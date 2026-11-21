use crate::{
    db::{self, exec, query, text, AppResult},
    practice,
    state::{AppState, Inner},
};
use serde_json::{json, Value};

pub async fn start(state: &AppState, input: &Value) -> AppResult<Value> {
    let id = text(input, "requestId");
    let track = uuid::Uuid::parse_str(id).is_ok();
    if track {
        if let Ok(i) = state.lock() {
            let _ = exec(
                &i.db,
                "INSERT OR IGNORE INTO practice_start_samples(id,started_at,status) VALUES (?1,?2,'pending')",
                &[&id, &db::now()],
            );
        }
    }
    let result = practice::start_with_path(state).await;
    if track {
        if let Ok(i) = state.lock() {
            match &result {
                Ok((_, path)) => {
                    let _ = exec(
                        &i.db,
                        "UPDATE practice_start_samples SET path=?2 WHERE id=?1 AND status='pending'",
                        &[&id, path],
                    );
                }
                Err(_) => {
                    let _ = finish(&i, &json!({"requestId":id,"failed":true}));
                }
            }
        }
    }
    result.map(|(session, _)| session)
}

pub fn finish(i: &Inner, input: &Value) -> AppResult<Value> {
    let id = text(input, "requestId");
    if uuid::Uuid::parse_str(id).is_err() {
        return Err("练习计时编号无效".into());
    }
    if input["failed"] == true {
        exec(
            &i.db,
            "UPDATE practice_start_samples SET status='failed' WHERE id=?1 AND status='pending'",
            &[&id],
        )?;
    } else {
        let elapsed = input["elapsedMs"]
            .as_i64()
            .filter(|ms| (0..=86400000).contains(ms))
            .ok_or("练习启动耗时无效")?;
        exec(
            &i.db,
            "UPDATE practice_start_samples SET status='ready',elapsed_ms=?2
             WHERE id=?1 AND path IS NOT NULL AND status='pending'",
            &[&id, &elapsed],
        )?;
    }
    Ok(Value::Null)
}

pub fn summary(i: &Inner) -> AppResult<Value> {
    let rows = query(
        &i.db,
        "SELECT path,status,elapsed_ms FROM practice_start_samples ORDER BY elapsed_ms",
        &[],
    )?;
    let summarize = |path: Option<&str>| {
        let rows = rows
            .iter()
            .filter(|row| path.is_none_or(|path| row["path"] == path));
        let successes = rows
            .clone()
            .filter(|row| row["status"] == "ready")
            .filter_map(|row| row["elapsed_ms"].as_i64())
            .collect::<Vec<_>>();
        let count = |status| rows.clone().filter(|row| row["status"] == status).count();
        let failed = count("failed");
        let interrupted = count("interrupted");
        let pending = count("pending");
        let completed = successes.len() + failed + interrupted;
        let percentile = |p: usize| {
            (!successes.is_empty()).then(|| successes[(successes.len() * p).div_ceil(100) - 1])
        };
        let mut summary = json!({
            "successCount":successes.len(),
            "p50Ms":percentile(50),"p90Ms":percentile(90)
        });
        if path.is_none() {
            summary["outcomes"] = json!({
                "failedCount":failed,"interruptedCount":interrupted,"pendingCount":pending,
                "failureRate":(completed > 0).then(|| failed as f64 / completed as f64)
            });
        }
        summary
    };
    let row = query(
        &i.db,
        "SELECT CASE WHEN json_valid(q.verify_json) THEN json_extract(q.verify_json,'$.source') END source,
                COUNT(*) reviewed,SUM(r.action='void') invalid
         FROM practice_question_review_state r JOIN practice_questions q ON q.id=r.question_id
         WHERE r.action IN ('void','keep','restore') GROUP BY source",
        &[],
    )?;
    let reviewed_quality = |source: &str| {
        let row = row
            .iter()
            .find(|row| row["source"].as_str().unwrap_or("legacy") == source);
        let reviewed = row.and_then(|row| row["reviewed"].as_u64()).unwrap_or(0);
        let invalid = row.and_then(|row| row["invalid"].as_u64()).unwrap_or(0);
        json!({"reviewedCount":reviewed,"invalidCount":invalid,"invalidRate":(reviewed > 0).then(|| invalid as f64 / reviewed as f64)})
    };
    Ok(json!({
        "overall":summarize(None),
        "ready":summarize(Some("ready")),
        "online":summarize(Some("online")),
        "resume":summarize(Some("resume")),
        "reviewedQuality":{"template":reviewed_quality("template"),"ai":reviewed_quality("ai"),"legacy":reviewed_quality("legacy")}
    }))
}
