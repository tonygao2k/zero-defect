use crate::{
    answers,
    db::{self, text, AppResult},
    repo,
    state::{data_url, AppState, Settings},
};
use serde_json::{json, Value};
use std::{collections::HashSet, time::Duration};

pub fn recognition_model() -> &'static str {
    &crate::config::ai().recognition_model
}

pub fn practice_model() -> &'static str {
    &crate::config::ai().practice_model
}

pub fn verification_model() -> &'static str {
    &crate::config::ai().verification_model
}

pub struct Reply {
    pub content: String,
    pub usage: Value,
}
pub struct ChatOptions {
    pub max_tokens: u32,
    pub timeout: u64,
    pub thinking: Option<bool>,
    pub retries: u32,
    pub ping: bool,
}
impl Default for ChatOptions {
    fn default() -> Self {
        Self {
            max_tokens: 8192,
            timeout: 120,
            thinking: None,
            retries: 2,
            ping: false,
        }
    }
}
pub async fn chat(
    state: &AppState,
    key: &str,
    model: &str,
    messages: Value,
    options: ChatOptions,
) -> AppResult<Reply> {
    let ChatOptions {
        max_tokens,
        timeout,
        thinking,
        retries,
        ping,
    } = options;
    let mut body = json!({"model":model,"messages":messages,"max_tokens":max_tokens});
    if let Some(value) = thinking {
        body["enable_thinking"] = json!(value);
    }
    for attempt in 0..=retries {
        let response = state
            .client
            .post(&state.ai_endpoint)
            .bearer_auth(key)
            .timeout(Duration::from_secs(timeout))
            .json(&body)
            .send()
            .await;
        let response = match response {
            Ok(r) => r,
            Err(e) => {
                if attempt < retries {
                    tokio::time::sleep(Duration::from_secs(1 << attempt)).await;
                    continue;
                }
                return Err(if e.is_timeout() {
                    "通义千问响应太慢,请稍后再试"
                } else {
                    "无法连接到通义千问,请检查网络"
                }
                .into());
            }
        };
        let status = response.status();
        if !status.is_success() {
            if (status.as_u16() == 429 || status.is_server_error()) && attempt < retries {
                tokio::time::sleep(Duration::from_secs(1 << attempt)).await;
                continue;
            }
            let message = match status.as_u16() {
                401 => "通义千问不认这个 API Key,请在设置里检查",
                402 => "通义千问账户余额不足,请充值后再试",
                403 => "通义千问拒绝了这次请求,请检查账号权限和余额",
                404 => "通义千问找不到所需的模型,请确认百炼账号已开通",
                429 => "通义千问提示请求太频繁,请稍后再试",
                500..=599 => "通义千问暂时出了问题,请稍后再试",
                _ => "通义千问拒绝了这次请求,请稍后重试",
            };
            return Err(message.into());
        }
        let value: Value = response
            .json()
            .await
            .map_err(|_| "通义千问返回了无法解析的内容")?;
        let usage = json!({"promptTokens":value["usage"]["prompt_tokens"].as_u64().unwrap_or(0),"completionTokens":value["usage"]["completion_tokens"].as_u64().unwrap_or(0)});
        if ping {
            return Ok(Reply {
                content: String::new(),
                usage,
            });
        }
        if value["choices"][0]["finish_reason"] == "length" {
            return Err("AI 输出达到长度上限,请减少页数后重试".into());
        }
        let content = &value["choices"][0]["message"]["content"];
        let content = content
            .as_str()
            .map(str::to_owned)
            .or_else(|| {
                content
                    .as_array()
                    .map(|parts| parts.iter().map(|p| text(p, "text")).collect::<String>())
            })
            .unwrap_or_default();
        if content.trim().is_empty() {
            return Err("通义千问没有返回内容,请重试".into());
        }
        return Ok(Reply { content, usage });
    }
    Err("无法连接到通义千问,请检查网络".into())
}
pub fn extract_json(input: &str) -> Option<Value> {
    if let (Some(start), Some(end)) = (input.find('{'), input.rfind('}')) {
        if start < end {
            if let Ok(v) = serde_json::from_str::<Value>(&input[start..=end]) {
                return Some(v);
            }
        }
    }
    let bytes = input.as_bytes();
    let mut found = None;
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] != b'{' {
            i += 1;
            continue;
        }
        let mut depth = 0;
        let mut quoted = false;
        let mut j = i;
        while j < bytes.len() {
            let c = bytes[j];
            if quoted {
                if c == b'\\' {
                    j += 1;
                } else if c == b'"' {
                    quoted = false;
                }
            } else if c == b'"' {
                quoted = true;
            } else if c == b'{' {
                depth += 1;
            } else if c == b'}' {
                depth -= 1;
                if depth == 0 {
                    break;
                }
            }
            j += 1;
        }
        if depth == 0 && j < bytes.len() {
            if let Ok(v) = serde_json::from_slice::<Value>(&bytes[i..=j]) {
                if v.is_object() {
                    found = Some(v);
                    i = j;
                }
            }
        }
        i += 1;
    }
    found
}
pub fn str_value(v: &Value) -> String {
    match v {
        Value::String(s) => s.trim().to_owned(),
        Value::Number(n) => n.to_string(),
        _ => String::new(),
    }
}
pub fn numeric(v: &Value) -> f64 {
    v.as_f64()
        .or_else(|| v.as_str().and_then(|s| s.parse().ok()))
        .filter(|n| n.is_finite())
        .unwrap_or(0.0)
}
pub fn postprocess(
    raw: &Value,
    page_count: usize,
    causes: &[Value],
    points: &[Value],
    settings: &Settings,
) -> AppResult<Value> {
    let q = text(raw, "question_markdown").trim();
    let quality = text(raw, "image_quality").trim().to_lowercase();
    if q.is_empty() || quality == "unreadable" {
        return Err("这张图片看不清题目,请重新拍一张(光线充足、对准题目)".into());
    }
    let active = causes
        .iter()
        .map(|c| text(c, "code"))
        .collect::<HashSet<_>>();
    let mut warnings = Vec::<String>::new();
    if quality == "blurry" {
        warnings.push("图片有些模糊,请仔细核对识别出的文字".into());
    }
    let work = text(raw, "student_work_markdown").trim();
    let unanswered = text(raw, "student_answer").trim().is_empty()
        && work.is_empty()
        && active.contains("not_attempted");
    let has_work = raw["has_student_work"] == true && !work.is_empty();
    let incomplete = raw["incomplete"] == true;
    if unanswered {
        warnings.push("孩子没有作答,请确认是不会做还是漏做了".into());
    } else if !has_work {
        warnings.push("缺少解题过程,未推断具体错因".into());
    }
    if incomplete {
        warnings.push("这道题被页边截断了,请补传缺的那一页,或核对题目内容".into());
    }
    let mut candidates = Vec::<Value>::new();
    let causes_with_work = raw["root_causes"].as_array().filter(|_| has_work);
    for c in causes_with_work.into_iter().flatten() {
        if text(c, "code").trim() == "not_attempted" {
            continue;
        }
        let known = active.contains(text(c, "code").trim());
        let code = if known {
            text(c, "code").trim()
        } else {
            "needs_review"
        };
        let confidence = numeric(&c["confidence"]).clamp(0.0, 1.0);
        let confidence_known = c["confidence"]
            .as_f64()
            .or_else(|| c["confidence"].as_str().and_then(|raw| raw.parse().ok()))
            .is_some_and(|score| (0.0..=1.0).contains(&score));
        let candidate = json!({"code":code,"confidence":confidence,"confidenceKnown":confidence_known,"evidence":text(c,"evidence").trim(),"unknownFromModel":!known});
        if let Some(index) = candidates.iter().position(|v| text(v, "code") == code) {
            if (confidence_known, confidence)
                > (
                    candidates[index]["confidenceKnown"] == true,
                    numeric(&candidates[index]["confidence"]),
                )
            {
                candidates[index] = candidate;
            }
        } else {
            candidates.push(candidate);
        }
    }
    if unanswered {
        let candidate = json!({"code":"not_attempted","confidence":1.0,"confidenceKnown":true,"evidence":"卷面上没有孩子的作答","unknownFromModel":false});
        candidates.push(candidate);
    }
    candidates.sort_by(|a, b| {
        (b["confidenceKnown"] == true)
            .cmp(&(a["confidenceKnown"] == true))
            .then_with(|| numeric(&b["confidence"]).total_cmp(&numeric(&a["confidence"])))
    });
    if candidates.iter().any(|c| c["unknownFromModel"] == true) {
        warnings.push("模型给出了不在清单内的归因,请从列表中重新选择".into());
    }
    let usable = candidates
        .iter()
        .filter(|c| active.contains(text(c, "code")))
        .collect::<Vec<_>>();
    let recommended = if unanswered {
        Some("not_attempted")
    } else {
        usable
            .iter()
            .find(|c| text(c, "code") == text(raw, "recommended_root_cause").trim())
            .or(usable.first())
            .map(|c| text(c, "code"))
    };
    if let Some(code) = recommended {
        if usable.iter().any(|c| {
            text(c, "code") == code
                && (c["confidenceKnown"] != true
                    || numeric(&c["confidence"]) < settings.confidence_threshold)
        }) {
            warnings.push("归因把握不高,请家长仔细核对".into());
        }
    } else {
        warnings.push("没有找到可靠的归因,请家长手动选择".into());
    }
    let kp = text(raw, "knowledge_point_code").trim();
    let kp = if points.iter().any(|p| text(p, "code") == kp) {
        kp
    } else {
        warnings.push("没能确定知识点,请家长选择".into());
        "other"
    };
    let mut pages = raw["pages"]
        .as_array()
        .unwrap_or(&Vec::new())
        .iter()
        .map(|p| numeric(p).trunc() as i64 - 1)
        .filter(|p| *p >= 0 && (*p as usize) < page_count)
        .collect::<Vec<_>>();
    pages.sort();
    pages.dedup();
    let kind = text(raw, "figure_kind").trim().to_lowercase();
    let kind = match kind.as_str() {
        "" => "none",
        "none" | "cube_net" | "number_line" | "bar_chart" | "cube_stack" | "other" => &kind,
        _ => "other",
    };
    Ok(
        json!({"label":text(raw,"label").trim(),"questionMarkdown":q,"studentAnswer":text(raw,"student_answer").trim(),"studentWorkMarkdown":text(raw,"student_work_markdown").trim(),"correctAnswer":text(raw,"correct_answer").trim(),"knowledgePointCode":kp,"hasStudentWork":has_work,"imageQuality":quality,"pages":pages,"incomplete":incomplete,"rootCauses":candidates,"recommendedRootCause":recommended,"warnings":warnings,"figureKind":kind,"figureNote":if kind=="none"{String::new()}else{text(raw,"figure_note").trim().chars().take(200).collect()}}),
    )
}
fn analysis_messages(grade: i64, causes: &[Value], points: &[Value], urls: Vec<String>) -> Value {
    let list_causes = causes
        .iter()
        .map(|c| {
            format!(
                "- {}:{}。{}",
                text(c, "code"),
                text(c, "label"),
                text(c, "description")
            )
        })
        .collect::<Vec<_>>()
        .join("\n");
    let list_points = points
        .iter()
        .map(|p| {
            format!(
                "- {}:{}({})",
                text(p, "code"),
                text(p, "label"),
                if p["grade"].is_null() {
                    "通用".into()
                } else {
                    format!(
                        "{}年级{}",
                        p["grade"],
                        if p["semester"] == 1 { "上" } else { "下" }
                    )
                }
            )
        })
        .collect::<Vec<_>>()
        .join("\n");
    let system = include_str!("../assets/analysis-prompt.txt")
        .replace("{{pageCount}}", &urls.len().to_string())
        .replace("{{grade}}", &grade.to_string())
        .replace("{{causes}}", &list_causes)
        .replace("{{points}}", &list_points);
    let mut content = vec![
        json!({"type":"text","text":format!("按顺序给出同一份试卷的 {} 页,请找出所有做错和没做的题。",urls.len())}),
    ];
    content.extend(
        urls.into_iter()
            .map(|url| json!({"type":"image_url","image_url":{"url":url}})),
    );
    json!([{"role":"system","content":system},{"role":"user","content":content}])
}
pub async fn analyze_paper(state: AppState, paper_id: String) {
    let outcome = run_paper(&state, &paper_id).await;
    if let Err(message) = outcome {
        if let Ok(i) = state.lock() {
            let _=db::exec(&i.db,"UPDATE papers SET status='failed',error_message=?1,updated_at=?2 WHERE id=?3 AND status='processing'",&[&message,&db::now(),&paper_id]);
            let _ = repo::log(
                &i,
                "analyze_paper",
                json!({"paperId":paper_id}),
                None,
                recognition_model(),
                Some(&message),
            );
        }
    }
}
async fn run_paper(state: &AppState, pid: &str) -> AppResult<()> {
    let (paper, pages, settings, key, causes, points, messages) = {
        let i = state.lock()?;
        let paper = repo::paper(&i, pid)?;
        let pages = repo::pages(&i, pid)?;
        let settings = i.settings.clone();
        let key = i.require_key()?;
        let causes = repo::causes(&i)?;
        let points = repo::points(
            &i,
            paper["curriculum_id"]
                .as_str()
                .unwrap_or(&settings.curriculum_id),
            paper["grade"].as_i64().unwrap_or(settings.grade),
        )?;
        let urls = pages
            .iter()
            .map(|p| {
                std::fs::read(text(p, "image_path"))
                    .map(|b| data_url(&b))
                    .map_err(|_| "试卷图片不存在,请重新导入".to_string())
            })
            .collect::<AppResult<Vec<_>>>()?;
        let messages = analysis_messages(
            paper["grade"].as_i64().unwrap_or(settings.grade),
            &causes,
            &points,
            urls,
        );
        (paper, pages, settings, key, causes, points, messages)
    };
    let mut last = String::new();
    let mut parsed = None;
    let mut usage = json!({"promptTokens":0,"completionTokens":0});
    for _ in 0..2 {
        let reply = chat(
            state,
            &key,
            recognition_model(),
            messages.clone(),
            ChatOptions {
                max_tokens: 16384,
                timeout: 300,
                ..Default::default()
            },
        )
        .await?;
        last = reply.content;
        for k in ["promptTokens", "completionTokens"] {
            usage[k] = json!(usage[k].as_u64().unwrap_or(0) + reply.usage[k].as_u64().unwrap_or(0));
        }
        if let Some(v) = extract_json(&last) {
            if let Some(batch) = parse_batch(&v) {
                parsed = Some(batch);
                break;
            }
        }
    }
    let (quality, raw) =
        parsed.ok_or("AI 返回的内容无法解析,请点重试;如果多次失败,可以换一份更清晰的图片")?;
    if raw.is_empty() && quality == "unreadable" {
        return Err("这张图片看不清题目,请重新拍一张".into());
    }
    let wrong = raw
        .into_iter()
        .filter(|q| !answers::same(text(q, "student_answer"), text(q, "correct_answer")))
        .collect::<Vec<_>>();
    let mut analyses = Vec::new();
    let mut first_error = String::new();
    for mut q in wrong.iter().take(30).cloned() {
        if q["image_quality"].is_null() {
            q["image_quality"] = json!(quality);
        }
        match postprocess(&q, pages.len(), &causes, &points, &settings) {
            Ok(a) => analyses.push(a),
            Err(e) => {
                if first_error.is_empty() {
                    first_error = e;
                }
            }
        }
    }
    if !wrong.is_empty() && analyses.is_empty() {
        return Err(first_error);
    }
    let i = state.lock()?;
    if repo::paper(&i, pid).is_err() {
        return Ok(());
    }
    repo::create_drafts(&i, &paper, &pages, &analyses)?;
    repo::log(
        &i,
        "analyze_paper",
        json!({"paperId":pid,"pageHashes":pages.iter().map(|p|p["image_hash"].clone()).collect::<Vec<_>>(),"grade":paper["grade"],"usage":usage}),
        Some(&last),
        recognition_model(),
        None,
    )?;
    db::exec(&i.db,"UPDATE papers SET status='done',error_message=NULL,skipped_count=?1,updated_at=?2 WHERE id=?3",&[&((wrong.len()-analyses.len()) as i64),&db::now(),&pid])?;
    Ok(())
}

