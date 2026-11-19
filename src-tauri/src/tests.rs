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
    json!({"label":"第1题","questionMarkdown":"23×14=?","studentAnswer":"312","studentWorkMarkdown":"个位进位未计入十位","correctAnswer":"322","knowledgePointCode":"mul_two_digit","hasStudentWork":true,"imageQuality":"ok","pages":[0],"incomplete":false,"rootCauses":[{"code":"carry_omission","confidence":0.9,"confidenceKnown":true,"evidence":"漏进位","unknownFromModel":false}],"recommendedRootCause":"carry_omission","warnings":[]})
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
fn fresh_database_has_all_seven_versions_and_taxonomy() {
    let (_d, s) = setup();
    let i = s.lock().unwrap();
    assert_eq!(count(&i, "schema_migrations"), 7);
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
fn upgrades_practice_questions_without_marking_old_revisions_as_guided() {
    let db = rusqlite::Connection::open_in_memory().unwrap();
    db.execute_batch("PRAGMA foreign_keys=ON").unwrap();
    db::migrate(&db, None, 5).unwrap();
    db.execute_batch("INSERT INTO practice_questions(id,root_cause_id,knowledge_point_id,question_markdown,answer_type,correct_answer,difficulty,created_at) VALUES ('old','carry_omission','mul_two_digit','23×14=?','number','322',1,'t')").unwrap();
    db::migrate(&db, None, 6).unwrap();
    let question = one(&db, "SELECT * FROM practice_questions WHERE id='old'", &[])
        .unwrap()
        .unwrap();
    assert_eq!(question["correct_answer"], "322");
    assert_eq!(question["revision_hint_at"], Value::Null);
}
#[test]
fn upgrades_v6_attempts_conservatively_and_keeps_original_content() {
    let conn = rusqlite::Connection::open_in_memory().unwrap();
    conn.execute_batch("PRAGMA foreign_keys=ON").unwrap();
    db::migrate(&conn, None, 6).unwrap();
    conn.execute_batch(
        "INSERT INTO mistakes(id,image_path,image_hash,question_markdown,grade,curriculum_id,knowledge_point_id,status,created_at,updated_at,student_answer,correct_answer)
         VALUES ('blank','/img/original.jpg','hash','原题',3,'pep_primary_math','mul_two_digit','active','2026-11-01T00:00:00Z','2026-11-01T00:00:00Z','','322');
         INSERT INTO practice_sessions(id,practice_date,status,created_at) VALUES ('older','2026-11-01','submitted','2026-11-01T00:00:00Z');
         WITH samples(id) AS (VALUES ('ok'),('bad'),('skip'),('empty'),('helped'))
         INSERT INTO practice_questions(id,session_id,root_cause_id,knowledge_point_id,question_markdown,answer_type,correct_answer,difficulty,status,created_at,revision_hint_at)
         SELECT id,'older','carry_omission','mul_two_digit',id,'number','322',1,'answered','2026-11-01T00:00:00Z',
                CASE WHEN id='bad' THEN '2026-11-01T00:00:02Z' END FROM samples;
         WITH samples(id,q,answer,correct,hinted,skipped,stamp) AS (VALUES
           ('a','ok','322',1,0,0,'2026-11-01T00:00:01Z'),('b','bad','312',0,0,0,'2026-11-01T00:00:01Z'),
           ('c','skip','',0,0,1,'2026-11-01T00:00:01Z'),('d','empty','',0,0,0,'2026-11-01T00:00:01Z'),
           ('e','helped','322',1,1,0,'2026-11-01T00:00:01Z'),('f','bad','322',1,0,0,'2026-11-01T00:00:03Z'))
         INSERT INTO answer_attempts(id,practice_question_id,root_cause_id,knowledge_point_id,submitted_answer,is_correct,used_hint,skipped,created_at)
         SELECT id,q,'carry_omission','mul_two_digit',answer,correct,hinted,skipped,stamp FROM samples;"
    ).unwrap();
    db::migrate(&conn, None, 7).unwrap();
    let rows = query(
        &conn,
        "SELECT id,outcome,submitted_answer FROM answer_attempts ORDER BY id",
        &[],
    )
    .unwrap();
    assert_eq!(
        rows.iter()
            .map(|row| text(row, "outcome"))
            .collect::<Vec<_>>(),
        ["correct", "wrong", "skipped", "unknown", "unknown", "unknown"]
    );
    assert_eq!(
        rows[5],
        json!({"id":"f","outcome":"unknown","submitted_answer":"322"})
    );
    let evidence = query(
        &conn,
        "SELECT id FROM independent_practice_evidence ORDER BY id",
        &[],
    )
    .unwrap();
    assert_eq!(evidence, vec![json!({"id":"a"}), json!({"id":"b"})]);
    let blank = one(
        &conn,
        "SELECT image_path,confirmed_evidence_at FROM mistakes WHERE id='blank'",
        &[],
    )
    .unwrap()
    .unwrap();
    assert_eq!(
        blank,
        json!({"image_path":"/img/original.jpg","confirmed_evidence_at":null})
    );
    assert_eq!(
        one(
            &conn,
            "SELECT revision_hint_at FROM practice_questions WHERE id='bad'",
            &[]
        )
        .unwrap()
        .unwrap()["revision_hint_at"],
        "2026-11-01T00:00:02Z"
    );
    assert!(query(&conn, "PRAGMA foreign_key_check", &[])
        .unwrap()
        .is_empty());
}
#[test]
fn migrated_and_manually_confirmed_mistakes_share_answer_normalization() {
    let dir = tempfile::tempdir().unwrap();
    let conn = rusqlite::Connection::open(dir.path().join("zero-defect.sqlite")).unwrap();
    conn.execute_batch("PRAGMA foreign_keys=ON").unwrap();
    db::migrate(&conn, None, 6).unwrap();
    conn.execute_batch(
        "WITH samples(id,student,work,correct) AS (VALUES
           ('equivalent','３２２。','竖式','322'),('wrong','312','竖式','322'),
           ('partial','','竖式','322'),('blank','　','　','322'),
           ('no-key','312','竖式',NULL),('not-attempted','312','竖式','322'))
         INSERT INTO mistakes(id,question_markdown,grade,curriculum_id,knowledge_point_id,status,created_at,updated_at,student_answer,student_work_markdown,correct_answer)
         SELECT id,'原题',3,'pep_primary_math','mul_two_digit','active','2026-11-01T00:00:00Z','2026-11-10T08:00:00Z',student,work,correct FROM samples;
         INSERT INTO mistake_root_causes(mistake_id,root_cause_id,confirmed,is_primary)
         SELECT id,CASE WHEN id='not-attempted' THEN 'not_attempted' ELSE 'carry_omission' END,1,1 FROM mistakes;",
    ).unwrap();
    drop(conn);

    let state = AppState::new(dir.path().to_owned(), vec![]).unwrap();
    let i = state.lock().unwrap();
    let original_stamp = "2026-11-10T08:00:00Z";
    assert_eq!(query(&i.db,"SELECT id,confirmed_evidence_at at FROM mistakes WHERE confirmed_evidence_at IS NOT NULL ORDER BY id",&[]).unwrap(),
        vec![json!({"id":"partial","at":original_stamp}),json!({"id":"wrong","at":original_stamp})]);
    assert_eq!(
        one(
            &i.db,
            "SELECT student_answer FROM mistakes WHERE id='equivalent'",
            &[]
        )
        .unwrap()
        .unwrap()["student_answer"],
        "３２２。"
    );
    let evidence_at = || {
        one(
            &i.db,
            "SELECT confirmed_evidence_at FROM mistakes WHERE id='wrong'",
            &[],
        )
        .unwrap()
        .unwrap()["confirmed_evidence_at"]
            .clone()
    };
    let mut edit = json!({"mistakeId":"wrong","questionMarkdown":"补记题干","studentAnswer":"312","studentWorkMarkdown":"竖式","correctAnswer":"322","knowledgePointCode":"mul_two_digit","rootCauseCode":"calculation_error"});
    repo::confirm(&i, &edit).unwrap();
    assert_eq!(evidence_at(), original_stamp);
    edit["studentAnswer"] = json!("３２２。");
    repo::confirm(&i, &edit).unwrap();
    assert!(evidence_at().is_null());
    edit["studentAnswer"] = json!("312");
    repo::confirm(&i, &edit).unwrap();
    let new_stamp = evidence_at();
    assert!(DateTime::parse_from_rfc3339(new_stamp.as_str().unwrap()).is_ok());
    assert_ne!(new_stamp, original_stamp);
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
    assert_eq!(
        repo::confirm_recommended(&i, &mid).unwrap()["confirmed"],
        true
    );
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
            unsure_due: false,
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
    assert_eq!(result["wrongCount"], 1);
    assert_eq!(result["skippedCount"], 1);
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
    let mut edit = analysis();
    edit["mistakeId"] = json!(mid);
    edit["rootCauseCode"] = json!("calculation_error");
    repo::confirm(&i, &edit).unwrap();
    assert_eq!(mastery::pairs(&i).unwrap()[0].cause, "calculation_error");
    assert_eq!(
        one(
            &i.db,
            "SELECT root_cause_id FROM answer_attempts WHERE practice_question_id=?1",
            &[&qid.as_str().unwrap()]
        )
        .unwrap()
        .unwrap()["root_cause_id"],
        "carry_omission"
    );
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
fn cross_day_mastery_ignores_skips_and_blank_paper_but_unsure_schedules_a_variant() {
    let (_dir, state) = setup();
    let i = state.lock().unwrap();
    let paper = mock_paper(&i);
    let mistake = mock_draft(&i, &paper);
    assert_eq!(
        repo::confirm_recommended(&i, &mistake).unwrap()["confirmed"],
        true
    );
    exec(
        &i.db,
        "UPDATE mistakes SET confirmed_evidence_at='2026-03-01T12:00:00Z' WHERE id=?1",
        &[&mistake],
    )
    .unwrap();
    let variant = |label: &str| Question {
        markdown: label.into(),
        kind: "number".into(),
        options: vec![],
        correct: "15".into(),
        unit: String::new(),
        solution: "15".into(),
        figure: Value::Null,
        solver: "15".into(),
        pair: mastery::pairs(&i).unwrap().remove(0),
    };
    let submit = |session: &Value, answers: Value, stamp: Option<&str>| {
        let result = practice::submit(
            &i,
            &json!({"sessionId":session["sessionId"],"answers":answers}),
        )
        .unwrap();
        if let Some(stamp) = stamp {
            exec(&i.db,"UPDATE answer_attempts SET created_at=?1 WHERE practice_question_id IN (SELECT id FROM practice_questions WHERE session_id=?2)",&[&stamp,&text(session,"sessionId")]).unwrap();
        }
        result
    };
    let day_one = practice::save(&i, &[variant("A"), variant("B")]).unwrap();
    assert_eq!(count(&i, "answer_attempts"), 0);
    let first = submit(
        &day_one,
        json!([
            {"questionId":day_one["questions"][0]["id"],"answer":"15"},
            {"questionId":day_one["questions"][1]["id"],"answer":"","disposition":"skipped"}
        ]),
        Some("2026-03-02T10:00:00Z"),
    );
    assert_eq!(first["skippedCount"], 1);
    assert_eq!(first["wrongCount"], 0);
    assert_eq!(mastery::pairs(&i).unwrap()[0].streak, 1);
    assert_eq!(
        practice::revise(
            &i,
            &json!({"questionId":day_one["questions"][1]["id"],"answer":"15"})
        )
        .unwrap()["correct"],
        true
    );
    let day_two = practice::save(&i, &[variant("C"), variant("D")]).unwrap();
    submit(
        &day_two,
        json!([
            {"questionId":day_two["questions"][0]["id"],"answer":"15"},
            {"questionId":day_two["questions"][1]["id"],"answer":"15"}
        ]),
        Some("2026-03-03T10:00:00Z"),
    );
    assert!(mastery::pairs(&i).unwrap()[0].mastered);
    let blank_paper = mock_paper(&i);
    let blank = mock_draft(&i, &blank_paper);
    repo::confirm(&i,&json!({"mistakeId":blank,"questionMarkdown":"卷面留白","correctAnswer":"15","knowledgePointCode":"mul_two_digit","rootCauseCode":"carry_omission"})).unwrap();
    assert_eq!(mastery::pairs(&i).unwrap()[0].streak, 3);
    let marked = practice::save(&i, &[variant("E"), variant("F")]).unwrap();
    assert!(practice::submit(&i,&json!({"sessionId":marked["sessionId"],"answers":[{"questionId":marked["questions"][0]["id"],"answer":"15","disposition":"unsure"}]})).is_err());
    let result = submit(
        &marked,
        json!([
            {"questionId":marked["questions"][0]["id"],"answer":"","disposition":"unsure"},
            {"questionId":marked["questions"][1]["id"],"answer":"15"}
        ]),
        Some("2026-03-04T10:00:00Z"),
    );
    assert_eq!(result["unsureCount"], 1);
    assert_eq!(result["wrongCount"], 0);
    let pair = mastery::pairs(&i).unwrap().remove(0);
    assert!(pair.mastered && pair.unsure_due && !pair.review_due);
    assert_eq!(mastery::stats(&i).unwrap()["practiceablePairs"], 1);
    assert_eq!(mastery::stats(&i).unwrap()["answeredCount"], 4);
    let repeated = practice::save(&i, &[variant("E")]).unwrap();
    submit(
        &repeated,
        json!([{"questionId":repeated["questions"][0]["id"],"answer":"15"}]),
        Some("2026-03-05T10:00:00Z"),
    );
    assert!(mastery::pairs(&i).unwrap()[0].unsure_due);
    let fresh = practice::save(&i, &[variant("G")]).unwrap();
    submit(
        &fresh,
        json!([{"questionId":fresh["questions"][0]["id"],"answer":"15"}]),
        Some("2026-03-06T10:00:00Z"),
    );
    assert!(!mastery::pairs(&i).unwrap()[0].unsure_due);
    assert_eq!(count(&i, "answer_attempts"), 8);
}

#[test]
fn paper_evidence_follows_grade_and_term_but_independent_answers_remain_shared() {
    let (_dir, state) = setup();
    let mut i = state.lock().unwrap();
    i.db.execute_batch(
        "WITH samples(id,grade,term,stamp) AS (VALUES
           ('current',3,1,'2026-03-01T10:00:00Z'),
           ('other-grade',4,1,'2026-03-04T10:00:00Z'),
           ('other-term',3,2,'2026-03-05T10:00:00Z'),
           ('term-unknown',3,NULL,'2026-03-01T10:00:00Z'))
         INSERT INTO mistakes(id,question_markdown,grade,semester,knowledge_point_id,status,created_at,updated_at,confirmed_evidence_at)
         SELECT id,'原题',grade,term,'mul_two_digit','active',stamp,stamp,stamp FROM samples;
         INSERT INTO mistake_root_causes(mistake_id,root_cause_id,confirmed,is_primary)
         SELECT id,'carry_omission',1,1 FROM mistakes;
         INSERT INTO practice_sessions(id,practice_date,status,created_at) VALUES ('cross-term','2026-03-02','submitted','2026-03-02T10:00:00Z');
         WITH samples(id,stamp) AS (VALUES ('first','2026-03-02T10:00:00Z'),('second','2026-03-03T10:00:00Z'),('third','2026-03-03T10:00:01Z'))
         INSERT INTO practice_questions(id,session_id,root_cause_id,knowledge_point_id,question_markdown,answer_type,correct_answer,difficulty,status,created_at)
         SELECT id,'cross-term','carry_omission','mul_two_digit',id,'number','15',1,'answered',stamp FROM samples;
         INSERT INTO answer_attempts(id,practice_question_id,root_cause_id,knowledge_point_id,submitted_answer,is_correct,created_at,outcome)
         SELECT id,id,root_cause_id,knowledge_point_id,'15',1,created_at,'correct' FROM practice_questions;",
    ).unwrap();

    let mastery_for = |i: &mut state::Inner, grade, term| {
        i.settings.grade = grade;
        i.settings.semester = term;
        let pair = mastery::pairs(i).unwrap().remove(0);
        (pair.mastered, pair.streak)
    };
    assert_eq!(mastery_for(&mut i, 3, 1), (true, 3));
    assert_eq!(mastery_for(&mut i, 4, 1), (false, 0));
    assert_eq!(mastery_for(&mut i, 3, 2), (false, 0));
    assert_eq!(mastery_for(&mut i, 3, 1), (true, 3));
    exec(
        &i.db,
        "UPDATE mistakes SET confirmed_evidence_at='2026-03-06T10:00:00Z' WHERE id='term-unknown'",
        &[],
    )
    .unwrap();
    assert_eq!(mastery_for(&mut i, 3, 1), (false, 0));
    exec(
        &i.db,
        "UPDATE mistakes SET confirmed_evidence_at=NULL WHERE id='other-term'",
        &[],
    )
    .unwrap();
    assert_eq!(mastery_for(&mut i, 3, 2), (false, 0));
    assert_eq!(count(&i, "mistakes"), 4);
    assert_eq!(count(&i, "answer_attempts"), 3);
}

