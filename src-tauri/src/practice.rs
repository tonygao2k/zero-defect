use crate::{
    ai::{chat, extract_json, practice_model, str_value, verification_model},
    answers,
    db::{self, exec, one, parsed, query, text, transaction, AppResult},
    figure,
    mastery::{self, GuidedRechecks, Pair},
    practice_structure::{RecheckRequirement, Structure},
    practice_templates::{self, Metadata},
    repo, revision,
    state::{AppState, Inner, PracticeDifficulty, Settings},
};
use chrono::{DateTime, Local, NaiveDate, TimeZone, Utc};
use regex::Regex;
use serde_json::{json, Value};
use std::{collections::HashSet, time::Duration};
use tokio::task::JoinSet;

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
    pub level: Option<PracticeDifficulty>,
    pub template: Option<Metadata>,
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
            level: None,
            template: None,
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
                || options.iter().enumerate().any(|(index, option)| {
                    options[..index]
                        .iter()
                        .any(|other| answers::check("number", option, other, ""))
                })
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

#[derive(Clone, Copy, PartialEq, Eq)]
enum Purpose {
    Review,
    Recheck,
    Reinforcement,
}

#[derive(Clone)]
struct Assignment {
    pair: Pair,
    purpose: Purpose,
    count: usize,
}

#[derive(Clone, PartialEq, Eq)]
struct Curriculum {
    grade: i64,
    semester: i64,
    id: String,
}

impl From<&Settings> for Curriculum {
    fn from(settings: &Settings) -> Self {
        Self {
            grade: settings.grade,
            semester: settings.semester,
            id: settings.curriculum_id.clone(),
        }
    }
}

pub(crate) struct PreparedBatch {
    curriculum: Curriculum,
    credential_hash: String,
    questions: Vec<Question>,
}

#[derive(Clone)]
struct GenerationSlot {
    assignment: Assignment,
    difficulty: PracticeDifficulty,
    recheck: Option<RecheckRequirement>,
}

fn select_pairs(
    mut pairs: Vec<Pair>,
    rechecks: &GuidedRechecks,
    round_size: usize,
) -> Vec<Assignment> {
    pairs.retain(|pair| pair.practiceable(rechecks));
    pairs.sort_by(|left, right| {
        (
            !left.unsure_due,
            left.mastered,
            left.streak,
            &left.point,
            &left.cause,
        )
            .cmp(&(
                !right.unsure_due,
                right.mastered,
                right.streak,
                &right.point,
                &right.cause,
            ))
    });
    let mut due = pairs
        .iter()
        .filter(|pair| pair.review_due)
        .collect::<Vec<_>>();
    due.sort_by_key(|pair| pair.review_date);
    let mut rechecks_due = pairs
        .iter()
        .filter_map(|pair| pair.pending_guidance(rechecks).map(|since| (pair, since)))
        .collect::<Vec<_>>();
    rechecks_due.sort_by_key(|(_, since)| *since);
    let weak = pairs.iter().filter(|pair| {
        !pair.review_due && (pair.unsure_due || (!pair.mastered && !pair.waiting_for_recovery))
    });
    let mut seen = HashSet::new();
    let mut plan = Vec::new();
    for (pair, purpose) in due
        .iter()
        .take(2)
        .map(|pair| (*pair, Purpose::Review))
        .chain(rechecks_due.first().map(|(pair, _)| {
            (
                *pair,
                if pair.review_due {
                    Purpose::Review
                } else {
                    Purpose::Recheck
                },
            )
        }))
        .chain(weak.map(|pair| (pair, Purpose::Reinforcement)))
        .chain(due.iter().skip(2).map(|pair| (*pair, Purpose::Review)))
        .chain(
            rechecks_due
                .iter()
                .skip(1)
                .map(|(pair, _)| (*pair, Purpose::Recheck)),
        )
    {
        if seen.insert((&pair.cause, &pair.point)) {
            plan.push(Assignment {
                pair: pair.clone(),
                purpose,
                count: 1,
            });
        }
        if plan.len() == round_size {
            return plan;
        }
    }
    let weak_indices = plan
        .iter()
        .enumerate()
        .filter_map(|(index, item)| (item.purpose == Purpose::Reinforcement).then_some(index))
        .collect::<Vec<_>>();
    for index in weak_indices
        .into_iter()
        .cycle()
        .take(round_size - plan.len())
    {
        plan[index].count += 1;
    }
    plan
}

