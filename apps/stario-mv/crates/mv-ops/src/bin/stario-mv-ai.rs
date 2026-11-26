//! 外部 AI の操作口のコマンド（MV-0005 決定1）。中身は MCP と同じ [`mv_ops::Ops::call`]。
//!
//! 使い方：
//! - `stario-mv-ai call <操作> [<引数の JSON> | @<ファイル> | -]`＝操作を1つ呼ぶ（結果の JSON を標準出力へ）
//! - `stario-mv-ai tools`＝操作の一覧（正典 mv-operations.json）
//! - `stario-mv-ai mcp [--project <フォルダ>]`＝MCP の口を開く（標準入出力）
//! - `stario-mv-ai allow <フォルダ>`／`allowed`＝AI に書き出し等を許すフォルダ（**利用者が行う**）
//!
//! 終わりのコード：0＝できた／1＝操作が断られた・失敗した／2＝使い方の誤り。

use mv_ops::settings::{config_dir, resolve, Settings};
use mv_ops::{catalog, Ops};
use serde_json::{json, Value};
use std::io::Read;
use std::path::PathBuf;

const USAGE: &str = "使い方：
  stario-mv-ai call <操作> [<引数の JSON> | @<ファイル> | -]
  stario-mv-ai tools
  stario-mv-ai mcp [--project <動画のフォルダ>]
  stario-mv-ai allow <フォルダ>
  stario-mv-ai allowed";

fn usage() -> ! {
    eprintln!("{USAGE}");
    std::process::exit(2)
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let dir = config_dir();
    let settings = match Settings::load(&dir) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("{e}");
            std::process::exit(1)
        }
    };
    match args.first().map(String::as_str) {
        Some("tools") => {
            println!(
                "{}",
                serde_json::to_string_pretty(catalog()).unwrap_or_default()
            );
        }
        Some("call") => {
            let Some(name) = args.get(1) else { usage() };
            let raw = match args.get(2).map(String::as_str) {
                None => "{}".to_string(),
                Some("-") => {
                    let mut s = String::new();
                    if let Err(e) = std::io::stdin().read_to_string(&mut s) {
                        eprintln!("標準入力を読めませんでした（{e}）。");
                        std::process::exit(1)
                    }
                    s
                }
                Some(a) if a.starts_with('@') => match std::fs::read_to_string(&a[1..]) {
                    Ok(s) => s,
                    Err(e) => {
                        eprintln!("{} を読めませんでした（{e}）。", &a[1..]);
                        std::process::exit(1)
                    }
                },
                Some(a) => a.to_string(),
            };
            let call_args: Value = match serde_json::from_str(&raw) {
                Ok(v) => v,
                Err(e) => {
                    eprintln!("引数が JSON として読めません（{e}）。");
                    std::process::exit(2)
                }
            };
            std::process::exit(call(settings, name, &call_args));
        }
        Some("mcp") => {
            let project = match (args.get(1).map(String::as_str), args.get(2)) {
                (None, _) => None,
                (Some("--project"), Some(p)) => Some(PathBuf::from(p)),
                _ => usage(),
            };
            let mut ops = Ops::new(settings, project);
            let stdin = std::io::stdin();
            if let Err(e) = mv_ops::mcp::serve(&mut ops, stdin.lock(), std::io::stdout()) {
                eprintln!("MCP の口が止まりました（{e}）。");
                std::process::exit(1)
            }
        }
        Some("allow") => {
            let Some(folder) = args.get(1) else { usage() };
            let abs = std::path::absolute(folder).ok();
            let Some(p) = abs.as_deref().and_then(resolve).filter(|p| p.is_dir()) else {
                eprintln!(
                    "{folder} はフォルダとして見つかりません。あるフォルダを指定してください。"
                );
                std::process::exit(1)
            };
            let mut s = settings;
            if !s.allowed_folders.contains(&p) {
                s.allowed_folders.push(p.clone());
            }
            match s.save(&dir) {
                Ok(f) => println!("許しました：{}（設定：{}）", p.display(), f.display()),
                Err(e) => {
                    eprintln!("設定を保存できませんでした（{e}）。");
                    std::process::exit(1)
                }
            }
        }
        Some("allowed") => {
            for f in &settings.allowed_folders {
                println!("{}", f.display());
            }
        }
        _ => usage(),
    }
}

/// 操作を1つ呼んで結果を出す。絵は `out` が無ければ動画のフォルダの `cache/frames/` に保存して場所を返す。
fn call(settings: Settings, name: &str, args: &Value) -> i32 {
    let mut ops = Ops::new(settings, None);
    match ops.call(name, args) {
        Ok(mut out) => {
            if let (Some(png), None) = (&out.image, out.json.get("savedTo")) {
                let dir = args
                    .get("project")
                    .and_then(Value::as_str)
                    .map(PathBuf::from)
                    .unwrap_or_default();
                let comp = out
                    .json
                    .pointer("/frame/compositionId")
                    .or_else(|| out.json.get("compositionId"))
                    .and_then(Value::as_str)
                    .unwrap_or("frame")
                    .to_string();
                let frame = out
                    .json
                    .pointer("/frame/frame")
                    .or_else(|| out.json.get("frame"))
                    .and_then(Value::as_i64)
                    .unwrap_or(0);
                let p = dir
                    .join(mv_core::io::CACHE_DIR)
                    .join("frames")
                    .join(format!("{comp}_{frame}.png"));
                let saved = p
                    .parent()
                    .map(std::fs::create_dir_all)
                    .transpose()
                    .and_then(|_| std::fs::write(&p, &png.bytes));
                match saved {
                    Ok(()) => out.json["savedTo"] = json!(p.display().to_string()),
                    Err(e) => {
                        eprintln!("絵を {} に保存できませんでした（{e}）。", p.display());
                        return 1;
                    }
                }
            }
            println!(
                "{}",
                serde_json::to_string_pretty(&out.json).unwrap_or_default()
            );
            i32::from(out.is_error)
        }
        Err(e) => {
            println!(
                "{}",
                serde_json::to_string_pretty(
                    &json!({ "error": { "code": e.code, "message": e.message } })
                )
                .unwrap_or_default()
            );
            1
        }
    }
}
