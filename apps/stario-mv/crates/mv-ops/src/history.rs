//! 元に戻す・やり直す（MV-0009）。画面と AI の取引を1本の履歴に並べ、動画のフォルダの `history/` に残す。
//!
//! - 1つの取引＝1つの履歴（その前と後の中身＝`project.json` の全体）。戻すのは新しい順に1つずつ。
//! - 戻したあとに新しい取引を積んだら、やり直しの分は捨てる。最大 [`MAX_HISTORY`] 回分。
//! - ⚠️ **黙って別の結果にしない**：戻す・やり直す前に、今の中身が履歴の覚えている版かを確かめる（[`HistoryError::Mismatch`]）。
//!   覚えるのは**今の中身の版1つ**（積む・戻す・やり直す・開き直すたびに書き換える）。⚠️ 取引ごとに版を覚えると、
//!   戻すときに書いた中身（反映した時刻が変わる）と食い違い、続けて戻せなくなる（同じ秒の中だけ通る＝実際に踏んだ）。
//! - 素材のファイルは履歴に入れない（取り込みを戻しても `assets/` のファイルは消さない＝ADR-0074 C-4）。

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

pub const HISTORY_DIR: &str = "history";
pub const INDEX_FILE: &str = "index.json";
/// 残す回数（MV-0009 決定2）。
pub const MAX_HISTORY: usize = 200;

/// 履歴の並びと今の位置（`history/index.json`）。
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Index {
    /// これより前（`entries[..cursor]`）が戻せる・これ以後がやり直せる。
    pub cursor: usize,
    pub next_id: u64,
    /// 履歴が最後に書いた（＝今あるはずの）中身の版。違えば、履歴の外で動画が変わっている。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub current_revision: Option<String>,
    pub entries: Vec<Entry>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub id: u64,
    pub at: String,
    /// `user`（画面）か `ai`。
    pub actor: String,
    /// 「画面：レイヤーを直す」のような名前。
    pub label: String,
}

/// 戻す・やり直すができない理由。
#[derive(Debug, Clone, PartialEq)]
pub enum HistoryError {
    /// 戻せるもの（やり直せるもの）が無い。
    Nothing,
    /// 履歴のあとに、別の道で動画が変わっている。
    Mismatch,
    /// 履歴のファイルが読めない。
    Broken(String),
}

/// 戻すか、やり直すか。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Step {
    Undo,
    Redo,
}

fn dir_of(project: &Path) -> PathBuf {
    project.join(HISTORY_DIR)
}

fn entry_path(project: &Path, id: u64) -> PathBuf {
    dir_of(project).join(format!("{id:08}.json"))
}

/// 並びを読む（無ければ空）。⚠️ 壊れていたら空として扱う（戻せなくなるだけ＝動画は開ける）。
pub fn load_index(project: &Path) -> Index {
    fs::read(dir_of(project).join(INDEX_FILE))
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default()
}

fn save_index(project: &Path, idx: &Index) -> io::Result<()> {
    write_atomic(
        &dir_of(project).join(INDEX_FILE),
        &serde_json::to_vec_pretty(idx).map_err(io::Error::other)?,
    )
}

fn write_atomic(p: &Path, bytes: &[u8]) -> io::Result<()> {
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent)?;
    }
    let tmp = p.with_extension("writing");
    fs::write(&tmp, bytes)?;
    fs::rename(&tmp, p)
}

/// 保存した取引を履歴に積む（やり直しの分は捨てる・多すぎれば古いものから消す）。
pub fn record(
    project: &Path,
    before: &Value,
    after: &Value,
    after_revision: &str,
    actor: &str,
    label: &str,
    at: &str,
) -> io::Result<()> {
    let mut idx = load_index(project);
    for e in idx.entries.drain(idx.cursor.min(idx.entries.len())..) {
        let _ = fs::remove_file(entry_path(project, e.id));
    }
    let id = idx.next_id;
    write_atomic(
        &entry_path(project, id),
        &serde_json::to_vec(&json!({ "before": before, "after": after }))
            .map_err(io::Error::other)?,
    )?;
    idx.entries.push(Entry {
        id,
        at: at.into(),
        actor: actor.into(),
        label: label.into(),
    });
    idx.current_revision = Some(after_revision.into());
    idx.next_id = id + 1;
    while idx.entries.len() > MAX_HISTORY {
        let old = idx.entries.remove(0);
        let _ = fs::remove_file(entry_path(project, old.id));
    }
    idx.cursor = idx.entries.len();
    save_index(project, &idx)
}