fn pending_session(i: &Inner) -> AppResult<Option<Value>> {
    one(&i.db,"SELECT id FROM practice_sessions s WHERE s.status='pending' AND EXISTS
        (SELECT 1 FROM valid_practice_questions q WHERE q.session_id=s.id) ORDER BY s.created_at DESC LIMIT 1",&[])
}

fn daily_submitted(i: &Inner, today: NaiveDate) -> AppResult<bool> {
    Ok(one(
        &i.db,
        "SELECT 1 FROM practice_sessions WHERE is_daily=1 AND submitted_local_date=?1",
        &[&today.to_string()],
    )?
    .is_some())
}

pub fn daily_status(
    i: &Inner,
    today: NaiveDate,
    pairs: &[Pair],
    rechecks: &GuidedRechecks,
) -> AppResult<Value> {
    let plan = select_pairs(pairs.to_vec(), rechecks, i.settings.practice_question_count);
    let count = |purpose| {
        plan.iter()
            .filter(|entry| entry.purpose == purpose)
            .map(|entry| entry.count)
            .sum::<usize>()
    };
    Ok(json!({
        "date":today,
        "canResume":pending_session(i)?.is_some(),
        "submitted":daily_submitted(i, today)?,
        "dueReviews":pairs.iter().filter(|pair| pair.review_due).count(),
        "overdueReviews":pairs.iter().filter(|pair| pair.review_date.is_some_and(|date| date < today)).count(),
        "plan":{"review":count(Purpose::Review),"recheck":count(Purpose::Recheck),"reinforcement":count(Purpose::Reinforcement)}
    }))
}

#[cfg(test)]
pub async fn start(state: &AppState) -> AppResult<Value> {
    start_with_path(state).await.map(|(session, _)| session)
}

pub async fn start_with_path(state: &AppState) -> AppResult<(Value, &'static str)> {
    // Serialize session creation. Neither the database lock nor this gate is used for prefetch.
    let _gate = state.practice_gate.lock().await;
    let (key, settings, slots) = {
        let i = state.lock()?;
        let today = Local::now().date_naive();
        exec(&i.db,"UPDATE practice_sessions SET status='completed',completed_at=?1 WHERE status='submitted'",&[&db::now()])?;
        exec(&i.db,"UPDATE practice_sessions SET status='abandoned',completed_at=?1 WHERE status='pending' AND NOT EXISTS (SELECT 1 FROM valid_practice_questions q WHERE q.session_id=practice_sessions.id)",&[&db::now()])?;
        if let Some(p) = pending_session(&i)? {
            return session(&i, text(&p, "id")).map(|session| (session, "resume"));
        }

        let slots = generation_slots(&i, today, &i.settings)?;
        if slots.is_empty() {
            return Err(
                "现在没有需要练习的内容。先去错题库确认错题，或者等到了复习时间再来。".into(),
            );
        }

        let key = i.key()?;
        let curriculum = Curriculum::from(&i.settings);
        let prepared = i.prepared_practice.as_ref().filter(|batch| {
            batch.curriculum == curriculum
                && batch.credential_hash == crate::state::hash(key.as_bytes())
        });
        let blocked = voided_question_keys(&i)?;
        let mut groups = Vec::new();
        for slot in &slots {
            let history = QuestionHistory::load(&i, &slot.assignment.pair)?;
            let mut candidates = prepared
                .into_iter()
                .flat_map(|batch| &batch.questions)
                .filter(|question| slot.matches(question) && history.allows(question))
                .cloned()
                .collect::<Vec<_>>();
            candidates.extend(local_questions(&i, slot, &history, &blocked)?);
            groups.push((candidates, slot.assignment.count));
        }
        let questions = assemble_round(groups, blocked, i.settings.practice_question_count);
        if !questions.is_empty() {
            let daily = !daily_submitted(&i, today)?;
            let session = save_at(&i, &questions, daily, Utc::now())?;
            if !key.is_empty() {
                // Prepare only the first missing assignment, so a quick round has bounded AI cost.
                let missing = slots.iter().find_map(|slot| {
                    let filled = questions
                        .iter()
                        .filter(|question| slot.matches(question))
                        .count();
                    let remaining = slot.assignment.count.saturating_sub(filled);
                    (remaining > 0).then(|| {
                        let mut slot = slot.clone();
                        slot.assignment.count = remaining;
                        slot
                    })
                });
                let variety = || {
                    if questions.iter().any(|question| question.template.is_none()) {
                        return None;
                    }
                    slots
                        .iter()
                        .find(|slot| slot.assignment.purpose == Purpose::Reinforcement)
                        .cloned()
                        .map(|mut slot| {
                            slot.assignment.count = 1;
                            slot
                        })
                };
                if let Some(slot) = missing.or_else(variety) {
                    prepare_next(state, curriculum, key, slot);
                }
            }
            return Ok((session, "ready"));
        }
        if key.is_empty() {
            return Err("暂时没有适合的离线题。可在设置中填写 API Key，在线出题后再开始。".into());
        }
        (key, i.settings.clone(), slots)
    };

    let curriculum = Curriculum::from(&settings);
    let mut tasks = JoinSet::new();
    for (index, slot) in slots.into_iter().enumerate() {
        let state = state.clone();
        let key = key.clone();
        let grade = settings.grade;
        tasks.spawn(async move { (index, timed_questions(&state, &key, grade, &slot).await) });
    }
    let mut generated = Vec::new();
    while let Some(task) = tasks.join_next().await {
        generated.push(task.map_err(|_| "练习生成任务中断，请重试")?);
    }
    generated.sort_by_key(|(index, _)| *index);

    let i = state.lock()?;
    if Curriculum::from(&i.settings) != curriculum {
        return Err("教材、年级或学期已更改，请重新开始练习".into());
    }
    let today = Local::now().date_naive();
    let mut groups = Vec::new();
    let mut first_error = None;
    let mut verified = Vec::new();
    for (_, result) in generated {
        match result {
            Ok(questions) => verified.extend(questions),
            Err(error) => {
                first_error.get_or_insert(error);
            }
        }
    }
    // Use the current plan after waiting. A confirmed mistake or a review may have changed.
    for slot in generation_slots(&i, today, &settings)? {
        let history = QuestionHistory::load(&i, &slot.assignment.pair)?;
        let questions = verified
            .iter()
            .filter(|question| slot.matches(question) && history.allows(question))
            .cloned()
            .collect();
        groups.push((questions, slot.assignment.count));
    }
    let questions = assemble_round(
        groups,
        voided_question_keys(&i)?,
        settings.practice_question_count,
    );
    if questions.is_empty() {
        return Err(first_error.unwrap_or_else(|| "暂时没有生成合适的题目，请重试。".into()));
    }
    let daily = !daily_submitted(&i, today)?;
    save_at(&i, &questions, daily, Utc::now()).map(|session| (session, "online"))
}

impl GenerationSlot {
    fn matches(&self, question: &Question) -> bool {
        question.pair.cause == self.assignment.pair.cause
            && question.pair.point == self.assignment.pair.point
            && question.level.as_ref() == Some(&self.difficulty)
            && self.recheck.as_ref().is_none_or(|requirement| {
                requirement.accepts(question.structure(), self.difficulty.code())
            })
    }
}

fn generation_slots(
    i: &Inner,
    today: NaiveDate,
    settings: &Settings,
) -> AppResult<Vec<GenerationSlot>> {
    let rechecks = mastery::guided_rechecks(i, today)?;
    Ok(select_pairs(
        mastery::pairs_on(i, today)?,
        &rechecks,
        settings.practice_question_count,
    )
    .into_iter()
    .map(|assignment| {
        let recheck = assignment
            .pair
            .pending_guidance_requirement(&rechecks)
            .cloned();
        let difficulty = recheck
            .as_ref()
            .map_or(&settings.practice_difficulty, |r| &r.level)
            .clone();
        GenerationSlot {
            assignment,
            difficulty,
            recheck,
        }
    })
    .collect())
}

fn prepare_next(state: &AppState, curriculum: Curriculum, key: String, slot: GenerationSlot) {
    let Ok(gate) = state.practice_preparation.clone().try_lock_owned() else {
        return;
    };
    let state = state.clone();
    tauri::async_runtime::spawn(async move {
        let _gate = gate;
        let Ok(mut questions) = timed_questions(&state, &key, curriculum.grade, &slot).await else {
            return;
        };
        questions.retain(|question| slot.matches(question));
        questions.truncate(slot.assignment.count);
        if questions.is_empty() {
            return;
        }
        if let Ok(mut i) = state.lock() {
            if Curriculum::from(&i.settings) == curriculum && i.key().as_deref() == Ok(key.as_str())
            {
                i.prepared_practice = Some(PreparedBatch {
                    curriculum,
                    credential_hash: crate::state::hash(key.as_bytes()),
                    questions,
                });
            }
        }
    });
}

async fn timed_questions(
    state: &AppState,
    key: &str,
    grade: i64,
    slot: &GenerationSlot,
) -> AppResult<Vec<Question>> {
    tokio::time::timeout(
        Duration::from_secs(45),
        make_questions(state, key, grade, slot),
    )
    .await
    .map_err(|_| "出题等候时间较长，请重试。".to_string())?
}

fn local_questions(
    i: &Inner,
    slot: &GenerationSlot,
    history: &QuestionHistory,
    blocked: &HashSet<(String, String)>,
) -> AppResult<Vec<Question>> {
    if slot
        .recheck
        .as_ref()
        .is_some_and(|r| !r.accepts_structure(Structure::Calculation))
    {
        return Ok(vec![]);
    }
    let pair = &slot.assignment.pair;
    let Some(row) = one(
        &i.db,
        "SELECT p.code FROM knowledge_points p JOIN curriculum_knowledge_points c
         ON c.knowledge_point_id=p.id WHERE p.id=?1 AND c.curriculum_id=?2 AND p.active=1
         AND (c.grade<?3 OR (c.grade=?3 AND (c.semester IS NULL OR c.semester<=?4)))",
        &[
            &pair.point,
            &i.settings.curriculum_id,
            &i.settings.grade,
            &i.settings.semester,
        ],
    )?
    else {
        return Ok(vec![]);
    };
    let Some(family) = practice_templates::family(text(&row, "code"), &pair.cause) else {
        return Ok(vec![]);
    };
    let seed = uuid::Uuid::new_v4().as_u128() as u32;
    let numeric_limit = if i.settings.grade == 2 && i.settings.semester == 1 {
        100
    } else {
        10000
    };
    let mut candidates = Vec::new();
    let mut seen = HashSet::new();
    for offset in 0..128 {
        let Some(sample) = practice_templates::generate(
            family,
            &slot.difficulty,
            numeric_limit,
            seed.wrapping_add(offset),
        ) else {
            continue;
        };
        let kind = if sample.options.is_empty() {
            "number"
        } else {
            "choice"
        };
        let question = Question {
            markdown: sample.markdown,
            options: sample.options,
            kind: kind.into(),
            correct: sample.correct,
            unit: sample.unit.into(),
            solution: sample.solution,
            figure: Value::Null,
            solver: "code".into(),
            pair: pair.clone(),
            level: Some(slot.difficulty.clone()),
            template: Some(sample.metadata),
        };
        let key = question.variant_key();
        if history.allows(&question) && !blocked.contains(&key) && seen.insert(key) {
            candidates.push(question);
            if candidates.len() >= slot.assignment.count + 2 {
                break;
            }
        }
    }
    Ok(candidates)
}

fn assemble_round(
    groups: Vec<(Vec<Question>, usize)>,
    mut seen: HashSet<(String, String)>,
    round_size: usize,
) -> Vec<Question> {
    let mut groups = groups
        .into_iter()
        .map(|(group, count)| (group.into_iter(), count))
        .collect::<Vec<_>>();
    let mut questions = Vec::new();
    while questions.len() < round_size {
        let before = questions.len();
        for (group, remaining) in &mut groups {
            if *remaining == 0 {
                continue;
            }
            if let Some(question) = group.find(|question| seen.insert(question.variant_key())) {
                questions.push(question);
                *remaining -= 1;
                if questions.len() == round_size {
                    return questions;
                }
            }
        }
        if questions.len() == before {
            break;
        }
    }
    questions
}

type VariantKey = (String, String);

fn variant_key(markdown: &str, figure: &Value) -> VariantKey {
    (
        practice_templates::canonical_prompt(markdown),
        figure::validate(figure).unwrap_or(Value::Null).to_string(),
    )
}

impl Question {
    fn structure(&self) -> Structure {
        Structure::inspect(&self.markdown, &self.figure, self.template.is_some())
    }

    fn variant_key(&self) -> VariantKey {
        if let Some(template) = &self.template {
            return (template.fingerprint.clone(), "null".into());
        }
        variant_key(&self.markdown, &self.figure)
    }

    fn verification(&self) -> Value {
        if let Some(template) = &self.template {
            return json!({"source":"template","solver":"code","template":template,"structure":self.structure()});
        }
        json!({
            "source":"ai",
            "solver":self.solver,
            "model":verification_model(),
            "fingerprint":[self.kind, self.variant_key()],
            "structure":self.structure(),
        })
    }
}

fn voided_question_keys(i: &Inner) -> AppResult<HashSet<VariantKey>> {
    Ok(query(&i.db,"SELECT q.question_markdown q,q.figure_json FROM practice_questions q JOIN practice_question_review_state r ON r.question_id=q.id AND r.action='void'",&[])?
        .iter().map(|row| variant_key(text(row, "q"), &parsed(row, "figure_json"))).collect())
}

struct QuestionHistory {
    prior: HashSet<VariantKey>,
    originals: HashSet<String>,
}

impl QuestionHistory {
    fn load(i: &Inner, pair: &Pair) -> AppResult<Self> {
        let history = query(
            &i.db,
            "SELECT question_markdown q,figure_json FROM practice_questions WHERE root_cause_id=?1 AND knowledge_point_id=?2",
            &[&pair.cause, &pair.point],
        )?;
        let originals = query(
            &i.db,
            "SELECT m.question_markdown q FROM mistakes m JOIN mistake_root_causes mrc
             ON mrc.mistake_id=m.id AND mrc.is_primary=1
             WHERE m.status='active' AND mrc.root_cause_id=?1 AND m.knowledge_point_id=?2",
            &[&pair.cause, &pair.point],
        )?;
        Ok(Self {
            prior: history
                .iter()
                .map(|row| variant_key(text(row, "q"), &parsed(row, "figure_json")))
                .collect(),
            originals: originals
                .iter()
                .map(|row| practice_templates::canonical_prompt(text(row, "q")))
                .collect(),
        })
    }

    fn allows(&self, question: &Question) -> bool {
        let key = question.variant_key();
        !self.originals.contains(&key.0) && !self.prior.contains(&key)
    }
}

async fn make_questions(
    state: &AppState,
    key: &str,
    grade: i64,
    slot: &GenerationSlot,
) -> AppResult<Vec<Question>> {
    let pair = &slot.assignment.pair;
    let count = slot.assignment.count + 2;
    let (info, examples, avoid, history, blocked) = {
        let i = state.lock()?;
        let info=one(&i.db,"SELECT kp.label kp,rc.label cause,COALESCE(rc.description,'') description FROM knowledge_points kp,root_causes rc WHERE kp.id=?1 AND rc.id=?2",&[&pair.point,&pair.cause])?.ok_or("知识点或归因不存在")?;
        let examples=query(&i.db,"SELECT m.question_markdown question,COALESCE(m.student_answer,'') studentAnswer,m.analysis_json aj FROM mistakes m JOIN mistake_root_causes mrc ON mrc.mistake_id=m.id AND mrc.is_primary=1 WHERE m.status='active' AND mrc.root_cause_id=?1 AND m.knowledge_point_id=?2 ORDER BY m.updated_at DESC LIMIT 2",&[&pair.cause,&pair.point])?;
        let avoid=query(&i.db,"SELECT question_markdown q,figure_json FROM practice_questions WHERE root_cause_id=?1 AND knowledge_point_id=?2 ORDER BY created_at DESC LIMIT 10",&[&pair.cause,&pair.point])?;
        let history = QuestionHistory::load(&i, pair)?;
        let blocked = voided_question_keys(&i)?;
        (info, examples, avoid, history, blocked)
    };
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
    let mut system = include_str!("../assets/practice-prompt.txt")
        .replace("{{grade}}", &grade.to_string())
        .replace("{{count}}", &count.to_string())
        .replace("{{difficulty}}", slot.difficulty.prompt_text());
    if let Some(requirement) = &slot.recheck {
        system.push_str("\n本轮复测的题目形式以此条为准。");
        system.push_str(&requirement.instructions());
    }
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
            let mut seen = blocked.clone();
            drafts = parse_questions(&value, pair)
                .into_iter()
                .map(|mut question| {
                    question.level = Some(slot.difficulty.clone());
                    question
                })
                .filter(|question| {
                    slot.matches(question)
                        && history.allows(question)
                        && seen.insert(question.variant_key())
                })
                .take(count)
                .collect();
        }
        if !drafts.is_empty() {
            break;
        }
    }
    let mut tasks = JoinSet::new();
    for (index, question) in drafts.into_iter().enumerate() {
        let state = state.clone();
        let key = key.to_owned();
        tasks.spawn(async move { (index, verify_question(&state, &key, question).await) });
    }
    let mut verified = Vec::new();
    let mut first_error = None;
    while let Some(task) = tasks.join_next().await {
        let (index, result) = task.map_err(|_| "校验任务被中断")?;
        match result {
            Ok(Some(question)) => verified.push((index, question)),
            Ok(None) => {}
            Err(error) => {
                first_error.get_or_insert(error);
            }
        }
    }
    if verified.is_empty() {
        if let Some(error) = first_error {
            return Err(error);
        }
    }
    verified.sort_by_key(|(index, _)| *index);
    Ok(verified.into_iter().map(|(_, question)| question).collect())
}

