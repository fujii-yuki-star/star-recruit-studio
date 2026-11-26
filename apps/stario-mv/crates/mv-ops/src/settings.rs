//! AI に許す範囲の設定（MV-0005 決定4）。⚠️ 許すフォルダを足すのは利用者がコマンドで行う（MCP の一覧には載せない）。

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Component, Path, PathBuf};

/// 設定のファイル名。
pub const SETTINGS_FILE: &str = "ai-settings.json";

/// 設定（`%APPDATA%\jp.star-system.stario-mv\ai-settings.json`）。
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    /// 書き出し・新しい動画・素材の取り込み・1コマの保存を許すフォルダ。
    pub allowed_folders: Vec<PathBuf>,
    /// 描くときに読むフォントのフォルダ（環境変数 `STARIO_MV_FONTS` があればそれも）。
    pub font_dirs: Vec<PathBuf>,
    /// FFmpeg の場所（無ければ `FFMPEG_PATH`・PATH の順）。
    pub ffmpeg: Option<PathBuf>,
}

/// 設定の置き場（`STARIO_MV_CONFIG_DIR` があればそこ＝検査用）。
pub fn config_dir() -> PathBuf {
    if let Some(d) = std::env::var_os("STARIO_MV_CONFIG_DIR") {
        return PathBuf::from(d);
    }
    if let Some(d) = std::env::var_os("APPDATA") {
        return PathBuf::from(d).join("jp.star-system.stario-mv");
    }
    let home = std::env::var_os("HOME").unwrap_or_default();
    PathBuf::from(home).join(".config").join("stario-mv")
}

impl Settings {
    /// 読む（無ければ空の設定）。
    pub fn load(dir: &Path) -> Result<Self, String> {
        let p = dir.join(SETTINGS_FILE);
        match fs::read_to_string(&p) {
            Ok(s) => serde_json::from_str(&s).map_err(|e| {
                format!(
                    "設定のファイルが読めません（{}・{e}）。JSON の形を直すか、消して作り直してください。",
                    p.display()
                )
            }),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Self::default()),
            Err(e) => Err(format!(
                "設定のファイルが読めません（{}・{e}）。",
                p.display()
            )),
        }
    }

    /// 保存する。
    pub fn save(&self, dir: &Path) -> std::io::Result<PathBuf> {
        fs::create_dir_all(dir)?;
        let p = dir.join(SETTINGS_FILE);
        let mut s = serde_json::to_string_pretty(self).map_err(std::io::Error::other)?;
        s.push('\n');
        fs::write(&p, s)?;
        Ok(p)
    }

    /// その場所が許したフォルダの中か（`extra` も許す＝例：動画のフォルダの `cache/`）。
    pub fn is_allowed(&self, path: &Path, extra: &[PathBuf]) -> bool {
        let Some(target) = resolve(path) else {
            return false;
        };
        self.allowed_folders
            .iter()
            .chain(extra)
            .filter_map(|a| resolve(a))
            .any(|a| target.starts_with(&a))
    }
}

/// 場所を確かな形にする（まだ無い部分は、いちばん近い実在のフォルダに足す）。
/// ⚠️ `..` を含む場所は認めない（許したフォルダの外へ出る抜け道にしない）。相対の場所も認めない。
/// （実在する所の `..` は canonicalize が正しく畳み、まだ無い所の `..` は名前が取れずに断られるので、この行を外しても結果は同じ＝
/// 変異チェックで等価と確かめた。それでも意図を読めるように残す。）
pub fn resolve(path: &Path) -> Option<PathBuf> {
    if !path.is_absolute() || path.components().any(|c| c == Component::ParentDir) {
        return None;
    }
    let mut rest = Vec::new();
    let mut cur = path.to_path_buf();
    loop {
        if let Ok(c) = cur.canonicalize() {
            let mut out = c;
            for r in rest.iter().rev() {
                out.push(r);
            }
            return Some(out);
        }
        let name = cur.file_name()?.to_os_string();
        rest.push(name);
        cur = cur.parent()?.to_path_buf();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 許したフォルダの中だけ() {
        let root = tempfile::tempdir().unwrap();
        let ok = root.path().join("ok");
        fs::create_dir_all(&ok).unwrap();
        let s = Settings {
            allowed_folders: vec![ok.clone()],
            ..Default::default()
        };
        assert!(
            s.is_allowed(&ok.join("a/b/out.mp4"), &[]),
            "まだ無い場所でも中なら許す"
        );
        assert!(!s.is_allowed(&root.path().join("ng/out.mp4"), &[]));
        assert!(
            !s.is_allowed(&ok.join("../ng/out.mp4"), &[]),
            "`..` で外へ出られない"
        );
        assert!(
            !s.is_allowed(Path::new("out.mp4"), &[]),
            "相対の場所は認めない"
        );
        assert!(
            !s.is_allowed(&root.path().join("okay/out.mp4"), &[]),
            "名前の前の方が同じだけのフォルダは別物"
        );
        let extra = root.path().join("cache");
        assert!(s.is_allowed(&extra.join("f.png"), std::slice::from_ref(&extra)));
    }
}
