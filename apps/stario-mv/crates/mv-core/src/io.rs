//! 読み書き（MV-0001 決定1＝動画1本＝フォルダ1つ）。
//!
//! 読む順番＝JSON として読む → **1段目：JSON Schema（正典）で形を確かめる** → 型へ入れる → 2段目の検査。
//! ⚠️ 2段目の問題があっても**開くことはできる**（直すために開く）。書き出し・外部 AI の反映は、問題が無いときだけ（呼ぶ側の責任）。

use crate::model::{Project, FORMAT};
use crate::validate::{validate, Issue};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

/// 正典の JSON Schema（γ の資料からそのまま埋め込む＝写しを作らない）。
pub const PROJECT_SCHEMA_JSON: &str =
    include_str!("../../../../../docs/stario_mv_docs/schemas/mv-project.schema.json");
/// フォルダの中の正典のファイル名。
pub const PROJECT_FILE: &str = "project.json";
/// コピーした素材の置き場。
pub const ASSETS_DIR: &str = "assets";
/// 解析の結果の置き場（消しても作り直せる）。
pub const CACHE_DIR: &str = "cache";

/// 形の検査で見つかった問題1つ。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SchemaIssue {
    pub path: String,
    pub message: String,
}

/// 読めなかった理由。
#[derive(Debug)]
pub enum LoadError {
    Io(std::io::Error),
    /// JSON として読めない。
    Json(String),
    /// すたりおMV の動画ではない（目印が違う）。
    NotMvProject,
    /// 形が正典と合わない（1段目）。
    Schema(Vec<SchemaIssue>),
}

impl std::fmt::Display for LoadError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            LoadError::Io(e) => write!(
                f,
                "ファイルを読めませんでした（{e}）。場所と読み取りの権限を確かめてください。"
            ),
            LoadError::Json(e) => write!(f, "project.json が JSON として壊れています（{e}）。"),
            LoadError::NotMvProject => write!(
                f,
                "すたりおMV の動画ではありません（format が {FORMAT} ではない）。"
            ),
            LoadError::Schema(v) => {
                write!(f, "project.json の形が正典と合いません（{} 件）。", v.len())?;
                for i in v.iter().take(5) {
                    write!(f, "\n  {}: {}", i.path, i.message)?;
                }
                Ok(())
            }
        }
    }
}

impl std::error::Error for LoadError {}

fn validator() -> &'static jsonschema::Validator {
    static V: OnceLock<jsonschema::Validator> = OnceLock::new();
    V.get_or_init(|| {
        let schema: serde_json::Value = serde_json::from_str(PROJECT_SCHEMA_JSON)
            .expect("正典の schema が JSON として読めない（γ の資料が壊れている）");
        jsonschema::draft202012::new(&schema)
            .expect("正典の schema を組み立てられない（γ の資料が壊れている）")
    })
}

/// 1段目＝形の検査（正典の JSON Schema）。
pub fn check_schema(doc: &serde_json::Value) -> Vec<SchemaIssue> {
    validator()
        .iter_errors(doc)
        .map(|e| SchemaIssue {
            path: e.instance_path.to_string(),
            message: e.to_string(),
        })
        .collect()
}

/// JSON の文字列を、形を確かめてから型へ入れる（2段目はしない）。
pub fn parse_project(json: &str) -> Result<Project, LoadError> {
    let doc: serde_json::Value =
        serde_json::from_str(json).map_err(|e| LoadError::Json(e.to_string()))?;
    if doc.get("format").and_then(|v| v.as_str()) != Some(FORMAT) {
        return Err(LoadError::NotMvProject);
    }
    let issues = check_schema(&doc);
    if !issues.is_empty() {
        return Err(LoadError::Schema(issues));
    }
    serde_json::from_value(doc).map_err(|e| {
        LoadError::Json(format!(
            "正典の形は通ったが型へ入らない（芯の型が schema とずれている）: {e}"
        ))
    })
}

/// 開いた結果＝動画と、2段目の問題（空なら書き出せる）。
#[derive(Debug)]
pub struct Loaded {
    pub project: Project,
    pub issues: Vec<Issue>,
}

/// フォルダから開く。
pub fn load_project(dir: &Path) -> Result<Loaded, LoadError> {
    let json = fs::read_to_string(dir.join(PROJECT_FILE)).map_err(LoadError::Io)?;
    let project = parse_project(&json)?;
    let issues = validate(&project);
    Ok(Loaded { project, issues })
}

/// フォルダへ保存する（`assets/`・`cache/` も用意する）。⚠️ 書きかけで落ちても元のファイルを壊さない＝一時ファイルに書いてから置き換える。
pub fn save_project(dir: &Path, project: &Project) -> std::io::Result<PathBuf> {
    fs::create_dir_all(dir.join(ASSETS_DIR))?;
    fs::create_dir_all(dir.join(CACHE_DIR))?;
    let target = dir.join(PROJECT_FILE);
    let tmp = dir.join(format!("{PROJECT_FILE}.writing"));
    let mut text = serde_json::to_string_pretty(project).map_err(std::io::Error::other)?;
    text.push('\n');
    fs::write(&tmp, text)?;
    fs::rename(&tmp, &target)?;
    Ok(target)
}
