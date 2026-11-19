use crate::{
    db::{self, exec, one, parsed, query, text, transaction, AppResult},
    figure, repo,
    state::Inner,
};
use serde_json::{json, Value};

pub fn report(i: &Inner, input: &Value) -> AppResult<Value> {
    let id = repo::required(input, "questionId", 500)?;
    let reason = repo::required(input, "reason", 50)?;
    if !matches!(reason, "prompt" | "grading" | "explanation" | "other") {
        return Err("请选择题目问题的类型".into());
    }
    if one(&i.db, "SELECT 1 FROM practice_questions WHERE id=?1 AND session_id IS NOT NULL AND status IN ('assigned','answered')", &[&id])?.is_none() {
        return Err("找不到可申报的练习题".into());
    }
    exec(&i.db,
        "INSERT INTO practice_question_review_events(question_id,action,reason,created_at)
         SELECT ?1,'report',?2,?3 WHERE NOT EXISTS (SELECT 1 FROM practice_question_review_events WHERE question_id=?1)",
        &[&id,&reason,&db::now()])?;
    Ok(Value::Null)
}

pub fn list(i: &Inner) -> AppResult<Value> {
    let rows = query(
        &i.db,
        "SELECT q.id questionId,q.question_markdown questionMarkdown,q.answer_type answerType,
                q.options_json,q.figure_json,COALESCE(q.answer_unit,'') unit,
                CASE WHEN s.status<>'pending' THEN q.correct_answer END correctAnswer,
                CASE WHEN s.status<>'pending' THEN q.solution_markdown END solutionMarkdown,
                a.submitted_answer submittedAnswer,a.outcome outcome,r.action status,r.created_at updatedAt,
                reported.created_at reportedAt,reported.reason reason,
                CASE WHEN r.action='report' THEN NULL ELSE r.reason END decisionNote
         FROM practice_question_review_state r
         JOIN practice_questions q ON q.id=r.question_id
         JOIN practice_sessions s ON s.id=q.session_id
         LEFT JOIN answer_attempts a ON a.rowid=(SELECT first.rowid FROM answer_attempts first
             WHERE first.practice_question_id=q.id ORDER BY first.created_at,first.rowid LIMIT 1)
         JOIN practice_question_review_events reported ON reported.question_id=q.id AND reported.action='report'
         ORDER BY r.action='report' DESC,r.created_at DESC,reported.sequence DESC",
        &[],
    )?;
    Ok(json!(rows
        .into_iter()
        .map(|mut row| {
            row["figure"] = figure::validate(&parsed(&row, "figure_json")).unwrap_or(Value::Null);
            row["options"] = json!(parsed(&row, "options_json")
                .as_array()
                .cloned()
                .unwrap_or_default());
            let fields = row.as_object_mut().unwrap();
            fields.remove("figure_json");
            fields.remove("options_json");
            row
        })
        .collect::<Vec<_>>()))
}

pub fn resolve(i: &Inner, input: &Value) -> AppResult<Value> {
    let id = repo::required(input, "questionId", 500)?;
    let action = repo::required(input, "action", 20)?;
    let note = repo::required(input, "note", 200)?.trim();
    if !matches!(action, "keep" | "void" | "restore") {
        return Err("不支持的复核操作".into());
    }
    transaction(&i.db, || {
        let row = one(
            &i.db,
            "SELECT action FROM practice_question_review_state WHERE question_id=?1",
            &[&id],
        )?
        .ok_or("找不到该题的申报记录")?;
        let current = text(&row, "action");
        if current == action {
            return Ok(Value::Null);
        }
        if !matches!(
            (current, action),
            ("report", "keep" | "void") | ("void", "restore")
        ) {
            return Err("复核状态已经改变，请刷新后再操作".into());
        }
        exec(&i.db,"INSERT INTO practice_question_review_events(question_id,action,reason,created_at) VALUES (?1,?2,?3,?4)",&[&id,&action,&note,&db::now()])?;
        Ok(Value::Null)
    })
}
