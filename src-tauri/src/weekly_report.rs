use crate::{
    db::{one, parsed, query, text, AppResult},
    figure,
    mastery::{self, Pair},
    practice,
    state::Inner,
};
use chrono::{Datelike, Days, Local, NaiveDate, Weekday};
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashMap};

#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
struct Topic {
    point: String,
    cause: String,
    independent_count: usize,
    independent_correct: usize,
    mistake_count: usize,
    hint_count: usize,
    unsure_count: usize,
    recheck_count: usize,
    next: Option<NextPractice>,
    records: Vec<Record>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NextPractice {
    kind: &'static str,
    date: Option<NaiveDate>,
}

#[derive(Serialize)]
struct DuePractice {
    point: String,
    cause: String,
    recheck: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Record {
    id: String,
    date: String,
    kind: String,
    question_markdown: String,
    figure: Option<Value>,
    options: Vec<Value>,
    submitted_answer: String,
    correct_answer: String,
    unit: String,
    hint_date: Option<NaiveDate>,
}

fn next_practice(pair: &Pair, recheck: Option<&mastery::GuidedRecheck>) -> NextPractice {
    let (kind, date) =
        if let Some(recheck) = recheck.filter(|item| item.awaiting_compatible_answer()) {
            (
                if recheck.due {
                    "recheck"
                } else {
                    "recheck_later"
                },
                None,
            )
        } else if pair.waiting_for_recovery {
            ("retry", pair.review_date)
        } else if pair.unsure_due || !pair.mastered {
            ("reinforce", None)
        } else {
            ("review", pair.review_date.filter(|_| !pair.review_due))
        };
    NextPractice { kind, date }
}

pub fn get(i: &Inner, input: &Value) -> AppResult<Value> {
    report_on(i, input, Local::now().date_naive())
}

pub fn report_on(i: &Inner, input: &Value, today: NaiveDate) -> AppResult<Value> {
    let current_start = today - Days::new(today.weekday().num_days_from_monday().into());
    let start = if input["weekStart"].is_null() {
        current_start
    } else {
        text(input, "weekStart")
            .parse::<NaiveDate>()
            .ok()
            .filter(|date| {
                date.weekday() == Weekday::Mon && date.year() >= 1 && *date <= current_start
            })
            .ok_or("请选择本周或更早的一周")?
    };
    let end = start + Days::new(6);
    let through = end.min(today);
    let is_current = start == current_start;
    let from = start.to_string();
    let to = through.to_string();

    let guidance = mastery::weekly_guidance(i, start, through)?;
    let recheck_dates = guidance
        .iter()
        .filter_map(|hint| {
            let answer = hint.recheck.cross_day.as_ref()?;
            (answer.date >= start).then_some((answer.question_id.as_str(), hint.date))
        })
        .collect::<HashMap<_, _>>();
    let rows = query(
        &i.db,
        "WITH activity AS (
            SELECT m.id,mrc.root_cause_id cause,m.knowledge_point_id point,'mistake' kind,
                   COALESCE(m.confirmed_evidence_local_date,date(m.confirmed_evidence_at,'localtime')) day,
                   m.confirmed_evidence_at at,m.rowid sequence,NULL question_order,m.student_answer answer
            FROM mistakes m JOIN mistake_root_causes mrc ON mrc.mistake_id=m.id AND mrc.is_primary=1
            WHERE m.status='active' AND m.confirmed_evidence_at IS NOT NULL
              AND m.grade=?3 AND (m.semester IS NULL OR m.semester=?4)
            UNION ALL
            SELECT a.practice_question_id,a.root_cause_id,a.knowledge_point_id,
                   CASE WHEN a.used_hint<>0 THEN 'assisted' ELSE a.outcome END,
                   COALESCE(a.local_date,date(a.created_at,'localtime')),a.created_at,a.attempt_order,q.rowid,a.submitted_answer
            FROM practice_first_answers a JOIN practice_questions q ON q.id=a.practice_question_id
            JOIN practice_sessions s ON s.id=a.session_id
            WHERE s.status IN ('submitted','completed') AND (
                a.outcome='unsure'
                OR EXISTS (SELECT 1 FROM independent_practice_evidence e WHERE e.practice_question_id=a.practice_question_id)
                OR (a.used_hint<>0 AND TRIM(a.submitted_answer)<>'')
            )
            UNION ALL
            SELECT q.id,q.root_cause_id,q.knowledge_point_id,'hint',
                   COALESCE(q.revision_hint_local_date,date(q.revision_hint_at,'localtime')),
                   q.revision_hint_at,q.question_order,NULL,NULL
            FROM valid_practice_questions q JOIN practice_sessions s ON s.id=q.session_id
            WHERE q.revision_hint_at IS NOT NULL AND s.status IN ('submitted','completed')
         )
         SELECT a.*,kp.label point_label,rc.label cause_label,
                COALESCE(q.question_markdown,m.question_markdown) markdown,
                COALESCE(q.correct_answer,m.correct_answer) expected,q.options_json,q.figure_json,q.answer_unit
         FROM activity a JOIN knowledge_points kp ON kp.id=a.point JOIN root_causes rc ON rc.id=a.cause
         LEFT JOIN mistakes m ON a.kind='mistake' AND m.id=a.id
         LEFT JOIN practice_questions q ON a.kind<>'mistake' AND q.id=a.id
         WHERE a.day BETWEEN ?1 AND ?2
         ORDER BY a.day DESC,julianday(a.at) DESC,a.kind,a.sequence DESC",
        &[&from, &to, &i.settings.grade, &i.settings.semester],
    )?;