#[test]
fn quick_review_uses_the_same_gates_for_single_and_batch_confirmation() {
    let (_dir, state) = setup();
    let mut i = state.lock().unwrap();
    let paper = mock_paper(&i);
    let add = |label: &str, edit: fn(&mut Value)| {
        let mut item = analysis();
        item["questionMarkdown"] = json!(label);
        edit(&mut item);
        repo::create_drafts(
            &i,
            &repo::paper(&i, &paper).unwrap(),
            &repo::pages(&i, &paper).unwrap(),
            &[item],
        )
        .unwrap();
        one(
            &i.db,
            "SELECT id FROM mistakes WHERE question_markdown=?1",
            &[&label],
        )
        .unwrap()
        .unwrap()["id"]
            .as_str()
            .unwrap()
            .to_owned()
    };
    let ready = add("刚好达到阈值", |item| {
        item["rootCauses"][0]["confidence"] = json!(0.7)
    });
    let low = add("低置信", |item| {
        item["rootCauses"][0]["confidence"] = json!(0.69)
    });
    let missing = add("没有置信度", |item| {
        item["rootCauses"][0]["confidence"] = json!(0.0);
        item["rootCauses"][0]["confidenceKnown"] = json!(false);
    });
    add("模糊", |item| item["imageQuality"] = json!("blurry"));
    add("答案丢失", |item| item["correctAnswer"] = json!(""));
    add("没有步骤", |item| {
        item["studentWorkMarkdown"] = json!("")
    });
    add("知识点未知", |item| {
        item["knowledgePointCode"] = json!("other")
    });
    let incomplete = add("截断", |item| item["incomplete"] = json!(true));
    assert_eq!(
        repo::confirm_recommended(&i, &low).unwrap(),
        json!({"confirmed":false,"reasons":["low_confidence"]})
    );
    assert_eq!(
        repo::confirm_paper(&i, &paper).unwrap(),
        json!({"confirmed":1,"skipped":7,"skippedReasons":{"low_confidence":2,"image_quality":1,"missing_fields":1,"missing_evidence":1,"unknown_point":1,"incomplete":1}})
    );
    assert_eq!(repo::detail(&i, &ready).unwrap()["status"], "active");
    let low_detail = repo::detail(&i, &low).unwrap();
    assert_eq!(low_detail["status"], "draft");
    assert_eq!(low_detail["imageDataUrls"].as_array().unwrap().len(), 1);
    i.settings.confidence_threshold = 0.0;
    assert_eq!(
        repo::confirm_recommended(&i, &missing).unwrap()["reasons"],
        json!(["low_confidence"])
    );
    let mut edit = json!({"mistakeId":incomplete,"questionMarkdown":"补齐后的原题","studentAnswer":"312","studentWorkMarkdown":"原卷步骤","correctAnswer":"322","knowledgePointCode":"mul_two_digit","rootCauseCode":"calculation_error"});
    assert!(repo::confirm(&i, &edit).is_err());
    edit["confirmComplete"] = json!(true);
    repo::confirm(&i, &edit).unwrap();
    let saved = repo::detail(&i, &incomplete).unwrap();
    assert_eq!(saved["confirmedRootCauseCode"], "calculation_error");
    assert_eq!(saved["fields"]["questionMarkdown"], "补齐后的原题");
    assert_eq!(saved["incomplete"], false);
}

