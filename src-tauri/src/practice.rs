use crate::{
    ai::{chat, extract_json, practice_model, str_value, verification_model},
    answers,
    db::{self, exec, one, parsed, query, text, transaction, AppResult},
    figure,
    mastery::{self, GuidedRechecks, Pair},
    repo, revision,
    state::{AppState, Inner, PracticeDifficulty},
};
use regex::Regex;
use serde_json::{json, Value};
use std::collections::HashSet;

#[derive(Clone)]
pub struct Question {
    pub markdown: String,
    pub kind: String,
    pub options: Vec<String>,
    pub correct: String,
    pub unit: String,
    pub solution: String,
    pub figure: Value,
    pub solver: String,
    pub pair: Pair,
}
fn first_number(s: &str) -> Option<i64> {
    Regex::new(r"-?\d+")
        .unwrap()
        .find(&answers::normalize(s))
        .and_then(|m| m.as_str().parse().ok())
}
pub fn parse_questions(value: &Value, pair: &Pair) -> Vec<Question> {
    let mut out = Vec::new();
    let refers_to_figure=Regex::new(r"[上下左右如见]图|展开图|图中|图示|统计图|示意图|从[前后左右上正]面看|从[前后左右上]边看|俯视").unwrap();
    let unsupported =
        Regex::new(r"判断对错|判断下面|列出.{0,6}算式|写出.{0,6}算式|写出.{0,4}过程").unwrap();
    let prefix = Regex::new(r"^\s*[A-Da-d][.、:：)）]\s*").unwrap();
    for q in value["questions"].as_array().unwrap_or(&Vec::new()) {
        let markdown = text(q, "question_markdown").trim().to_owned();
        let correct = str_value(&q["correct_answer"]);
        let kind = text(q, "answer_type");
        if markdown.is_empty() || correct.is_empty() {
            continue;
        }
        let Some(fig) = figure::validate(&q["figure"]) else {
            continue;
        };
        let compact = markdown
            .chars()
            .filter(|c| !c.is_whitespace() && !['*', '_', '$', '\\'].contains(c))
            .collect::<String>();
        if fig.is_null() && refers_to_figure.is_match(&compact) {
            continue;
        }
        if unsupported.is_match(&markdown) {
            continue;
        }
        let stack = if text(&fig, "type") == "cube_stack" {
            let Some(n) = figure::stack_count(&fig, text(q, "view_of")) else {
                continue;
            };
            Some(n)
        } else {
            None
        };
        let mut question = Question {
            markdown,
            kind: kind.into(),
            options: Vec::new(),
            correct: correct.clone(),
            unit: text(q, "unit").trim().into(),
            solution: text(q, "solution_markdown").trim().into(),
            figure: fig.clone(),
            solver: String::new(),
            pair: pair.clone(),
        };
        if kind == "choice" {
            let options = q["options"]
                .as_array()
                .unwrap_or(&Vec::new())
                .iter()
                .map(|o| prefix.replace(text_or_empty(o), "").trim().to_owned())
                .collect::<Vec<_>>();
            let Some(letter) = correct.chars().next().map(|c| c.to_ascii_uppercase()) else {
                continue;
            };
            if options.len() != 4
                || options.iter().any(String::is_empty)
                || !('A'..='D').contains(&letter)
            {
                continue;
            }
            let index = (letter as u8 - b'A') as usize;
            if text(&fig, "type") == "cube_net" {
                let labels = fig["cells"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|c| text(c, "text"))
                    .collect::<Vec<_>>();
                if options.iter().any(|o| !labels.contains(&o.as_str()))
                    || figure::opposite(&fig, text(q, "opposite_of")).as_deref()
                        != Some(options[index].as_str())
                {
                    continue;
                }
            }
            if stack.is_some_and(|n| first_number(&options[index]) != Some(n)) {
                continue;
            }
            question.options = options;
            question.correct = letter.to_string();
            question.unit.clear();
        } else if kind == "number" {
            if text(&fig, "type") == "cube_net"
                || stack.is_some_and(|n| first_number(&correct) != Some(n))
            {
                continue;
            }
        } else {
            continue;
        }
        out.push(question);
    }
    out
}
fn text_or_empty(v: &Value) -> &str {
    v.as_str().unwrap_or("")
}
fn session(i: &Inner, id: &str) -> AppResult<Value> {
    let rows = query(
        &i.db,
        "SELECT * FROM valid_practice_questions WHERE session_id=?1 ORDER BY position",
        &[&id],
    )?;
    Ok(
        json!({"sessionId":id,"questions":rows.iter().map(|q|json!({"id":q["id"],"position":q["position"],"questionMarkdown":q["question_markdown"],"answerType":q["answer_type"],"options":parsed(q,"options_json").as_array().cloned().unwrap_or_default(),"unit":text(q,"answer_unit"),"figure":figure::validate(&parsed(q,"figure_json")).unwrap_or(Value::Null)})).collect::<Vec<_>>()}),
    )
}