async fn verify_question(
    state: &AppState,
    key: &str,
    mut question: Question,
) -> AppResult<Option<Question>> {
    if ["cube_net", "cube_stack"].contains(&text(&question.figure, "type")) {
        question.solver = "code".into();
        return Ok(Some(question));
    }
    let options = question
        .options
        .iter()
        .enumerate()
        .map(|(index, option)| format!("{}. {option}", char::from(b'A' + index as u8)))
        .collect::<Vec<_>>()
        .join("\n");
    let how = if question.kind == "choice" {
        "这是选择题,answer 填正确选项字母。"
    } else {
        "answer 填最终结果:整数、小数、最简分数(a/b)或商...余数,不带单位。"
    };
    let figure = if question.figure.is_null() {
        String::new()
    } else {
        format!("\n配图数据:{}", question.figure)
    };
    let messages = json!([
        {"role":"system","content":format!("你是一位严谨的小学数学老师。独立解答题目,推理简短,最后单独一行给出 JSON 对象: {{\"answer\":\"...\"}}。{how}")},
        {"role":"user","content":format!("{}{figure}\n{options}", question.markdown)},
    ]);
    let reply = chat(
        state,
        key,
        verification_model(),
        messages,
        crate::ai::ChatOptions {
            max_tokens: 4096,
            retries: 1,
            ..Default::default()
        },
    )
    .await?;
    let value = extract_json(&reply.content).unwrap_or(Value::Null);
    let answer = str_value(&value["answer"]);
    if !answers::check(&question.kind, &answer, &question.correct, &question.unit) {
        return Ok(None);
    }
    question.solver = answer;
    Ok(Some(question))
}
pub(crate) fn question_key(markdown: &str, figure: &Value) -> (String, String) {
    let figure = figure::validate(figure).unwrap_or(Value::Null);
    (markdown.split_whitespace().collect(), figure.to_string())
}
#[cfg(test)]
pub fn save(i: &Inner, questions: &[Question]) -> AppResult<Value> {
    save_at(i, questions, false, Utc::now())
}

