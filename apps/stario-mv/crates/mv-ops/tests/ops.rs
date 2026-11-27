//! 外部 AI の操作口（MV-0005）の検査。取引・許す範囲・一覧と中身の一致・MCP・1コマ描く・書き出しまで通しで。
//! ⚠️ 描く検査は GPU（CI はソフトウェアの GPU）・書き出しは FFmpeg を使う（無ければ飛ばさずに落ちる＝mv-export の検査と同じ）。

use mv_ops::settings::Settings;
use mv_ops::{catalog, mcp, read_doc, Ops, HANDLED};
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};

fn repo() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../..")
}

/// 見本の動画（γ の資料の minimal.json）を一時フォルダに置く。
fn sample() -> (tempfile::TempDir, PathBuf) {
    let root = tempfile::tempdir().unwrap();
    let dir = root.path().join("video");
    fs::create_dir_all(&dir).unwrap();
    fs::copy(
        repo().join("docs/stario_mv_docs/schemas/examples/minimal.json"),
        dir.join("project.json"),
    )
    .unwrap();
    (root, dir)
}

fn ops_allowing(folders: Vec<PathBuf>) -> Ops {
    Ops::new(
        Settings {
            allowed_folders: folders,
            font_dirs: vec![repo().join("public/fonts")],
            ffmpeg: None,
        },
        None,
    )
}

fn p(dir: &Path) -> String {
    dir.display().to_string()
}

const TITLE: &str = "lyr_01JDQ0000000000000000000Y1";
const BG: &str = "lyr_01JDQ0000000000000000000Y2";
const COMP: &str = "cmp_01JDQ0000000000000000000C0";

fn tx(ops: &mut Ops, dir: &Path, body: Value) -> mv_ops::Output {
    let mut a = body;
    a["project"] = json!(p(dir));
    ops.call("applyTransaction", &a).expect("取引を受け付ける")
}

#[test]
fn 一覧の操作には全部中身がある() {
    let names: Vec<&str> = catalog()
        .iter()
        .map(|t| t["name"].as_str().unwrap())
        .collect();
    assert_eq!(names, HANDLED, "一覧（正典）と中身の並びが食い違っている");
    // 取引の中の編集も一覧と同じ
    let apply = catalog()
        .iter()
        .find(|t| t["name"] == "applyTransaction")
        .unwrap();
    let ops_in_catalog: Vec<&str> = apply["inputSchema"]["$defs"]["op"]["oneOf"]
        .as_array()
        .unwrap()
        .iter()
        .map(|o| o["properties"]["op"]["const"].as_str().unwrap())
        .collect();
    assert_eq!(ops_in_catalog, mv_ops::tx::TX_OPS);
    for t in catalog() {
        for k in ["name", "title", "description", "inputSchema"] {
            assert!(t.get(k).is_some(), "{} に {k} が無い", t["name"]);
        }
    }
}

#[test]
fn 引数は一覧の形で確かめる() {
    let (_r, dir) = sample();
    let mut ops = ops_allowing(vec![]);
    let e = ops
        .call("inspect", &json!({ "project": p(&dir), "nope": 1 }))
        .unwrap_err();
    assert_eq!(e.code, "invalidArguments");
    let e = ops
        .call(
            "applyTransaction",
            &json!({ "project": p(&dir), "ops": [{ "op": "fly" }] }),
        )
        .unwrap_err();
    assert_eq!(e.code, "invalidArguments", "知らない編集は形の段階で断る");
    let e = ops.call("explode", &json!({})).unwrap_err();
    assert_eq!(e.code, "unknownTool");
}

#[test]
fn 中身を見る() {
    let (_r, dir) = sample();
    let mut ops = ops_allowing(vec![]);
    let out = ops.call("inspect", &json!({ "project": p(&dir) })).unwrap();
    let j = out.json;
    assert_eq!(j["revision"].as_str().unwrap().len(), 64);
    assert_eq!(
        j["compositions"][0]["layers"][0]["id"], TITLE,
        "先頭が最前面のまま"
    );
    assert_eq!(j["issueCount"], 0);
    let l = ops
        .call("inspect", &json!({ "project": p(&dir), "layerId": BG }))
        .unwrap()
        .json;
    assert_eq!(l["layer"]["solid"]["width"], 1920);
    assert_eq!(l["compositionId"], COMP);
    let e = ops
        .call(
            "inspect",
            &json!({ "project": p(&dir), "layerId": "lyr_X" }),
        )
        .unwrap_err();
    assert_eq!(e.code, "notFound");
}