#[test]
fn drafts_saved_before_v1_0_4_can_still_be_quick_confirmed() {
    let (_dir, state) = setup();
    let mut i = state.lock().unwrap();
    let paper = mock_paper(&i);
    let add = |label: &str, edit: fn(&mut Value)| {
        let mut item = analysis();
        item["questionMarkdown"] = json!(label);
        item.as_object_mut().unwrap().remove("imageQuality");
        item["rootCauses"][0]
            .as_object_mut()
            .unwrap()
            .remove("confidenceKnown");
        edit(&mut item);
        repo::create_drafts(
            &i,
            &repo::paper(&i, &paper).unwrap(),
            &repo::pages(&i, &paper).unwrap(),
            &[item],
        )
        .unwrap();
        one(
            &i.db,
            "SELECT id FROM mistakes WHERE question_markdown=?1",
            &[&label],
        )
        .unwrap()
        .unwrap()["id"]
            .as_str()
            .unwrap()
            .to_owned()
    };
    let ok = add("旧草稿", |item| {
        item["rootCauses"][0]["confidence"] = json!(0.9)
    });
    let low = add("旧草稿低置信", |item| {
        item["rootCauses"][0]["confidence"] = json!(0.3)
    });
    let blurry = add("旧草稿模糊", |item| {
        item["rootCauses"][0]["confidence"] = json!(0.9);
        item["warnings"] = json!(["图片有些模糊,请仔细核对识别出的文字"]);
    });
    let capped = add("旧草稿饱和分数", |item| {
        item["rootCauses"][0]["confidence"] = json!(1.0)
    });
    let legacy_zero = add("旧草稿零分", |item| {
        item["rootCauses"][0]["confidence"] = json!(0.0)
    });
    let blank = add("旧草稿卷面留白", |item| {
        item["studentAnswer"] = json!("");
        item["studentWorkMarkdown"] = json!("");
        item["hasStudentWork"] = json!(false);
        item["recommendedRootCause"] = json!("not_attempted");
        item["rootCauses"] = json!([{"code":"not_attempted","confidence":1.0,"evidence":"卷面上没有孩子的作答","unknownFromModel":false}]);
    });
    let known_one = add("新草稿明确满分", |item| {
        item["imageQuality"] = json!("ok");
        item["rootCauses"][0]["confidenceKnown"] = json!(true);
        item["rootCauses"][0]["confidence"] = json!(1.0);
    });
    let known_zero = add("新草稿明确零分", |item| {
        item["imageQuality"] = json!("ok");
        item["rootCauses"][0]["confidenceKnown"] = json!(true);
        item["rootCauses"][0]["confidence"] = json!(0.0);
    });
    assert_eq!(
        repo::confirm_recommended(&i, &ok).unwrap(),
        json!({"confirmed":true,"reasons":[]})
    );
    assert_eq!(
        repo::confirm_recommended(&i, &low).unwrap()["reasons"],
        json!(["low_confidence"])
    );
    assert_eq!(
        repo::confirm_recommended(&i, &blurry).unwrap()["reasons"],
        json!(["image_quality"])
    );
    assert_eq!(
        repo::confirm_recommended(&i, &capped).unwrap()["reasons"],
        json!(["low_confidence"])
    );
    assert_eq!(
        repo::confirm_paper(&i, &paper).unwrap(),
        json!({"confirmed":2,"skipped":5,"skippedReasons":{"image_quality":1,"low_confidence":4}})
    );
    for id in [&blank, &known_one] {
        assert_eq!(repo::detail(&i, id).unwrap()["status"], "active");
    }
    i.settings.confidence_threshold = 0.0;
    assert_eq!(
        repo::confirm_recommended(&i, &legacy_zero).unwrap()["reasons"],
        json!(["low_confidence"])
    );
    assert_eq!(
        repo::confirm_recommended(&i, &known_zero).unwrap()["confirmed"],
        true
    );
}

