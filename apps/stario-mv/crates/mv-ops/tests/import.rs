//! 素材の取り込みと、映像・連番・SVG の描き方（MV-0006）の検査。
//! ⚠️ 素材は検査の中で FFmpeg で作る（無ければ飛ばさずに落ちる）。描くのは GPU（CI はソフトウェアの GPU）。

use mv_ops::settings::Settings;
use mv_ops::{read_doc, Ops, Output};
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

fn repo() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../..")
}

fn ffmpeg() -> PathBuf {
    mv_export::locate_ffmpeg(
        None,
        &[repo().join("src-tauri/resources/ffmpeg/bin/ffmpeg.exe")],
    )
    .expect("FFmpeg が見つからない（CI では入れてから回す）")
}

fn run_ffmpeg(args: &[&str]) {
    let o = Command::new(ffmpeg())
        .args(["-hide_banner", "-loglevel", "error", "-y"])
        .args(args)
        .output()
        .unwrap();
    assert!(o.status.success(), "{}", String::from_utf8_lossy(&o.stderr));
}

fn p(d: &Path) -> String {
    d.display().to_string()
}

/// 素材の置き場（許したフォルダ）と、64×36・10fps・1秒の空の動画。
struct Env {
    _root: tempfile::TempDir,
    media: PathBuf,
    video: PathBuf,
    ops: Ops,
}

fn env() -> Env {
    let root = tempfile::tempdir().unwrap();
    let media = root.path().join("media");
    let video = root.path().join("video");
    fs::create_dir_all(&media).unwrap();
    let mut ops = Ops::new(
        Settings {
            allowed_folders: vec![root.path().to_path_buf()],
            font_dirs: vec![repo().join("public/fonts")],
            ffmpeg: Some(ffmpeg()),
        },
        None,
    );
    let out = ops
        .call(
            "createProject",
            &json!({ "dir": p(&video), "name": "取り込み", "width": 64, "height": 36,
                "fps": { "num": 10, "den": 1 }, "durationFrames": 10, "background": [0, 0, 1, 1],
                "workingColorSpace": "srgb" }),
        )
        .unwrap();
    assert!(!out.is_error);
    Env {
        _root: root,
        media,
        video,
        ops,
    }
}

impl Env {
    fn tx(&mut self, ops: Value) -> Output {
        self.ops
            .call(
                "applyTransaction",
                &json!({ "project": p(&self.video), "ops": ops }),
            )
            .expect("取引を受け付ける")
    }

    fn tx_err(&mut self, ops: Value) -> mv_ops::OpError {
        self.ops
            .call(
                "applyTransaction",
                &json!({ "project": p(&self.video), "ops": ops }),
            )
            .unwrap_err()
    }

    /// コマを描いて、中央の画素。
    fn center(&mut self, frame: i64) -> [u8; 4] {
        let out = self
            .ops
            .call(
                "renderFrame",
                &json!({ "project": p(&self.video), "frame": frame, "maxSize": 0 }),
            )
            .unwrap();
        let img = image::load_from_memory(&out.image.unwrap().bytes)
            .unwrap()
            .to_rgba8();
        img.get_pixel(32, 18).0
    }

    /// 灰色の連番（i 番目＝明るさ i×20・不透明度 a）を書く。
    fn gray_frames(&self, prefix: &str, n: u32, a: u8) -> PathBuf {
        for i in 0..n {
            let g = (i * 20) as u8;
            let img = image::RgbaImage::from_pixel(64, 36, image::Rgba([g, g, g, a]));
            img.save(self.media.join(format!("{prefix}{:03}.png", i + 1)))
                .unwrap();
        }
        self.media.join(format!("{prefix}001.png"))
    }
}

fn near(a: [u8; 4], b: [u8; 4], tol: i32) -> bool {
    a.iter()
        .zip(b.iter())
        .all(|(x, y)| (i32::from(*x) - i32::from(*y)).abs() <= tol)
}