#[test]
fn 取引はまとめて反映し既定を入れる() {
    let (_r, dir) = sample();
    let mut ops = ops_allowing(vec![]);
    let rev = ops
        .call("inspect", &json!({ "project": p(&dir) }))
        .unwrap()
        .json["revision"]
        .clone();
    let id = ops
        .call("newIds", &json!({ "kind": "layer" }))
        .unwrap()
        .json["ids"][0]
        .clone();
    let out = tx(
        &mut ops,
        &dir,
        json!({ "baseRevision": rev, "ops": [
            { "op": "addLayer", "layer": { "id": id, "name": "帯", "type": "solid", "solid": { "color": [1, 0, 0, 1], "width": 400, "height": 100 } } },
            { "op": "updateLayer", "layerId": id, "patch": { "transform": { "opacity": { "value": 0.5 } } } },
            { "op": "moveLayer", "layerId": id, "index": 1 },
            { "op": "updateLayer", "layerId": TITLE, "patch": { "text": { "text": "こんにちは" } } },
            { "op": "removeLayer", "layerId": BG },
        ]}),
    );
    assert!(!out.is_error, "{}", out.json);
    assert_eq!(out.json["applied"], true);
    assert_ne!(out.json["revision"], rev, "版が変わる");
    assert_eq!(
        out.json["created"],
        json!([{ "opIndex": 0, "kind": "layer", "id": id }])
    );
    assert_eq!(out.json["changes"]["layers"]["added"], json!([id]));
    assert_eq!(out.json["changes"]["layers"]["removed"], json!([BG]));
    assert_eq!(out.json["changes"]["layers"]["changed"], json!([TITLE]));
    assert_eq!(
        out.json["changes"]["compositions"]["changed"],
        json!([COMP])
    );
    assert_eq!(out.json["changes"]["project"], false);

    let (doc, now) = read_doc(&dir).unwrap();
    assert_eq!(
        now,
        out.json["revision"].as_str().unwrap(),
        "返した版＝保存した中身"
    );
    let layers = doc["compositions"][0]["layers"].as_array().unwrap();
    assert_eq!(layers.len(), 2);
    assert_eq!(layers[0]["id"], TITLE);
    assert_eq!(layers[0]["text"]["text"], "こんにちは");
    assert_eq!(
        layers[0]["text"]["fontSize"].as_f64(),
        Some(120.0),
        "patch に書かない項目は残る"
    );
    let band = &layers[1];
    assert_eq!(band["id"], id);
    assert_eq!(band["outFrame"], 90, "既定＝コンポジションの全体の長さ");
    assert_eq!(
        band["transform"]["anchor"]["value"],
        json!([200.0, 50.0]),
        "単色のアンカーは中身の中心"
    );
    assert_eq!(
        band["transform"]["position"]["value"],
        json!([960.0, 540.0])
    );
    assert_eq!(band["transform"]["opacity"]["value"], 0.5);
    assert_ne!(
        doc["updatedAt"], "2026-11-26T00:00:00Z",
        "反映した時刻を書く"
    );
    // 錠は外す（OS の錠＝ほかの手がすぐかけられる）
    let f = fs::OpenOptions::new()
        .write(true)
        .open(dir.join(mv_ops::LOCK_FILE))
        .unwrap();
    assert!(f.try_lock().is_ok(), "錠は外す");
}

