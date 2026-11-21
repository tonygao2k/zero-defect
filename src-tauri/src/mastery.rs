use crate::{
    db::{self, one, parsed, query, text, AppResult},
    practice::question_key,
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
            .filter(|recheck| {
                recheck.cross_day_correct.is_none()
                    && recheck.due
                    && recheck.requirement.structure != Structure::Unknown
            })
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
    pub cross_day_correct: Option<bool>,
    pub due: bool,
    pub requirement: RecheckRequirement,
}

pub type GuidedRechecks = HashMap<(String, String), GuidedRecheck>;

pub fn guided_rechecks(i: &Inner, today: NaiveDate) -> AppResult<GuidedRechecks> {
    let rows = query(
        &i.db,
        "WITH guidance AS (
            SELECT q.root_cause_id,q.knowledge_point_id,q.session_id,q.revision_hint_at,q.difficulty,
                q.question_markdown,q.figure_json,q.verify_json,
                COALESCE(q.revision_hint_local_date,date(q.revision_hint_at,'localtime')) hint_day,ROW_NUMBER() OVER (
                PARTITION BY q.root_cause_id,q.knowledge_point_id ORDER BY q.revision_hint_at DESC,q.question_order DESC
            ) newest
            FROM valid_practice_questions q WHERE q.revision_hint_at IS NOT NULL
         ), candidates AS (
            SELECT a.*,q.rowid question_order,q.difficulty,q.question_markdown,q.figure_json,q.verify_json
            FROM independent_practice_evidence a JOIN practice_questions q ON q.id=a.practice_question_id
         )
         SELECT g.root_cause_id cause,g.knowledge_point_id point,g.revision_hint_at since,g.hint_day<?1 due,
                   g.hint_day,g.difficulty,g.question_markdown,g.figure_json,g.verify_json,
                   a.outcome='correct' correct,a.question_order,
                   a.question_markdown answer_markdown,a.figure_json answer_figure_json,a.verify_json answer_verify_json,
                   a.difficulty answer_difficulty,COALESCE(a.local_date,date(a.created_at,'localtime')) answer_day
            FROM guidance g LEFT JOIN candidates a
              ON a.root_cause_id=g.root_cause_id AND a.knowledge_point_id=g.knowledge_point_id
              AND julianday(a.created_at)>=julianday(g.revision_hint_at) AND a.session_id<>g.session_id
              AND NOT EXISTS (
                  SELECT 1 FROM practice_questions seen WHERE seen.session_id=g.session_id
                    AND seen.question_markdown=a.question_markdown
                    AND COALESCE(seen.figure_json,'null')=COALESCE(a.figure_json,'null')
              )
            WHERE g.newest=1 ORDER BY cause,point,julianday(a.created_at),a.attempt_order",
        &[&today.to_string()],
    )?;
    let mut result = HashMap::new();
    for group in rows
        .chunk_by(|left, right| left["cause"] == right["cause"] && left["point"] == right["point"])
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
            .filter(|(row, structure)| {
                row["answer_difficulty"]
                    .as_i64()
                    .is_some_and(|level| requirement.accepts(*structure, level))
                    && text(row, "answer_day") > text(row, "hint_day")
                    && !text(row, "hint_day").is_empty()
            })
            .map(|(row, _)| row)
            .peekable();
        let cross_day_correct = if cross_day.peek().is_some() {
            let variants = variant_orders(i, cause, point)?;
            cross_day
                .find(|row| {
                    row["question_order"]
                        .as_i64()
                        .is_some_and(|order| variants.contains(&order))
                })
                .map(|row| row["correct"] == 1)
        } else {
            None
        };
        result.insert(
            (cause.into(), point.into()),
            GuidedRecheck {
                since: text(first, "since").into(),
                correct,
                cross_day_correct,
                due: first["due"] == 1,
                requirement,
            },
        );
    }
    Ok(result)
}

fn variant_orders(i: &Inner, cause: &str, point: &str) -> AppResult<HashSet<i64>> {
    let originals = query(&i.db,"SELECT m.question_markdown FROM mistakes m JOIN mistake_root_causes cause ON cause.mistake_id=m.id AND cause.is_primary=1 WHERE cause.root_cause_id=?1 AND m.knowledge_point_id=?2 AND m.status='active'",&[&cause,&point])?;
    let original_keys = originals
        .iter()
        .map(|row| question_key(text(row, "question_markdown"), &Value::Null).0)
        .collect::<HashSet<_>>();
    let history = query(&i.db,"SELECT rowid question_order,question_markdown,figure_json FROM practice_questions WHERE root_cause_id=?1 AND knowledge_point_id=?2 ORDER BY rowid",&[&cause,&point])?;
    let mut keys = HashSet::new();
    Ok(history
        .iter()
        .filter_map(|row| {
            let key = question_key(text(row, "question_markdown"), &parsed(row, "figure_json"));
            if original_keys.contains(&key.0) || !keys.insert(key) {
                None
            } else {
                row["question_order"].as_i64()
            }
        })
        .collect())
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
            "waiting":guided.iter().filter(|item|item.cross_day_correct.is_none() && !item.due).count(),
            "due":guided.iter().filter(|item|item.cross_day_correct.is_none() && item.due).count(),
            "completed":guided.iter().filter(|item|item.cross_day_correct.is_some()).count(),
            "correct":guided.iter().filter(|item|item.cross_day_correct==Some(true)).count()
        },
        "guidedRecheck":{
            "pending":guided.iter().filter(|item|item.correct.is_none()).count(),
            "completed":guided.iter().filter(|item|item.correct.is_some()).count(),
            "correct":guided.iter().filter(|item|item.correct==Some(true)).count()
        }
    }))
}
