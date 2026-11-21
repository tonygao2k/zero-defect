use crate::answers;
use chrono::{DateTime, Local, NaiveDate, Utc};
use rusqlite::{params, types::ValueRef, Connection, ToSql};
use serde_json::{json, Map, Value};
use std::{
    fs,
    path::{Path, PathBuf},
    time::Duration,
};

pub type AppResult<T> = Result<T, String>;
const SCHEMA_VERSION: i64 = 9;

pub fn now() -> String {
    stamp(Utc::now())
}
pub fn stamp(time: DateTime<Utc>) -> String {
    time.to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}
pub fn local_date(at: &str) -> Option<NaiveDate> {
    DateTime::parse_from_rfc3339(at)
        .ok()
        .map(|time| time.with_timezone(&Local).date_naive())
}
pub fn id() -> String {
    uuid::Uuid::new_v4().to_string()
}
pub fn err(e: impl std::fmt::Display) -> String {
    format!("本地数据操作失败: {e}")
}
pub fn query(db: &Connection, sql: &str, args: &[&dyn ToSql]) -> AppResult<Vec<Value>> {
    let mut st = db.prepare(sql).map_err(err)?;
    let names: Vec<String> = st.column_names().iter().map(|s| s.to_string()).collect();
    let rows = st
        .query_map(args, |row| {
            let mut out = Map::new();
            for (i, name) in names.iter().enumerate() {
                let value = match row.get_ref(i)? {
                    ValueRef::Null => Value::Null,
                    ValueRef::Integer(n) => json!(n),
                    ValueRef::Real(n) => json!(n),
                    ValueRef::Text(s) => Value::String(String::from_utf8_lossy(s).into_owned()),
                    ValueRef::Blob(_) => Value::Null,
                };
                out.insert(name.clone(), value);
            }
            Ok(Value::Object(out))
        })
        .map_err(err)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(err)
}
pub fn one(db: &Connection, sql: &str, args: &[&dyn ToSql]) -> AppResult<Option<Value>> {
    Ok(query(db, sql, args)?.into_iter().next())
}
pub fn exec(db: &Connection, sql: &str, args: &[&dyn ToSql]) -> AppResult<usize> {
    db.execute(sql, args).map_err(err)
}
pub fn transaction<T>(db: &Connection, f: impl FnOnce() -> AppResult<T>) -> AppResult<T> {
    db.execute_batch("BEGIN IMMEDIATE").map_err(err)?;
    match f() {
        Ok(value) => {
            if let Err(e) = db.execute_batch("COMMIT") {
                let _ = db.execute_batch("ROLLBACK");
                return Err(err(e));
            }
            Ok(value)
        }
        Err(e) => {
            let _ = db.execute_batch("ROLLBACK");
            Err(e)
        }
    }
}
pub fn text<'a>(v: &'a Value, key: &str) -> &'a str {
    v.get(key).and_then(Value::as_str).unwrap_or("")
}
pub fn parsed(v: &Value, key: &str) -> Value {
    serde_json::from_str(text(v, key)).unwrap_or(Value::Null)
}

pub fn open(file: &Path) -> AppResult<Connection> {
    if let Some(parent) = file.parent() {
        fs::create_dir_all(parent).map_err(err)?;
    }
    let db = Connection::open(file).map_err(err)?;
    db.busy_timeout(Duration::from_secs(10)).map_err(err)?;
    db.execute_batch("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;")
        .map_err(err)?;
    migrate(&db, Some(file), SCHEMA_VERSION)?;
    Ok(db)
}

