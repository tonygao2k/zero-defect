use crate::{
    db::{one, query, text, AppResult},
    state::Inner,
};
use chrono::{DateTime, Local, Utc};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
#[derive(Clone, Debug)]
pub struct Pair {
    pub cause: String,
    pub point: String,
    pub mastered: bool,
    pub streak: usize,
    pub review_due: bool,
}
pub fn evaluate(events: &[(bool, String)], now: DateTime<Utc>) -> (bool, usize, bool) {
    let mut events = events.to_vec();
    events.sort_by(|a, b| a.1.cmp(&b.1));
    let mut streak = 0;
    let mut days = HashSet::new();
    let mut mastered_at = None;
    let mut attempts = 0;
    for (correct, at) in events {
        if !correct {
            streak = 0;
            days.clear();
            mastered_at = None;
            attempts = 0;
            continue;
        }
        streak += 1;
        let parsed = DateTime::parse_from_rfc3339(&at).ok();
        if let Some(date) = parsed {
            days.insert(date.with_timezone(&Local).format("%Y-%m-%d").to_string());
        }
        if mastered_at.is_some() {
            attempts += 1;
        } else if streak >= 3 && days.len() >= 2 {
            mastered_at = parsed.map(|d| d.with_timezone(&Utc));
            attempts = 0;
        }
    }
    (
        mastered_at.is_some(),
        streak,
        mastered_at.is_some_and(|d| {
            attempts == 0 && now.signed_duration_since(d).num_seconds() >= 7 * 86400
        }),
    )
}
pub fn pairs(i: &Inner) -> AppResult<Vec<Pair>> {
    let rows=query(&i.db,"SELECT DISTINCT mrc.root_cause_id cause,m.knowledge_point_id point FROM mistakes m JOIN mistake_root_causes mrc ON mrc.mistake_id=m.id AND mrc.is_primary=1 WHERE m.status='active' AND m.knowledge_point_id IS NOT NULL AND m.grade=?1 AND(m.semester IS NULL OR m.semester=?2)",&[&i.settings.grade,&i.settings.semester])?;
    let mut out = Vec::new();
    for row in rows {
        let cause = text(&row, "cause").to_owned();
        let point = text(&row, "point").to_owned();
        let mistakes=query(&i.db,"SELECT m.updated_at at FROM mistakes m JOIN mistake_root_causes mrc ON mrc.mistake_id=m.id AND mrc.is_primary=1 WHERE m.status='active' AND mrc.root_cause_id=?1 AND m.knowledge_point_id=?2",&[&cause,&point])?;
        let attempts=query(&i.db,"SELECT is_correct correct,created_at at FROM answer_attempts WHERE root_cause_id=?1 AND knowledge_point_id=?2",&[&cause,&point])?;
        let mut events = mistakes
            .iter()
            .map(|m| (false, text(m, "at").to_owned()))
            .collect::<Vec<_>>();
        events.extend(
            attempts
                .iter()
                .map(|a| (a["correct"] == 1, text(a, "at").to_owned())),
        );
        let (mastered, streak, review_due) = evaluate(&events, Utc::now());
        out.push(Pair {
            cause,
            point,
            mastered,
            streak,
            review_due,
        });
    }
    Ok(out)
}
pub fn stats(i: &Inner) -> AppResult<Value> {
    let pairs = pairs(i)?;
    let mut by_point = HashMap::new();
    for p in &pairs {
        let v = by_point.entry(&p.point).or_insert(true);
        *v &= p.mastered;
    }
    let mastered = by_point.values().filter(|v| **v).count();
    let count=one(&i.db,"SELECT COUNT(*) n FROM mistakes m WHERE m.status='active' AND m.grade=?1 AND(m.semester IS NULL OR m.semester=?2)",&[&i.settings.grade,&i.settings.semester])?.unwrap()["n"].clone();
    let answered = one(
        &i.db,
        "SELECT COUNT(*) n FROM answer_attempts WHERE skipped=0",
        &[],
    )?
    .unwrap()["n"]
        .clone();
    Ok(
        json!({"mistakeCount":count,"knowledgePointCount":by_point.len(),"answeredCount":answered,"masteredKnowledgePoints":mastered,"remainingKnowledgePoints":by_point.len()-mastered,"practiceablePairs":pairs.iter().filter(|p|!p.mastered||p.review_due).count()}),
    )
}
