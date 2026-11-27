//! 画面なしの書き出しを**本物の FFmpeg** に通して確かめる（文字列の一致だけで安心しない）。
//! ⚠️ FFmpeg が無いときは**飛ばさずに落ちる**（環境変数 FFMPEG_PATH・α の同梱・PATH の順に探す）。

use mv_core::id::{new_id, IdKind};
use mv_core::io::{parse_project, save_project};
use mv_core::model::*;
use mv_export::{export, locate_ffmpeg, ExportError, ExportOptions};
use mv_render::text::Fonts;
use mv_render::{Gpu, Renderer};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::AtomicBool;
use std::sync::{Mutex, OnceLock};

const MINIMAL: &str =
    include_str!("../../../../../docs/stario_mv_docs/schemas/examples/minimal.json");

fn repo() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../..")
}

fn ffmpeg() -> PathBuf {
    locate_ffmpeg(
        None,
        &[repo().join("src-tauri/resources/ffmpeg/bin/ffmpeg.exe")],
    )
    .expect("FFmpeg が見つからない（CI では入れてから回す）")
}

fn renderer() -> std::sync::MutexGuard<'static, Renderer> {
    static R: OnceLock<Mutex<Renderer>> = OnceLock::new();
    R.get_or_init(|| {
        Mutex::new(Renderer::new(
            Gpu::new().expect("GPU"),
            Fonts::load(&[&repo().join("public/fonts")]).expect("フォント"),
        ))
    })
    .lock()
    .unwrap_or_else(|e| e.into_inner())
}

fn tmpdir() -> PathBuf {
    let d = std::env::temp_dir().join(format!("mv-export-test-{}", new_id(IdKind::Asset)));
    std::fs::create_dir_all(&d).unwrap();
    d
}

fn opts(out: &Path) -> ExportOptions {
    ExportOptions {
        ffmpeg: ffmpeg(),
        out: out.to_path_buf(),
        composition_id: None,
        encoder: None,
    }
}

/// `ffmpeg -i` の説明（標準エラー）。
fn describe(file: &Path) -> String {
    let o = Command::new(ffmpeg())
        .args(["-hide_banner", "-i"])
        .arg(file)
        .output()
        .unwrap();
    String::from_utf8_lossy(&o.stderr).to_string()
}

#[test]
fn 見本を書き出すと_h264_の_mp4_になる_色も合う() {
    let p = parse_project(MINIMAL).unwrap();
    let dir = tmpdir();
    let out = dir.join("out.mp4");
    let mut done = 0;
    let report = export(
        &mut renderer(),
        &p,
        &dir,
        &opts(&out),
        |d, _| done = d,
        &AtomicBool::new(false),
    )
    .unwrap();
    assert_eq!(report.frames, 90);
    assert_eq!(done, 90, "進み具合が最後まで届く");
    assert!(out.is_file());
    assert!(
        !dir.join(".out.mp4.writing").exists(),
        "書きかけが残っていない"
    );
    let info = describe(&out);
    assert!(info.contains("Video: h264"), "{info}");
    assert!(info.contains("1920x1080"), "{info}");
    assert!(
        info.contains("bt709"),
        "色の情報（BT.709）が書いてある: {info}"
    );
    assert!(info.contains("Duration: 00:00:03.0"), "{info}");
    assert!(
        !info.contains("Audio:"),
        "音のレイヤーが無ければ音は無い: {info}"
    );

    // 30 コマ目を取り出して、描画の核の絵と比べる（H.264 の劣化と YUV の往復ぶんだけの差）
    let o = Command::new(ffmpeg())
        .args(["-hide_banner", "-loglevel", "error", "-i"])
        .arg(&out)
        .args([
            "-vf",
            "select=eq(n\\,30),scale=in_color_matrix=bt709:in_range=tv,format=rgb24",
            "-frames:v",
            "1",
            "-f",
            "rawvideo",
            "-",
        ])
        .output()
        .unwrap();
    assert!(o.status.success(), "{}", String::from_utf8_lossy(&o.stderr));
    let decoded = o.stdout;
    let rendered = renderer()
        .render(&p, &p.main_composition_id, 30, &dir)
        .unwrap();
    assert_eq!(decoded.len(), (1920 * 1080 * 3) as usize);
    let mut sum = 0u64;
    for (i, px) in decoded.chunks(3).enumerate() {
        for (c, v) in px.iter().enumerate() {
            sum += v.abs_diff(rendered.data[i * 4 + c]) as u64;
        }
    }
    let mean = sum as f64 / (1920.0 * 1080.0 * 3.0);
    assert!(mean < 2.0, "平均のずれ {mean}");
    // 背景（色ずれが出やすい暗い青）
    let bg = &decoded[0..3];
    let want = rendered.pixel(0, 0);
    for c in 0..3 {
        assert!(
            bg[c].abs_diff(want[c]) <= 3,
            "背景の色: 書き出し {bg:?}・描画 {want:?}"
        );
    }
    std::fs::remove_dir_all(&dir).ok();
}

