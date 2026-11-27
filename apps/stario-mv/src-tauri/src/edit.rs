//! 画面の編集を、外部 AI と同じ取引の道で反映する（MV-0008 決定1・2）。
//!
//! - 画面の操作は `mv-ops` の `applyTransaction` を**同じ関数で**呼ぶ＝検査も保存も AI と同じ。
//! - 取引には、画面が見ていた版（`baseRevision`）を付ける。版が違えば（その間に AI が書いた）、
//!   **最新の中身に同じ操作を当て直す**（操作は ID で指しているので当て直せることが多い・検査は必ず通す）。
//! - 錠がかかっている（AI が反映中）ときは、少し待って送り直す（最大 [`LOCK_WAIT`]）。
//! - 掴んで動かしている途中は保存しない＝プレビューの糸に「試し」として渡すだけ（[`trial_project`]）。

use mv_core::model::Project;
use mv_ops::{OpError, Ops, Output};
use serde_json::{json, Value};
use std::path::Path;
use std::time::Duration;

/// 錠が外れるのを待つ長さ（MV-0008 決定2＝最大2秒）。
pub const LOCK_WAIT: Duration = Duration::from_secs(2);
/// 錠を見直す間隔。
pub const LOCK_POLL: Duration = Duration::from_millis(100);

/// 取引を送る相手（検査で差し替えられるように）。
pub trait Transact {
    fn transact(&mut self, args: &Value) -> Result<Output, OpError>;
}

impl Transact for Ops {
    fn transact(&mut self, args: &Value) -> Result<Output, OpError> {
        self.call("applyTransaction", args)
    }
}

/// 画面の取引を反映する。成功したら `applyTransaction` の結果に `reapplied`（当て直したか）を足して返す。
/// 失敗（検査に問題が残る・当てられない・錠が外れない）は、画面に出す文で返す（何も変えていない）。
pub fn apply(
    engine: &mut impl Transact,
    dir: &Path,
    ops: &Value,
    base_revision: Option<&str>,
    sleep: &mut impl FnMut(Duration),
) -> Result<Value, String> {
    let mut base = base_revision.map(str::to_string);
    let mut reapplied = false;
    let mut waited = Duration::ZERO;
    loop {
        let mut args = json!({ "project": dir.display().to_string(), "ops": ops });
        if let Some(b) = &base {
            args["baseRevision"] = json!(b);
        }
        match engine.transact(&args) {
            Ok(out) if out.is_error => return Err(refusal(&out.json)),
            Ok(mut out) => {
                out.json["reapplied"] = json!(reapplied);
                return Ok(out.json);
            }
            // その間に AI が書いた＝最新の中身に同じ操作を当て直す（1回だけ＝当て直しで版を外す）
            Err(e) if e.code == "conflict" && base.is_some() => {
                base = None;
                reapplied = true;
            }
            Err(e) if e.code == "locked" && waited < LOCK_WAIT => {
                sleep(LOCK_POLL);
                waited += LOCK_POLL;
            }
            Err(e) if e.code == "locked" => {
                return Err(
                    "AI がこの動画に反映している途中です。少し待ってから、もう一度操作してください（何も変えていません）。"
                        .into(),
                )
            }
            Err(e) => return Err(e.message),
        }
    }
}

/// 検査に問題が残って断ったときの文（いちばん初めの問題を添える）。
fn refusal(out: &Value) -> String {
    let first = out["issues"]
        .as_array()
        .and_then(|v| v.first())
        .and_then(|i| i["message"].as_str())
        .unwrap_or("");
    if first.is_empty() {
        "この操作は検査を通らないので、反映していません。".into()
    } else {
        format!("この操作は反映していません：{first}")
    }
}

/// 試し（掴んで動かしている途中）の中身を、開いている動画の写しに当てて返す。
/// 当てられない・形に入らないときは `None`（＝元のまま描く。離したときの取引で理由が出る）。
pub fn trial_project(project: &Project, ops: &[Value]) -> Option<Project> {
    let mut doc = serde_json::to_value(project).ok()?;
    mv_ops::tx::apply_ops(&mut doc, ops).ok()?;
    serde_json::from_value(doc).ok()
}

/// 値の欄が出す、動かせる値の場所（MV-0008 決定5）。⚠️ 画面の `src/edit/props.ts` の `ANIM_PATHS` と同じ並び。
pub const ANIM_PATHS: &[&str] = &[
    "/transform/anchor",
    "/transform/position",
    "/transform/scale",
    "/transform/rotation",
    "/transform/opacity",
    "/shape/size",
    "/shape/cornerRadius",
];

