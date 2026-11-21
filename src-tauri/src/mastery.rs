use crate::{
    db::{self, one, parsed, query, text, AppResult},
    practice::variant_key,
    practice_structure::{RecheckRequirement, Structure},
    schedule::Projection,
    state::{Inner, PracticeDifficulty},
};
use chrono::{DateTime, Days, Local, NaiveDate};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
#[derive(Clone, Debug)]
pub struct Pair {
    pub cause: String,
    pub point: String,
    pub mastered: bool,
    pub streak: usize,
    pub review_due: bool,
    pub review_date: Option<NaiveDate>,
    pub waiting_for_recovery: bool,
    pub unsure_due: bool,
}

impl Pair {
    fn guidance<'a>(&self, rechecks: &'a GuidedRechecks) -> Option<&'a GuidedRecheck> {
        rechecks
            .get(&(self.cause.clone(), self.point.clone()))
            .filter(|recheck| recheck.due && recheck.awaiting_compatible_answer())
    }

    pub fn pending_guidance<'a>(&self, rechecks: &'a GuidedRechecks) -> Option<&'a str> {
        self.guidance(rechecks)
            .map(|recheck| recheck.since.as_str())
    }

    pub fn pending_guidance_requirement<'a>(
        &self,
        rechecks: &'a GuidedRechecks,
    ) -> Option<&'a RecheckRequirement> {
        self.guidance(rechecks).map(|recheck| &recheck.requirement)
    }

    pub fn practiceable(&self, rechecks: &GuidedRechecks) -> bool {
        (!self.mastered && !self.waiting_for_recovery)
            || self.review_due
            || self.unsure_due
            || self.pending_guidance(rechecks).is_some()
    }
}

pub struct GuidedRecheck {
    pub since: String,
    pub correct: Option<bool>,
    pub cross_day: Option<RecheckAnswer>,
    pub due: bool,
    pub requirement: RecheckRequirement,
}

impl GuidedRecheck {
    pub fn awaiting_compatible_answer(&self) -> bool {
        self.cross_day.is_none() && self.requirement.structure != Structure::Unknown
    }
}

pub struct RecheckAnswer {
    pub question_id: String,
    pub date: NaiveDate,
    pub correct: bool,
}

pub struct GuidanceEvidence {
    pub cause: String,
    pub point: String,
    pub date: NaiveDate,
    pub recheck: GuidedRecheck,
}

pub type GuidedRechecks = HashMap<(String, String), GuidedRecheck>;

pub fn guided_rechecks(i: &Inner, today: NaiveDate) -> AppResult<GuidedRechecks> {
    Ok(project_guidance(i, today, None)?
        .into_iter()
        .map(|hint| ((hint.cause, hint.point), hint.recheck))
        .collect())
}

pub fn weekly_guidance(
    i: &Inner,
    start: NaiveDate,
    through: NaiveDate,
) -> AppResult<Vec<GuidanceEvidence>> {
    project_guidance(i, through, Some(start))
}