fn select_pairs(mut pairs: Vec<Pair>, rechecks: &GuidedRechecks) -> Vec<Pair> {
    pairs.retain(|pair| pair.practiceable(rechecks));
    pairs.sort_by_key(|pair| (!pair.unsure_due, pair.mastered, pair.streak));
    if let Some((index, _)) = pairs
        .iter()
        .enumerate()
        .filter_map(|(index, pair)| pair.pending_guidance(rechecks).map(|since| (index, since)))
        .min_by_key(|(_, since)| *since)
    {
        pairs[..=index].rotate_right(1);
    }
    pairs.truncate(5);
    pairs
}

pub async fn start(state: &AppState) -> AppResult<Value> {
    // Serialize generation only; no database lock is held during HTTP requests.
    let _gate = state.practice_gate.lock().await;
    let (key, settings, candidates) = {
        let i = state.lock()?;
        exec(&i.db,"UPDATE practice_sessions SET status='completed',completed_at=?1 WHERE status='submitted'",&[&db::now()])?;
        exec(&i.db,"UPDATE practice_sessions SET status='completed',completed_at=?1 WHERE status='pending' AND NOT EXISTS (SELECT 1 FROM valid_practice_questions q WHERE q.session_id=practice_sessions.id)",&[&db::now()])?;
        if let Some(p)=one(&i.db,"SELECT id FROM practice_sessions WHERE status='pending' ORDER BY created_at DESC LIMIT 1",&[])?{return session(&i,text(&p,"id"));}
        let key = i.require_key()?;
        let pairs = select_pairs(mastery::pairs(&i)?, &mastery::guided_rechecks(&i)?);
        if pairs.is_empty() {
            return Err(
                "现在没有需要练习的内容。先去错题库确认错题,或者等已掌握的知识点到了复习时间再来"
                    .into(),
            );
        }
        (key, i.settings.clone(), pairs)
    };
    let len = candidates.len();
    let mut tasks = Vec::new();
    for (index, pair) in candidates.into_iter().enumerate() {
        let count = (0..5).filter(|n| n % len == index).count() + 2;
        let state = state.clone();
        let key = key.clone();
        let grade = settings.grade;
        let difficulty = settings.practice_difficulty.clone();
        tasks.push(tauri::async_runtime::spawn(async move {
            make_questions(&state, &pair, count, &key, grade, &difficulty).await
        }));
    }
    let mut groups = Vec::new();
    let mut first_error = None;
    for task in tasks {
        match task.await.map_err(|_| "练习生成任务中断,请重试")? {
            Ok(q) => groups.push(q),
            Err(e) => {
                first_error.get_or_insert(e);
            }
        }
    }
    let mut questions = Vec::new();
    for pos in 0..groups.iter().map(Vec::len).max().unwrap_or(0) {
        for group in &groups {
            if let Some(q) = group.get(pos) {
                questions.push(q.clone());
            }
        }
    }
    questions.truncate(5);
    if questions.is_empty() {
        return Err(first_error.unwrap_or_else(|| "没能生成合格的练习题,请稍后重试".into()));
    }
    let i = state.lock()?;
    let excluded = voided_question_keys(&i)?;
    questions.retain(|q| !excluded.contains(&question_key(&q.markdown, &q.figure)));
    if questions.is_empty() {
        return Err("生成的题目已作废，请重新开始练习".into());
    }
    save(&i, &questions)
}