pub fn migrate(db: &Connection, file: Option<&Path>, target: i64) -> AppResult<()> {
    db.execute_batch("CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)").map_err(err)?;
    let from: i64 = db
        .query_row(
            "SELECT COALESCE(MAX(version),0) FROM schema_migrations",
            [],
            |r| r.get(0),
        )
        .map_err(err)?;
    if from > SCHEMA_VERSION {
        return Err("数据库来自更新版本,请升级应用后再打开".into());
    }
    if from > 0 && from < target {
        if let Some(file) = file {
            backup(db, &file.parent().unwrap().join("backups"), from)?;
        }
    }
    for version in from + 1..=target {
        let fk_off = version == 3 || version == 4;
        if fk_off {
            db.execute_batch("PRAGMA foreign_keys=OFF").map_err(err)?;
        }
        let outcome = transaction(db, || {
            match version {
                1 => db
                    .execute_batch(include_str!("../assets/v1.sql"))
                    .map_err(err)?,
                2 => seed(db)?,
                3 => db
                    .execute_batch(include_str!("../assets/v3.sql"))
                    .map_err(err)?,
                4 => {
                    db.execute_batch(include_str!("../assets/v4.sql"))
                        .map_err(err)?;
                    let seeds: Value =
                        serde_json::from_str(include_str!("../assets/seeds.json")).map_err(err)?;
                    for c in seeds["ROOT_CAUSES_V4"].as_array().unwrap() {
                        db.execute("INSERT INTO root_causes(id,code,label,description,active,created_at) VALUES (?1,?1,?2,?3,1,?4)",params![text(c,"code"),text(c,"label"),text(c,"description"),now()]).map_err(err)?;
                    }
                    let groups=query(db,"SELECT image_path,MIN(analysis_key) analysis_key,MIN(image_hash) image_hash,MIN(created_at) created_at,MIN(grade) grade,MIN(curriculum_id) curriculum_id FROM mistakes WHERE image_path IS NOT NULL GROUP BY image_path",&[])?;
                    for g in groups {
                        let paper = id();
                        let page = id();
                        let key = g["analysis_key"]
                            .as_str()
                            .or(g["image_hash"].as_str())
                            .unwrap_or(text(&g, "image_path"));
                        let title = DateTime::parse_from_rfc3339(text(&g, "created_at"))
                            .map(|d| {
                                d.with_timezone(&Local)
                                    .format("%Y年%-m月%-d日 %-H时")
                                    .to_string()
                            })
                            .unwrap_or_else(|_| "历史试卷".into());
                        let grade = g["grade"].as_i64();
                        let curriculum = g["curriculum_id"].as_str();
                        db.execute("INSERT INTO papers(id,title,analysis_key,status,grade,curriculum_id,created_at,updated_at) VALUES (?1,?2,?3,'done',?4,?5,?6,?6)",params![paper,title,key,grade,curriculum,text(&g,"created_at")]).map_err(err)?;
                        db.execute("INSERT INTO paper_pages(id,paper_id,position,image_path,image_hash) VALUES (?1,?2,0,?3,?4)",params![page,paper,text(&g,"image_path"),g["image_hash"].as_str().unwrap_or(key)]).map_err(err)?;
                        db.execute(
                            "UPDATE mistakes SET paper_id=?1 WHERE image_path=?2",
                            params![paper, text(&g, "image_path")],
                        )
                        .map_err(err)?;
                        db.execute("INSERT INTO mistake_pages(mistake_id,page_id,position) SELECT id,?1,0 FROM mistakes WHERE image_path=?2",params![page,text(&g,"image_path")]).map_err(err)?;
                    }
                }
                5 => db
                    .execute_batch("ALTER TABLE practice_questions ADD COLUMN figure_json TEXT")
                    .map_err(err)?,
                6 => db
                    .execute_batch(
                        "ALTER TABLE practice_questions ADD COLUMN revision_hint_at TEXT",
                    )
                    .map_err(err)?,
                7 => {
                    db.execute_batch(include_str!("../assets/v7.sql"))
                        .map_err(err)?;
                    backfill_mistake_evidence(db)?;
                }
                8 => {
                    db.execute_batch(include_str!("../assets/v8.sql"))
                        .map_err(err)?;
                    exec(
                        db,
                        "INSERT INTO practice_schedule_origin VALUES (?1)",
                        &[&Local::now().date_naive().to_string()],
                    )?;
                    for (table, column, day) in [
                        ("answer_attempts", "created_at", "local_date"),
                        (
                            "practice_questions",
                            "revision_hint_at",
                            "revision_hint_local_date",
                        ),
                        (
                            "mistakes",
                            "confirmed_evidence_at",
                            "confirmed_evidence_local_date",
                        ),
                    ] {
                        exec(db, &format!("UPDATE {table} SET {day}=date({column},'localtime') WHERE {column} IS NOT NULL"), &[])?;
                    }
                }
                9 => db
                    .execute_batch(include_str!("../assets/v9.sql"))
                    .map_err(err)?,
                _ => return Err("不支持的数据库版本".into()),
            }
            if !query(db, "PRAGMA foreign_key_check", &[])?.is_empty() {
                return Err(format!("数据库迁移 {version} 外键检查未通过,已回滚"));
            }
            db.execute(
                "INSERT INTO schema_migrations VALUES (?1,?2)",
                params![version, now()],
            )
            .map_err(err)?;
            Ok(())
        });
        if fk_off {
            db.execute_batch("PRAGMA foreign_keys=ON").map_err(err)?;
        }
        outcome?;
    }
    Ok(())
}
fn backfill_mistake_evidence(db: &Connection) -> AppResult<()> {
    let rows = query(
        db,
        "SELECT id,student_answer,student_work_markdown,correct_answer FROM mistakes m
         WHERE m.status='active' AND julianday(m.updated_at) IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM mistake_root_causes cause WHERE cause.mistake_id=m.id
                           AND cause.is_primary=1 AND cause.root_cause_id='not_attempted')",
        &[],
    )?;
    let mut update = db
        .prepare("UPDATE mistakes SET confirmed_evidence_at=updated_at WHERE id=?1")
        .map_err(err)?;
    for row in rows {
        if answers::is_mistake_evidence(
            text(&row, "student_answer"),
            text(&row, "student_work_markdown"),
            text(&row, "correct_answer"),
        ) {
            update.execute([text(&row, "id")]).map_err(err)?;
        }
    }
    Ok(())
}
fn seed(db: &Connection) -> AppResult<()> {
    let data: Value = serde_json::from_str(include_str!("../assets/seeds.json")).map_err(err)?;
    for c in data["ROOT_CAUSE_SEEDS"].as_array().unwrap() {
        db.execute(
            "INSERT INTO root_causes VALUES (?1,?1,?2,?3,?4,?5)",
            params![
                text(c, "code"),
                text(c, "label"),
                text(c, "description"),
                c["active"].as_i64(),
                now()
            ],
        )
        .map_err(err)?;
    }
    for c in data["CURRICULUM_SEEDS"].as_array().unwrap() {
        db.execute(
            "INSERT INTO curricula(id,stage,subject,edition,label) VALUES (?1,?2,'math',?3,?4)",
            params![
                text(c, "id"),
                text(c, "stage"),
                text(c, "edition"),
                text(c, "label")
            ],
        )
        .map_err(err)?;
    }
    for k in data["GENERIC_KNOWLEDGE_POINTS"].as_array().unwrap() {
        db.execute("INSERT INTO knowledge_points(id,code,label,stage,subject) VALUES (?1,?1,?2,'any','math')",params![text(k,"code"),text(k,"label")]).map_err(err)?;
    }
    for (i, k) in data["PEP_PRIMARY_MATH"]
        .as_array()
        .unwrap()
        .iter()
        .enumerate()
    {
        db.execute("INSERT INTO knowledge_points(id,code,label,stage,subject) VALUES (?1,?1,?2,'primary','math')",params![k[2].as_str(),k[3].as_str()]).map_err(err)?;
        db.execute(
            "INSERT INTO curriculum_knowledge_points VALUES ('pep_primary_math',?1,?2,?3,?4)",
            params![k[2].as_str(), k[0].as_i64(), k[1].as_i64(), i as i64],
        )
        .map_err(err)?;
    }
    Ok(())
}
pub fn backup(db: &Connection, dir: &Path, version: i64) -> AppResult<PathBuf> {
    fs::create_dir_all(dir).map_err(err)?;
    let target = dir.join(format!(
        "db-v{version}-{}.sqlite",
        Utc::now().format("%Y%m%dT%H%M%S%f")
    ));
    db.execute("VACUUM INTO ?1", [target.to_string_lossy().as_ref()])
        .map_err(err)?;
    let copy = Connection::open(&target).map_err(err)?;
    let has: bool = copy
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE name='app_settings')",
            [],
            |r| r.get(0),
        )
        .map_err(err)?;
    if has {
        copy.execute("DELETE FROM app_settings WHERE key='bailian_api_key'", [])
            .map_err(err)?;
        copy.execute_batch("VACUUM").map_err(err)?;
    }
    Ok(target)
}