fn project_guidance(
    i: &Inner,
    through: NaiveDate,
    week_start: Option<NaiveDate>,
) -> AppResult<Vec<GuidanceEvidence>> {
    let rows = query(
        &i.db,
        "WITH hints AS (
            SELECT q.id,q.root_cause_id,q.knowledge_point_id,q.session_id,q.revision_hint_at,q.difficulty,
                q.question_markdown,q.figure_json,q.verify_json,q.question_order,
                COALESCE(q.revision_hint_local_date,date(q.revision_hint_at,'localtime')) hint_day
            FROM valid_practice_questions q JOIN practice_sessions s ON s.id=q.session_id
            WHERE q.revision_hint_at IS NOT NULL AND s.status IN ('submitted','completed')
         ), guidance AS (
            SELECT hints.*,
                LEAD(revision_hint_at) OVER timeline next_hint_at
            FROM hints WHERE hint_day IS NOT NULL AND (?2 IS NULL OR hint_day<=?1)
            WINDOW timeline AS (PARTITION BY root_cause_id,knowledge_point_id
                ORDER BY julianday(revision_hint_at),question_order)
         ), candidates AS (
            SELECT a.*,q.rowid question_order,q.difficulty,q.question_markdown,q.figure_json,q.verify_json,
                COALESCE(a.local_date,date(a.created_at,'localtime')) answer_day
            FROM independent_practice_evidence a JOIN practice_questions q ON q.id=a.practice_question_id
            JOIN practice_sessions s ON s.id=a.session_id WHERE s.status IN ('submitted','completed')
         )
         SELECT g.id hint_question_id,g.root_cause_id cause,g.knowledge_point_id point,g.revision_hint_at since,g.hint_day<?1 due,
                   g.hint_day,g.difficulty,g.question_markdown,g.figure_json,g.verify_json,
                   a.outcome='correct' correct,a.question_order,a.practice_question_id answer_question_id,
                   a.question_markdown answer_markdown,a.figure_json answer_figure_json,a.verify_json answer_verify_json,
                   a.difficulty answer_difficulty,a.answer_day
            FROM guidance g LEFT JOIN candidates a
              ON a.root_cause_id=g.root_cause_id AND a.knowledge_point_id=g.knowledge_point_id
              AND julianday(a.created_at)>=julianday(g.revision_hint_at) AND a.session_id<>g.session_id
              AND (g.next_hint_at IS NULL OR julianday(a.created_at)<julianday(g.next_hint_at))
              AND (?2 IS NULL OR a.answer_day<=?1)
              AND NOT EXISTS (
                  SELECT 1 FROM practice_questions seen WHERE seen.session_id=g.session_id
                    AND seen.question_markdown=a.question_markdown
                    AND COALESCE(seen.figure_json,'null')=COALESCE(a.figure_json,'null')
              )
            WHERE g.next_hint_at IS NULL OR ?2 IS NOT NULL
            ORDER BY cause,point,julianday(g.revision_hint_at),g.question_order,julianday(a.created_at),a.attempt_order",
        &[&through.to_string(), &week_start.map(|date| date.to_string())],
    )?;
    let mut result = Vec::new();
    let mut variants = HashMap::new();
    for group in rows.chunk_by(|left, right| left["hint_question_id"] == right["hint_question_id"])
    {
        let first = &group[0];
        let cause = text(first, "cause");
        let point = text(first, "point");
        let requirement = RecheckRequirement {
            structure: Structure::from_storage(
                text(first, "question_markdown"),
                first["figure_json"].as_str(),
                &parsed(first, "verify_json"),
            ),
            level: PracticeDifficulty::from_code(first["difficulty"].as_i64().unwrap_or(1)),
        };
        let candidates = group
            .iter()
            .filter(|row| row["correct"].is_i64())
            .map(|row| {
                let structure = Structure::from_storage(
                    text(row, "answer_markdown"),
                    row["answer_figure_json"].as_str(),
                    &parsed(row, "answer_verify_json"),
                );
                (row, structure)
            });
        let correct = candidates.clone().find_map(|(row, structure)| {
            requirement
                .accepts_structure(structure)
                .then(|| row["correct"] == 1)
        });
        let mut cross_day = candidates
            .filter_map(|(row, structure)| {
                let date = text(row, "answer_day").parse::<NaiveDate>().ok()?;
                (row["answer_difficulty"]
                    .as_i64()
                    .is_some_and(|level| requirement.accepts(structure, level))
                    && text(row, "answer_day") > text(row, "hint_day")
                    && !text(row, "hint_day").is_empty())
                .then_some((row, date))
            })
            .peekable();
        let cross_day = if cross_day.peek().is_some() {
            let orders = match variants.entry((cause, point)) {
                std::collections::hash_map::Entry::Occupied(entry) => entry.into_mut(),
                std::collections::hash_map::Entry::Vacant(entry) => {
                    entry.insert(variant_orders(i, cause, point)?)
                }
            };
            cross_day
                .find(|(row, _)| {
                    row["question_order"]
                        .as_i64()
                        .is_some_and(|order| orders.contains(&order))
                })
                .map(|(row, date)| RecheckAnswer {
                    question_id: text(row, "answer_question_id").into(),
                    date,
                    correct: row["correct"] == 1,
                })
        } else {
            None
        };
        let Ok(date) = text(first, "hint_day").parse() else {
            continue;
        };
        if week_start.is_some_and(|start| {
            date < start && cross_day.as_ref().is_none_or(|answer| answer.date < start)
        }) {
            continue;
        }
        result.push(GuidanceEvidence {
            cause: cause.into(),
            point: point.into(),
            date,
            recheck: GuidedRecheck {
                since: text(first, "since").into(),
                correct,
                cross_day,
                due: first["due"] == 1,
                requirement,
            },
        });
    }
    Ok(result)
}