#[test]
fn 検査に問題が残る取引は何も変えない() {
    let (_r, dir) = sample();
    let before = fs::read(dir.join("project.json")).unwrap();
    let mut ops = ops_allowing(vec![]);
    // 形の問題（描画モードに無い値）
    let out = tx(
        &mut ops,
        &dir,
        json!({ "ops": [
            { "op": "updateLayer", "layerId": TITLE, "patch": { "name": "ok" } },
            { "op": "updateLayer", "layerId": BG, "patch": { "blendMode": "glow" } },
        ]}),
    );
    assert!(out.is_error);
    assert_eq!(out.json["applied"], false);
    assert_eq!(out.json["issues"][0]["stage"], "schema");
    assert_eq!(
        fs::read(dir.join("project.json")).unwrap(),
        before,
        "1つでも通らなければ全体を変えない"
    );
    // 中身の問題（まだ描けない機能＝親子付け）
    let out = tx(
        &mut ops,
        &dir,
        json!({ "ops": [{ "op": "updateLayer", "layerId": TITLE, "patch": { "parentId": BG } }]}),
    );
    assert!(out.is_error);
    assert_eq!(out.json["issues"][0]["stage"], "content");
    assert_eq!(out.json["issues"][0]["code"], "NotYetSupported");
    assert_eq!(fs::read(dir.join("project.json")).unwrap(), before);
}

#[test]
fn 当てられない操作はどれかを示して何も変えない() {
    let (_r, dir) = sample();
    let before = fs::read(dir.join("project.json")).unwrap();
    let mut ops = ops_allowing(vec![]);
    let cases = [
        (
            json!({ "op": "removeLayer", "layerId": "lyr_NOPE" }),
            "見つかりません",
        ),
        (
            json!({ "op": "updateLayer", "layerId": TITLE, "patch": { "id": "lyr_X" } }),
            "ID は変えられません",
        ),
        (
            json!({ "op": "updateComposition", "compositionId": COMP, "patch": { "layers": [] } }),
            "layers",
        ),
        (
            json!({ "op": "removeComposition", "compositionId": COMP }),
            "既定のコンポジションは外せません",
        ),
        (
            json!({ "op": "updateProject", "patch": { "id": "prj_X" } }),
            "id は変えられません",
        ),
    ];
    for (op, needle) in cases {
        let e = ops
            .call(
                "applyTransaction",
                &json!({ "project": p(&dir), "ops": [{ "op": "updateLayer", "layerId": TITLE, "patch": { "name": "先" } }, op] }),
            )
            .unwrap_err();
        assert_eq!(e.code, "opFailed");
        assert!(e.message.starts_with("1 番目"), "{}", e.message);
        assert!(e.message.contains(needle), "{}", e.message);
        assert_eq!(fs::read(dir.join("project.json")).unwrap(), before);
    }
}

#[test]
fn 試すだけなら保存しない() {
    let (_r, dir) = sample();
    let before = fs::read(dir.join("project.json")).unwrap();
    let mut ops = ops_allowing(vec![]);
    let out = tx(
        &mut ops,
        &dir,
        json!({ "dryRun": true, "ops": [{ "op": "updateLayer", "layerId": TITLE, "patch": { "name": "x" } }]}),
    );
    assert!(!out.is_error);
    assert_eq!(out.json["applied"], false);
    assert_eq!(out.json["changes"]["layers"]["changed"], json!([TITLE]));
    assert_eq!(fs::read(dir.join("project.json")).unwrap(), before);
    // 試しで問題が見つかるのは失敗ではない（知らせるだけ）
    let out = tx(
        &mut ops,
        &dir,
        json!({ "dryRun": true, "ops": [{ "op": "updateLayer", "layerId": TITLE, "patch": { "parentId": BG } }]}),
    );
    assert!(!out.is_error);
    assert_eq!(out.json["issues"][0]["code"], "NotYetSupported");
}

#[test]
fn 版が違えば断り反映中なら断る() {
    let (_r, dir) = sample();
    let before = fs::read(dir.join("project.json")).unwrap();
    let mut ops = ops_allowing(vec![]);
    let op = json!([{ "op": "updateLayer", "layerId": TITLE, "patch": { "name": "x" } }]);
    let e = ops
        .call(
            "applyTransaction",
            &json!({ "project": p(&dir), "baseRevision": "0".repeat(64), "ops": op }),
        )
        .unwrap_err();
    assert_eq!(e.code, "conflict");
    // ほかの手（別のアプリ・AI のコマンド）が錠をかけている
    let held = fs::File::create(dir.join(mv_ops::LOCK_FILE)).unwrap();
    held.try_lock().unwrap();
    let e = ops
        .call(
            "applyTransaction",
            &json!({ "project": p(&dir), "ops": op }),
        )
        .unwrap_err();
    assert_eq!(e.code, "locked");
    drop(held);
    assert_eq!(fs::read(dir.join("project.json")).unwrap(), before);
}