fn voided_question_keys(i: &Inner) -> AppResult<HashSet<(String, String)>> {
    Ok(query(&i.db,"SELECT q.question_markdown q,q.figure_json FROM practice_questions q JOIN practice_question_review_state r ON r.question_id=q.id AND r.action='void'",&[])?
        .iter().map(|row| question_key(text(row, "q"), &parsed(row, "figure_json"))).collect())
}

async fn make_questions(
    state: &AppState,
    pair: &Pair,
    count: usize,
    key: &str,
    grade: i64,
    difficulty: &PracticeDifficulty,
) -> AppResult<Vec<Question>> {
    let (info, examples, avoid, voided) = {
        let i = state.lock()?;
        let info=one(&i.db,"SELECT kp.label kp,rc.label cause,COALESCE(rc.description,'') description FROM knowledge_points kp,root_causes rc WHERE kp.id=?1 AND rc.id=?2",&[&pair.point,&pair.cause])?.ok_or("知识点或归因不存在")?;
        let examples=query(&i.db,"SELECT m.question_markdown question,COALESCE(m.student_answer,'') studentAnswer,m.analysis_json aj FROM mistakes m JOIN mistake_root_causes mrc ON mrc.mistake_id=m.id AND mrc.is_primary=1 WHERE m.status='active' AND mrc.root_cause_id=?1 AND m.knowledge_point_id=?2 ORDER BY m.updated_at DESC LIMIT 2",&[&pair.cause,&pair.point])?;
        let avoid=query(&i.db,"SELECT question_markdown q,figure_json FROM practice_questions WHERE root_cause_id=?1 AND knowledge_point_id=?2 ORDER BY created_at DESC LIMIT 10",&[&pair.cause,&pair.point])?;
        let voided = voided_question_keys(&i)?;
        (info, examples, avoid, voided)
    };
    let seen = examples
        .iter()
        .map(|example| question_key(text(example, "question"), &Value::Null))
        .chain(
            avoid
                .iter()
                .map(|prior| question_key(text(prior, "q"), &parsed(prior, "figure_json"))),
        )
        .chain(voided)
        .collect::<HashSet<_>>();
    let examples = examples
        .iter()
        .enumerate()
        .map(|(n, e)| {
            let analysis = parsed(e, "aj");
            let kind = analysis["figureKind"]
                .as_str()
                .unwrap_or_else(|| figure::infer(text(e, "question")));
            let hint = if ["cube_net", "number_line", "bar_chart", "cube_stack"].contains(&kind) {
                format!(
                    "【原题配图 {kind},新题也应配同类图;特点:{}】",
                    text(&analysis, "figureNote")
                )
            } else if kind == "other" {
                "【原题配图无法绘制,请改成已知条件完整的文字题】".into()
            } else {
                String::new()
            };
            format!(
                "例{}:{}(孩子的错误答案:{}){}",
                n + 1,
                text(e, "question"),
                if text(e, "studentAnswer").is_empty() {
                    "未作答"
                } else {
                    text(e, "studentAnswer")
                },
                hint
            )
        })
        .collect::<Vec<_>>()
        .join("\n");
    let avoid = avoid
        .iter()
        .map(|v| format!("- {}", text(v, "q")))
        .collect::<Vec<_>>()
        .join("\n");
    let system = include_str!("../assets/practice-prompt.txt")
        .replace("{{grade}}", &grade.to_string())
        .replace("{{count}}", &count.to_string())
        .replace("{{difficulty}}", difficulty.prompt_text());
    let user=format!("知识点:{}\n错误原因:{}。{}\n孩子做错的题:\n{examples}\n以下题目之前已经出过,不要重复:\n{avoid}\n请出 {count} 道新题。",text(&info,"kp"),text(&info,"cause"),text(&info,"description"));
    let messages = json!([{"role":"system","content":system},{"role":"user","content":user}]);
    let mut drafts = Vec::new();
    for _ in 0..2 {
        let reply = chat(
            state,
            key,
            practice_model(),
            messages.clone(),
            crate::ai::ChatOptions {
                thinking: Some(false),
                ..Default::default()
            },
        )
        .await?;
        if let Some(value) = extract_json(&reply.content) {
            let mut seen = seen.clone();
            drafts = parse_questions(&value, pair)
                .into_iter()
                .filter(|question| seen.insert(question_key(&question.markdown, &question.figure)))
                .collect();
        }
        if !drafts.is_empty() {
            break;
        }
    }
    let mut tasks = Vec::new();
    for mut q in drafts {
        let state = state.clone();
        let key = key.to_owned();
        tasks.push(tauri::async_runtime::spawn(async move{
   if ["cube_net","cube_stack"].contains(&text(&q.figure,"type")){q.solver="code".into();return Ok(Some(q));}
   let options=q.options.iter().enumerate().map(|(i,o)|format!("{}. {}",(b'A'+i as u8)as char,o)).collect::<Vec<_>>().join("\n");
   let how=if q.kind=="choice"{"这是选择题,answer 填正确选项字母。"}else{"answer 填最终结果:整数、小数、最简分数(a/b)或商...余数,不带单位。"};
   let figure=if q.figure.is_null(){String::new()}else{format!("\n配图数据:{}",q.figure)};
   let messages=json!([{"role":"system","content":format!("你是一位严谨的小学数学老师。独立解答题目,推理简短,最后单独一行给出 JSON 对象: {{\"answer\":\"...\"}}。{how}")},{"role":"user","content":format!("{}{figure}\n{options}",q.markdown)}]);
   let reply=chat(&state,&key,verification_model(),messages,crate::ai::ChatOptions { max_tokens:4096,timeout:45,retries:1,..Default::default() }).await?;
   let value=extract_json(&reply.content).unwrap_or(Value::Null);let answer=str_value(&value["answer"]);
   if answers::check(&q.kind,&answer,&q.correct,&q.unit){q.solver=answer;Ok(Some(q))}else{Ok(None)}
  }));
    }
    let mut verified = Vec::new();
    let mut first_error = None;
    for task in tasks {
        match task.await.map_err(|_| "校验任务被中断")? {
            Ok(Some(q)) => verified.push(q),
            Ok(None) => {}
            Err(e) => {
                first_error.get_or_insert(e);
            }
        }
    }
    if verified.is_empty() {
        if let Some(e) = first_error {
            return Err(e);
        }
    }
    Ok(verified)
}
fn question_key(markdown: &str, figure: &Value) -> (String, String) {
    (markdown.split_whitespace().collect(), figure.to_string())
}
pub fn save(i: &Inner, questions: &[Question]) -> AppResult<Value> {
    let session_id = db::id();
    let t = db::now();
    transaction(&i.db, || {
        exec(&i.db,"INSERT INTO practice_sessions(id,practice_date,status,created_at) VALUES (?1,?2,'pending',?3)",&[&session_id,&&t[..10],&t])?;
        for (pos, q) in questions.iter().enumerate() {
            let source=one(&i.db,"SELECT m.id FROM mistakes m JOIN mistake_root_causes mrc ON mrc.mistake_id=m.id AND mrc.is_primary=1 WHERE m.status='active' AND mrc.root_cause_id=?1 AND m.knowledge_point_id=?2 ORDER BY m.updated_at DESC LIMIT 1",&[&q.pair.cause,&q.pair.point])?;
            exec(&i.db,"INSERT INTO practice_questions(id,session_id,position,root_cause_id,knowledge_point_id,source_mistake_id,question_markdown,answer_type,options_json,correct_answer,answer_unit,solution_markdown,figure_json,difficulty,status,verify_json,created_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,1,'assigned',?14,?15)",&[&db::id(),&session_id,&(pos as i64),&q.pair.cause,&q.pair.point,&source.as_ref().and_then(|s|s["id"].as_str()),&q.markdown,&q.kind,&json!(q.options).to_string(),&q.correct,&q.unit,&q.solution,&if q.figure.is_null(){None}else{Some(q.figure.to_string())},&json!({"solver":q.solver,"model":verification_model()}).to_string(),&t])?;
        }
        Ok(())
    })?;
    repo::log(
        i,
        "generate_practice",
        json!({"sessionId":session_id,"count":questions.len()}),
        None,
        practice_model(),
        None,
    )?;
    session(i, &session_id)
}
pub fn submit(i: &Inner, input: &Value) -> AppResult<Value> {
    let id = repo::required(input, "sessionId", 500)?;
    let session = one(
        &i.db,
        "SELECT status FROM practice_sessions WHERE id=?1",
        &[&id],
    )?
    .ok_or("找不到这次练习")?;
    if session["status"] != "pending" {
        return Err("这次练习已经提交过了".into());
    }
    let answers = input["answers"]
        .as_array()
        .filter(|v| v.len() <= 20)
        .ok_or("作答格式不合法")?;
    for a in answers {
        repo::required(a, "questionId", 500)?;
        let answer = a["answer"]
            .as_str()
            .filter(|answer| answer.chars().count() <= 200)
            .ok_or("答案过长或格式不合法")?;
        if !a["disposition"].is_null()
            && (!matches!(a["disposition"].as_str(), Some("unsure" | "skipped"))
                || !answer.trim().is_empty())
        {
            return Err("作答状态不合法".into());
        }
    }
    let elapsed = if input["elapsedMs"].is_null() {
        None
    } else {
        Some(
            input["elapsedMs"]
                .as_i64()
                .filter(|n| (0..=86400000).contains(n))
                .ok_or("练习时长不合法")?,
        )
    };
    let rows = query(
        &i.db,
        "SELECT * FROM valid_practice_questions WHERE session_id=?1 ORDER BY position",
        &[&id],
    )?;
    let per_question = elapsed
        .filter(|n| *n > 0)
        .map(|n| (n as f64 / (rows.len().max(1) as f64)).round() as i64);
    transaction(&i.db, || {
        for q in &rows {
            let input_answer = answers.iter().rev().find(|a| a["questionId"] == q["id"]);
            let given = input_answer.map_or("", |a| text(a, "answer").trim());
            let outcome = if input_answer.is_some_and(|a| a["disposition"] == "unsure") {
                "unsure"
            } else if given.is_empty() {
                "skipped"
            } else if answers::check(
                text(q, "answer_type"),
                given,
                text(q, "correct_answer"),
                text(q, "answer_unit"),
            ) {
                "correct"
            } else {
                "wrong"
            };
            exec(&i.db,"INSERT INTO answer_attempts(id,practice_question_id,root_cause_id,knowledge_point_id,submitted_answer,normalized_answer,is_correct,skipped,answer_time_ms,created_at,outcome) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",&[&db::id(),&text(q,"id"),&text(q,"root_cause_id"),&text(q,"knowledge_point_id"),&given,&given.to_lowercase(),&(outcome=="correct"),&(outcome=="skipped"),&per_question,&db::now(),&outcome])?;
            exec(
                &i.db,
                "UPDATE practice_questions SET status='answered' WHERE id=?1",
                &[&text(q, "id")],
            )?;
        }
        exec(
            &i.db,
            "UPDATE practice_sessions SET status='submitted' WHERE id=?1",
            &[&id],
        )?;
        Ok(())
    })?;
    result(i, id)
}

