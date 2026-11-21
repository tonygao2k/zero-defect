use crate::{
    answers,
    db::{self, exec, one, parsed, query, text, transaction, AppResult},
    practice_templates::canonical_prompt,
    state::{data_url, Inner},
};
use serde_json::{json, Value};
use std::{collections::BTreeMap, fs};

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
    let mut summaries = Vec::new();
    for mut row in rows {
        let analysis = parsed(&row, "aj");
        let reasons = if row["status"] == "active" {
            vec![]
        } else {
            quick_review_reasons(i, &row, &analysis)?
        };
        row["label"] = json!(text(&analysis, "label").trim());
        row["needsAttention"] = json!(!reasons.is_empty());
        row["reviewReasons"] = json!(reasons);
        row["incomplete"] = json!(row["incomplete"] == 1);
        row.as_object_mut().unwrap().remove("aj");
        summaries.push(row);
    }
    Ok(json!(summaries))
}
pub fn detail(i: &Inner, id: &str) -> AppResult<Value> {
    let r=one(&i.db,"SELECT m.*,p.title paperTitle,kp.code kpCode,(SELECT rc.code FROM mistake_root_causes mrc JOIN root_causes rc ON rc.id=mrc.root_cause_id WHERE mrc.mistake_id=m.id AND mrc.is_primary=1) confirmedCause FROM mistakes m LEFT JOIN papers p ON p.id=m.paper_id LEFT JOIN knowledge_points kp ON kp.id=m.knowledge_point_id WHERE m.id=?1",&[&id])?.ok_or("找不到这道错题")?;
    let analysis = parsed(&r, "analysis_json");
    let reasons = if r["status"] == "active" {
        vec![]
    } else {
        quick_review_reasons(i, &r, &analysis)?
    };
    let paths=query(&i.db,"SELECT pg.image_path FROM mistake_pages mp JOIN paper_pages pg ON pg.id=mp.page_id WHERE mp.mistake_id=?1 ORDER BY pg.position",&[&id])?;
    let mut urls = Vec::new();
    for p in paths {
        let path = text(&p, "image_path");
        if let Ok(bytes) = fs::read(path) {
            urls.push(data_url(&bytes));
        }
    }
    Ok(
        json!({"id":id,"status":r["status"],"paperId":r["paper_id"],"paperTitle":r["paperTitle"],"incomplete":r["incomplete"]==1,"imageDataUrls":urls,"analysis":analysis,"reviewReasons":reasons,"confirmedRootCauseCode":r["confirmedCause"],"fields":{"questionMarkdown":text(&r,"question_markdown"),"studentAnswer":text(&r,"student_answer"),"studentWorkMarkdown":text(&r,"student_work_markdown"),"correctAnswer":text(&r,"correct_answer"),"knowledgePointCode":r["kpCode"].as_str().unwrap_or("other")}}),
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
    let correct = required(input, "correctAnswer", 10000)?.trim();
    let student = text(input, "studentAnswer").trim();
    let work = text(input, "studentWorkMarkdown").trim();
    let row = one(
        &i.db,
        "SELECT m.incomplete,m.confirmed_evidence_at,m.confirmed_evidence_local_date,m.status,
                m.question_markdown,m.knowledge_point_id,m.original_question_since,
                (SELECT c.root_cause_id FROM mistake_root_causes c
                 WHERE c.mistake_id=m.id AND c.is_primary=1) root_cause_id
         FROM mistakes m WHERE m.id=?1",
        &[&id],
    )?
    .ok_or("找不到这道错题")?;
    if row["incomplete"] == 1 && input["confirmComplete"] != true {
        return Err("请核对并补齐题目，再确认题目完整".into());
    }
    if kp == "other" {
        return Err("请先选择一个明确的知识点".into());
    }
    if cause == "not_attempted" && (!student.is_empty() || !work.is_empty()) {
        return Err("这道题已有作答，请核对后选择其他错因".into());
    }
    let now = db::now();
    let evidence_at = answers::is_mistake_evidence(student, work, correct)
        .then(|| row["confirmed_evidence_at"].as_str().unwrap_or(&now));
    let evidence_day = evidence_at.and_then(|at| {
        row["confirmed_evidence_local_date"]
            .as_str()
            .map(str::to_owned)
            .or_else(|| db::local_date(at).map(|day| day.to_string()))
    });
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
    let same_original = row["status"] == "active"
        && row["knowledge_point_id"] == kp["id"]
        && row["root_cause_id"] == cause["id"]
        && canonical_prompt(text(&row, "question_markdown")) == canonical_prompt(q);
    let original_since = if same_original {
        row["original_question_since"].as_str().unwrap_or(&now)
    } else {
        &now
    };
    transaction(&i.db, || {
        exec(&i.db,"UPDATE mistakes SET question_markdown=?1,student_answer=?2,student_work_markdown=?3,correct_answer=?4,knowledge_point_id=?5,status='active',updated_at=?6,confirmed_evidence_at=?7,confirmed_evidence_local_date=?8,original_question_since=?9,incomplete=0 WHERE id=?10",&[&q,&student,&work,&correct,&text(&kp,"id"),&now,&evidence_at,&evidence_day,&original_since,&id])?;
        exec(
            &i.db,
            "UPDATE mistake_root_causes SET is_primary=0 WHERE mistake_id=?1",
            &[&id],
        )?;
        exec(&i.db,"INSERT INTO mistake_root_causes(mistake_id,root_cause_id,confidence,evidence,confirmed,is_primary) VALUES (?1,?2,NULL,NULL,1,1) ON CONFLICT(mistake_id,root_cause_id) DO UPDATE SET confirmed=1,is_primary=1",&[&id,&text(&cause,"id")])?;
        Ok(Value::Null)
    })
}
fn quick_review_reasons(i: &Inner, row: &Value, analysis: &Value) -> AppResult<Vec<&'static str>> {
    let mut reasons = Vec::new();
    if row["incomplete"] == 1 {
        reasons.push("incomplete");
    }
    // Drafts saved before v1.0.4 carry no `imageQuality`; their only blur signal is the warning text.
    let legacy = analysis.get("imageQuality").is_none();
    let blurry = if !legacy {
        text(analysis, "imageQuality") != "ok"
    } else {
        analysis["warnings"].as_array().is_some_and(|w| {
            w.iter()
                .any(|w| w.as_str().is_some_and(|w| w.contains("模糊")))
        })
    };
    if blurry {
        reasons.push("image_quality");
    }
    if ["questionMarkdown", "correctAnswer"]
        .iter()
        .any(|field| text(analysis, field).trim().is_empty())
    {
        reasons.push("missing_fields");
    }
    let point = text(analysis, "knowledgePointCode");
    if point == "other"
        || one(
            &i.db,
            "SELECT 1 FROM knowledge_points WHERE code=?1 AND active=1",
            &[&point],
        )?
        .is_none()
    {
        reasons.push("unknown_point");
    }
    let cause = text(analysis, "recommendedRootCause");
    let candidate = analysis["rootCauses"].as_array().and_then(|candidates| {
        candidates.iter().find(|candidate| {
            text(candidate, "code") == cause && candidate["unknownFromModel"] != true
        })
    });
    let blank = text(analysis, "studentAnswer").trim().is_empty()
        && text(analysis, "studentWorkMarkdown").trim().is_empty();
    if candidate.is_none()
        || (cause == "not_attempted") != blank
        || one(
            &i.db,
            "SELECT 1 FROM root_causes WHERE code=?1 AND active=1",
            &[&cause],
        )?
        .is_none()
    {
        reasons.push("unknown_cause");
    } else if let Some(candidate) = candidate {
        let score = candidate["confidence"].as_f64();
        let known = match candidate.get("confidenceKnown") {
            Some(known) => known == true,
            None => {
                legacy
                    && score.is_some_and(|score| {
                        (0.0 < score && score < 1.0)
                            || (blank && cause == "not_attempted" && score == 1.0)
                    })
            }
        };
        if !known
            || !score.is_some_and(|score| (i.settings.confidence_threshold..=1.0).contains(&score))
        {
            reasons.push("low_confidence");
        }
    }
    if candidate.is_some_and(|item| text(item, "evidence").trim().is_empty())
        || (!blank
            && (analysis["hasStudentWork"] != true
                || text(analysis, "studentWorkMarkdown").trim().is_empty()))
    {
        reasons.push("missing_evidence");
    }
    Ok(reasons)
}