/// 戻せる取引・やり直せる取引の名前。
pub fn status(project: &Path) -> (Option<String>, Option<String>) {
    let idx = load_index(project);
    let undo = idx
        .cursor
        .checked_sub(1)
        .and_then(|i| idx.entries.get(i))
        .map(|e| e.label.clone());
    let redo = idx.entries.get(idx.cursor).map(|e| e.label.clone());
    (undo, redo)
}

/// 戻す（やり直す）ときに書く中身と、その履歴。今の版が履歴の覚えている版でなければ断る。
pub fn target(
    project: &Path,
    step: Step,
    current_revision: &str,
) -> Result<(Entry, Value), HistoryError> {
    let idx = load_index(project);
    let (e, key) = match step {
        Step::Undo => (
            idx.cursor
                .checked_sub(1)
                .and_then(|i| idx.entries.get(i))
                .ok_or(HistoryError::Nothing)?,
            "before",
        ),
        Step::Redo => (
            idx.entries.get(idx.cursor).ok_or(HistoryError::Nothing)?,
            "after",
        ),
    };
    if idx.current_revision.as_deref() != Some(current_revision) {
        return Err(HistoryError::Mismatch);
    }
    let bytes =
        fs::read(entry_path(project, e.id)).map_err(|err| HistoryError::Broken(err.to_string()))?;
    let v: Value =
        serde_json::from_slice(&bytes).map_err(|err| HistoryError::Broken(err.to_string()))?;
    let doc = v
        .get(key)
        .cloned()
        .ok_or_else(|| HistoryError::Broken(format!("{key} が無い")))?;
    Ok((e.clone(), doc))
}

/// 戻した（やり直した）中身を保存したあと、今の位置を動かし、書いた版を覚える。
pub fn commit_step(project: &Path, step: Step, new_revision: &str) -> io::Result<()> {
    let mut idx = load_index(project);
    match step {
        Step::Undo => idx.cursor = idx.cursor.saturating_sub(1),
        Step::Redo => idx.cursor = (idx.cursor + 1).min(idx.entries.len()),
    }
    idx.current_revision = Some(new_revision.into());
    save_index(project, &idx)
}

/// 今の中身の版を覚え直す（履歴の最後の中身から開き直したとき）。
pub fn set_current(project: &Path, revision: &str) -> io::Result<()> {
    let mut idx = load_index(project);
    idx.current_revision = Some(revision.into());
    save_index(project, &idx)
}

/// 履歴の最後の中身（今の位置の中身＝落ちて `project.json` が読めないときに開き直す元・MV-0009 決定5）。
pub fn latest(project: &Path) -> Option<Value> {
    let idx = load_index(project);
    let (e, key) = match idx.cursor.checked_sub(1) {
        Some(i) => (idx.entries.get(i)?, "after"),
        None => (idx.entries.first()?, "before"),
    };
    let v: Value = serde_json::from_slice(&fs::read(entry_path(project, e.id)).ok()?).ok()?;
    v.get(key).cloned()
}

