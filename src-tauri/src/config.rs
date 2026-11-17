use serde::{Deserialize, Serialize};
use std::sync::LazyLock;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiConfig {
    pub provider: String,
    pub display_name: String,
    pub endpoint: String,
    pub recognition_model: String,
    pub practice_model: String,
    pub verification_model: String,
}

static AI: LazyLock<AiConfig> = LazyLock::new(|| {
    serde_json::from_str(include_str!("../config/ai.json"))
        .expect("src-tauri/config/ai.json must contain valid AI configuration")
});

pub fn ai() -> &'static AiConfig {
    &AI
}