/// 音のレイヤーの入った小さな動画（1 秒目〜2 秒目だけ 1 kHz が鳴る）。
fn audio_project(dir: &Path) -> Project {
    std::fs::create_dir_all(dir.join("assets")).unwrap();
    let st = Command::new(ffmpeg())
        .args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=1000:sample_rate=48000:duration=5",
        ])
        .arg(dir.join("assets/tone.wav"))
        .status()
        .unwrap();
    assert!(st.success());
    let mut p = parse_project(MINIMAL).unwrap();
    let asset = Asset {
        id: new_id(IdKind::Asset),
        kind: AssetKind::Audio,
        name: "tone".into(),
        source: AssetSource::Copied {
            path: "assets/tone.wav".into(),
        },
        sha256: None,
        meta: None,
    };
    let mut l = p.compositions[0].layers[1].clone();
    l.id = new_id(IdKind::Layer);
    l.name = "音".into();
    l.layer_type = LayerType::Audio;
    l.solid = None;
    l.asset_id = Some(asset.id.clone());
    l.in_frame = 30;
    l.out_frame = 60;
    l.start_frame = 30;
    l.audio = Some(LayerAudio {
        volume_db: Animatable::number(-6.0),
        muted: false,
    });
    p.assets.push(asset);
    p.compositions[0].layers.push(l);
    p
}