pub fn variant_orders(i: &Inner, cause: &str, point: &str) -> AppResult<HashSet<i64>> {
    let history = query(
        &i.db,
        "SELECT rowid question_order,question_markdown,figure_json FROM practice_questions
         WHERE root_cause_id=?1 AND knowledge_point_id=?2 AND matches_original_at_dispatch=0
         ORDER BY rowid",
        &[&cause, &point],
    )?;
    let mut keys = HashSet::new();
    let mut orders = HashSet::new();
    for row in &history {
        let key = variant_key(text(row, "question_markdown"), &parsed(row, "figure_json"));
        if keys.insert(key) {
            orders.extend(row["question_order"].as_i64());
        }
    }
    Ok(orders)
}
#[cfg(test)]
pub fn pairs(i: &Inner) -> AppResult<Vec<Pair>> {
    pairs_on(i, Local::now().date_naive())
}

pub fn pairs_on(i: &Inner, today: NaiveDate) -> AppResult<Vec<Pair>> {
    let origin = one(
        &i.db,
        "SELECT local_date FROM practice_schedule_origin",
        &[],
    )?
    .and_then(|row| text(&row, "local_date").parse::<NaiveDate>().ok())
    .ok_or("找不到复习排程的起始日期")?;
    let rows=query(&i.db,"SELECT DISTINCT mrc.root_cause_id cause,m.knowledge_point_id point FROM mistakes m JOIN mistake_root_causes mrc ON mrc.mistake_id=m.id AND mrc.is_primary=1 WHERE m.status='active' AND m.knowledge_point_id IS NOT NULL AND m.grade=?1 AND(m.semester IS NULL OR m.semester=?2)",&[&i.settings.grade,&i.settings.semester])?;
    let mut out = Vec::new();
    for row in rows {
        let cause = text(&row, "cause").to_owned();
        let point = text(&row, "point").to_owned();
        let mistakes=query(&i.db,"SELECT m.confirmed_evidence_at at,m.confirmed_evidence_local_date day FROM mistakes m JOIN mistake_root_causes mrc ON mrc.mistake_id=m.id AND mrc.is_primary=1 WHERE m.status='active' AND mrc.root_cause_id=?1 AND m.knowledge_point_id=?2 AND m.confirmed_evidence_at IS NOT NULL AND m.grade=?3 AND (m.semester IS NULL OR m.semester=?4) ORDER BY m.rowid",&[&cause,&point,&i.settings.grade,&i.settings.semester])?;
        let attempts=query(&i.db,"SELECT a.outcome='correct' correct,a.created_at at,a.local_date day,q.question_order
            FROM independent_practice_evidence a JOIN valid_practice_questions q ON q.id=a.practice_question_id
            WHERE a.root_cause_id=?1 AND a.knowledge_point_id=?2 ORDER BY a.created_at,a.attempt_order",&[&cause,&point])?;
        let unsure_due = one(
            &i.db,
            "SELECT EXISTS (
                SELECT 1 FROM practice_first_answers unsure
                JOIN practice_questions original ON original.id=unsure.practice_question_id
                WHERE unsure.root_cause_id=?1 AND unsure.knowledge_point_id=?2 AND unsure.outcome='unsure'
                  AND NOT EXISTS (
                    SELECT 1 FROM independent_practice_evidence later
                    JOIN practice_questions variant ON variant.id=later.practice_question_id
                    WHERE later.root_cause_id=unsure.root_cause_id AND later.knowledge_point_id=unsure.knowledge_point_id
                      AND (later.created_at,later.attempt_order)>(unsure.created_at,unsure.attempt_order)
                      AND later.session_id<>unsure.session_id
                      AND (variant.question_markdown<>original.question_markdown
                           OR COALESCE(variant.figure_json,'null')<>COALESCE(original.figure_json,'null'))
                  )
            ) due",
            &[&cause, &point],
        )?.is_some_and(|row| row["due"]==1);
        let variants = if attempts.is_empty() {
            HashSet::new()
        } else {
            variant_orders(i, &cause, &point)?
        };
        let mut events = mistakes
            .iter()
            .filter(|row| !row["at"].is_null())
            .map(|row| (row, false, false))
            .collect::<Vec<_>>();
        events.extend(attempts.iter().map(|row| {
            (
                row,
                row["correct"] == 1,
                row["question_order"]
                    .as_i64()
                    .is_some_and(|position| variants.contains(&position)),
            )
        }));
        events.sort_by_key(|(row, _, _)| DateTime::parse_from_rfc3339(text(row, "at")).ok());
        let stagger = cause
            .bytes()
            .chain(point.bytes())
            .map(u64::from)
            .sum::<u64>()
            % 7;
        let legacy_start = origin + Days::new(1 + stagger);
        let mut projection = Projection::default();
        for (row, correct, variant) in events {
            if let Some(day) = text(row, "day")
                .parse()
                .ok()
                .or_else(|| db::local_date(text(row, "at")))
            {
                projection.record(
                    day,
                    correct,
                    variant && day >= origin,
                    if day < origin { legacy_start } else { day },
                );
            }
        }
        let review_date = projection.review.map(|review| review.due);
        out.push(Pair {
            cause,
            point,
            mastered: projection.mastered,
            streak: projection.streak,
            review_due: review_date.is_some_and(|day| day <= today),
            review_date,
            waiting_for_recovery: projection.waiting_for_recovery(today),
            unsure_due,
        });
    }
    Ok(out)
}
pub fn stats(i: &Inner) -> AppResult<Value> {
    stats_on(i, Local::now().date_naive())
}