#[test]
fn 画像を写して取り込み素材の中心に置く() {
    let mut e = env();
    let src = e.media.join("赤.png");
    image::RgbaImage::from_pixel(20, 10, image::Rgba([255, 0, 0, 255]))
        .save(&src)
        .unwrap();
    let out = e.tx(json!([{ "op": "importAsset", "path": p(&src) }]));
    assert!(!out.is_error, "{}", out.json);
    let aid = out.json["created"][0]["id"].as_str().unwrap().to_string();
    assert_eq!(out.json["created"][0]["kind"], "asset");
    let (doc, _) = read_doc(&e.video).unwrap();
    let a = &doc["assets"][0];
    assert_eq!(a["kind"], "image");
    assert_eq!(a["name"], "赤.png");
    assert_eq!(a["source"]["path"], format!("assets/{aid}/赤.png"));
    assert_eq!(
        a["meta"],
        json!({ "width": 20, "height": 10, "hasAlpha": true })
    );
    let copied = e.video.join(format!("assets/{aid}/赤.png"));
    assert_eq!(fs::read(&copied).unwrap(), fs::read(&src).unwrap());
    assert_eq!(
        a["sha256"].as_str().unwrap(),
        mv_ops::revision_of(&fs::read(&src).unwrap()),
        "指紋＝中身の SHA-256"
    );
    // assetId だけで足せる（type は素材から・アンカーは素材の中心）
    let out = e.tx(json!([{ "op": "addLayer", "layer": { "name": "赤", "assetId": aid } }]));
    assert!(!out.is_error, "{}", out.json);
    let (doc, _) = read_doc(&e.video).unwrap();
    let l = &doc["compositions"][0]["layers"][0];
    assert_eq!(l["type"], "image");
    assert_eq!(l["transform"]["anchor"]["value"], json!([10.0, 5.0]));
    assert!(
        near(e.center(0), [255, 0, 0, 255], 2),
        "素材がちょうど真ん中"
    );
    // 試しの絵＝まだ写していない素材も元の場所から読んで描く
    let green = e.media.join("緑.png");
    image::RgbaImage::from_pixel(64, 36, image::Rgba([0, 255, 0, 255]))
        .save(&green)
        .unwrap();
    let mut out = e
        .ops
        .call(
            "applyTransaction",
            &json!({ "project": p(&e.video), "dryRun": true, "render": { "frame": 0, "maxSize": 0 }, "ops": [
                { "op": "importAsset", "path": p(&green), "id": "ast_01JDQ0000000000000000000D1" },
                { "op": "addLayer", "layer": { "name": "緑", "assetId": "ast_01JDQ0000000000000000000D1" } },
            ] }),
        )
        .unwrap();
    let img = image::load_from_memory(&out.image.take().expect("試しの絵").bytes)
        .unwrap()
        .to_rgba8();
    assert!(
        near(img.get_pixel(32, 18).0, [0, 255, 0, 255], 2),
        "{:?}",
        img.get_pixel(32, 18)
    );
    assert!(!e
        .video
        .join("assets/ast_01JDQ0000000000000000000D1")
        .exists());
}

#[test]
fn 参照で取り込むと写さない() {
    let mut e = env();
    let src = e.media.join("g.png");
    image::RgbaImage::from_pixel(4, 4, image::Rgba([0, 255, 0, 255]))
        .save(&src)
        .unwrap();
    let out =
        e.tx(json!([{ "op": "importAsset", "path": p(&src), "mode": "reference", "name": "緑" }]));
    assert!(!out.is_error, "{}", out.json);
    let (doc, _) = read_doc(&e.video).unwrap();
    assert_eq!(doc["assets"][0]["source"]["mode"], "referenced");
    assert_eq!(doc["assets"][0]["name"], "緑");
    let abs = PathBuf::from(doc["assets"][0]["source"]["absolutePath"].as_str().unwrap());
    assert_eq!(abs.canonicalize().unwrap(), src.canonicalize().unwrap());
    assert_eq!(
        fs::read_dir(e.video.join("assets")).unwrap().count(),
        0,
        "写さない"
    );
}