#[test]
fn コンポジションを足して直して外す() {
    let (_r, dir) = sample();
    let mut ops = ops_allowing(vec![]);
    let out = tx(
        &mut ops,
        &dir,
        json!({ "ops": [{ "op": "addComposition", "composition": { "name": "縦", "width": 1080, "height": 1920, "fps": { "num": 30, "den": 1 }, "durationFrames": 30 } }]}),
    );
    assert!(!out.is_error, "{}", out.json);
    let cid = out.json["created"][0]["id"].as_str().unwrap().to_string();
    let out = tx(
        &mut ops,
        &dir,
        json!({ "ops": [
            { "op": "addLayer", "compositionId": cid, "layer": { "name": "地", "type": "solid", "solid": { "color": [0, 1, 0, 1] } } },
            { "op": "updateComposition", "compositionId": cid, "patch": { "name": "縦の版" } },
            { "op": "updateProject", "patch": { "mainCompositionId": cid, "name": "改名" } },
        ]}),
    );
    assert!(!out.is_error, "{}", out.json);
    assert_eq!(out.json["changes"]["project"], true);
    let (doc, _) = read_doc(&dir).unwrap();
    let c = &doc["compositions"][1];
    assert_eq!(c["name"], "縦の版");
    assert_eq!(
        c["layers"][0]["solid"]["width"], 1080,
        "単色の大きさの既定＝そのコンポジション"
    );
    assert_eq!(
        c["layers"][0]["transform"]["position"]["value"],
        json!([540.0, 960.0])
    );
    let out = tx(
        &mut ops,
        &dir,
        json!({ "ops": [{ "op": "removeComposition", "compositionId": COMP }]}),
    );
    assert!(!out.is_error, "{}", out.json);
    assert_eq!(
        out.json["changes"]["compositions"]["removed"],
        json!([COMP])
    );
}

#[test]
fn 許したフォルダの外へは作らない書き出さない() {
    let (root, dir) = sample();
    let allowed = root.path().join("allowed");
    fs::create_dir_all(&allowed).unwrap();
    let mut ops = ops_allowing(vec![allowed.clone()]);
    let mk = |d: &Path| json!({ "dir": p(d), "name": "新しい", "width": 640, "height": 360, "fps": { "num": 24, "den": 1 }, "durationFrames": 24 });
    let e = ops
        .call("createProject", &mk(&root.path().join("outside")))
        .unwrap_err();
    assert_eq!(e.code, "notAllowed");
    assert!(!root.path().join("outside").exists());
    let e = ops
        .call(
            "exportVideo",
            &json!({ "project": p(&dir), "out": p(&root.path().join("x.mp4")) }),
        )
        .unwrap_err();
    assert_eq!(e.code, "notAllowed");
    let e = ops
        .call(
            "renderFrame",
            &json!({ "project": p(&dir), "frame": 0, "out": p(&root.path().join("f.png")) }),
        )
        .unwrap_err();
    assert_eq!(e.code, "notAllowed");

    let made = allowed.join("新しい動画");
    let out = ops.call("createProject", &mk(&made)).unwrap();
    assert!(!out.is_error);
    let v = ops
        .call("validate", &json!({ "project": p(&made) }))
        .unwrap();
    assert_eq!(v.json["ok"], true, "{}", v.json);
    let e = ops.call("createProject", &mk(&made)).unwrap_err();
    assert_eq!(e.code, "invalidArguments", "空でないフォルダには作らない");
}

