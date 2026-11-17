mod ai;
mod answers;
mod config;
mod db;
mod figure;
mod mastery;
mod practice;
mod repo;
mod state;

use db::{exec, one, text, transaction, AppResult};
use serde_json::{json, Value};
use state::AppState;
use tauri::Manager;

const RELEASE_URL: &str = "https://github.com/tonygao2k/zero-defect/releases/latest";
const VERSION: &str = env!("CARGO_PKG_VERSION");
const WRAPPED: &[&str] = &[
    "saveSettings",
    "setApiKey",
    "testApiKey",
    "pickFiles",
    "pasteImage",
    "importImage",
    "submitPaper",
    "renamePaper",
    "deletePaper",
    "retryPaper",
    "confirmPaper",
    "getMistake",
    "confirmMistake",
    "confirmRecommended",
    "deleteMistake",
    "startPractice",
    "submitPractice",
    "revisePractice",
    "finishPractice",
];

#[tauri::command]
async fn backend(
    state: tauri::State<'_, AppState>,
    method: String,
    input: Value,
) -> Result<Value, String> {
    let wrapped = WRAPPED.contains(&method.as_str());
    let state = state.inner().clone();
    let outcome = match method.as_str() {
        "checkForUpdate" => Ok(check_update(&state).await),
        "testApiKey" => test_key(&state).await,
        "startPractice" => practice::start(&state).await,
        _ => tauri::async_runtime::spawn_blocking(move || dispatch(&state, &method, &input))
            .await
            .map_err(|_| "后台任务中断,请重试".to_string())?,
    };
    if wrapped {
        Ok(match outcome {
            Ok(value) => json!({"ok":true,"value":value}),
            Err(error) => json!({"ok":false,"error":error}),
        })
    } else {
        outcome
    }
}
async fn test_key(state: &AppState) -> AppResult<Value> {
    let key = state.lock()?.require_key()?;
    ai::chat(
        state,
        &key,
        ai::recognition_model(),
        json!([{"role":"user","content":"回复“好”"}]),
        ai::ChatOptions {
            max_tokens: 16,
            timeout: 30,
            ping: true,
            ..Default::default()
        },
    )
    .await?;
    Ok(Value::Null)
}
fn dispatch(state: &AppState, method: &str, input: &Value) -> AppResult<Value> {
    match method {
        "getAppVersion" => return Ok(json!(VERSION)),
        "getAiConfig" => return Ok(json!(config::ai())),
        "openReleasePage" => {
            open::that(RELEASE_URL).map_err(|_| "无法打开系统浏览器")?;
            return Ok(Value::Null);
        }
        "pickFiles" => return state::pick_files(state),
        "pasteImage" => return state::paste_image(state),
        "submitPaper" => return submit_paper(state, input),
        "retryPaper" => return retry_paper(state, input),
        _ => {}
    }
    let mut i = state.lock()?;
    match method {
        "getSettings" => Ok(json!(i.settings)),
        "saveSettings" => i.save_settings(input),
        "setApiKey" => {
            let key = input["key"]
                .as_str()
                .filter(|s| s.chars().count() <= 500)
                .ok_or("API Key 格式不合法")?
                .trim();
            if key.is_empty() {
                exec(
                    &i.db,
                    "DELETE FROM app_settings WHERE key='bailian_api_key'",
                    &[],
                )?;
            } else {
                exec(&i.db,"INSERT INTO app_settings(key,value) VALUES ('bailian_api_key',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value",&[&key])?;
            }
            Ok(Value::Null)
        }
        "hasApiKey" => Ok(json!(!i.key()?.is_empty())),
        "importImage" => {
            let bytes: Vec<u8> =
                serde_json::from_value(input["bytes"].clone()).map_err(|_| "图片数据格式不合法")?;
            i.import(&bytes)
        }
        "discardImage" => {
            i.discard(repo::required(input, "imageId", 500)?)?;
            Ok(Value::Null)
        }
        "listPapers" => repo::papers(&i, input["allTerms"] == true),
        "renamePaper" => repo::rename(&i, input),
        "deletePaper" => {
            repo::remove_paper(&i, repo::required(input, "paperId", 500)?)?;
            Ok(Value::Null)
        }
        "confirmPaper" => repo::confirm_paper(&i, repo::required(input, "paperId", 500)?),
        "getMistake" => repo::detail(&i, repo::required(input, "mistakeId", 500)?),
        "confirmMistake" => repo::confirm(&i, input),
        "confirmRecommended" => Ok(
            json!({"confirmed":repo::confirm_recommended(&i,repo::required(input,"mistakeId",500)?)?}),
        ),
        "deleteMistake" => {
            repo::remove_mistake(&i, repo::required(input, "mistakeId", 500)?)?;
            Ok(Value::Null)
        }
        "listMistakes" => repo::mistakes(&i, input),
        "getTaxonomy" => repo::taxonomy(&i),
        "getHomeStats" => mastery::stats(&i),
        "submitPractice" => practice::submit(&i, input),
        "revisePractice" => practice::revise(&i, input),
        "finishPractice" => practice::finish(&i, input),
        _ => Err("不支持的后台操作".into()),
    }
}
fn submit_paper(state: &AppState, input: &Value) -> AppResult<Value> {
    let ids = input["imageIds"]
        .as_array()
        .filter(|v| !v.is_empty() && v.len() <= 6)
        .ok_or("请添加 1 到 6 页试卷图片")?;
    if input["title"]
        .as_str()
        .is_none_or(|s| s.chars().count() > 500)
    {
        return Err("试卷名称过长或格式不合法".into());
    }
    let mut i = state.lock()?;
    i.require_key()?;
    let ids = ids
        .iter()
        .map(|v| v.as_str().ok_or("图片标识不合法"))
        .collect::<Result<Vec<_>, _>>()?;
    if ids.iter().collect::<std::collections::HashSet<_>>().len() != ids.len() {
        return Err("同一图片不能在试卷中重复添加".into());
    }
    let hashes = ids
        .iter()
        .map(|id| {
            i.pending
                .get(*id)
                .map(|p| p.hash.clone())
                .ok_or("图片已失效,请重新选择".to_string())
        })
        .collect::<AppResult<Vec<_>>>()?;
    let key = state::hash(hashes.join("\n").as_bytes());
    if let Some(existing) = one(
        &i.db,
        "SELECT id,title,status FROM papers WHERE analysis_key=?1 ORDER BY created_at DESC LIMIT 1",
        &[&key],
    )? {
        if existing["status"] != "failed" {
            for id in ids {
                i.discard(id)?;
            }
            return Ok(
                json!({"kind":"duplicate","paperId":existing["id"],"title":existing["title"]}),
            );
        }
        repo::remove_paper(&i, text(&existing, "id"))?;
    }
    let pid = db::id();
    let mut stored = Vec::<String>::new();
    let result = (|| {
        for (pos, id) in ids.iter().enumerate() {
            let p = i.pending.get(*id).ok_or("图片已失效")?;
            let name = state::hash(format!("{key}:{pos}").as_bytes());
            let target = i
                .directory
                .join("images")
                .join(format!("{}.jpg", &name[..32]));
            std::fs::copy(&p.file, &target).map_err(db::err)?;
            stored.push(target.to_string_lossy().into_owned());
        }
        transaction(&i.db, || {
            exec(&i.db,"INSERT INTO papers(id,title,analysis_key,status,grade,semester,curriculum_id,created_at,updated_at) VALUES (?1,?2,?3,'processing',?4,?5,?6,?7,?7)",&[&pid,&repo::title(text(input,"title")),&key,&i.settings.grade,&i.settings.semester,&i.settings.curriculum_id,&db::now()])?;
            for (pos, path) in stored.iter().enumerate() {
                exec(&i.db,"INSERT INTO paper_pages(id,paper_id,position,image_path,image_hash) VALUES (?1,?2,?3,?4,?5)",&[&db::id(),&pid,&(pos as i64),&path,&hashes[pos]])?;
            }
            Ok(())
        })
    })();
    if let Err(e) = result {
        for path in stored {
            let _ = i.remove_stored(&path);
        }
        return Err(e);
    }
    for id in ids {
        let _ = i.discard(id);
    }
    drop(i);
    tauri::async_runtime::spawn(ai::analyze_paper(state.clone(), pid.clone()));
    Ok(json!({"kind":"started","paperId":pid}))
}
fn retry_paper(state: &AppState, input: &Value) -> AppResult<Value> {
    let id = repo::required(input, "paperId", 500)?.to_owned();
    let i = state.lock()?;
    i.require_key()?;
    if repo::paper(&i, &id)?["status"] != "failed" {
        return Err("这份试卷不需要重试".into());
    }
    exec(
        &i.db,
        "UPDATE papers SET status='processing',error_message=NULL,updated_at=?1 WHERE id=?2",
        &[&db::now(), &id],
    )?;
    drop(i);
    tauri::async_runtime::spawn(ai::analyze_paper(state.clone(), id));
    Ok(Value::Null)
}
async fn check_update(state: &AppState) -> Value {
    let result = async {
        let response = state
            .client
            .get("https://api.github.com/repos/tonygao2k/zero-defect/releases/latest")
            .header("Accept", "application/vnd.github+json")
            .timeout(std::time::Duration::from_secs(10))
            .send()
            .await
            .map_err(|_| "无法连接到 GitHub,请检查网络")?;
        if response.status().as_u16() == 404 {
            return Ok(json!({"status":"no_release","current":VERSION}));
        }
        if !response.status().is_success() {
            return Err("无法检查更新,请稍后重试");
        }
        let release: Value = response
            .json()
            .await
            .map_err(|_| "返回的内容格式不对,请稍后再试")?;
        let latest = text(&release, "tag_name");
        fn version(s: &str) -> Option<Vec<u64>> {
            let re = regex::Regex::new(r"^v?(\d+)\.(\d+)\.(\d+)").ok()?;
            let c = re.captures(s.trim())?;
            (1..=3).map(|i| c[i].parse().ok()).collect()
        }
        let new = version(latest).ok_or("无法识别发布版本号")?;
        let current = version(VERSION).unwrap();
        Ok(if new > current {
            json!({"status":"update_available","current":VERSION,"latest":latest})
        } else {
            json!({"status":"up_to_date","current":VERSION})
        })
    }
    .await;
    result.unwrap_or_else(
        |message: &str| json!({"status":"error","current":VERSION,"message":message}),
    )
}
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.set_focus();
            } else {
                let _ = create_window(app);
            }
        }))
        .setup(|app| {
            let directory = app.path().app_data_dir()?;
            let old_base = app.path().config_dir()?;
            let legacy = vec![old_base.join("zero-defect"), old_base.join("超级错题本")];
            let state = AppState::new(directory, legacy).map_err(std::io::Error::other)?;
            app.manage(state);
            create_window(app.handle())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![backend])
        .build(tauri::generate_context!())
        .expect("无法启动超级错题本")
        .run(|app, event| {
            #[cfg(target_os = "macos")]
            match event {
                tauri::RunEvent::ExitRequested {
                    api, code: None, ..
                } => api.prevent_exit(),
                tauri::RunEvent::Reopen { .. } => {
                    if app.get_webview_window("main").is_none() {
                        let _ = create_window(app);
                    } else if let Some(window) = app.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
                _ => {}
            }
            #[cfg(not(target_os = "macos"))]
            let _ = (app, event);
        });
}

#[cfg(test)]
mod tests;

fn create_window(app: &tauri::AppHandle) -> tauri::Result<()> {
    let config = app.config().app.windows[0].clone();
    let window = tauri::WebviewWindowBuilder::from_config(app, &config)?
        .on_navigation(|url| {
            (url.scheme() == "tauri" && url.host_str() == Some("localhost"))
                || (url.scheme() == "http" && url.host_str() == Some("tauri.localhost"))
                || (cfg!(debug_assertions)
                    && url.scheme() == "http"
                    && [Some("localhost"), Some("127.0.0.1")].contains(&url.host_str())
                    && url.port() == Some(1420))
        })
        .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
        .build()?;
    if let Some(monitor) = window.primary_monitor()? {
        let logical = monitor.size().to_logical::<f64>(monitor.scale_factor());
        // Keep the first window compact on large monitors while leaving enough
        // room for the two-column library layout. The user can resize it later.
        window.set_size(tauri::LogicalSize::new(
            (logical.width * 0.72).clamp(1024.0, 1240.0),
            (logical.height * 0.78).clamp(680.0, 840.0),
        ))?;
        window.center()?;
    }
    Ok(())
}
