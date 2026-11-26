//! 画面なしで書き出す（γ0.1 の段階④）。
//!
//! 使い方：`stario-mv-export <動画のフォルダ> --out <出力.mp4> [--fonts <フォントのフォルダ>] [--ffmpeg <ffmpeg.exe>] [--composition <id>] [--encoder <名前>]`
//! フォントは `--fonts` か環境変数 `STARIO_MV_FONTS`。終わりのコード：0＝できた／1＝動画や環境の問題／2＝使い方の誤り。

use mv_export::{export, locate_ffmpeg, ExportOptions};
use mv_render::text::Fonts;
use mv_render::{Gpu, Renderer};
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;

fn usage() -> ! {
    eprintln!("使い方：stario-mv-export <動画のフォルダ> --out <出力.mp4> [--fonts <フォントのフォルダ>] [--ffmpeg <ffmpeg.exe>] [--composition <id>] [--encoder <名前>]");
    std::process::exit(2)
}

fn main() {
    let mut args = std::env::args().skip(1);
    let mut dir: Option<PathBuf> = None;
    let (mut out, mut fonts, mut ffmpeg, mut comp, mut encoder) = (
        None,
        std::env::var_os("STARIO_MV_FONTS").map(PathBuf::from),
        None,
        None,
        None,
    );
    while let Some(a) = args.next() {
        match a.as_str() {
            "--out" => out = args.next().map(PathBuf::from),
            "--fonts" => fonts = args.next().map(PathBuf::from),
            "--ffmpeg" => ffmpeg = args.next().map(PathBuf::from),
            "--composition" => comp = args.next(),
            "--encoder" => encoder = args.next(),
            s if s.starts_with("--") => usage(),
            _ if dir.is_none() => dir = Some(PathBuf::from(a)),
            _ => usage(),
        }
    }
    let (Some(dir), Some(out)) = (dir, out) else {
        usage()
    };
    let Some(fonts) = fonts else {
        eprintln!("フォントの場所がわかりません。--fonts でフォルダを指定するか、環境変数 STARIO_MV_FONTS を設定してください。");
        std::process::exit(2)
    };
    if let Err(e) = run(dir, out, fonts, ffmpeg, comp, encoder) {
        eprintln!("{e}");
        std::process::exit(1);
    }
}

fn run(
    dir: PathBuf,
    out: PathBuf,
    fonts: PathBuf,
    ffmpeg: Option<PathBuf>,
    comp: Option<String>,
    encoder: Option<String>,
) -> Result<(), Box<dyn std::error::Error>> {
    let loaded = mv_core::io::load_project(&dir)?;
    let ffmpeg = locate_ffmpeg(ffmpeg.as_deref(), &[])?;
    let gpu = Gpu::new()?;
    eprintln!("GPU：{}", gpu.adapter_name);
    let mut renderer = Renderer::new(gpu, Fonts::load(&[&fonts])?);
    let opts = ExportOptions {
        ffmpeg,
        out,
        composition_id: comp,
        encoder,
    };
    let cancel = AtomicBool::new(false);
    let mut last = 0;
    let report = export(
        &mut renderer,
        &loaded.project,
        &dir,
        &opts,
        |done, total| {
            let pct = done * 100 / total.max(1);
            if pct >= last + 10 || done == total {
                last = pct;
                eprintln!("{pct}%（{done}／{total} コマ）");
            }
        },
        &cancel,
    )?;
    println!("{}", report.out.display());
    eprintln!(
        "書き出しました：{} コマ・{}・音 {} 本",
        report.frames, report.encoder, report.audio_layers
    );
    Ok(())
}