#[test]
fn mcp_の作法() {
    let (_r, dir) = sample();
    let mut ops = ops_allowing(vec![]);
    ops.default_project = Some(dir.clone());
    let input = [
        json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"t","version":"0"}}}),
        json!({"jsonrpc":"2.0","method":"notifications/initialized"}),
        json!({"jsonrpc":"2.0","id":2,"method":"tools/list"}),
        json!({"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"inspect","arguments":{}}}),
        json!({"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"inspect","arguments":{"layerId":"lyr_X"}}}),
        json!({"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"nope","arguments":{}}}),
        json!({"jsonrpc":"2.0","id":6,"method":"resources/list"}),
        json!({"jsonrpc":"2.0","id":7,"method":"ping"}),
    ]
    .iter()
    .map(|v| v.to_string())
    .collect::<Vec<_>>()
    .join("\n")
        + "\nnot json\n";
    let mut out = Vec::new();
    mcp::serve(&mut ops, input.as_bytes(), &mut out).unwrap();
    let replies: Vec<Value> = String::from_utf8(out)
        .unwrap()
        .lines()
        .map(|l| serde_json::from_str(l).unwrap())
        .collect();
    assert_eq!(replies.len(), 8, "通知には返事をしない");
    assert_eq!(
        replies[0]["result"]["protocolVersion"], "2025-03-26",
        "相手の版に合わせる"
    );
    assert_eq!(replies[0]["result"]["capabilities"], json!({ "tools": {} }));
    let tools = replies[1]["result"]["tools"].as_array().unwrap();
    assert_eq!(tools.len(), catalog().len());
    assert_eq!(
        tools[0]["inputSchema"],
        catalog()[0]["inputSchema"],
        "一覧をそのまま返す"
    );
    assert_eq!(replies[2]["result"]["isError"], false);
    assert_eq!(
        replies[2]["result"]["structuredContent"]["compositions"][0]["id"], COMP,
        "--project の既定を使う"
    );
    assert_eq!(
        replies[3]["result"]["isError"], true,
        "操作の失敗は結果の isError で返す"
    );
    assert!(replies[3]["result"]["content"][0]["text"]
        .as_str()
        .unwrap()
        .contains("notFound"));
    assert_eq!(replies[4]["error"]["code"], -32602);
    assert_eq!(replies[5]["error"]["code"], -32601);
    assert_eq!(replies[6]["result"], json!({}));
    assert_eq!(replies[7]["error"]["code"], -32700);
    assert_eq!(replies[7]["id"], Value::Null);
    // 反映を断った取引も、結果の isError で知らせる（AI が「できた」と取り違えない）
    let r = mcp::handle_line(
        &mut ops,
        &json!({"jsonrpc":"2.0","id":9,"method":"tools/call","params":{"name":"applyTransaction","arguments":{
            "ops": [{ "op": "updateLayer", "layerId": BG, "patch": { "blendMode": "glow" } }]}}})
        .to_string(),
    )
    .unwrap();
    assert_eq!(r["result"]["isError"], true);
    assert_eq!(r["result"]["structuredContent"]["applied"], false);
}

#[test]
fn 一コマ描いて返す() {
    let (_r, dir) = sample();
    let mut ops = ops_allowing(vec![]);
    let out = ops
        .call(
            "renderFrame",
            &json!({ "project": p(&dir), "frame": 30, "maxSize": 480 }),
        )
        .unwrap();
    let png = out.image.expect("絵");
    assert_eq!((png.width, png.height), (480, 270), "長辺を上限まで縮める");
    let img = image::load_from_memory(&png.bytes).unwrap().to_rgba8();
    // 背景の単色（0.1,0.1,0.3 → sRGB 8bit）が角に出ている
    let c = img.get_pixel(5, 5).0;
    assert!(
        (i32::from(c[2]) - 77).abs() <= 3 && (i32::from(c[0]) - 26).abs() <= 3,
        "{c:?}"
    );
    let e = ops
        .call("renderFrame", &json!({ "project": p(&dir), "frame": 90 }))
        .unwrap_err();
    assert_eq!(e.code, "invalidArguments", "長さの外のコマは断る");
    // 取引の試しでも絵を返せる（MCP では画像として渡る）
    let mut out = tx(
        &mut ops,
        &dir,
        json!({ "dryRun": true, "render": { "frame": 0, "maxSize": 0 },
            "ops": [{ "op": "removeLayer", "layerId": BG }] }),
    );
    let png = out.image.take().expect("試しの絵");
    assert_eq!((png.width, png.height), (1920, 1080), "0 なら縮めない");
    let img = image::load_from_memory(&png.bytes).unwrap().to_rgba8();
    assert_eq!(
        img.get_pixel(5, 5).0,
        [0, 0, 0, 255],
        "外した背景は描かれない（試しの写しを描く）"
    );
    let r = mcp::handle_line(
        &mut ops,
        &json!({"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"renderFrame","arguments":{"project": p(&dir), "frame": 0, "maxSize": 64}}}).to_string(),
    )
    .unwrap();
    assert_eq!(r["result"]["content"][1]["type"], "image");
    assert_eq!(r["result"]["content"][1]["mimeType"], "image/png");
}

/// AI が通しで行う流れ：新しい動画 → 取引でレイヤーを並べる → 書き出す（コマンドの入口で）。
#[test]
fn コマンドで作って並べて書き出す() {
    let root = tempfile::tempdir().unwrap();
    let cfg = root.path().join("cfg");
    let work = root.path().join("work");
    fs::create_dir_all(&work).unwrap();
    let bin = env!("CARGO_BIN_EXE_stario-mv-ai");
    let ffmpeg = mv_export::locate_ffmpeg(
        None,
        &[repo().join("src-tauri/resources/ffmpeg/bin/ffmpeg.exe")],
    )
    .expect("FFmpeg が見つからない（CI では入れてから回す）");
    let run = |args: &[&str]| {
        let o = std::process::Command::new(bin)
            .args(args)
            .env("STARIO_MV_CONFIG_DIR", &cfg)
            .env("STARIO_MV_FONTS", repo().join("public/fonts"))
            .env("FFMPEG_PATH", &ffmpeg)
            .output()
            .unwrap();
        (
            o.status.code(),
            String::from_utf8_lossy(&o.stdout).to_string(),
            String::from_utf8_lossy(&o.stderr).to_string(),
        )
    };
    let video = work.join("v");
    let create = json!({ "dir": p(&video), "name": "通し", "width": 320, "height": 180, "fps": { "num": 10, "den": 1 }, "durationFrames": 10 }).to_string();
    let (code, out, _) = run(&["call", "createProject", &create]);
    assert_eq!(code, Some(1), "許す前は作れない: {out}");
    assert!(out.contains("notAllowed"));
    let (code, _, err) = run(&["allow", &p(&work)]);
    assert_eq!(code, Some(0), "{err}");
    let (code, out, _) = run(&["call", "createProject", &create]);
    assert_eq!(code, Some(0), "{out}");
    let txf = root.path().join("tx.json");
    fs::write(
        &txf,
        json!({ "project": p(&video), "render": { "frame": 5 }, "ops": [
            { "op": "addLayer", "layer": { "name": "地", "type": "solid", "solid": { "color": [1, 0.5, 0, 1] } } },
            { "op": "addLayer", "layer": { "name": "字", "type": "text", "text": { "text": "AI", "fontFamily": "Gen Interface JP", "fontSize": 60, "fill": [1, 1, 1, 1], "align": "center" } } },
        ]})
        .to_string(),
    )
    .unwrap();
    let (code, out, err) = run(&["call", "applyTransaction", &format!("@{}", txf.display())]);
    assert_eq!(code, Some(0), "{out}{err}");
    let j: Value = serde_json::from_str(&out).unwrap();
    assert_eq!(j["applied"], true);
    let saved = PathBuf::from(j["savedTo"].as_str().expect("絵の場所"));
    assert!(saved.starts_with(video.join("cache").join("frames")) && saved.exists());
    let mp4 = work.join("out.mp4");
    let (code, out, err) = run(&[
        "call",
        "exportVideo",
        &json!({ "project": p(&video), "out": p(&mp4) }).to_string(),
    ]);
    assert_eq!(code, Some(0), "{out}{err}");
    assert!(fs::metadata(&mp4).unwrap().len() > 0);
    let (code, out, _) = run(&["tools"]);
    assert_eq!(code, Some(0));
    assert_eq!(
        serde_json::from_str::<Value>(&out)
            .unwrap()
            .as_array()
            .unwrap()
            .len(),
        catalog().len()
    );
}

#[test]
fn 足す場所は既定で最前面() {
    let (_r, dir) = sample();
    let mut ops = ops_allowing(vec![]);
    let solid =
        |name: &str| json!({ "name": name, "type": "solid", "solid": { "color": [1, 1, 1, 1] } });
    let out = tx(
        &mut ops,
        &dir,
        json!({ "ops": [
            { "op": "addLayer", "layer": solid("前") },
            { "op": "addLayer", "index": 99, "layer": solid("奥") },
            { "op": "addLayer", "index": 2, "layer": solid("中") },
        ]}),
    );
    assert!(!out.is_error, "{}", out.json);
    let (doc, _) = read_doc(&dir).unwrap();
    let names: Vec<&str> = doc["compositions"][0]["layers"]
        .as_array()
        .unwrap()
        .iter()
        .map(|l| l["name"].as_str().unwrap())
        .collect();
    assert_eq!(names, ["前", "見出し", "中", "背景", "奥"]);
}

/// MV-0009 決定5：落ちて残った錠のファイル（誰も OS の錠をかけていない）は、待たずに書ける。
#[test]
fn 落ちて残った錠のファイルがあっても待たずに書ける() {
    let (_r, dir) = sample();
    let mut ops = ops_allowing(vec![]);
    let lock = dir.join(mv_ops::LOCK_FILE);
    fs::write(&lock, b"").unwrap();
    let out = tx(
        &mut ops,
        &dir,
        json!({ "ops": [{ "op": "updateLayer", "layerId": TITLE, "patch": { "name": "x" } }]}),
    );
    assert_eq!(out.json["applied"], true);
}

#[test]
fn すたりおmvの動画でなければ読まない() {
    let root = tempfile::tempdir().unwrap();
    fs::write(
        root.path().join("project.json"),
        r#"{"format":"stario-timeline"}"#,
    )
    .unwrap();
    let mut ops = ops_allowing(vec![]);
    let e = ops
        .call("inspect", &json!({ "project": p(root.path()) }))
        .unwrap_err();
    assert_eq!(e.code, "load");
    assert!(e.message.contains("すたりおMV の動画ではありません"));
}

#[test]
fn 許すフォルダは長い場所の印を外して保存する() {
    let root = tempfile::tempdir().unwrap();
    let cfg = root.path().join("cfg");
    let o = std::process::Command::new(env!("CARGO_BIN_EXE_stario-mv-ai"))
        .args(["allow", &p(root.path())])
        .env("STARIO_MV_CONFIG_DIR", &cfg)
        .output()
        .unwrap();
    assert!(o.status.success());
    let s = fs::read_to_string(cfg.join("ai-settings.json")).unwrap();
    assert!(!s.contains(r"\\?\\"), "{s}");
    let saved: Value = serde_json::from_str(&s).unwrap();
    let f = PathBuf::from(saved["allowedFolders"][0].as_str().unwrap());
    assert_eq!(
        f.canonicalize().unwrap(),
        root.path().canonicalize().unwrap()
    );
}

fn name_of(dir: &Path) -> String {
    let (doc, _) = read_doc(dir).unwrap();
    doc["compositions"][0]["layers"]
        .as_array()
        .unwrap()
        .iter()
        .find(|l| l["id"] == TITLE)
        .unwrap()["name"]
        .as_str()
        .unwrap()
        .to_string()
}

/// MV-0009 決定1・3・4：画面と AI の取引を1本の履歴に並べ、新しい順に戻す。AI も undo・redo を呼べる。
#[test]
fn 画面と_ai_の取引を1本の履歴で戻してやり直す() {
    let (_r, dir) = sample();
    let settings = ops_allowing(vec![]).settings.clone();
    let mut ai = Ops::new(settings.clone(), None);
    let mut user = Ops::for_user(settings);
    let first = name_of(&dir);
    let set = |name: &str| json!({ "ops": [{ "op": "updateLayer", "layerId": TITLE, "patch": { "name": name } }]});
    assert_eq!(
        tx(&mut ai, &dir, set("AI の名前")).json["history"]["undo"],
        "AI：レイヤーを直す"
    );
    let out = tx(&mut user, &dir, set("画面の名前"));
    assert_eq!(out.json["history"]["undo"], "画面：レイヤーを直す");
    let undo = |o: &mut Ops| o.call("undo", &json!({ "project": p(&dir) }));
    let redo = |o: &mut Ops| o.call("redo", &json!({ "project": p(&dir) }));
    // 画面の取引を戻す（AI の口からでも同じ1本）
    let u = undo(&mut ai).unwrap();
    assert_eq!(u.json["undone"], "画面：レイヤーを直す");
    assert_eq!(name_of(&dir), "AI の名前");
    assert_eq!(u.json["revision"], json!(read_doc(&dir).unwrap().1));
    // 続けて AI の取引も戻す（画面の口から）
    assert_eq!(
        undo(&mut user).unwrap().json["undone"],
        "AI：レイヤーを直す"
    );
    assert_eq!(name_of(&dir), first);
    assert_eq!(undo(&mut user).unwrap_err().code, "nothingToUndo");
    // やり直す
    assert_eq!(
        redo(&mut user).unwrap().json["redone"],
        "AI：レイヤーを直す"
    );
    assert_eq!(name_of(&dir), "AI の名前");
    let i = ai.call("inspect", &json!({ "project": p(&dir) })).unwrap();
    assert_eq!(
        i.json["history"],
        json!({ "undo": "AI：レイヤーを直す", "redo": "画面：レイヤーを直す" })
    );
    // 戻したあとに新しい取引を反映すると、やり直しの分は消える
    tx(&mut user, &dir, set("新しい名前"));
    assert_eq!(redo(&mut user).unwrap_err().code, "nothingToRedo");
    // 戻したものはファイルにも残る（閉じても戻せる＝history/）
    assert!(dir.join("history").join("index.json").exists());
}

/// MV-0009 決定3：履歴の外で動画が変わっていたら、上書きせずに断る。試しと断られた取引は積まない。
#[test]
fn 履歴の外の変更は上書きせず_試しと断られた取引は積まない() {
    let (_r, dir) = sample();
    let mut ai = ops_allowing(vec![]);
    let set = |name: &str| json!({ "ops": [{ "op": "updateLayer", "layerId": TITLE, "patch": { "name": name } }]});
    tx(&mut ai, &dir, set("一"));
    // 試すだけ・検査で断られた取引は積まない
    let mut dry = set("試し");
    dry["dryRun"] = json!(true);
    tx(&mut ai, &dir, dry);
    let bad = tx(
        &mut ai,
        &dir,
        json!({ "ops": [{ "op": "updateLayer", "layerId": TITLE, "patch": { "outFrame": -5 } }]}),
    );
    assert!(bad.is_error);
    assert_eq!(mv_ops::history::load_index(&dir).entries.len(), 1);
    // 手で project.json を直した
    let text = fs::read_to_string(dir.join("project.json"))
        .unwrap()
        .replace("\"一\"", "\"手で直した\"");
    fs::write(dir.join("project.json"), text).unwrap();
    let e = ai.call("undo", &json!({ "project": p(&dir) })).unwrap_err();
    assert_eq!(e.code, "historyMismatch");
    assert_eq!(name_of(&dir), "手で直した", "上書きしない");
}

/// MV-0009 決定5：project.json が壊れたら、履歴の最後の中身から開き直せる。
#[test]
fn 壊れた中身は履歴の最後から開き直せる() {
    let (_r, dir) = sample();
    let mut ai = ops_allowing(vec![]);
    assert_eq!(
        mv_ops::recover_from_history(&dir).unwrap_err().code,
        "nothingToRecover"
    );
    tx(
        &mut ai,
        &dir,
        json!({ "ops": [{ "op": "updateLayer", "layerId": TITLE, "patch": { "name": "最後" } }]}),
    );
    fs::write(dir.join("project.json"), b"{ broken").unwrap();
    assert!(read_doc(&dir).is_err());
    let rev = mv_ops::recover_from_history(&dir).unwrap();
    assert_eq!(read_doc(&dir).unwrap().1, rev);
    assert_eq!(name_of(&dir), "最後");
    // 開き直したあとも、そのまま戻せる（履歴の版と同じ中身を書く）
    assert!(ai.call("undo", &json!({ "project": p(&dir) })).is_ok());
}