pub fn result(i: &Inner, id: &str) -> AppResult<Value> {
    if one(
        &i.db,
        "SELECT 1 FROM practice_sessions WHERE id=?1 AND status<>'pending'",
        &[&id],
    )?
    .is_none()
    {
        return Err("找不到已提交的练习".into());
    }
    let rows = query(&i.db,
        "SELECT q.id,q.position,CASE WHEN v.id IS NOT NULL AND a.outcome IS NULL
                       THEN 'skipped' ELSE a.outcome END outcome,v.id IS NULL invalid,r.reason FROM practice_questions q
         LEFT JOIN valid_practice_questions v ON v.id=q.id
         LEFT JOIN practice_first_answers a ON a.practice_question_id=q.id
         LEFT JOIN practice_question_review_state r ON r.question_id=q.id AND r.action='void'
         WHERE q.session_id=?1 ORDER BY q.position", &[&id])?;
    let ids = |outcome: &str| {
        rows.iter()
            .filter(|row| row["outcome"] == outcome)
            .map(|row| row["id"].clone())
            .collect::<Vec<_>>()
    };
    let correct = ids("correct");
    let wrong = ids("wrong");
    let unsure = ids("unsure");
    let skipped = ids("skipped");
    let invalid = rows
        .iter()
        .filter(|row| row["invalid"] == 1)
        .map(
            |row| json!({"questionId":row["id"],"position":row["position"],"reason":row["reason"]}),
        )
        .collect::<Vec<_>>();
    Ok(json!({
        "correctCount":correct.len(), "wrongCount":wrong.len(), "unsureCount":unsure.len(),
        "skippedCount":skipped.len(),"unknownCount":ids("unknown").len(),"invalidCount":invalid.len(),"invalidQuestions":invalid,
        "wrongQuestionIds":wrong, "unsureQuestionIds":unsure, "skippedQuestionIds":skipped
    }))
}
pub fn revise(i: &Inner, input: &Value) -> AppResult<Value> {
    let id = repo::required(input, "questionId", 500)?;
    let answer = input["answer"]
        .as_str()
        .filter(|a| a.chars().count() <= 200)
        .ok_or("答案格式不合法")?;
    let q = revision::question_for_revision(i, id)?;
    let give_up = input["giveUp"] == true;
    let correct = !give_up
        && answers::check(
            text(&q, "answer_type"),
            answer,
            text(&q, "correct_answer"),
            text(&q, "answer_unit"),
        );
    let reveal = correct || give_up;
    Ok(
        json!({"correct":correct,"correctAnswer":if reveal{Some(text(&q,"correct_answer"))}else{None},"solutionMarkdown":if reveal{Some(text(&q,"solution_markdown"))}else{None}}),
    )
}
pub fn finish(i: &Inner, input: &Value) -> AppResult<Value> {
    let id = repo::required(input, "sessionId", 500)?;
    exec(&i.db,"UPDATE practice_sessions SET status='completed',completed_at=?1 WHERE id=?2 AND status IN ('submitted','pending')",&[&db::now(),&id])?;
    Ok(Value::Null)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mastery::GuidedRecheck;

    #[test]
    fn gives_one_pending_recheck_priority_without_reordering_the_other_pairs() {
        let pairs = (0..9)
            .rev()
            .map(|streak| Pair {
                cause: "calculation_error".into(),
                point: streak.to_string(),
                streak,
                mastered: streak == 8,
                review_due: false,
                unsure_due: false,
            })
            .collect();
        let rechecks = [
            ("8", "2026-11-01", Some(true)),
            ("5", "2026-11-02", Some(false)),
            ("6", "2026-11-04", None),
            ("7", "2026-11-03", None),
        ]
        .into_iter()
        .map(|(point, since, correct)| {
            (
                ("calculation_error".into(), point.into()),
                GuidedRecheck {
                    since: since.into(),
                    correct,
                },
            )
        })
        .collect();
        let selected = select_pairs(pairs, &rechecks);
        assert_eq!(
            selected.iter().map(|pair| pair.streak).collect::<Vec<_>>(),
            [7, 0, 1, 2, 3]
        );
    }
}