    let mut topics = BTreeMap::<(String, String), Topic>::new();
    let mut variants = HashMap::new();
    for row in &rows {
        let cause = text(row, "cause");
        let point = text(row, "point");
        let id = text(row, "id");
        let kind = text(row, "kind");
        let independent = matches!(kind, "correct" | "wrong");
        if independent {
            let orders = match variants.entry((cause, point)) {
                std::collections::hash_map::Entry::Occupied(entry) => entry.into_mut(),
                std::collections::hash_map::Entry::Vacant(entry) => {
                    entry.insert(mastery::variant_orders(i, cause, point)?)
                }
            };
            if !row["question_order"]
                .as_i64()
                .is_some_and(|order| orders.contains(&order))
            {
                continue;
            }
        }
        let topic = topics
            .entry((cause.into(), point.into()))
            .or_insert_with(|| Topic {
                point: text(row, "point_label").into(),
                cause: text(row, "cause_label").into(),
                ..Default::default()
            });
        let hint_date = if independent {
            recheck_dates.get(id).copied()
        } else {
            None
        };
        topic.independent_count += usize::from(independent);
        topic.independent_correct += usize::from(kind == "correct");
        topic.recheck_count += usize::from(hint_date.is_some());
        topic.hint_count += usize::from(matches!(kind, "hint" | "assisted"));
        topic.mistake_count += usize::from(kind == "mistake");
        topic.unsure_count += usize::from(kind == "unsure");
        topic.records.push(Record {
            id: id.into(),
            date: text(row, "day").into(),
            kind: kind.into(),
            question_markdown: text(row, "markdown").into(),
            figure: figure::validate(&parsed(row, "figure_json")),
            options: parsed(row, "options_json")
                .as_array()
                .cloned()
                .unwrap_or_default(),
            submitted_answer: text(row, "answer").into(),
            correct_answer: text(row, "expected").into(),
            unit: text(row, "answer_unit").into(),
            hint_date,
        });
    }
    let mut due_practice = Vec::new();
    if is_current {
        let rechecks = mastery::guided_rechecks(i, today)?;
        let pairs = mastery::pairs_on(i, today)?;
        for assignment in
            practice::select_pairs(pairs.clone(), &rechecks, i.settings.practice_question_count)
        {
            let pair = &assignment.pair;
            let recheck = pair.pending_guidance(&rechecks).is_some();
            if !pair.review_due && !recheck {
                continue;
            }
            let labels = one(
                &i.db,
                "SELECT kp.label point,rc.label cause FROM knowledge_points kp,root_causes rc
                 WHERE kp.id=?1 AND rc.id=?2",
                &[&pair.point, &pair.cause],
            )?
            .ok_or("找不到待复习的知识点")?;
            due_practice.push(DuePractice {
                point: text(&labels, "point").into(),
                cause: text(&labels, "cause").into(),
                recheck,
            });
        }
        for pair in pairs {
            let key = (pair.cause.clone(), pair.point.clone());
            if let Some(topic) = topics.get_mut(&key) {
                topic.next = Some(next_practice(&pair, rechecks.get(&key)));
            }
        }
    }
    let mut topics = topics.into_values().collect::<Vec<_>>();
    topics.sort_by(|left, right| {
        let priority = |topic: &Topic| {
            topic.mistake_count + topic.unsure_count + topic.independent_count
                - topic.independent_correct
        };
        priority(right)
            .cmp(&priority(left))
            .then_with(|| left.point.cmp(&right.point))
    });
    let independent_count: usize = topics.iter().map(|topic| topic.independent_count).sum();
    let independent_correct: usize = topics.iter().map(|topic| topic.independent_correct).sum();
    let recheck_count: usize = topics.iter().map(|topic| topic.recheck_count).sum();
    Ok(json!({
        "start":start,"end":end,"isCurrent":is_current,
        "previousStart":start.checked_sub_days(Days::new(7)).filter(|date| date.year()>=1),
        "nextStart":(!is_current).then(|| start + Days::new(7)),
        "independentCount":independent_count,"independentCorrect":independent_correct,
        "recheckCount":recheck_count,"topics":topics,"duePractice":due_practice,
    }))
}