// Copy the legacy SQLite with SQLite's backup API (including WAL), never move it.
// Publish the database last so interrupted imports can safely resume next launch.
pub fn import_legacy(destination: &Path, candidates: &[PathBuf]) -> AppResult<()> {
    fs::create_dir_all(destination).map_err(err)?;
    let target = destination.join("zero-defect.sqlite");
    if target.exists() {
        return Ok(());
    }
    let found = candidates
        .iter()
        .filter(|p| p.join("zero-defect.sqlite").is_file() && p.as_path() != destination)
        .collect::<Vec<_>>();
    if found.len() > 1 {
        return Err("找到多个旧版数据目录,请先保留需要迁移的一份后重新启动".into());
    }
    let Some(source) = found.first() else {
        return Ok(());
    };
    let staging = destination.join("legacy-import.sqlite.tmp");
    if staging.exists() {
        fs::remove_file(&staging).map_err(err)?;
    }
    let original = Connection::open_with_flags(
        source.join("zero-defect.sqlite"),
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
    )
    .map_err(err)?;
    original.backup("main", &staging, None).map_err(err)?;
    copy_dir(&source.join("images"), &destination.join("images"))?;
    if source.join("settings.json").is_file() && !destination.join("settings.json").exists() {
        fs::copy(
            source.join("settings.json"),
            destination.join("settings.json"),
        )
        .map_err(err)?;
    }
    let copy = Connection::open(&staging).map_err(err)?;
    for table in ["mistakes", "paper_pages"] {
        if one(
            &copy,
            "SELECT name FROM sqlite_master WHERE type='table' AND name=?1",
            &[&table],
        )?
        .is_none()
        {
            continue;
        }
        let rows = query(
            &copy,
            &format!("SELECT DISTINCT image_path FROM {table} WHERE image_path IS NOT NULL"),
            &[],
        )?;
        for row in rows {
            let old = PathBuf::from(text(&row, "image_path"));
            let name = old.file_name().ok_or("旧版图片路径无效")?;
            let candidate = source.join("images").join(name);
            if !candidate.is_file() {
                return Err("旧版数据引用的图片缺失,迁移已停止;原数据未改动".into());
            }
            let new = destination
                .join("images")
                .join(name)
                .to_string_lossy()
                .into_owned();
            copy.execute(
                &format!("UPDATE {table} SET image_path=?1 WHERE image_path=?2"),
                params![new, text(&row, "image_path")],
            )
            .map_err(err)?;
        }
    }
    let integrity: String = copy
        .query_row("PRAGMA integrity_check", [], |r| r.get(0))
        .map_err(err)?;
    if integrity != "ok" {
        return Err("旧版数据库完整性检查失败,原数据未改动".into());
    }
    drop(copy);
    drop(original);
    fs::rename(&staging, &target).map_err(err)?;
    Ok(())
}
fn copy_dir(from: &Path, to: &Path) -> AppResult<()> {
    if !from.exists() {
        return Ok(());
    }
    fs::create_dir_all(to).map_err(err)?;
    for entry in fs::read_dir(from).map_err(err)? {
        let entry = entry.map_err(err)?;
        if entry.file_type().map_err(err)?.is_file() {
            fs::copy(entry.path(), to.join(entry.file_name())).map_err(err)?;
        }
    }
    Ok(())
}