/// 取引の名前（「画面：レイヤーを直す・素材を取り込む」）。同じ編集は1回だけ・出た順。
pub fn label_of(ops: &[Value], user: bool) -> String {
    let mut names: Vec<&str> = Vec::new();
    for op in ops {
        let n = match op["op"].as_str().unwrap_or("") {
            "addLayer" => "レイヤーを足す",
            "updateLayer" => "レイヤーを直す",
            "removeLayer" => "レイヤーを消す",
            "moveLayer" => "重なりの順を変える",
            "splitLayer" => "レイヤーを分ける",
            "addComposition" => "コンポジションを足す",
            "updateComposition" => "コンポジションを直す",
            "removeComposition" => "コンポジションを外す",
            "updateProject" => "動画を直す",
            "importAsset" => "素材を取り込む",
            "removeAsset" => "素材を外す",
            _ => "編集",
        };
        if !names.contains(&n) {
            names.push(n);
        }
    }
    format!("{}：{}", if user { "画面" } else { "AI" }, names.join("・"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn doc(n: i64) -> Value {
        json!({ "n": n })
    }

    #[test]
    fn 積んで戻してやり直す_版が合わなければ断る() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path();
        assert_eq!(status(p), (None, None));
        record(p, &doc(0), &doc(1), "r1", "user", "画面：一", "t").unwrap();
        record(p, &doc(1), &doc(2), "r2", "ai", "AI：二", "t").unwrap();
        assert_eq!(status(p), (Some("AI：二".into()), None));
        // 今の版が違えば戻さない
        assert_eq!(target(p, Step::Undo, "rX"), Err(HistoryError::Mismatch));
        let (e, d1) = target(p, Step::Undo, "r2").unwrap();
        assert_eq!((e.label.as_str(), d1), ("AI：二", doc(1)));
        commit_step(p, Step::Undo, "u1").unwrap();
        assert_eq!(status(p), (Some("画面：一".into()), Some("AI：二".into())));
        // 戻したあとは、戻して書いた版から続けて戻せる・やり直せる（戻す前の版では断る）
        assert_eq!(target(p, Step::Redo, "r2"), Err(HistoryError::Mismatch));
        assert_eq!(target(p, Step::Undo, "u1").unwrap().1, doc(0));
        assert_eq!(target(p, Step::Redo, "u1").unwrap().1, doc(2));
        commit_step(p, Step::Redo, "r2b").unwrap();
        assert_eq!(status(p), (Some("AI：二".into()), None));
        assert_eq!(target(p, Step::Redo, "r2b"), Err(HistoryError::Nothing));
        // やり直したあとは、やり直して書いた版から戻せる
        assert_eq!(target(p, Step::Undo, "r2b").unwrap().1, doc(1));
        // 開き直したら、その版を覚え直す
        set_current(p, "rec").unwrap();
        assert_eq!(target(p, Step::Undo, "r2b"), Err(HistoryError::Mismatch));
        assert_eq!(target(p, Step::Undo, "rec").unwrap().1, doc(1));
    }

    #[test]
    fn 戻したあとに積むとやり直しの分は消える() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path();
        record(p, &doc(0), &doc(1), "r1", "user", "一", "t").unwrap();
        record(p, &doc(1), &doc(2), "r2", "user", "二", "t").unwrap();
        target(p, Step::Undo, "r2").unwrap();
        commit_step(p, Step::Undo, "u").unwrap();
        record(p, &doc(1), &doc(9), "r9", "user", "九", "t").unwrap();
        assert_eq!(status(p), (Some("九".into()), None));
        let idx = load_index(p);
        assert_eq!(
            idx.entries
                .iter()
                .map(|e| e.label.as_str())
                .collect::<Vec<_>>(),
            ["一", "九"]
        );
        assert!(!entry_path(p, 1).exists(), "やり直しの分のファイルも消す");
    }

    #[test]
    fn 二百回を超えたら古いものから消す() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path();
        for i in 0..(MAX_HISTORY as i64 + 3) {
            record(
                p,
                &doc(i),
                &doc(i + 1),
                &format!("r{i}"),
                "ai",
                &format!("{i}"),
                "t",
            )
            .unwrap();
        }
        let idx = load_index(p);
        assert_eq!(idx.entries.len(), MAX_HISTORY);
        assert_eq!(idx.entries[0].label, "3");
        assert_eq!(idx.cursor, MAX_HISTORY);
        assert!(!entry_path(p, 2).exists());
        assert!(entry_path(p, 3).exists());
    }

    #[test]
    fn 最後の中身は今の位置の中身() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path();
        assert_eq!(latest(p), None);
        record(p, &doc(0), &doc(1), "r1", "user", "一", "t").unwrap();
        record(p, &doc(1), &doc(2), "r2", "user", "二", "t").unwrap();
        assert_eq!(latest(p), Some(doc(2)));
        commit_step(p, Step::Undo, "u").unwrap();
        assert_eq!(latest(p), Some(doc(1)));
        commit_step(p, Step::Undo, "u0").unwrap();
        assert_eq!(latest(p), Some(doc(0)), "全部戻したら最初の取引の前");
    }

    #[test]
    fn 取引の名前は誰が何をしたか() {
        let ops = [
            json!({ "op": "addLayer" }),
            json!({ "op": "importAsset" }),
            json!({ "op": "addLayer" }),
        ];
        assert_eq!(label_of(&ops, true), "画面：レイヤーを足す・素材を取り込む");
        assert_eq!(
            label_of(&[json!({ "op": "splitLayer" })], false),
            "AI：レイヤーを分ける"
        );
        // 取引の中の編集には全部、名前がある（足したのに名前を忘れると「編集」になる）
        for op in crate::tx::TX_OPS {
            assert!(
                !label_of(&[json!({ "op": op })], true).ends_with("：編集"),
                "{op} に名前が無い"
            );
        }
    }
}