#[test]
fn optional_guidance_rechecks_only_a_new_independent_first_answer() {
    let (_dir, state) = setup();
    let i = state.lock().unwrap();
    let paper = mock_paper(&i);
    assert_eq!(
        repo::confirm_recommended(&i, &mock_draft(&i, &paper)).unwrap()["confirmed"],
        true
    );
    let question = Question {
        markdown: "12×13=?".into(),
        kind: "number".into(),
        options: vec![],
        correct: "156".into(),
        unit: String::new(),
        solution: "12×13=156".into(),
        figure: Value::Null,
        solver: "156".into(),
        pair: Pair {
            cause: "carry_omission".into(),
            point: "mul_two_digit".into(),
            mastered: false,
            streak: 0,
            review_due: false,
            unsure_due: false,
        },
    };
    let submit = |session: &Value, answer: &str| {
        practice::submit(
            &i,
            &json!({"sessionId":session["sessionId"],"answers":[{"questionId":session["questions"][0]["id"],"answer":answer}]}),
        )
        .unwrap();
    };
    let finish = |session: &Value| {
        practice::finish(&i, &json!({"sessionId":session["sessionId"]})).unwrap();
    };
    let original = practice::save(&i, std::slice::from_ref(&question)).unwrap();
    let original_id = &original["questions"][0]["id"];
    let request_hint =
        |step| revision::request_hint(&i, &json!({"questionId":original_id,"step":step}));
    assert!(request_hint(1).is_err());
    submit(&original, "146");
    assert!(request_hint(0).is_err());
    assert!(request_hint(2).is_err());
    let first = request_hint(1).unwrap();
    let second = request_hint(2).unwrap();
    assert_eq!(first["step"], 1);
    assert_eq!(second["step"], 2);
    assert!(first["prompt"].as_str().unwrap().contains("进位"));
    assert_ne!(first["prompt"], second["prompt"]);
    assert!(first.get("correctAnswer").is_none());
    assert!(first.get("solutionMarkdown").is_none());
    assert_eq!(request_hint(1).unwrap(), first);
    assert_eq!(
        practice::revise(&i, &json!({"questionId":original_id,"answer":"156"})).unwrap()["correct"],
        true
    );
    assert_eq!(count(&i, "answer_attempts"), 1);
    assert_eq!(mastery::pairs(&i).unwrap()[0].streak, 0);
    assert_eq!(
        mastery::stats(&i).unwrap()["guidedRecheck"],
        json!({"pending":1,"completed":0,"correct":0})
    );
    finish(&original);
    assert!(request_hint(1).is_err());

    let repeat = practice::save(&i, std::slice::from_ref(&question)).unwrap();
    submit(&repeat, "156");
    assert!(revision::request_hint(
        &i,
        &json!({"questionId":repeat["questions"][0]["id"],"step":1})
    )
    .is_err());
    finish(&repeat);

    let variant = Question {
        markdown: "13×14=?".into(),
        correct: "182".into(),
        ..question.clone()
    };
    let skipped = practice::save(&i, std::slice::from_ref(&variant)).unwrap();
    submit(&skipped, "");
    finish(&skipped);
    assert_eq!(mastery::stats(&i).unwrap()["guidedRecheck"]["pending"], 1);

    let independent = practice::save(&i, &[variant]).unwrap();
    submit(&independent, "182");
    finish(&independent);
    assert_eq!(
        mastery::stats(&i).unwrap()["guidedRecheck"],
        json!({"pending":0,"completed":1,"correct":1})
    );

    let later = practice::save(
        &i,
        &[Question {
            markdown: "14×15=?".into(),
            correct: "210".into(),
            ..question
        }],
    )
    .unwrap();
    submit(&later, "200");
    assert_eq!(mastery::stats(&i).unwrap()["guidedRecheck"]["correct"], 1);

    let first_id = &independent["questions"][0]["id"];
    let later_id = &later["questions"][0]["id"];
    let report = |id: &Value| {
        question_review::report(&i, &json!({"questionId":id,"reason":"grading"})).unwrap()
    };
    let resolve = |id: &Value, action: &str| {
        question_review::resolve(
            &i,
            &json!({"questionId":id,"action":action,"note":"核对判分与原题"}),
        )
        .unwrap()
    };
    report(first_id);
    report(first_id);
    assert_eq!(count(&i, "practice_question_review_events"), 1);
    assert_eq!(mastery::stats(&i).unwrap()["guidedRecheck"]["correct"], 1);
    assert_eq!(mastery::stats(&i).unwrap()["answeredCount"], 4);
    resolve(first_id, "void");
    resolve(first_id, "void");
    assert_eq!(count(&i, "practice_question_review_events"), 2);
    assert_eq!(mastery::stats(&i).unwrap()["answeredCount"], 3);
    assert_eq!(
        mastery::stats(&i).unwrap()["guidedRecheck"],
        json!({"pending":0,"completed":1,"correct":0})
    );
    let result = practice::result(&i, text(&independent, "sessionId")).unwrap();
    assert_eq!(result["correctCount"], 0);
    assert_eq!(result["invalidCount"], 1);
    assert_eq!(
        question_review::list(&i).unwrap()[0]["submittedAnswer"],
        "182"
    );
    report(later_id);
    resolve(later_id, "void");
    assert!(practice::revise(&i, &json!({"questionId":later_id,"answer":"210"})).is_err());
    assert_eq!(mastery::stats(&i).unwrap()["guidedRecheck"]["pending"], 1);
    resolve(first_id, "restore");
    assert_eq!(
        practice::result(&i, text(&independent, "sessionId")).unwrap()["correctCount"],
        1
    );
    assert_eq!(mastery::stats(&i).unwrap()["guidedRecheck"]["correct"], 1);
    report(original_id);
    resolve(original_id, "void");
    assert_eq!(
        mastery::stats(&i).unwrap()["guidedRecheck"],
        json!({"pending":0,"completed":0,"correct":0})
    );
    resolve(original_id, "restore");
    assert_eq!(mastery::stats(&i).unwrap()["guidedRecheck"]["correct"], 1);
    assert_eq!(count(&i, "answer_attempts"), 5);
}