pub(crate) fn save_at(
    i: &Inner,
    questions: &[Question],
    daily: bool,
    now: DateTime<Utc>,
) -> AppResult<Value> {
    let session_id = db::id();
    let t = db::stamp(now);
    let today = now.with_timezone(&Local).date_naive().to_string();
    transaction(&i.db, || {
        exec(&i.db,"INSERT INTO practice_sessions(id,practice_date,status,created_at,is_daily) VALUES (?1,?2,'pending',?3,?4)",&[&session_id,&today,&t,&daily])?;
        for (pos, q) in questions.iter().enumerate() {
            let source=one(&i.db,"SELECT m.id FROM mistakes m JOIN mistake_root_causes mrc ON mrc.mistake_id=m.id AND mrc.is_primary=1 WHERE m.status='active' AND mrc.root_cause_id=?1 AND m.knowledge_point_id=?2 ORDER BY m.updated_at DESC LIMIT 1",&[&q.pair.cause,&q.pair.point])?;
            exec(&i.db,"INSERT INTO practice_questions(id,session_id,position,root_cause_id,knowledge_point_id,source_mistake_id,question_markdown,answer_type,options_json,correct_answer,answer_unit,solution_markdown,figure_json,difficulty,status,verify_json,created_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,'assigned',?15,?16)",&[&db::id(),&session_id,&(pos as i64),&q.pair.cause,&q.pair.point,&source.as_ref().and_then(|s|s["id"].as_str()),&q.markdown,&q.kind,&json!(q.options).to_string(),&q.correct,&q.unit,&q.solution,&if q.figure.is_null(){None}else{Some(q.figure.to_string())},&q.level.as_ref().map_or(1, PracticeDifficulty::code),&q.verification().to_string(),&t])?;
        }
        let ai_count = questions
            .iter()
            .filter(|question| question.template.is_none())
            .count();
        if ai_count > 0 {
            repo::log(
                i,
                "generate_practice",
                json!({"sessionId":session_id,"count":ai_count}),
                None,
                practice_model(),
                None,
            )?;
        }
        Ok(())
    })?;
    session(i, &session_id)
}
pub fn submit(i: &Inner, input: &Value) -> AppResult<Value> {
    submit_at(i, input, Local::now())
}

