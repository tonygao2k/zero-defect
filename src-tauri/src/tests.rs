use super::*;
use crate::{
    db::{one, query},
    mastery::Pair,
    practice::Question,
    state::{AppState, Settings},
};
use chrono::{DateTime, Utc};
use std::fs;
fn setup() -> (tempfile::TempDir, AppState) {
    let dir = tempfile::tempdir().unwrap();
    let state = AppState::new(dir.path().to_owned(), vec![]).unwrap();
    (dir, state)
}
fn count(i: &state::Inner, table: &str) -> i64 {
    one(&i.db, &format!("SELECT COUNT(*) n FROM {table}"), &[])
        .unwrap()
        .unwrap()["n"]
        .as_i64()
        .unwrap()
}
fn mock_paper(i: &state::Inner) -> String {
    let id = db::id();
    exec(&i.db,"INSERT INTO papers(id,title,analysis_key,status,grade,semester,curriculum_id,created_at,updated_at) VALUES (?1,'试卷','key','done',3,1,'pep_primary_math',?2,?2)",&[&id,&db::now()]).unwrap();
    let page = db::id();
    let path = i.directory.join("images").join("original.jpg");
    fs::write(&path, b"image").unwrap();
    exec(
        &i.db,
        "INSERT INTO paper_pages VALUES (?1,?2,0,?3,'hash')",
        &[&page, &id, &path.to_string_lossy().as_ref()],
    )
    .unwrap();
    id
}
fn analysis() -> Value {
    json!({"label":"第1题","questionMarkdown":"23×14=?","studentAnswer":"312","studentWorkMarkdown":"","correctAnswer":"322","knowledgePointCode":"mul_two_digit","hasStudentWork":false,"pages":[0],"incomplete":false,"rootCauses":[{"code":"carry_omission","confidence":0.5,"evidence":"漏进位","unknownFromModel":false}],"recommendedRootCause":"carry_omission","warnings":["缺少解题过程"]})
}
fn mock_draft(i: &state::Inner, pid: &str) -> String {
    repo::create_drafts(
        i,
        &repo::paper(i, pid).unwrap(),
        &repo::pages(i, pid).unwrap(),
        &[analysis()],
    )
    .unwrap();
    text(
        &query(&i.db, "SELECT id FROM mistakes WHERE paper_id=?1", &[&pid]).unwrap()[0],
        "id",
    )
    .to_owned()
}
#[test]
fn fresh_database_has_all_five_versions_and_taxonomy() {
    let (_d, s) = setup();
    let i = s.lock().unwrap();
    assert_eq!(count(&i, "schema_migrations"), 5);
    let t = repo::taxonomy(&i).unwrap();
    assert!(t["causes"]
        .as_array()
        .unwrap()
        .iter()
        .any(|c| c["code"] == "not_attempted"));
    assert!(t["knowledgePoints"].as_array().unwrap().len() > 15);
    assert!(query(&i.db, "PRAGMA foreign_key_check", &[])
        .unwrap()
        .is_empty());
    assert_eq!(mastery::stats(&i).unwrap()["mistakeCount"], 0);
}
#[test]
fn upgrades_v2_with_relations_and_groups_legacy_images() {
    let db = rusqlite::Connection::open_in_memory().unwrap();
    db.execute_batch("PRAGMA foreign_keys=ON").unwrap();
    db::migrate(&db, None, 2).unwrap();
    db.execute_batch("INSERT INTO mistakes(id,image_path,image_hash,question_markdown,grade,curriculum_id,knowledge_point_id,status,created_at,updated_at) VALUES ('m1','/img/a.jpg','hash','q',3,'pep_primary_math','mul_two_digit','active','2026-11-01T00:00:00Z','2026-11-01T00:00:00Z'); INSERT INTO mistake_root_causes VALUES ('m1','carry_omission',0.8,'e',1,1); INSERT INTO mastery(root_cause_id,knowledge_point_id,score) VALUES ('carry_omission','mul_two_digit',1.5);").unwrap();
    db::migrate(&db, None, 5).unwrap();
    assert_eq!(
        one(&db, "SELECT analysis_key FROM mistakes WHERE id='m1'", &[])
            .unwrap()
            .unwrap()["analysis_key"],
        "hash"
    );
    assert_eq!(
        query(&db, "SELECT * FROM mistake_pages", &[])
            .unwrap()
            .len(),
        1
    );
    assert_eq!(
        one(&db, "SELECT score FROM mastery", &[]).unwrap().unwrap()["score"],
        1.5
    );
    assert!(query(&db, "PRAGMA foreign_key_check", &[])
        .unwrap()
        .is_empty());
    db.execute_batch("INSERT INTO practice_sessions(id,practice_date,created_at) VALUES ('s1','today','t'),('s2','today','t')").unwrap();
}
#[test]
fn failed_migration_rolls_back_and_restores_foreign_keys() {
    let db = rusqlite::Connection::open_in_memory().unwrap();
    db.execute_batch("PRAGMA foreign_keys=ON").unwrap();
    db::migrate(&db, None, 2).unwrap();
    db.execute_batch("PRAGMA foreign_keys=OFF; INSERT INTO mistake_root_causes(mistake_id,root_cause_id) VALUES ('ghost','carry_omission'); PRAGMA foreign_keys=ON;").unwrap();
    assert!(db::migrate(&db, None, 5).unwrap_err().contains("外键检查"));
    assert_eq!(
        one(&db, "SELECT MAX(version) v FROM schema_migrations", &[])
            .unwrap()
            .unwrap()["v"],
        2
    );
    assert_eq!(
        one(&db, "PRAGMA foreign_keys", &[]).unwrap().unwrap()["foreign_keys"],
        1
    );
}
#[test]
fn backup_removes_key_without_changing_live_database() {
    let (d, s) = setup();
    let i = s.lock().unwrap();
    exec(
        &i.db,
        "INSERT INTO app_settings VALUES ('bailian_api_key','test-secret')",
        &[],
    )
    .unwrap();
    let backup = db::backup(&i.db, &d.path().join("backup"), 5).unwrap();
    let copied = rusqlite::Connection::open(backup).unwrap();
    assert!(one(&copied, "SELECT value FROM app_settings", &[])
        .unwrap()
        .is_none());
    assert_eq!(i.key().unwrap(), "test-secret");
}
#[test]
fn legacy_import_keeps_source_and_rewrites_image_paths() {
    let root = tempfile::tempdir().unwrap();
    let source = root.path().join("old");
    let dest = root.path().join("new");
    let original = AppState::new(source.clone(), vec![]).unwrap();
    {
        let i = original.lock().unwrap();
        let pid = mock_paper(&i);
        mock_draft(&i, &pid);
        exec(
            &i.db,
            "INSERT INTO app_settings VALUES ('bailian_api_key','preserve-key')",
            &[],
        )
        .unwrap();
    }
    let imported = AppState::new(dest.clone(), vec![source.clone()]).unwrap();
    let i = imported.lock().unwrap();
    assert_eq!(count(&i, "mistakes"), 1);
    assert_eq!(i.key().unwrap(), "preserve-key");
    let path = repo::pages(
        &i,
        text(
            &query(&i.db, "SELECT id FROM papers", &[]).unwrap()[0],
            "id",
        ),
    )
    .unwrap()[0]["image_path"]
        .as_str()
        .unwrap()
        .to_owned();
    assert_eq!(
        std::path::Path::new(&path).parent().unwrap(),
        dest.join("images")
    );
    assert!(source.join("images/original.jpg").exists());
    assert!(source.join("zero-defect.sqlite").exists());
}
#[test]
fn missing_legacy_image_stops_import_before_database_publish() {
    let root = tempfile::tempdir().unwrap();
    let old = root.path().join("old");
    let new = root.path().join("new");
    let s = AppState::new(old.clone(), vec![]).unwrap();
    {
        let i = s.lock().unwrap();
        mock_paper(&i);
    }
    fs::remove_file(old.join("images/original.jpg")).unwrap();
    assert!(AppState::new(new.clone(), vec![old.clone()]).is_err());
    assert!(!new.join("zero-defect.sqlite").exists());
    assert!(old.join("zero-defect.sqlite").exists());
}
#[test]
fn confirm_practice_submit_revise_delete_preserves_history() {
    let (_d, s) = setup();
    let i = s.lock().unwrap();
    let pid = mock_paper(&i);
    let mid = mock_draft(&i, &pid);
    assert!(repo::confirm_recommended(&i, &mid).unwrap());
    assert_eq!(mastery::stats(&i).unwrap()["practiceablePairs"], 1);
    let question = Question {
        markdown: "12+1=?".into(),
        kind: "number".into(),
        options: vec![],
        correct: "13".into(),
        unit: "个".into(),
        solution: "12+1=13".into(),
        figure: Value::Null,
        solver: "13".into(),
        pair: Pair {
            cause: "carry_omission".into(),
            point: "mul_two_digit".into(),
            mastered: false,
            streak: 0,
            review_due: false,
        },
    };
    let session = practice::save(&i, &[question.clone(), question]).unwrap();
    assert!(session["questions"][0].get("correctAnswer").is_none());
    let sid = &session["sessionId"];
    let qid = &session["questions"][0]["id"];
    assert!(practice::revise(&i, &json!({"questionId":qid,"answer":"13"})).is_err());
    let result = practice::submit(
        &i,
        &json!({"sessionId":sid,"answers":[{"questionId":qid,"answer":"12"}],"elapsedMs":10000}),
    )
    .unwrap();
    assert_eq!(result["wrongCount"], 2);
    assert_eq!(count(&i, "answer_attempts"), 2);
    assert_eq!(mastery::stats(&i).unwrap()["answeredCount"], 1);
    assert!(practice::submit(&i, &json!({"sessionId":sid,"answers":[]})).is_err());
    assert_eq!(
        practice::revise(&i, &json!({"questionId":qid,"answer":"12"})).unwrap()["correctAnswer"],
        Value::Null
    );
    assert_eq!(
        practice::revise(&i, &json!({"questionId":qid,"answer":"13个"})).unwrap()["correctAnswer"],
        "13"
    );
    assert_eq!(count(&i, "answer_attempts"), 2);
    practice::finish(&i, &json!({"sessionId":sid})).unwrap();
    repo::remove_paper(&i, &pid).unwrap();
    assert_eq!(count(&i, "mistakes"), 0);
    assert_eq!(count(&i, "answer_attempts"), 2);
    assert_eq!(count(&i, "practice_questions"), 2);
    assert!(query(&i.db, "PRAGMA foreign_key_check", &[])
        .unwrap()
        .is_empty());
}
#[test]
fn image_handles_normalize_and_expire() {
    let (_d, s) = setup();
    let mut i = s.lock().unwrap();
    let mut buffer = std::io::Cursor::new(Vec::new());
    image::DynamicImage::new_rgb8(2500, 100)
        .write_to(&mut buffer, image::ImageFormat::Png)
        .unwrap();
    let a = i.import(buffer.get_ref()).unwrap();
    let b = i.import(buffer.get_ref()).unwrap();
    let a_id = text(&a, "imageId");
    assert_ne!(a["imageId"], b["imageId"]);
    assert_eq!(i.pending[a_id].hash, i.pending[text(&b, "imageId")].hash);
    let normalized = fs::read(&i.pending[a_id].file).unwrap();
    assert_eq!(image::load_from_memory(&normalized).unwrap().width(), 2000);
    assert!(normalized.starts_with(&[255, 216]));
    i.discard(a_id).unwrap();
    assert!(!i.pending.contains_key(a_id));
    assert!(i.import(&[]).is_err());
}
#[test]
fn settings_validate_and_persist() {
    let (d, s) = setup();
    {
        let mut i = s.lock().unwrap();
        assert!(i.save_settings(&json!({"grade":7})).is_err());
        i.save_settings(&json!({"grade":5,"semester":2})).unwrap();
    }
    drop(s);
    let s = AppState::new(d.path().to_owned(), vec![]).unwrap();
    assert_eq!(s.lock().unwrap().settings.grade, 5);
}
#[test]
fn answers_preserve_original_comparison_rules() {
    for form in [
        r"4\cdots\cdots1",
        "4...1",
        "4……1",
        "4…1",
        "4余1",
        " 4 ... 1 ",
        r"$4\cdots1$",
    ] {
        assert_eq!(answers::normalize(form), "4…1");
    }
    assert_eq!(answers::normalize(" ５６ "), "56");
    assert_eq!(answers::normalize("1,000"), "1000");
    assert!(answers::same("56", "56"));
    assert!(!answers::same("", ""));
    for (kind, a, b, unit, right) in [
        ("choice", "b", "B", "", true),
        ("number", "0.50", "0.5", "", true),
        ("number", "36 个", "36", "个", true),
        ("number", "0.5", "1/2", "", false),
        ("number", "2/4", "1/2", "", false),
        ("number", "", "0", "", false),
    ] {
        assert_eq!(answers::check(kind, a, b, unit), right);
    }
}
#[test]
fn mastery_requires_multiple_days_and_resets_on_wrong() {
    fn date(day: u32) -> String {
        format!("2026-11-{day:02}T10:00:00Z")
    }
    let now = DateTime::parse_from_rfc3339(&date(11))
        .unwrap()
        .with_timezone(&Utc);
    let events = vec![
        (false, date(1)),
        (true, date(2)),
        (true, date(3)),
        (true, date(4)),
    ];
    assert_eq!(mastery::evaluate(&events, now), (true, 3, true));
    let mut reset = events.clone();
    reset.push((false, date(5)));
    assert_eq!(mastery::evaluate(&reset, now), (false, 0, false));
    let same = vec![(true, date(2)), (true, date(2)), (true, date(2))];
    assert!(!mastery::evaluate(&same, now).0);
}
#[test]
fn parsing_and_postprocessing_keep_guardrails() {
    assert_eq!(
        ai::extract_json("推理 {a} 最后 {\"answer\":\"13\"}").unwrap()["answer"],
        "13"
    );
    let causes = vec![
        json!({"code":"carry_omission"}),
        json!({"code":"not_attempted"}),
    ];
    let points = vec![json!({"code":"mul_two_digit"})];
    let raw = json!({"question_markdown":"q","student_answer":"1","knowledge_point_code":"mul_two_digit","root_causes":[{"code":"carry_omission","confidence":"0.95"},{"code":"unknown","confidence":1}],"pages":[1,2,100]});
    let a = ai::postprocess(&raw, 2, &causes, &points, &Settings::default()).unwrap();
    assert_eq!(a["rootCauses"][0]["confidence"], 0.5);
    assert_eq!(a["pages"], json!([0, 1]));
    assert!(a["warnings"].as_array().unwrap().len() >= 2);
    let blank = ai::postprocess(
        &json!({"question_markdown":"q"}),
        1,
        &causes,
        &points,
        &Settings::default(),
    )
    .unwrap();
    assert_eq!(blank["recommendedRootCause"], "not_attempted");
    assert!(ai::postprocess(
        &json!({"question_markdown":""}),
        1,
        &causes,
        &points,
        &Settings::default()
    )
    .is_err());
}
#[test]
fn cross_language_parity_with_original_backend() {
    fn numeric_json(value: Value) -> Value {
        match value {
            Value::Number(n) => json!(n.as_f64().unwrap()),
            Value::Array(xs) => Value::Array(xs.into_iter().map(numeric_json).collect()),
            Value::Object(map) => {
                Value::Object(map.into_iter().map(|(k, v)| (k, numeric_json(v))).collect())
            }
            v => v,
        }
    }
    let fixtures: Value =
        serde_json::from_str(include_str!("../assets/parity-fixtures.json")).unwrap();
    let causes = fixtures["causes"]
        .as_array()
        .unwrap()
        .iter()
        .map(|c| json!({"code":c}))
        .collect::<Vec<_>>();
    let points = fixtures["points"]
        .as_array()
        .unwrap()
        .iter()
        .map(|c| json!({"code":c}))
        .collect::<Vec<_>>();
    for case in fixtures["postprocess"].as_array().unwrap() {
        assert_eq!(
            numeric_json(
                ai::postprocess(&case["input"], 2, &causes, &points, &Settings::default()).unwrap()
            ),
            numeric_json(case["expected"].clone()),
            "postprocess: {}",
            case["input"]
        );
    }
    for case in fixtures["figures"].as_array().unwrap() {
        let parsed = figure::validate(&case["input"]);
        if case["expected"]["ok"] == true {
            assert_eq!(
                parsed.map(numeric_json),
                Some(numeric_json(case["expected"]["figure"].clone())),
                "figure: {}",
                case["input"]
            );
        } else {
            assert!(parsed.is_none());
        }
    }
    let pair = Pair {
        cause: "carry_omission".into(),
        point: "mul_two_digit".into(),
        mastered: false,
        streak: 0,
        review_due: false,
    };
    for case in fixtures["practice"].as_array().unwrap() {
        let questions =
            practice::parse_questions(&json!({"questions":[case["input"].clone()]}), &pair);
        let actual=questions.iter().map(|q|json!({"questionMarkdown":q.markdown,"answerType":q.kind,"options":q.options,"correctAnswer":q.correct,"unit":q.unit,"solutionMarkdown":q.solution,"figure":q.figure})).collect::<Vec<_>>();
        assert_eq!(
            numeric_json(json!(actual)),
            numeric_json(case["expected"].clone()),
            "practice: {}",
            case["input"]
        );
    }
    for case in fixtures["answers"].as_array().unwrap() {
        assert_eq!(
            answers::check(
                text(case, "kind"),
                text(case, "submitted"),
                text(case, "correct"),
                text(case, "unit")
            ),
            case["expected"] == true
        );
    }
}
fn mock_ai(responses: Vec<(u16, Value)>) -> (String, std::thread::JoinHandle<Vec<Value>>) {
    use std::{
        io::{Read, Write},
        net::TcpListener,
    };
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let handle = std::thread::spawn(move || {
        let mut received = Vec::new();
        for (status, body) in responses {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(std::time::Duration::from_secs(15)))
                .unwrap();
            let mut bytes = Vec::new();
            let mut chunk = [0u8; 4096];
            let (offset, length) = loop {
                let n = stream.read(&mut chunk).unwrap();
                assert!(n > 0);
                bytes.extend_from_slice(&chunk[..n]);
                if let Some(end) = bytes.windows(4).position(|w| w == b"\r\n\r\n") {
                    let headers = String::from_utf8_lossy(&bytes[..end]);
                    let length = headers
                        .lines()
                        .find_map(|l| {
                            l.to_lowercase()
                                .strip_prefix("content-length:")
                                .map(|n| n.trim().parse::<usize>().unwrap())
                        })
                        .unwrap();
                    break (end + 4, length);
                }
            };
            while bytes.len() < offset + length {
                let n = stream.read(&mut chunk).unwrap();
                assert!(n > 0);
                bytes.extend_from_slice(&chunk[..n]);
            }
            received.push(serde_json::from_slice(&bytes[offset..offset + length]).unwrap());
            let body = body.to_string();
            write!(stream,"HTTP/1.1 {status} OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",body.len()).unwrap();
        }
        received
    });
    (format!("http://{address}/chat/completions"), handle)
}
fn reply(content: &str) -> Value {
    json!({"choices":[{"message":{"content":content},"finish_reason":"stop"}],"usage":{"prompt_tokens":12,"completion_tokens":7}})
}
#[test]
fn ai_http_recognition_and_practice_flow() {
    let (_d, mut state) = setup();
    let pid = {
        let i = state.lock().unwrap();
        exec(
            &i.db,
            "INSERT INTO app_settings VALUES ('bailian_api_key','test-only')",
            &[],
        )
        .unwrap();
        let pid = mock_paper(&i);
        exec(
            &i.db,
            "UPDATE papers SET status='processing' WHERE id=?1",
            &[&pid],
        )
        .unwrap();
        pid
    };
    let result = json!({"image_quality":"ok","questions":[{"question_markdown":"23×14=?","student_answer":"312","correct_answer":"322","knowledge_point_code":"mul_two_digit","has_student_work":true,"root_causes":[{"code":"carry_omission","confidence":0.9}]},{"question_markdown":"7×8=?","student_answer":"56","correct_answer":"56"}]});
    let (endpoint, server) = mock_ai(vec![(200, reply(&result.to_string()))]);
    state.ai_endpoint = endpoint;
    tauri::async_runtime::block_on(ai::analyze_paper(state.clone(), pid.clone()));
    let requests = server.join().unwrap();
    assert_eq!(requests[0]["model"], ai::recognition_model());
    assert!(requests[0]["messages"][1]["content"][1]["image_url"]["url"]
        .as_str()
        .unwrap()
        .starts_with("data:image/jpeg;base64,"));
    {
        let i = state.lock().unwrap();
        assert_eq!(repo::paper(&i, &pid).unwrap()["status"], "done");
        assert_eq!(count(&i, "mistakes"), 1);
        let mid = text(
            &query(&i.db, "SELECT id FROM mistakes", &[]).unwrap()[0],
            "id",
        )
        .to_owned();
        assert!(repo::confirm_recommended(&i, &mid).unwrap());
        assert!(
            !query(&i.db, "SELECT input_json FROM ai_runs", &[]).unwrap()[0]["input_json"]
                .as_str()
                .unwrap()
                .contains("base64")
        );
    }
    let generated = json!({"questions":[{"question_markdown":"12+1=?","answer_type":"number","correct_answer":"13","solution_markdown":"12+1=13"}]});
    let (endpoint, server) = mock_ai(vec![
        (200, reply(&generated.to_string())),
        (200, reply("{\"answer\":\"13\"}")),
    ]);
    state.ai_endpoint = endpoint;
    let session = tauri::async_runtime::block_on(practice::start(&state)).unwrap();
    assert_eq!(session["questions"].as_array().unwrap().len(), 1);
    assert!(session["questions"][0].get("correctAnswer").is_none());
    let resumed = tauri::async_runtime::block_on(practice::start(&state)).unwrap();
    assert_eq!(session, resumed);
    let requests = server.join().unwrap();
    assert_eq!(requests.len(), 2);
    assert_eq!(requests[0]["enable_thinking"], false);
    assert!(!requests[1]["messages"].to_string().contains("正确答案:13"));
}
#[test]
fn ai_auth_failure_is_readable_and_never_retried() {
    let (_d, mut state) = setup();
    let (endpoint, server) = mock_ai(vec![(
        401,
        json!({"error":{"message":"secret-provider-body"}}),
    )]);
    state.ai_endpoint = endpoint;
    let error = tauri::async_runtime::block_on(ai::chat(
        &state,
        "test-only",
        ai::recognition_model(),
        json!([]),
        ai::ChatOptions {
            max_tokens: 16,
            timeout: 5,
            ..Default::default()
        },
    ))
    .err()
    .unwrap();
    assert!(error.contains("API Key"));
    assert!(!error.contains("secret-provider-body"));
    assert_eq!(server.join().unwrap().len(), 1);
}
#[test]
fn malformed_model_rows_are_filtered_and_invalid_batch_rejected() {
    let batch = json!({"image_quality":"ok","questions":[null,3,{"question_markdown":5},{"question_markdown":"q","root_causes":null},{"question_markdown":"q"}]});
    let (quality, items) = ai::parse_batch(&batch).unwrap();
    assert_eq!(quality, "ok");
    assert_eq!(items.len(), 1);
    assert_eq!(items[0]["image_quality"], "ok");
    assert!(ai::parse_batch(&json!({"questions":[null]})).is_none());
    assert!(ai::parse_batch(&json!({"questions":[]})).is_some());
}
#[test]
fn generated_heic_decodes_without_system_codecs() {
    let bytes = include_bytes!("../assets/test/generated.heic");
    let jpeg = state::normalize_image(bytes).unwrap();
    let image = image::load_from_memory(&jpeg).unwrap();
    assert_eq!((image.width(), image.height()), (128, 128));
    assert!(jpeg.starts_with(&[255, 216]));
}
#[test]
fn malformed_native_inputs_fail_without_panicking() {
    let (_dir, state) = setup();
    for method in [
        "setApiKey",
        "importImage",
        "discardImage",
        "getMistake",
        "confirmMistake",
        "confirmRecommended",
        "deleteMistake",
        "renamePaper",
        "deletePaper",
        "confirmPaper",
        "submitPractice",
        "revisePractice",
        "finishPractice",
    ] {
        assert!(dispatch(&state, method, &Value::Null).is_err(), "{method}");
    }
    assert!(dispatch(&state, "unknown", &json!({})).is_err());
    assert!(submit_paper(&state, &json!({"imageIds":[],"title":""})).is_err());
}