#[test]
fn review_before_submission_keeps_answers_private_and_never_creates_evidence() {
    let (_dir, state) = setup();
    let i = state.lock().unwrap();
    let paper = mock_paper(&i);
    repo::confirm_recommended(&i, &mock_draft(&i, &paper)).unwrap();
    let question = Question {
        markdown: "题干一".into(),
        kind: "number".into(),
        options: vec![],
        correct: "156".into(),
        unit: String::new(),
        solution: "解析".into(),
        figure: Value::Null,
        solver: "156".into(),
        pair: mastery::pairs(&i).unwrap().remove(0),
    };
    let session = practice::save(
        &i,
        &[
            question.clone(),
            Question {
                markdown: "题干二".into(),
                ..question
            },
        ],
    )
    .unwrap();
    let first = &session["questions"][0]["id"];
    let second = &session["questions"][1]["id"];
    let sid = text(&session, "sessionId");
    for id in [first, second] {
        question_review::report(&i, &json!({"questionId":id,"reason":"prompt"})).unwrap();
    }
    assert!(practice::result(&i, sid).is_err());
    for item in question_review::list(&i).unwrap().as_array().unwrap() {
        assert!(item["correctAnswer"].is_null() && item["solutionMarkdown"].is_null());
        assert!(item["submittedAnswer"].is_null());
    }
    question_review::resolve(
        &i,
        &json!({"questionId":first,"action":"keep","note":"条件齐全"}),
    )
    .unwrap();
    question_review::resolve(
        &i,
        &json!({"questionId":second,"action":"void","note":"图上条件无法辨认"}),
    )
    .unwrap();
    assert_eq!(count(&i, "answer_attempts"), 0);
    let result = practice::submit(&i,&json!({"sessionId":sid,"answers":[{"questionId":first,"answer":"156"},{"questionId":second,"answer":"156"}]})).unwrap();
    assert_eq!(result["correctCount"], 1);
    assert_eq!(result["invalidQuestions"][0]["reason"], "图上条件无法辨认");
    question_review::resolve(
        &i,
        &json!({"questionId":second,"action":"restore","note":"补核后确认有效"}),
    )
    .unwrap();
    assert_eq!(practice::result(&i, sid).unwrap()["skippedCount"], 1);
    assert_eq!(count(&i, "answer_attempts"), 1);
    assert_eq!(
        practice::revise(&i, &json!({"questionId":second,"answer":"156"})).unwrap()["correct"],
        true
    );
    assert_eq!(count(&i, "answer_attempts"), 1);
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
    assert_eq!(a["rootCauses"], json!([]));
    assert!(a["recommendedRootCause"].is_null());
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
        let mut actual =
            ai::postprocess(&case["input"], 2, &causes, &points, &Settings::default()).unwrap();
        assert_eq!(
            actual
                .as_object_mut()
                .unwrap()
                .remove("imageQuality")
                .unwrap(),
            text(&case["input"], "image_quality").trim().to_lowercase()
        );
        for cause in actual["rootCauses"].as_array_mut().unwrap() {
            assert!(cause
                .as_object_mut()
                .unwrap()
                .remove("confidenceKnown")
                .unwrap()
                .is_boolean());
        }
        assert_eq!(
            numeric_json(actual),
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
        unsure_due: false,
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
    let result = json!({"image_quality":"ok","questions":[{"question_markdown":"23×14=?","student_answer":"312","student_work_markdown":"十位没有加上进位","correct_answer":"322","knowledge_point_code":"mul_two_digit","has_student_work":true,"root_causes":[{"code":"carry_omission","confidence":0.9,"evidence":"漏进位"}]},{"question_markdown":"7×8=?","student_answer":"56","correct_answer":"56"}]});
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
        assert_eq!(
            repo::confirm_recommended(&i, &mid).unwrap()["confirmed"],
            true
        );
        assert!(
            !query(&i.db, "SELECT input_json FROM ai_runs", &[]).unwrap()[0]["input_json"]
                .as_str()
                .unwrap()
                .contains("base64")
        );
    }
    let generated = json!({"questions":[
        {"question_markdown":"23 × 14 = ?","answer_type":"number","correct_answer":"322"},
        {"question_markdown":"12+1=?","answer_type":"number","correct_answer":"13","solution_markdown":"12+1=13"},
        {"question_markdown":"12 + 1 = ?","answer_type":"number","correct_answer":"13"}
    ]});
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
        "getPracticeResult",
        "requestPracticeHint",
        "reportPracticeQuestion",
        "resolvePracticeReview",
        "revisePractice",
        "finishPractice",
    ] {
        assert!(dispatch(&state, method, &Value::Null).is_err(), "{method}");
    }
    assert!(dispatch(&state, "unknown", &json!({})).is_err());
    assert!(submit_paper(&state, &json!({"imageIds":[],"title":""})).is_err());
}