#[test]
fn 音は見える範囲の時刻だけ鳴る() {
    let dir = tmpdir();
    let p = audio_project(&dir);
    let out = dir.join("a.mp4");
    let report = export(
        &mut renderer(),
        &p,
        &dir,
        &opts(&out),
        |_, _| {},
        &AtomicBool::new(false),
    )
    .unwrap();
    assert_eq!(report.audio_layers, 1);
    let info = describe(&out);
    assert!(info.contains("Audio: aac"), "{info}");
    // 音を取り出して、0.1 秒ごとの大きさを見る
    // 左の音だけを見る（モノラルの素材が左右にそのままの大きさで配られているか）
    let o = Command::new(ffmpeg())
        .args(["-hide_banner", "-loglevel", "error", "-i"])
        .arg(&out)
        .args(["-af", "pan=mono|c0=c0", "-ar", "48000", "-f", "s16le", "-"])
        .output()
        .unwrap();
    let samples: Vec<f64> = o
        .stdout
        .chunks(2)
        .map(|b| i16::from_le_bytes([b[0], b[1]]) as f64 / 32768.0)
        .collect();
    let rms = |from: f64, to: f64| {
        let s = &samples[(from * 48000.0) as usize..((to * 48000.0) as usize).min(samples.len())];
        (s.iter().map(|x| x * x).sum::<f64>() / s.len() as f64).sqrt()
    };
    assert!(rms(0.1, 0.9) < 0.005, "前は無音: {}", rms(0.1, 0.9));
    assert!(rms(1.1, 1.9) > 0.02, "1〜2 秒は鳴る: {}", rms(1.1, 1.9));
    assert!(rms(2.1, 2.9) < 0.005, "後も無音: {}", rms(2.1, 2.9));
    let len = samples.len() as f64 / 48000.0;
    assert!((len - 3.0).abs() < 0.1, "音の長さは動画の長さ: {len}");
    // −6 dB ＝鳴っているところの大きさが元の半分ほど（モノラルを左右へ配るときに下げていないこと）
    let o2 = Command::new(ffmpeg())
        .args(["-hide_banner", "-loglevel", "error", "-i"])
        .arg(dir.join("assets/tone.wav"))
        .args(["-ac", "1", "-f", "s16le", "-"])
        .output()
        .unwrap();
    let src: Vec<f64> = o2
        .stdout
        .chunks(2)
        .map(|b| i16::from_le_bytes([b[0], b[1]]) as f64 / 32768.0)
        .collect();
    let src_rms = (src.iter().map(|x| x * x).sum::<f64>() / src.len() as f64).sqrt();
    let ratio = rms(1.1, 1.9) / src_rms;
    assert!((ratio - 0.5).abs() < 0.08, "−6 dB ≒ 半分: {ratio}");
    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn 直すところがある動画は書き出さない() {
    let mut p = parse_project(MINIMAL).unwrap();
    p.compositions[0].layers[0].out_frame = 0;
    let dir = tmpdir();
    let out = dir.join("x.mp4");
    match export(
        &mut renderer(),
        &p,
        &dir,
        &opts(&out),
        |_, _| {},
        &AtomicBool::new(false),
    ) {
        Err(ExportError::Invalid(v)) => assert!(!v.is_empty()),
        other => panic!("止まっていない: {other:?}"),
    }
    assert!(!out.exists());
    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn 止めたら書きかけを残さない() {
    let p = parse_project(MINIMAL).unwrap();
    let dir = tmpdir();
    let out = dir.join("c.mp4");
    let cancel = AtomicBool::new(false);
    let r = export(
        &mut renderer(),
        &p,
        &dir,
        &opts(&out),
        |d, _| {
            if d == 10 {
                cancel.store(true, std::sync::atomic::Ordering::SeqCst);
            }
        },
        &cancel,
    );
    assert!(matches!(r, Err(ExportError::Cancelled)), "{r:?}");
    assert!(!out.exists());
    assert!(!dir.join(".c.mp4.writing").exists());
    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn 失敗しても前からあるファイルを壊さない() {
    let p = parse_project(MINIMAL).unwrap();
    let dir = tmpdir();
    let out = dir.join("keep.mp4");
    std::fs::write(&out, b"previous").unwrap();
    let mut o = opts(&out);
    o.encoder = Some("no_such_encoder".into());
    let r = export(
        &mut renderer(),
        &p,
        &dir,
        &o,
        |_, _| {},
        &AtomicBool::new(false),
    );
    assert!(matches!(r, Err(ExportError::Ffmpeg(_))), "{r:?}");
    assert_eq!(std::fs::read(&out).unwrap(), b"previous");
    assert!(!dir.join(".keep.mp4.writing").exists());
    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn コマンドから書き出せる() {
    let dir = tmpdir();
    let proj = dir.join("proj");
    save_project(&proj, &parse_project(MINIMAL).unwrap()).unwrap();
    let out = dir.join("cli.mp4");
    let o = Command::new(env!("CARGO_BIN_EXE_stario-mv-export"))
        .arg(&proj)
        .arg("--out")
        .arg(&out)
        .arg("--fonts")
        .arg(repo().join("public/fonts"))
        .arg("--ffmpeg")
        .arg(ffmpeg())
        .output()
        .unwrap();
    assert!(o.status.success(), "{}", String::from_utf8_lossy(&o.stderr));
    assert!(out.is_file());
    assert_eq!(
        String::from_utf8_lossy(&o.stdout).trim(),
        out.display().to_string(),
        "出力の場所を標準出力に返す（外部 AI が受け取る）"
    );
    // 使い方の誤りは 2
    let bad = Command::new(env!("CARGO_BIN_EXE_stario-mv-export"))
        .arg("--nope")
        .output()
        .unwrap();
    assert_eq!(bad.status.code(), Some(2));
    std::fs::remove_dir_all(&dir).ok();
}

/// コマンドは別の工程＝描画の核に FFmpeg を渡すのは export 自身（MV-0006 決定4）。映像のレイヤーで確かめる。
#[test]
fn コマンドで映像のレイヤーも書き出せる() {
    let dir = tmpdir();
    let proj = dir.join("proj");
    let assets = proj.join("assets/v");
    std::fs::create_dir_all(&assets).unwrap();
    let st = Command::new(ffmpeg())
        .args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "color=c=red:s=64x64:r=30:d=3",
            "-c:v",
            "png",
        ])
        .arg(assets.join("c.mov"))
        .status()
        .unwrap();
    assert!(st.success());
    let mut doc: serde_json::Value = serde_json::from_str(MINIMAL).unwrap();
    doc["assets"] = serde_json::json!([{ "id": "ast_01JDQ0000000000000000000V9", "kind": "video", "name": "赤",
        "source": { "mode": "copied", "path": "assets/v/c.mov" } }]);
    let mut layer = doc["compositions"][0]["layers"][1].clone();
    layer.as_object_mut().unwrap().remove("solid");
    layer["type"] = "video".into();
    layer["assetId"] = "ast_01JDQ0000000000000000000V9".into();
    layer["transform"]["anchor"] = serde_json::json!({ "value": [32, 32] });
    doc["compositions"][0]["layers"] = serde_json::json!([layer]);
    save_project(&proj, &parse_project(&doc.to_string()).unwrap()).unwrap();
    let out = dir.join("video.mp4");
    let o = Command::new(env!("CARGO_BIN_EXE_stario-mv-export"))
        .arg(&proj)
        .arg("--out")
        .arg(&out)
        .arg("--fonts")
        .arg(repo().join("public/fonts"))
        .arg("--ffmpeg")
        .arg(ffmpeg())
        .output()
        .unwrap();
    assert!(o.status.success(), "{}", String::from_utf8_lossy(&o.stderr));
    let png = dir.join("f.png");
    let st = Command::new(ffmpeg())
        .args(["-hide_banner", "-loglevel", "error", "-y", "-i"])
        .arg(&out)
        .args(["-frames:v", "1"])
        .arg(&png)
        .status()
        .unwrap();
    assert!(st.success());
    let img = image::open(&png).unwrap().to_rgba8();
    let c = img.get_pixel(960, 540).0;
    assert!(
        c[0] > 230 && c[1] < 25 && c[2] < 25,
        "中央に映像の赤: {c:?}"
    );
    let c = img.get_pixel(100, 100).0;
    assert!(c[0] < 25, "映像の外は背景: {c:?}");
    std::fs::remove_dir_all(&dir).ok();
}

/// プレビューの音＝書き出しと同じ混ぜ方（時刻・−6 dB・モノラルを左右へそのまま）。機器の速さに合わせて出す。
#[test]
fn プレビューの音は書き出しと同じ時刻と大きさ() {
    let dir = tmpdir();
    let p = audio_project(&dir);
    let id = p.main_composition_id.clone();
    let pcm = mv_export::mix_pcm(&p, &id, &dir, &ffmpeg(), 44100)
        .unwrap()
        .expect("音がある");
    assert_eq!(pcm.len() % 2, 0, "左右交互");
    let len = pcm.len() as f64 / 2.0 / 44100.0;
    assert!(
        (len - 3.0).abs() < 0.02,
        "長さはコンポジションと同じ: {len}"
    );
    let rms = |ch: usize, from: f64, to: f64| {
        let s: Vec<f64> = pcm[(from * 44100.0) as usize * 2..(to * 44100.0) as usize * 2]
            .iter()
            .skip(ch)
            .step_by(2)
            .map(|v| f64::from(*v))
            .collect();
        (s.iter().map(|x| x * x).sum::<f64>() / s.len() as f64).sqrt()
    };
    assert!(rms(0, 0.1, 0.9) < 0.005, "前は無音");
    // 元の正弦波（振幅 1/8）の −6 dB＝実効値は 0.125/√2/2 ≒ 0.0442
    for ch in [0, 1] {
        let r = rms(ch, 1.1, 1.9);
        assert!(
            (r - 0.0442).abs() < 0.006,
            "1〜2 秒は −6 dB で左右とも鳴る（ch {ch}）: {r}"
        );
    }
    assert!(rms(0, 2.1, 2.9) < 0.005, "後も無音");
    // 音の無い動画は None
    let silent = parse_project(MINIMAL).unwrap();
    let sid = silent.main_composition_id.clone();
    assert!(mv_export::mix_pcm(&silent, &sid, &dir, &ffmpeg(), 48000)
        .unwrap()
        .is_none());
    std::fs::remove_dir_all(&dir).ok();
}

/// MV-0011 決定4：入れ子の中の音も、外の時刻へずらし、入れ子のレイヤーの見える範囲で切って混ぜる。消音・表示を切った入れ子は鳴らさない。
#[test]
fn 入れ子の中の音も外の時刻で混ぜる() {
    let dir = tmpdir();
    let mut p = audio_project(&dir);
    // 音のレイヤー（中の 30〜60 フレーム＝1〜2 秒）を入れ子へ移す
    let audio_layer = p.compositions[0].layers.pop().unwrap();
    let mut inner = p.compositions[0].clone();
    inner.id = new_id(IdKind::Composition);
    inner.layers = vec![audio_layer];
    let mut pre = p.compositions[0].layers[1].clone();
    pre.id = new_id(IdKind::Layer);
    pre.layer_type = LayerType::Precomp;
    pre.solid = None;
    pre.composition_id = Some(inner.id.clone());
    // 中の 0 秒＝外の 15 フレーム（0.5 秒）。見える範囲は外の 0〜60 フレーム（2 秒まで）
    pre.start_frame = 15;
    pre.in_frame = 0;
    pre.out_frame = 60;
    p.compositions[0].layers.push(pre);
    p.compositions.push(inner);
    let comp = &p.compositions[0];
    let fps = f64::from(comp.fps.num) / f64::from(comp.fps.den);
    let v = mv_export::audio_inputs(&p, comp, &dir, fps, &ffmpeg()).unwrap();
    assert_eq!(v.len(), 1, "{v:?}");
    // 中の 1〜2 秒 → 外の 1.5〜2.5 秒 → 見える範囲（2 秒まで）で切る＝1.5〜2.0
    assert!((v[0].at_sec - 1.5).abs() < 1e-6, "{v:?}");
    assert!((v[0].duration_sec - 0.5).abs() < 1e-6, "{v:?}");
    assert!((v[0].volume_db - (-6.0)).abs() < 1e-9);
    // 入れ子を消音・表示を切ると鳴らさない
    let mut q = p.clone();
    q.compositions[0].layers.last_mut().unwrap().audio = Some(LayerAudio {
        volume_db: Animatable::number(0.0),
        muted: true,
    });
    assert!(
        mv_export::audio_inputs(&q, &q.compositions[0], &dir, fps, &ffmpeg())
            .unwrap()
            .is_empty()
    );
    let mut q = p.clone();
    q.compositions[0].layers.last_mut().unwrap().enabled = false;
    assert!(
        mv_export::audio_inputs(&q, &q.compositions[0], &dir, fps, &ffmpeg())
            .unwrap()
            .is_empty()
    );
    std::fs::remove_dir_all(&dir).ok();
}
