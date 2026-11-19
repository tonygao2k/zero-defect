use crate::{
    config,
    db::{self, AppResult},
};
use image::{DynamicImage, ImageDecoder, ImageReader};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    fs,
    io::Cursor,
    path::{Path, PathBuf},
    sync::{Arc, Mutex, MutexGuard},
};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum PracticeDifficulty {
    Easy,
    Medium,
    Hard,
}

impl Default for PracticeDifficulty {
    fn default() -> Self {
        Self::Medium
    }
}

impl PracticeDifficulty {
    pub fn code(&self) -> i64 {
        match self {
            Self::Easy => 0,
            Self::Medium => 1,
            Self::Hard => 2,
        }
    }

    pub fn from_code(code: i64) -> Self {
        match code {
            0 => Self::Easy,
            2 => Self::Hard,
            _ => Self::Medium,
        }
    }

    pub fn prompt_text(&self) -> &'static str {
        match self {
            Self::Easy => "容易：以基础概念和直接计算为主，步骤少，数字简单，让孩子能够独立完成。",
            Self::Medium => {
                "适中：需要一到两步思考或计算，结合常见应用情境，但不超出孩子年级范围。"
            }
            Self::Hard => {
                "困难：在当前知识点内增加综合应用、变式或多步推理，允许有一定挑战，但不能超纲。"
            }
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub grade: i64,
    pub semester: i64,
    pub curriculum_id: String,
    pub confidence_threshold: f64,
    pub practice_difficulty: PracticeDifficulty,
}
impl Default for Settings {
    fn default() -> Self {
        Self {
            grade: 3,
            semester: 1,
            curriculum_id: "pep_primary_math".into(),
            confidence_threshold: 0.7,
            practice_difficulty: PracticeDifficulty::Medium,
        }
    }
}
impl Settings {
    pub fn validate(&self) -> AppResult<()> {
        if !(1..=6).contains(&self.grade)
            || !(1..=2).contains(&self.semester)
            || self.curriculum_id.trim().is_empty()
            || !(0.0..=1.0).contains(&self.confidence_threshold)
        {
            return Err("设置不合法,请检查年级和学期".into());
        }
        Ok(())
    }
}
#[derive(Clone)]
pub struct AppState {
    pub inner: Arc<Mutex<Inner>>,
    pub client: reqwest::Client,
    pub ai_endpoint: String,
    pub practice_gate: Arc<tokio::sync::Mutex<()>>,
}
pub struct Pending {
    pub file: PathBuf,
    pub hash: String,
}
pub struct Inner {
    pub db: rusqlite::Connection,
    pub directory: PathBuf,
    pub settings: Settings,
    pub pending: HashMap<String, Pending>,
}
impl AppState {
    pub fn new(directory: PathBuf, legacy: Vec<PathBuf>) -> AppResult<Self> {
        db::import_legacy(&directory, &legacy)?;
        let db = db::open(&directory.join("zero-defect.sqlite"))?;
        db::exec(&db,"UPDATE papers SET status='failed',error_message='识别被中断了,请点重试',updated_at=?1 WHERE status='processing'",&[&db::now()])?;
        fs::create_dir_all(directory.join("images")).map_err(db::err)?;
        fs::create_dir_all(directory.join("tmp-images")).map_err(db::err)?;
        for f in fs::read_dir(directory.join("tmp-images")).map_err(db::err)? {
            let f = f.map_err(db::err)?;
            if f.file_type().map_err(db::err)?.is_file() {
                fs::remove_file(f.path()).map_err(db::err)?;
            }
        }
        let settings = fs::read(directory.join("settings.json"))
            .ok()
            .and_then(|b| serde_json::from_slice::<Settings>(&b).ok())
            .filter(|s| s.validate().is_ok())
            .unwrap_or_default();
        let client = reqwest::Client::builder()
            .user_agent("zero-defect/1.0")
            .connect_timeout(std::time::Duration::from_secs(15))
            .build()
            .map_err(db::err)?;
        Ok(Self {
            ai_endpoint: config::ai().endpoint.clone(),
            inner: Arc::new(Mutex::new(Inner {
                db,
                directory,
                settings,
                pending: HashMap::new(),
            })),
            client,
            practice_gate: Arc::new(tokio::sync::Mutex::new(())),
        })
    }
    pub fn lock(&self) -> AppResult<MutexGuard<'_, Inner>> {
        self.inner
            .lock()
            .map_err(|_| "后台状态异常,请重新启动应用".into())
    }
}
impl Inner {
    pub fn key(&self) -> AppResult<String> {
        Ok(db::one(
            &self.db,
            "SELECT value FROM app_settings WHERE key='bailian_api_key'",
            &[],
        )?
        .map(|v| db::text(&v, "value").to_owned())
        .unwrap_or_default())
    }
    pub fn require_key(&self) -> AppResult<String> {
        let key = self.key()?;
        if key.is_empty() {
            Err("还没有设置通义千问的 API Key,请先到设置里填写".into())
        } else {
            Ok(key)
        }
    }
    pub fn save_settings(&mut self, input: &Value) -> AppResult<Value> {
        let s: Settings = serde_json::from_value(input.clone()).map_err(|_| "设置格式不合法")?;
        s.validate()?;
        let file = self.directory.join("settings.json");
        atomic_write(&file, &serde_json::to_vec_pretty(&s).map_err(db::err)?)?;
        self.settings = s;
        Ok(json!(self.settings))
    }
    pub fn import(&mut self, bytes: &[u8]) -> AppResult<Value> {
        if bytes.is_empty() {
            return Err("图片是空的".into());
        }
        if bytes.len() > 30 * 1024 * 1024 {
            return Err("图片太大,请选择小于 30MB 的图片".into());
        }
        let jpeg = normalize_image(bytes)?;
        self.import_jpeg(&jpeg)
    }
    pub fn import_jpeg(&mut self, jpeg: &[u8]) -> AppResult<Value> {
        let id = db::id();
        let hash = hash(jpeg);
        let file = self.directory.join("tmp-images").join(format!("{id}.jpg"));
        atomic_write(&file, jpeg)?;
        self.pending.insert(id.clone(), Pending { file, hash });
        Ok(json!({"imageId":id,"previewDataUrl":data_url(jpeg)}))
    }
    pub fn discard(&mut self, id: &str) -> AppResult<()> {
        if let Some(p) = self.pending.remove(id) {
            fs::remove_file(p.file).map_err(db::err)?;
        }
        Ok(())
    }
    pub fn remove_stored(&self, path: &str) -> AppResult<()> {
        let p = Path::new(path);
        if p.parent() == Some(self.directory.join("images").as_path()) && p.is_file() {
            fs::remove_file(p).map_err(db::err)?;
        }
        Ok(())
    }
}
pub fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
pub fn data_url(bytes: &[u8]) -> String {
    use base64::Engine;
    format!(
        "data:image/jpeg;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    )
}
pub fn atomic_write(file: &Path, bytes: &[u8]) -> AppResult<()> {
    use std::io::Write;
    fs::create_dir_all(file.parent().ok_or("文件路径无效")?).map_err(db::err)?;
    atomicwrites::AtomicFile::new(file, atomicwrites::AllowOverwrite)
        .write(|f| {
            f.write_all(bytes)?;
            f.sync_all()
        })
        .map_err(db::err)
}
pub fn encode_jpeg(mut image: DynamicImage) -> AppResult<Vec<u8>> {
    if image.width() > 2000 || image.height() > 2000 {
        image = image.resize(2000, 2000, image::imageops::FilterType::Lanczos3);
    }
    let rgb = image.to_rgb8();
    let mut jpeg = Vec::new();
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpeg, 85)
        .encode_image(&rgb)
        .map_err(|_| "图片转换失败")?;
    Ok(jpeg)
}
pub fn normalize_image(bytes: &[u8]) -> AppResult<Vec<u8>> {
    if bytes.get(4..8) == Some(b"ftyp") {
        let options = heic_rs::DecodeOptions {
            max_pixels: Some(64_000_000),
            apply_transforms: true,
            ..Default::default()
        };
        let decoded = heic_rs::decode(bytes, &options)
            .map_err(|_| "HEIC 图片无法解码,请尝试导出为 JPEG 或 PNG")?;
        let rgb = image::RgbImage::from_raw(decoded.width, decoded.height, decoded.data)
            .ok_or("HEIC 图片格式无效")?;
        return encode_jpeg(DynamicImage::ImageRgb8(rgb));
    }
    let mut reader = ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|_| "无法识别这个图片文件")?;
    let mut limits = image::Limits::default();
    limits.max_alloc = Some(256 * 1024 * 1024);
    limits.max_image_width = Some(16000);
    limits.max_image_height = Some(16000);
    reader.limits(limits);
    let mut decoder = reader.into_decoder().map_err(|_| "无法识别这个图片文件")?;
    let orientation = decoder
        .orientation()
        .unwrap_or(image::metadata::Orientation::NoTransforms);
    let mut image = DynamicImage::from_decoder(decoder).map_err(|_| "图片无法解码,请换一张图片")?;
    image.apply_orientation(orientation);
    encode_jpeg(image)
}
pub fn pick_files(state: &AppState) -> AppResult<Value> {
    let selected = rfd::FileDialog::new()
        .set_title("选择试卷图片或 PDF")
        .add_filter(
            "图片或 PDF",
            &[
                "jpg", "jpeg", "png", "webp", "heic", "heif", "bmp", "gif", "pdf",
            ],
        )
        .pick_files();
    let mut files = Vec::new();
    let mut imported = Vec::<String>::new();
    let outcome = (|| {
        for path in selected.unwrap_or_default() {
            let limit = if path
                .extension()
                .is_some_and(|s| s.eq_ignore_ascii_case("pdf"))
            {
                100 * 1024 * 1024
            } else {
                30 * 1024 * 1024
            };
            if fs::metadata(&path).map_err(db::err)?.len() > limit {
                return Err("文件过大:图片上限 30MB,PDF 上限 100MB".into());
            }
            let bytes = fs::read(&path).map_err(db::err)?;
            if path
                .extension()
                .is_some_and(|s| s.eq_ignore_ascii_case("pdf"))
            {
                files.push(json!({"kind":"pdf","name":path.file_name().unwrap_or_default().to_string_lossy(),"bytes":bytes}));
            } else {
                let handle = state.lock()?.import(&bytes)?;
                imported.push(db::text(&handle, "imageId").into());
                files.push(json!({"kind":"image","handle":handle}));
            }
        }
        Ok(json!(files))
    })();
    if outcome.is_err() {
        let mut inner = state.lock()?;
        for id in imported {
            let _ = inner.discard(&id);
        }
    }
    outcome
}
pub fn paste_image(state: &AppState) -> AppResult<Value> {
    let mut clipboard = arboard::Clipboard::new().map_err(|_| "无法访问剪贴板")?;
    let data = clipboard
        .get_image()
        .map_err(|_| "剪贴板里没有图片,请先截图或复制一张图片")?;
    if data.width.saturating_mul(data.height) > 64_000_000 {
        return Err("剪贴板图片太大".into());
    }
    let rgba = image::RgbaImage::from_raw(
        data.width as u32,
        data.height as u32,
        data.bytes.into_owned(),
    )
    .ok_or("剪贴板图片格式不支持")?;
    let jpeg = encode_jpeg(DynamicImage::ImageRgba8(rgba))?;
    state.lock()?.import_jpeg(&jpeg)
}