pub(crate) fn submit_at(
    i: &Inner,
    input: &Value,
    now: DateTime<impl TimeZone>,
) -> AppResult<Value> {
    let id = repo::required(input, "sessionId", 500)?;
    let session = one(
        &i.db,
        "SELECT status,is_daily FROM practice_sessions WHERE id=?1",
        &[&id],
    )?
    .ok_or("找不到这次练习")?;
    match session["status"].as_str() {
        Some("pending") => {}
        Some("submitted" | "completed") => return result(i, id),
        _ => return Err("这次练习已放弃".into()),
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
    if rows.is_empty() {
        return Err("本轮题目均已作废，请放弃后重新开始".into());
    }
    let timestamp = db::stamp(now.with_timezone(&Utc));
    let local_day = now.date_naive();
    let today = local_day.to_string();
    let daily = session["is_daily"] == 1 && !daily_submitted(i, local_day)?;
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
            exec(&i.db,"INSERT INTO answer_attempts(id,practice_question_id,root_cause_id,knowledge_point_id,submitted_answer,normalized_answer,is_correct,skipped,answer_time_ms,created_at,outcome,local_date) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)",&[&db::id(),&text(q,"id"),&text(q,"root_cause_id"),&text(q,"knowledge_point_id"),&given,&given.to_lowercase(),&(outcome=="correct"),&(outcome=="skipped"),&per_question,&timestamp,&outcome,&today])?;
            exec(
                &i.db,
                "UPDATE practice_questions SET status='answered' WHERE id=?1",
                &[&text(q, "id")],
            )?;
        }
        exec(
            &i.db,
            "UPDATE practice_sessions SET status='submitted',submitted_local_date=?2,is_daily=?3 WHERE id=?1",
            &[&id, &today, &daily],
        )?;
        Ok(())
    })?;
    result(i, id)
}