pub fn parse_batch(value: &Value) -> Option<(String, Vec<Value>)> {
    if !value.is_object() {
        return None;
    }
    let quality = text(value, "image_quality").to_owned();
    let items = if let Some(items) = value["questions"].as_array() {
        items.clone()
    } else if value.get("question_markdown").is_some() {
        vec![value.clone()]
    } else {
        return None;
    };
    let total = items.len();
    let mut valid = Vec::new();
    for mut item in items {
        if !item.is_object() {
            continue;
        }
        if ["question_markdown"]
            .iter()
            .any(|k| item.get(*k).is_some_and(|v| !v.is_string()))
        {
            continue;
        }
        if [
            "label",
            "student_answer",
            "student_work_markdown",
            "correct_answer",
            "knowledge_point_code",
            "image_quality",
            "recommended_root_cause",
            "figure_kind",
            "figure_note",
        ]
        .iter()
        .any(|k| item.get(*k).is_some_and(|v| !v.is_null() && !v.is_string()))
        {
            continue;
        }
        if ["has_student_work", "incomplete"].iter().any(|k| {
            item.get(*k)
                .is_some_and(|v| !v.is_null() && !v.is_boolean())
        }) || item.get("has_student_work").is_some_and(Value::is_null)
        {
            continue;
        }
        if item.get("pages").is_some_and(|v| {
            !v.is_null()
                && (!v.is_array()
                    || v.as_array().unwrap().iter().any(|n| {
                        !n.is_number() && !n.as_str().is_some_and(|s| s.parse::<f64>().is_ok())
                    }))
        }) {
            continue;
        }
        if item.get("root_causes").is_some_and(|v| {
            !v.is_array()
                || v.as_array().unwrap().iter().any(|c| {
                    !c.is_object()
                        || !c["code"].is_string()
                        || c.get("evidence")
                            .is_some_and(|v| !v.is_null() && !v.is_string())
                        || c.get("confidence").is_some_and(|v| {
                            !v.is_null()
                                && !v.is_number()
                                && !v.as_str().is_some_and(|s| s.parse::<f64>().is_ok())
                        })
                })
        }) {
            continue;
        }
        if item["image_quality"].is_null() {
            item["image_quality"] = json!(quality);
        }
        valid.push(item);
    }
    if total > 0 && valid.is_empty() {
        None
    } else {
        Some((quality, valid))
    }
}
