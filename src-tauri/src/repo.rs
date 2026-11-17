use crate::{
    db::{self, exec, one, parsed, query, text, transaction, AppResult},
    state::{data_url, Inner},
};
use serde_json::{json, Value};
use std::fs;

pub fn causes(i: &Inner) -> AppResult<Vec<Value>> {
    query(&i.db,"SELECT code,label,COALESCE(description,'') description FROM root_causes WHERE active=1 ORDER BY code",&[])
}
pub fn points(i: &Inner, curriculum: &str, grade: i64) -> AppResult<Vec<Value>> {
    let mut rows=query(&i.db,"SELECT kp.id,kp.code,kp.label,ck.grade,ck.semester FROM curriculum_knowledge_points ck JOIN knowledge_points kp ON kp.id=ck.knowledge_point_id WHERE ck.curriculum_id=?1 AND ck.grade<=?2 AND kp.active=1 ORDER BY ck.grade,ck.semester,ck.sort_order",&[&curriculum,&grade])?;
    rows.extend(query(&i.db,"SELECT id,code,label,NULL grade,NULL semester FROM knowledge_points WHERE stage='any' AND active=1 ORDER BY code",&[])?);
    Ok(rows)
}
pub fn taxonomy(i: &Inner) -> AppResult<Value> {
    Ok(
        json!({"causes":causes(i)?,"knowledgePoints":points(i,&i.settings.curriculum_id,i.settings.grade)?}),
    )
}
pub fn papers(i: &Inner, all: bool) -> AppResult<Value> {
    Ok(json!(query(&i.db,"SELECT p.id,p.title,p.status,p.error_message errorMessage,p.created_at createdAt,(SELECT COUNT(*) FROM mistakes m WHERE m.paper_id=p.id) totalCount,(SELECT COUNT(*) FROM mistakes m WHERE m.paper_id=p.id AND m.status IN ('draft','unattributed')) pendingCount FROM papers p WHERE (?1=1 OR(p.grade=?2 AND(p.semester IS NULL OR p.semester=?3))) ORDER BY p.created_at DESC,p.rowid DESC",&[&all,&i.settings.grade,&i.settings.semester])?))
}
pub fn paper(i: &Inner, id: &str) -> AppResult<Value> {
    one(&i.db, "SELECT * FROM papers WHERE id=?1", &[&id])?.ok_or("找不到这份试卷".into())
}
pub fn pages(i: &Inner, id: &str) -> AppResult<Vec<Value>> {
    query(
        &i.db,
        "SELECT * FROM paper_pages WHERE paper_id=?1 ORDER BY position",
        &[&id],
    )
}
pub fn title(raw: &str) -> String {
    let t = raw.trim();
    if t.is_empty() {
        chrono::Local::now()
            .format("%Y年%-m月%-d日 %-H时")
            .to_string()
    } else {
        t.chars().take(50).collect()
    }
}
pub fn rename(i: &Inner, input: &Value) -> AppResult<Value> {
    let id = required(input, "paperId", 500)?;
    let t = title(text(input, "title"));
    if exec(
        &i.db,
        "UPDATE papers SET title=?1,updated_at=?2 WHERE id=?3",
        &[&t, &db::now(), &id],
    )? == 0
    {
        return Err("找不到这份试卷".into());
    }
    Ok(Value::Null)
}
pub fn remove_mistake(i: &Inner, id: &str) -> AppResult<()> {
    if one(&i.db, "SELECT id FROM mistakes WHERE id=?1", &[&id])?.is_none() {
        return Err("找不到这道错题".into());
    }
    transaction(&i.db, || remove_mistake_rows(i, id))
}
fn remove_mistake_rows(i: &Inner, id: &str) -> AppResult<()> {
    exec(
        &i.db,
        "UPDATE practice_questions SET source_mistake_id=NULL WHERE source_mistake_id=?1",
        &[&id],
    )?;
    exec(
        &i.db,
        "DELETE FROM mistake_root_causes WHERE mistake_id=?1",
        &[&id],
    )?;
    exec(&i.db, "DELETE FROM mistakes WHERE id=?1", &[&id])?;
    Ok(())
}
pub fn remove_paper(i: &Inner, id: &str) -> AppResult<()> {
    paper(i, id)?;
    let paths = pages(i, id)?;
    transaction(&i.db, || {
        for row in query(&i.db, "SELECT id FROM mistakes WHERE paper_id=?1", &[&id])? {
            remove_mistake_rows(i, text(&row, "id"))?;
        }
        exec(&i.db, "DELETE FROM papers WHERE id=?1", &[&id])?;
        Ok(())
    })?;
    for row in paths {
        let path = text(&row, "image_path");
        if one(
            &i.db,
            "SELECT id FROM paper_pages WHERE image_path=?1",
            &[&path],
        )?
        .is_none()
        {
            i.remove_stored(path)?;
        }
    }
    Ok(())
}
pub fn mistakes(i: &Inner, input: &Value) -> AppResult<Value> {
    let status = text(input, "status");
    if !["", "pending", "confirmed"].contains(&status) {
        return Err("错题筛选条件不合法".into());
    }
    let pid = text(input, "paperId");
    let rows=query(&i.db,"SELECT m.id,m.status,m.paper_id paperId,m.question_markdown questionMarkdown,m.incomplete,m.analysis_json aj,m.created_at createdAt,kp.label knowledgePointLabel,(SELECT rc.label FROM mistake_root_causes mrc JOIN root_causes rc ON rc.id=mrc.root_cause_id WHERE mrc.mistake_id=m.id AND mrc.is_primary=1) primaryRootCauseLabel FROM mistakes m LEFT JOIN knowledge_points kp ON kp.id=m.knowledge_point_id WHERE (?1='' OR (?1='pending' AND m.status IN ('draft','unattributed')) OR (?1='confirmed' AND m.status='active')) AND (?2='' OR m.paper_id=?2) ORDER BY m.created_at,m.rowid",&[&status,&pid])?;
    Ok(json!(rows
        .into_iter()
        .map(|mut r| {
            let a = parsed(&r, "aj");
            r["label"] = json!(text(&a, "label").trim());
            r["needsAttention"] = json!(
                r["status"] != "active" && a["warnings"].as_array().is_some_and(|w| !w.is_empty())
            );
            r["incomplete"] = json!(r["incomplete"] == 1);
            r.as_object_mut().unwrap().remove("aj");
            r
        })
        .collect::<Vec<_>>()))
}
pub fn detail(i: &Inner, id: &str) -> AppResult<Value> {
    let r=one(&i.db,"SELECT m.*,p.title paperTitle,kp.code kpCode FROM mistakes m LEFT JOIN papers p ON p.id=m.paper_id LEFT JOIN knowledge_points kp ON kp.id=m.knowledge_point_id WHERE m.id=?1",&[&id])?.ok_or("找不到这道错题")?;
    let paths=query(&i.db,"SELECT pg.image_path FROM mistake_pages mp JOIN paper_pages pg ON pg.id=mp.page_id WHERE mp.mistake_id=?1 ORDER BY pg.position",&[&id])?;
    let mut urls = Vec::new();
    for p in paths {
        let path = text(&p, "image_path");
        if let Ok(bytes) = fs::read(path) {
            urls.push(data_url(&bytes));
        }
    }
    Ok(
        json!({"id":id,"status":r["status"],"paperId":r["paper_id"],"paperTitle":r["paperTitle"],"incomplete":r["incomplete"]==1,"imageDataUrls":urls,"analysis":parsed(&r,"analysis_json"),"fields":{"questionMarkdown":text(&r,"question_markdown"),"studentAnswer":text(&r,"student_answer"),"studentWorkMarkdown":text(&r,"student_work_markdown"),"correctAnswer":text(&r,"correct_answer"),"knowledgePointCode":r["kpCode"].as_str().unwrap_or("other")}}),
    )
}
pub fn required<'a>(v: &'a Value, key: &str, max: usize) -> AppResult<&'a str> {
    let s = v
        .get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| format!("缺少必要字段: {key}"))?;
    if s.trim().is_empty() || s.chars().count() > max {
        return Err(format!("输入字段不合法: {key}"));
    }
    Ok(s)
}
pub fn confirm(i: &Inner, input: &Value) -> AppResult<Value> {
    let id = required(input, "mistakeId", 500)?;
    let q = required(input, "questionMarkdown", 100000)?.trim();
    let kp = required(input, "knowledgePointCode", 500)?;
    let cause = required(input, "rootCauseCode", 500)?;
    if one(&i.db, "SELECT id FROM mistakes WHERE id=?1", &[&id])?.is_none() {
        return Err("找不到这道错题".into());
    }
    let cause = one(
        &i.db,
        "SELECT id FROM root_causes WHERE code=?1 AND active=1",
        &[&cause],
    )?
    .ok_or("请选择一个具体的错误归因")?;
    let kp = one(
        &i.db,
        "SELECT id FROM knowledge_points WHERE code=?1 AND active=1",
        &[&kp],
    )?
    .ok_or("知识点不存在,请重新选择")?;
    transaction(&i.db, || {
        exec(&i.db,"UPDATE mistakes SET question_markdown=?1,student_answer=?2,student_work_markdown=?3,correct_answer=?4,knowledge_point_id=?5,status='active',updated_at=?6 WHERE id=?7",&[&q,&text(input,"studentAnswer").trim(),&text(input,"studentWorkMarkdown").trim(),&text(input,"correctAnswer").trim(),&text(&kp,"id"),&db::now(),&id])?;
        exec(
            &i.db,
            "UPDATE mistake_root_causes SET is_primary=0 WHERE mistake_id=?1",
            &[&id],
        )?;
        exec(&i.db,"INSERT INTO mistake_root_causes(mistake_id,root_cause_id,confidence,evidence,confirmed,is_primary) VALUES (?1,?2,NULL,NULL,1,1) ON CONFLICT(mistake_id,root_cause_id) DO UPDATE SET confirmed=1,is_primary=1",&[&id,&text(&cause,"id")])?;
        Ok(Value::Null)
    })
}
pub fn confirm_recommended(i: &Inner, id: &str) -> AppResult<bool> {
    let r = one(
        &i.db,
        "SELECT analysis_json,incomplete FROM mistakes WHERE id=?1",
        &[&id],
    )?
    .ok_or("找不到这道错题")?;
    let mut a = parsed(&r, "analysis_json");
    if a.is_null()
        || r["incomplete"] == 1
        || text(&a, "recommendedRootCause").is_empty()
        || text(&a, "knowledgePointCode") == "other"
    {
        return Ok(false);
    }
    a["mistakeId"] = json!(id);
    a["rootCauseCode"] = a["recommendedRootCause"].clone();
    Ok(confirm(i, &a).is_ok())
}
pub fn confirm_paper(i: &Inner, id: &str) -> AppResult<Value> {
    paper(i, id)?;
    let ids = query(
        &i.db,
        "SELECT id FROM mistakes WHERE paper_id=?1 AND status IN ('draft','unattributed')",
        &[&id],
    )?;
    let total = ids.len();
    let mut confirmed = 0;
    for r in ids {
        if confirm_recommended(i, text(&r, "id"))? {
            confirmed += 1;
        }
    }
    Ok(json!({"confirmed":confirmed,"skipped":total-confirmed}))
}
pub fn create_drafts(
    i: &Inner,
    paper: &Value,
    pages: &[Value],
    analyses: &[Value],
) -> AppResult<()> {
    transaction(&i.db, || {
        for a in analyses {
            let id = db::id();
            let kp = one(
                &i.db,
                "SELECT id FROM knowledge_points WHERE code=?1",
                &[&text(a, "knowledgePointCode")],
            )?;
            exec(&i.db,"INSERT INTO mistakes(id,paper_id,question_markdown,student_answer,student_work_markdown,correct_answer,grade,semester,subject,curriculum_id,knowledge_point_id,analysis_json,status,incomplete,created_at,updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,'math',?9,?10,?11,'draft',?12,?13,?13)",&[&id,&text(paper,"id"),&text(a,"questionMarkdown"),&text(a,"studentAnswer"),&text(a,"studentWorkMarkdown"),&text(a,"correctAnswer"),&paper["grade"].as_i64().unwrap_or(i.settings.grade),&paper["semester"].as_i64().unwrap_or(i.settings.semester),&paper["curriculum_id"].as_str().unwrap_or(&i.settings.curriculum_id),&kp.as_ref().and_then(|k|k["id"].as_str()),&a.to_string(),&a["incomplete"].as_bool().unwrap_or(false),&db::now()])?;
            let selected = a["pages"]
                .as_array()
                .filter(|p| !p.is_empty())
                .map(|p| {
                    p.iter()
                        .filter_map(|n| n.as_u64().and_then(|n| pages.get(n as usize)))
                        .collect::<Vec<_>>()
                })
                .unwrap_or_else(|| pages.iter().collect());
            for (pos, page) in selected.iter().enumerate() {
                exec(
                    &i.db,
                    "INSERT INTO mistake_pages VALUES (?1,?2,?3)",
                    &[&id, &text(page, "id"), &(pos as i64)],
                )?;
            }
            for c in a["rootCauses"].as_array().unwrap_or(&Vec::new()) {
                exec(
                    &i.db,
                    "INSERT INTO mistake_root_causes VALUES (?1,?2,?3,?4,0,0)",
                    &[
                        &id,
                        &text(c, "code"),
                        &c["confidence"].as_f64().unwrap_or(0.0),
                        &text(c, "evidence"),
                    ],
                )?;
            }
        }
        Ok(())
    })
}
pub fn log(
    i: &Inner,
    kind: &str,
    input: Value,
    output: Option<&str>,
    model: &str,
    error: Option<&str>,
) -> AppResult<()> {
    exec(
        &i.db,
        "INSERT INTO ai_runs VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
        &[
            &db::id(),
            &kind,
            &input.to_string(),
            &output,
            &model,
            &if error.is_some() { "failed" } else { "ok" },
            &error,
            &db::now(),
        ],
    )?;
    Ok(())
}