pub fn result(i: &Inner, id: &str) -> AppResult<Value> {
    if one(
        &i.db,
        "SELECT 1 FROM practice_sessions WHERE id=?1 AND status IN ('submitted','completed')",
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
    exec(&i.db,"UPDATE practice_sessions SET status='completed',completed_at=?1 WHERE id=?2 AND status='submitted'",&[&db::now(),&id])?;
    Ok(Value::Null)
}

pub fn abandon(i: &Inner, input: &Value) -> AppResult<Value> {
    let id = repo::required(input, "sessionId", 500)?;
    let changed = exec(&i.db,"UPDATE practice_sessions SET status='abandoned',completed_at=?1 WHERE id=?2 AND status='pending'",&[&db::now(),&id])?;
    if changed == 0 {
        return Err("没有可放弃的进行中练习".into());
    }
    Ok(Value::Null)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mastery::GuidedRecheck;

    fn pair(streak: usize) -> Pair {
        Pair {
            cause: "calculation_error".into(),
            point: streak.to_string(),
            streak,
            mastered: false,
            review_due: false,
            review_date: None,
            waiting_for_recovery: false,
            unsure_due: false,
        }
    }

    #[test]
    fn daily_plan_reserves_due_slots_and_counts_overlapping_recheck_once() {
        let date = |day| NaiveDate::from_ymd_opt(2026, 11, day).unwrap();
        let mut pairs = (0..8).rev().map(pair).collect::<Vec<_>>();
        for pair in pairs.iter_mut().filter(|pair| pair.streak >= 5) {
            pair.mastered = true;
            pair.review_due = true;
            pair.review_date = Some(date(pair.streak as u32));
        }
        let rechecks = [(5, "2026-11-01"), (3, "2026-11-02")]
            .into_iter()
            .map(|(code, since)| {
                (
                    ("calculation_error".into(), code.to_string()),
                    GuidedRecheck {
                        since: since.into(),
                        correct: None,
                        cross_day_correct: None,
                        due: true,
                        requirement: RecheckRequirement {
                            structure: Structure::Calculation,
                            level: PracticeDifficulty::Medium,
                        },
                    },
                )
            })
            .collect();
        let small_plan = select_pairs(pairs.clone(), &rechecks, 1);
        assert_eq!(small_plan.len(), 1);
        assert_eq!(small_plan[0].pair.streak, 5);
        assert_eq!(small_plan[0].count, 1);
        let plan = select_pairs(pairs, &rechecks, 5);
        assert_eq!(
            plan.iter().map(|item| item.pair.streak).collect::<Vec<_>>(),
            [5, 6, 0, 1, 2]
        );
        assert_eq!(
            plan.iter()
                .filter(|item| item.purpose == Purpose::Review)
                .count(),
            2
        );
        assert_eq!(plan.iter().map(|item| item.count).sum::<usize>(), 5);
    }

    #[test]
    fn configured_round_size_can_exceed_five() {
        let plan = select_pairs(vec![pair(0)], &GuidedRechecks::new(), 8);
        assert_eq!(plan.len(), 1);
        assert_eq!(plan[0].count, 8);
    }

    #[test]
    fn round_deduplicates_questions_across_pairs_and_does_not_pad() {
        let sample = |markdown: &str, streak| Question {
            markdown: markdown.into(),
            kind: "number".into(),
            options: vec![],
            correct: "15".into(),
            unit: String::new(),
            solution: String::new(),
            figure: Value::Null,
            solver: String::new(),
            pair: pair(streak),
            level: None,
            template: None,
        };
        let questions = assemble_round(
            vec![
                (vec![sample("10 + 5", 0)], 1),
                (vec![sample("10+5", 1), sample("8+7", 1)], 3),
            ],
            HashSet::new(),
            5,
        );
        assert_eq!(
            questions
                .iter()
                .map(|question| question.markdown.as_str())
                .collect::<Vec<_>>(),
            ["10 + 5", "8+7"]
        );
        let capped = assemble_round(
            vec![(vec![sample("10 + 5", 0), sample("8+7", 0)], 2)],
            HashSet::new(),
            1,
        );
        assert_eq!(capped.len(), 1);
    }

    #[test]
    fn gives_one_pending_recheck_priority_without_reordering_the_other_pairs() {
        let pairs = (0..9)
            .rev()
            .map(|streak| Pair {
                mastered: streak == 8,
                ..pair(streak)
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
                    cross_day_correct: correct,
                    due: true,
                    requirement: RecheckRequirement {
                        structure: Structure::Calculation,
                        level: PracticeDifficulty::Medium,
                    },
                },
            )
        })
        .collect();
        let selected = select_pairs(pairs, &rechecks, 5);
        assert_eq!(
            selected
                .iter()
                .map(|item| item.pair.streak)
                .collect::<Vec<_>>(),
            [7, 0, 1, 2, 3]
        );
    }
}