/// レイヤーの動かせる値を、そのフレームで求める（描画の核と同じ計算＝`mv_core::eval`・画面で書き写さない）。
/// 答えは `{ "<場所>": 値 }`。その場所が無い・求められない（式など）ものは入れない。
pub fn eval_values(layer: &Value, frame: i64) -> Value {
    let mut out = serde_json::Map::new();
    for path in ANIM_PATHS {
        let Some(raw) = layer.pointer(path) else {
            continue;
        };
        let Ok(a) = serde_json::from_value::<mv_core::model::Animatable>(raw.clone()) else {
            continue;
        };
        if let Ok(v) = mv_core::eval::value_at(&a, frame as f64) {
            if let Ok(j) = serde_json::to_value(v) {
                out.insert((*path).to_string(), j);
            }
        }
    }
    Value::Object(out)
}

/// 画面が編集に使う、動画の全体と版。
pub fn read(dir: &Path) -> Result<Value, String> {
    let (doc, revision) = mv_ops::read_doc(dir).map_err(|e| e.message)?;
    Ok(json!({ "revision": revision, "project": doc }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    /// 返す答えを順に並べた偽の相手（呼ばれた引数を覚える）。
    struct Fake {
        replies: RefCell<Vec<Result<Output, OpError>>>,
        calls: Vec<Value>,
    }

    impl Fake {
        fn new(replies: Vec<Result<Output, OpError>>) -> Self {
            Self {
                replies: RefCell::new(replies.into_iter().rev().collect()),
                calls: vec![],
            }
        }
    }

    impl Transact for Fake {
        fn transact(&mut self, args: &Value) -> Result<Output, OpError> {
            self.calls.push(args.clone());
            self.replies.borrow_mut().pop().expect("答えが足りない")
        }
    }

    fn ok(json: Value) -> Result<Output, OpError> {
        Ok(Output {
            json,
            image: None,
            is_error: false,
        })
    }

    fn err(code: &'static str) -> Result<Output, OpError> {
        Err(OpError {
            code,
            message: format!("{code} の文"),
        })
    }

    fn ops() -> Value {
        json!([{ "op": "removeLayer", "layerId": "lyr_A" }])
    }

    #[test]
    fn 版が違えば同じ操作を最新に当て直す() {
        let mut f = Fake::new(vec![
            err("conflict"),
            ok(json!({ "applied": true, "revision": "r2" })),
        ]);
        let r = apply(&mut f, Path::new("D"), &ops(), Some("r1"), &mut |_| {}).unwrap();
        assert_eq!(r["reapplied"], true);
        assert_eq!(r["revision"], "r2");
        assert_eq!(f.calls[0]["baseRevision"], "r1");
        assert!(
            f.calls[1].get("baseRevision").is_none(),
            "当て直しは版を外す"
        );
        assert_eq!(f.calls[1]["ops"], ops(), "同じ操作");
        assert_eq!(f.calls[1]["project"], "D");
    }

    #[test]
    fn 版が合えば当て直さない() {
        let mut f = Fake::new(vec![ok(json!({ "applied": true }))]);
        let r = apply(&mut f, Path::new("D"), &ops(), Some("r1"), &mut |_| {}).unwrap();
        assert_eq!(r["reapplied"], false);
        assert_eq!(f.calls.len(), 1);
    }

    #[test]
    fn 当て直しても通らなければ理由を返す() {
        let mut f = Fake::new(vec![err("conflict"), err("opFailed")]);
        let e = apply(&mut f, Path::new("D"), &ops(), Some("r1"), &mut |_| {}).unwrap_err();
        assert_eq!(e, "opFailed の文");
        assert_eq!(f.calls.len(), 2, "当て直しは1回だけ");
    }

    #[test]
    fn 錠は最大2秒まで待って送り直す() {
        let mut f = Fake::new(vec![
            err("locked"),
            err("locked"),
            ok(json!({ "applied": true })),
        ]);
        let mut slept = Duration::ZERO;
        let r = apply(&mut f, Path::new("D"), &ops(), None, &mut |d| slept += d);
        assert!(r.is_ok());
        assert_eq!(slept, LOCK_POLL * 2);
        // 外れなければ、2秒待ってから断る（待った長さを数えている）
        let n = (LOCK_WAIT.as_millis() / LOCK_POLL.as_millis()) as usize;
        let mut f = Fake::new((0..=n).map(|_| err("locked")).collect());
        let mut slept = Duration::ZERO;
        let e = apply(&mut f, Path::new("D"), &ops(), None, &mut |d| slept += d).unwrap_err();
        assert!(e.contains("反映している途中"));
        assert_eq!(slept, LOCK_WAIT);
        assert_eq!(f.calls.len(), n + 1);
    }

    #[test]
    fn 検査に問題が残れば最初の問題を添えて断る() {
        let mut f = Fake::new(vec![Ok(Output {
            json: json!({ "applied": false, "issues": [{ "message": "outFrame は inFrame より大きく" }, { "message": "2つ目" }] }),
            image: None,
            is_error: true,
        })]);
        let e = apply(&mut f, Path::new("D"), &ops(), None, &mut |_| {}).unwrap_err();
        assert_eq!(
            e,
            "この操作は反映していません：outFrame は inFrame より大きく"
        );
    }

    #[test]
    fn 動かせる値をそのフレームで求める_キーの間は直線で_式と無い所は入れない() {
        let layer = json!({
            "transform": {
                "position": { "keyframes": [
                    { "frame": 10, "value": [0, 0], "interpolation": "linear" },
                    { "frame": 20, "value": [100, 50], "interpolation": "linear" }
                ] },
                "rotation": { "value": 45 },
                "opacity": { "expression": { "language": "javascript", "source": "time" } }
            },
            "shape": { "kind": "rectangle", "cornerRadius": { "value": 8 } }
        });
        let v = eval_values(&layer, 15);
        assert_eq!(v["/transform/position"], json!([50.0, 25.0]));
        assert_eq!(v["/transform/rotation"], json!(45.0));
        assert_eq!(v["/shape/cornerRadius"], json!(8.0));
        assert!(v.get("/transform/opacity").is_none(), "式は求めない");
        assert!(v.get("/transform/anchor").is_none(), "無い所は入れない");
        // キーの前後は端のキーの値
        assert_eq!(
            eval_values(&layer, 0)["/transform/position"],
            json!([0.0, 0.0])
        );
        assert_eq!(
            eval_values(&layer, 99)["/transform/position"],
            json!([100.0, 50.0])
        );
    }

    #[test]
    fn 試しは写しに当てるだけで元は変えない_当てられなければ_none() {
        // ⚠️ json! だと入れ子が深すぎて組み立てられない（再帰の上限）＝文字から読む
        let src = r#"{
            "format": "FMT", "schemaVersion": "VER",
            "id": "prj_01J00000000000000000000000", "name": "t",
            "createdAt": "2026-01-01T00:00:00Z", "updatedAt": "2026-01-01T00:00:00Z",
            "settings": { "workingColorSpace": "linear" }, "assets": [],
            "compositions": [{ "id": "cmp_A", "name": "c", "width": 64, "height": 36,
                "fps": { "num": 30, "den": 1 }, "durationFrames": 60, "background": [0,0,0,1],
                "markers": [], "layers": [{
                    "id": "lyr_A", "name": "s", "type": "solid",
                    "enabled": true, "locked": false, "inFrame": 0, "outFrame": 60, "startFrame": 0,
                    "parentId": null, "blendMode": "normal", "trackMatte": null,
                    "masks": [], "effects": [], "markers": [],
                    "solid": { "color": [1,0,0,1], "width": 64, "height": 36 },
                    "transform": { "anchor": {"value": [32,18]}, "position": {"value": [32,18]},
                        "scale": {"value": [1,1]}, "rotation": {"value": 0}, "opacity": {"value": 1} }
                }] }],
            "mainCompositionId": "cmp_A"
        }"#
        .replace("FMT", mv_core::model::FORMAT)
        .replace("VER", mv_core::model::SCHEMA_VERSION);
        let p: Project = serde_json::from_str(&src).expect("検査用の動画が形に入らない");
        let t = trial_project(
            &p,
            &[json!({ "op": "updateLayer", "layerId": "lyr_A", "patch": { "inFrame": 10 } })],
        )
        .unwrap();
        assert_eq!(t.compositions[0].layers[0].in_frame, 10);
        assert_eq!(p.compositions[0].layers[0].in_frame, 0, "元は変えない");
        assert!(
            trial_project(&p, &[json!({ "op": "removeLayer", "layerId": "lyr_NONE" })]).is_none()
        );
    }
}