#[test]
fn 取り込めないときは何も残さない() {
    let mut e = env();
    let src = e.media.join("a.png");
    image::RgbaImage::from_pixel(4, 4, image::Rgba([0, 0, 0, 255]))
        .save(&src)
        .unwrap();
    let before = fs::read(e.video.join("project.json")).unwrap();
    let outside = tempfile::tempdir().unwrap();
    let far = outside.path().join("b.png");
    fs::copy(&src, &far).unwrap();
    let err = e.tx_err(json!([{ "op": "importAsset", "path": p(&far) }]));
    assert_eq!(err.code, "opFailed");
    assert!(
        err.message.contains("許したフォルダの外"),
        "{}",
        err.message
    );
    let txt = e.media.join("memo.txt");
    fs::write(&txt, "x").unwrap();
    let err = e.tx_err(json!([{ "op": "importAsset", "path": p(&txt) }]));
    assert!(err.message.contains("取り込めません"), "{}", err.message);
    let err = e.tx_err(json!([{ "op": "importAsset", "path": p(&e.media.join("none.png")) }]));
    assert!(err.message.contains("見つかりません"), "{}", err.message);
    // 検査に問題が残る取引（後の操作が壊れている）＝写さない
    let out = e.tx(json!([
        { "op": "importAsset", "path": p(&src) },
        { "op": "updateProject", "patch": { "mainCompositionId": "cmp_NOPE" } },
    ]));
    assert!(out.is_error);
    // 試すだけ＝写さない
    let out = e
        .ops
        .call(
            "applyTransaction",
            &json!({ "project": p(&e.video), "dryRun": true, "ops": [{ "op": "importAsset", "path": p(&src) }] }),
        )
        .unwrap();
    assert_eq!(
        out.json["changes"]["assets"]["added"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    assert_eq!(fs::read_dir(e.video.join("assets")).unwrap().count(), 0);
    assert_eq!(fs::read(e.video.join("project.json")).unwrap(), before);
    // 置き場がもうある（ID がぶつかる）＝写さず、元のフォルダも消さない
    let id = "ast_01JDQ0000000000000000000Z9";
    let taken = e.video.join("assets").join(id);
    fs::create_dir_all(&taken).unwrap();
    fs::write(taken.join("keep"), "x").unwrap();
    let first = "ast_01JDQ0000000000000000000Z8";
    let err = e.tx_err(
        json!([{ "op": "importAsset", "path": p(&src), "id": first },
        { "op": "importAsset", "path": p(&src), "id": id }]),
    );
    assert_eq!(err.code, "io");
    assert!(taken.join("keep").exists());
    assert!(
        !e.video.join("assets").join(first).exists(),
        "先に写した素材も消して戻す"
    );
    assert_eq!(fs::read(e.video.join("project.json")).unwrap(), before);
}

#[test]
fn 連番はそのコマのファイルを描く() {
    let mut e = env();
    let first = e.gray_frames("seq_", 10, 255);
    let out = e.tx(json!([{ "op": "importAsset", "path": p(&first), "sequence": true, "fps": 5, "id": "ast_01JDQ0000000000000000000S1" },
        { "op": "addLayer", "layer": { "name": "連番", "assetId": "ast_01JDQ0000000000000000000S1" } }]));
    assert!(!out.is_error, "{}", out.json);
    let (doc, _) = read_doc(&e.video).unwrap();
    assert_eq!(doc["assets"][0]["meta"]["frameCount"], 10);
    assert_eq!(
        doc["assets"][0]["meta"]["fps"],
        json!({ "num": 5, "den": 1 })
    );
    assert_eq!(doc["compositions"][0]["layers"][0]["type"], "video");
    assert_eq!(
        fs::read_dir(e.video.join("assets/ast_01JDQ0000000000000000000S1"))
            .unwrap()
            .count(),
        10,
        "全部のコマを写す"
    );
    // 5fps の連番を 10fps のコンポジションに＝コマ 4 は素材の 2 番目（明るさ 40）
    assert!(near(e.center(4), [40, 40, 40, 255], 2), "{:?}", e.center(4));
    assert!(near(e.center(9), [80, 80, 80, 255], 2));
    // 始まりより前は描かない（startFrame をずらす）
    let out = e.tx(json!([{ "op": "updateLayer", "layerId": doc["compositions"][0]["layers"][0]["id"], "patch": { "startFrame": 5 } }]));
    assert!(!out.is_error, "{}", out.json);
    assert!(near(e.center(4), [0, 0, 255, 255], 2), "背景が見える");
    // 名前に番号が無いと連番にできない
    let err = e.tx_err(json!([{ "op": "importAsset", "path": p(&e.media.join("seq_001.png").with_file_name("x.png")), "sequence": true }]));
    assert_eq!(err.code, "opFailed");
}

#[test]
fn 映像は表示中のコマを順不同でも正しく描き透過も読む() {
    let mut e = env();
    let first = e.gray_frames("mov_", 10, 128);
    let mov = e.media.join("透過.mov");
    run_ffmpeg(&[
        "-framerate",
        "10",
        "-i",
        &p(&first.with_file_name("mov_%03d.png")),
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:duration=1:sample_rate=48000",
        "-c:v",
        "png",
        "-c:a",
        "pcm_s16le",
        "-shortest",
        &p(&mov),
    ]);
    let id = "ast_01JDQ0000000000000000000V1";
    let out = e.tx(json!([{ "op": "importAsset", "path": p(&mov), "id": id },
        { "op": "addLayer", "layer": { "name": "映像", "assetId": id } }]));
    assert!(!out.is_error, "{}", out.json);
    let (doc, _) = read_doc(&e.video).unwrap();
    let m = &doc["assets"][0]["meta"];
    assert_eq!(doc["assets"][0]["kind"], "video");
    assert_eq!(
        (m["width"].clone(), m["height"].clone()),
        (json!(64), json!(36))
    );
    assert_eq!(m["fps"], json!({ "num": 10, "den": 1 }));
    assert_eq!(m["frameCount"], 10);
    assert_eq!(m["hasAlpha"], true);
    assert_eq!(m["hasAudio"], true);
    assert_eq!(doc["compositions"][0]["layers"][0]["outFrame"], 10);
    // 順不同（戻る・飛ぶ・同じコマ）でも、そのコマ。透過 128 で背景の青と混ざる
    for f in [7, 2, 3, 3, 9, 0, 5] {
        let g = (f * 20) as f64;
        let want = [
            (g * 128.0 / 255.0).round() as u8,
            (g * 128.0 / 255.0).round() as u8,
            (g * 128.0 / 255.0 + 255.0 * 127.0 / 255.0).round() as u8,
            255,
        ];
        let got = e.center(f);
        assert!(near(got, want, 3), "コマ {f}: {got:?} ≠ {want:?}");
    }
}

#[test]
fn yuv_の映像は色の行列どおりに戻す() {
    let mut e = env();
    let first = e.gray_frames("yuv_", 10, 255);
    let mp4 = e.media.join("灰.mp4");
    // 限定範囲・BT.709 と書いた YUV（mpeg4 は FFmpeg に必ずある）。B フレーム入り・5 コマごとの区切り＝よくある映像と同じく、並びと表示の順が違う
    run_ffmpeg(&[
        "-framerate",
        "10",
        "-i",
        &p(&first.with_file_name("yuv_%03d.png")),
        "-vf",
        "scale=out_color_matrix=bt709:out_range=tv,format=yuv420p",
        "-c:v",
        "mpeg4",
        "-q:v",
        "1",
        "-bf",
        "2",
        "-g",
        "5",
        "-color_primaries",
        "bt709",
        "-color_trc",
        "bt709",
        "-colorspace",
        "bt709",
        "-color_range",
        "tv",
        &p(&mp4),
    ]);
    let id = "ast_01JDQ0000000000000000000V2";
    let out = e.tx(json!([{ "op": "importAsset", "path": p(&mp4), "id": id },
        { "op": "addLayer", "layer": { "name": "映像", "assetId": id } }]));
    assert!(!out.is_error, "{}", out.json);
    let (doc, _) = read_doc(&e.video).unwrap();
    assert_eq!(doc["assets"][0]["meta"]["hasAlpha"], false);
    assert_eq!(doc["assets"][0]["meta"]["hasAudio"], false);
    for f in [6, 1, 2, 3, 9, 4, 8, 0] {
        let g = (f * 20) as u8;
        let got = e.center(f);
        assert!(near(got, [g, g, g, 255], 4), "コマ {f}: {got:?}");
    }
    // 音の無い映像は、書き出しで音を混ぜようとしない
    let out = e
        .ops
        .call(
            "exportVideo",
            &json!({ "project": p(&e.video), "out": p(&e.media.join("無音.mp4")) }),
        )
        .unwrap();
    assert_eq!(out.json["audioLayers"], 0, "{}", out.json);
}

#[test]
fn svg_は拡大しても細かく描く() {
    let mut e = env();
    let svg = e.media.join("四角.svg");
    fs::write(
        &svg,
        r##"<svg xmlns="http://www.w3.org/2000/svg" width="8" height="4"><rect x="0" y="0" width="4" height="4" fill="#ff0000"/><rect x="4" y="0" width="4" height="4" fill="#00ff00"/></svg>"##,
    )
    .unwrap();
    let id = "ast_01JDQ0000000000000000000G1";
    let out = e.tx(json!([{ "op": "importAsset", "path": p(&svg), "id": id },
        { "op": "addLayer", "layer": { "name": "SVG", "assetId": id, "transform": { "scale": { "value": [8, 8] } } } }]));
    assert!(!out.is_error, "{}", out.json);
    let (doc, _) = read_doc(&e.video).unwrap();
    assert_eq!(doc["assets"][0]["kind"], "svg");
    assert_eq!(doc["assets"][0]["meta"]["width"], 8);
    let out = e
        .ops
        .call(
            "renderFrame",
            &json!({ "project": p(&e.video), "frame": 0, "maxSize": 0 }),
        )
        .unwrap();
    let img = image::load_from_memory(&out.image.unwrap().bytes)
        .unwrap()
        .to_rgba8();
    // 8 倍＝64×32。境目（x=32）の両隣が混ざらずにくっきり（倍率ぶん細かく描いている）
    assert!(
        near(img.get_pixel(30, 18).0, [255, 0, 0, 255], 2),
        "{:?}",
        img.get_pixel(30, 18)
    );
    assert!(
        near(img.get_pixel(33, 18).0, [0, 255, 0, 255], 2),
        "{:?}",
        img.get_pixel(33, 18)
    );
    // SVG の中の文字は黙って消さずに知らせる
    let t = e.media.join("文字.svg");
    fs::write(
        &t,
        r#"<svg xmlns="http://www.w3.org/2000/svg" width="8" height="4"><text>あ</text></svg>"#,
    )
    .unwrap();
    let err = e.tx_err(json!([{ "op": "importAsset", "path": p(&t) }]));
    assert!(err.message.contains("パスに変換"), "{}", err.message);
}

#[test]
fn 素材の記録を外してもファイルは消さない() {
    let mut e = env();
    let src = e.media.join("a.png");
    image::RgbaImage::from_pixel(4, 4, image::Rgba([0, 0, 0, 255]))
        .save(&src)
        .unwrap();
    let id = "ast_01JDQ0000000000000000000R1";
    let out = e.tx(json!([{ "op": "importAsset", "path": p(&src), "id": id },
        { "op": "addLayer", "layer": { "id": "lyr_01JDQ0000000000000000000R2", "name": "a", "assetId": id } }]));
    assert!(!out.is_error, "{}", out.json);
    let out = e.tx(json!([{ "op": "removeAsset", "assetId": id }]));
    assert!(out.is_error, "指しているレイヤーがあれば断る");
    assert_eq!(out.json["issues"][0]["code"], "MissingReference");
    let out = e.tx(
        json!([{ "op": "removeLayer", "layerId": "lyr_01JDQ0000000000000000000R2" },
        { "op": "removeAsset", "assetId": id }]),
    );
    assert!(!out.is_error, "{}", out.json);
    assert_eq!(out.json["changes"]["assets"]["removed"], json!([id]));
    assert!(
        e.video.join(format!("assets/{id}/a.png")).exists(),
        "ファイルは消さない"
    );
    let err = e.tx_err(json!([{ "op": "removeAsset", "assetId": id }]));
    assert!(err.message.contains("見つかりません"));
}

#[test]
fn 映像の音も書き出しに入る() {
    let mut e = env();
    let first = e.gray_frames("av_", 10, 255);
    let mov = e.media.join("音つき.mov");
    run_ffmpeg(&[
        "-framerate",
        "10",
        "-i",
        &p(&first.with_file_name("av_%03d.png")),
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:duration=1:sample_rate=48000",
        "-c:v",
        "png",
        "-c:a",
        "pcm_s16le",
        "-shortest",
        &p(&mov),
    ]);
    let id = "ast_01JDQ0000000000000000000A1";
    let out = e.tx(json!([{ "op": "importAsset", "path": p(&mov), "id": id },
        { "op": "addLayer", "layer": { "name": "映像", "assetId": id } }]));
    assert!(!out.is_error, "{}", out.json);
    let mp4 = e.media.join("出力.mp4");
    let out = e
        .ops
        .call(
            "exportVideo",
            &json!({ "project": p(&e.video), "out": p(&mp4) }),
        )
        .unwrap();
    assert_eq!(out.json["audioLayers"], 1, "{}", out.json);
    assert_eq!(out.json["frames"], 10);
    // 書き出しの 6 コマ目＝素材の 6 コマ目（明るさ 120）
    let png = e.media.join("f.png");
    run_ffmpeg(&[
        "-i",
        &p(&mp4),
        "-vf",
        "select=eq(n\\,6)",
        "-frames:v",
        "1",
        &p(&png),
    ]);
    let img = image::open(&png).unwrap().to_rgba8();
    assert!(
        near(img.get_pixel(32, 18).0, [120, 120, 120, 255], 4),
        "{:?}",
        img.get_pixel(32, 18)
    );
    // 音を消したレイヤーは混ぜない
    let lid = read_doc(&e.video).unwrap().0["compositions"][0]["layers"][0]["id"].clone();
    let out = e.tx(json!([{ "op": "updateLayer", "layerId": lid, "patch": { "audio": { "volumeDb": { "value": 0 }, "muted": true } } }]));
    assert!(!out.is_error, "{}", out.json);
    let out = e
        .ops
        .call(
            "exportVideo",
            &json!({ "project": p(&e.video), "out": p(&mp4) }),
        )
        .unwrap();
    assert_eq!(out.json["audioLayers"], 0);
}

#[test]
fn 速さの違う映像は表示中のコマを切り捨てで選ぶ() {
    let mut e = env();
    let first = e.gray_frames("slow_", 5, 255);
    let mov = e.media.join("4fps.mov");
    run_ffmpeg(&[
        "-framerate",
        "4",
        "-i",
        &p(&first.with_file_name("slow_%03d.png")),
        "-c:v",
        "png",
        &p(&mov),
    ]);
    let id = "ast_01JDQ0000000000000000000F4";
    let out = e.tx(json!([{ "op": "importAsset", "path": p(&mov), "id": id },
        { "op": "addLayer", "layer": { "name": "4fps", "assetId": id } }]));
    assert!(!out.is_error, "{}", out.json);
    // 10fps のコマ 9＝0.9 秒＝4fps の 3.6 コマ目＝表示中は 3 番目（明るさ 60）。四捨五入なら 4 番目になる
    assert!(near(e.center(9), [60, 60, 60, 255], 3), "{:?}", e.center(9));
    // コマ 2＝0.2 秒＝0.8 コマ目＝0 番目
    assert!(near(e.center(2), [0, 0, 0, 255], 3), "{:?}", e.center(2));
}

#[test]
fn 音の入っていない音の素材は取り込まない() {
    let mut e = env();
    let first = e.gray_frames("mute_", 2, 255);
    let fake = e.media.join("音のはず.m4a");
    run_ffmpeg(&[
        "-framerate",
        "10",
        "-i",
        &p(&first.with_file_name("mute_%03d.png")),
        "-c:v",
        "mpeg4",
        "-f",
        "mp4",
        &p(&fake),
    ]);
    let err = e.tx_err(json!([{ "op": "importAsset", "path": p(&fake) }]));
    assert_eq!(err.code, "opFailed");
    assert!(
        err.message.contains("音が入っていません"),
        "{}",
        err.message
    );
}

/// MV-0008 決定2：利用者（アプリの画面）が選んだ素材は、許したフォルダの外でも取り込める。AI の口は今までどおり断る。
#[test]
fn 利用者の口は許したフォルダの外でも取り込める_ai_の口は断る() {
    let e = env();
    let outside = tempfile::tempdir().unwrap();
    let far = outside.path().join("far.png");
    image::RgbaImage::from_pixel(4, 4, image::Rgba([255, 0, 0, 255]))
        .save(&far)
        .unwrap();
    let args = json!({ "project": p(&e.video), "ops": [{ "op": "importAsset", "path": p(&far) }] });
    // AI の口（Ops::new）は断る
    let mut ai = Ops::new(e.ops.settings.clone(), None);
    let err = ai.call("applyTransaction", &args).unwrap_err();
    assert!(
        err.message.contains("許したフォルダの外"),
        "{}",
        err.message
    );
    // 利用者の口（Ops::for_user）は取り込む（写す＝プロジェクトの中に入る）
    let mut user = Ops::for_user(e.ops.settings.clone());
    let out = user.call("applyTransaction", &args).unwrap();
    assert!(!out.is_error, "{}", out.json);
    assert_eq!(out.json["applied"], true);
    let id = out.json["created"][0]["id"].as_str().unwrap().to_string();
    assert!(e.video.join("assets").join(&id).exists(), "写した");
    // 書き出しの許しは緩めない（利用者の口でも、許したフォルダの外へは書き出さない＝取り込みだけの話）
    let err = user
        .call(
            "exportVideo",
            &json!({ "project": p(&e.video), "out": p(&outside.path().join("o.mp4")) }),
        )
        .unwrap_err();
    assert_eq!(err.code, "notAllowed");
}