pub fn stats_on(i: &Inner, today: NaiveDate) -> AppResult<Value> {
    let pairs = pairs_on(i, today)?;
    let rechecks = guided_rechecks(i, today)?;
    let daily = crate::practice::daily_status(i, today, &pairs, &rechecks)?;
    let guided = pairs
        .iter()
        .filter_map(|pair| rechecks.get(&(pair.cause.clone(), pair.point.clone())))
        .collect::<Vec<_>>();
    let mut by_point = HashMap::new();
    for p in &pairs {
        let v = by_point.entry(&p.point).or_insert(true);
        *v &= p.mastered;
    }
    let mastered = by_point.values().filter(|v| **v).count();
    let count=one(&i.db,"SELECT COUNT(*) n FROM mistakes m WHERE m.status='active' AND m.grade=?1 AND(m.semester IS NULL OR m.semester=?2)",&[&i.settings.grade,&i.settings.semester])?.unwrap()["n"].clone();
    let answered = one(
        &i.db,
        "SELECT COUNT(*) n FROM independent_practice_evidence",
        &[],
    )?
    .unwrap()["n"]
        .clone();
    Ok(json!({
        "mistakeCount":count,"knowledgePointCount":by_point.len(),"answeredCount":answered,
        "masteredKnowledgePoints":mastered,"remainingKnowledgePoints":by_point.len()-mastered,
        "practiceablePairs":pairs.iter().filter(|p|p.practiceable(&rechecks)).count(),
        "dailyPractice":daily,
        "unsureRecheckPending":pairs.iter().filter(|p|p.unsure_due).count(),
        "crossDayRecheck":{
            "waiting":guided.iter().filter(|item|item.cross_day.is_none() && !item.due).count(),
            "due":guided.iter().filter(|item|item.cross_day.is_none() && item.due).count(),
            "completed":guided.iter().filter(|item|item.cross_day.is_some()).count(),
            "correct":guided.iter().filter(|item|item.cross_day.as_ref().is_some_and(|answer| answer.correct)).count()
        },
        "guidedRecheck":{
            "pending":guided.iter().filter(|item|item.correct.is_none()).count(),
            "completed":guided.iter().filter(|item|item.correct.is_some()).count(),
            "correct":guided.iter().filter(|item|item.correct==Some(true)).count()
        }
    }))
}