pub fn confirm_recommended(i: &Inner, id: &str) -> AppResult<Value> {
    let r = one(
        &i.db,
        "SELECT analysis_json,incomplete,status FROM mistakes WHERE id=?1",
        &[&id],
    )?
    .ok_or("找不到这道错题")?;
    let mut a = parsed(&r, "analysis_json");
    if r["status"] == "active" {
        return Ok(json!({"confirmed":true,"reasons":[]}));
    }
    let reasons = quick_review_reasons(i, &r, &a)?;
    if !reasons.is_empty() {
        return Ok(json!({"confirmed":false,"reasons":reasons}));
    }
    a["mistakeId"] = json!(id);
    a["rootCauseCode"] = a["recommendedRootCause"].clone();
    confirm(i, &a)?;
    Ok(json!({"confirmed":true,"reasons":[]}))
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
    let mut skipped_reasons = BTreeMap::<String, usize>::new();
    for r in ids {
        let decision = confirm_recommended(i, text(&r, "id"))?;
        if decision["confirmed"] == true {
            confirmed += 1;
        } else if let Some(reasons) = decision["reasons"].as_array() {
            for reason in reasons.iter().filter_map(Value::as_str) {
                *skipped_reasons.entry(reason.to_owned()).or_default() += 1;
            }
        }
    }
    Ok(json!({"confirmed":confirmed,"skipped":total-confirmed,"skippedReasons":skipped_reasons}))
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
