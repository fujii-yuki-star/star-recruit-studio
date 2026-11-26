//! MCP の入口（標準入出力の JSON-RPC 2.0・1行1通＝MV-0005 決定5）。
//!
//! ⚠️ 待ち受けの口は開けない（ネットへ出ない＝ADR-0074 決定3 C-4）。中身は [`crate::Ops::call`] だけ。

use crate::{catalog, Ops, Output};
use base64::Engine;
use serde_json::{json, Value};
use std::io::{BufRead, Write};

/// 応じられる MCP の版（新しい順）。相手が言ってきた版が無ければ先頭を返す。
pub const PROTOCOL_VERSIONS: &[&str] = &["2025-06-18", "2025-03-26", "2024-11-05"];

/// AI へ最初に渡す使い方。
pub const INSTRUCTIONS: &str = "すたりおMV（動画編集ソフト）を操作する口です。\
基本の流れ：inspect で中身と revision を見る → applyTransaction に dryRun: true で編集を試す（差分・検査・render で絵も見られる）→ \
問題が無ければ baseRevision を付けて反映 → renderFrame で目で確かめる → exportVideo で書き出す。\
書き換えは applyTransaction だけで、検査を通らない取引は何も変えません。レイヤーの並びは先頭が最前面。";

/// 1行ずつ読んで答える（入力が終われば戻る）。
pub fn serve(ops: &mut Ops, input: impl BufRead, mut output: impl Write) -> std::io::Result<()> {
    for line in input.lines() {
        let line = line?;
        if line.trim().is_empty() {
            continue;
        }
        if let Some(reply) = handle_line(ops, &line) {
            writeln!(output, "{reply}")?;
            output.flush()?;
        }
    }
    Ok(())
}

/// 1通を処理する。返事が要らない（通知）なら `None`。
pub fn handle_line(ops: &mut Ops, line: &str) -> Option<Value> {
    let msg: Value = match serde_json::from_str(line) {
        Ok(v) => v,
        Err(e) => {
            return Some(error(
                Value::Null,
                -32700,
                &format!("JSON として読めません: {e}"),
            ))
        }
    };
    let Some(obj) = msg.as_object() else {
        return Some(error(
            Value::Null,
            -32600,
            "1通に1つの要求（オブジェクト）を送ってください。",
        ));
    };
    let method = obj.get("method").and_then(Value::as_str).unwrap_or("");
    let Some(id) = obj.get("id").cloned() else {
        return None; // 通知（notifications/initialized など）は受けるだけ
    };
    let params = obj.get("params").cloned().unwrap_or(json!({}));
    let result = match method {
        "initialize" => {
            let asked = params["protocolVersion"].as_str().unwrap_or("");
            let version = PROTOCOL_VERSIONS
                .iter()
                .find(|v| **v == asked)
                .unwrap_or(&PROTOCOL_VERSIONS[0]);
            json!({
                "protocolVersion": version,
                "capabilities": { "tools": {} },
                "serverInfo": { "name": "stario-mv", "title": "すたりおMV", "version": env!("CARGO_PKG_VERSION") },
                "instructions": INSTRUCTIONS,
            })
        }
        "ping" => json!({}),
        "tools/list" => {
            let tools: Vec<Value> = catalog()
                .iter()
                .map(|t| {
                    json!({
                        "name": t["name"], "title": t["title"],
                        "description": t["description"], "inputSchema": t["inputSchema"],
                    })
                })
                .collect();
            json!({ "tools": tools })
        }
        "tools/call" => {
            let name = params["name"].as_str().unwrap_or("");
            let args = params.get("arguments").cloned().unwrap_or(json!({}));
            if !catalog().iter().any(|t| t["name"].as_str() == Some(name)) {
                return Some(error(
                    id,
                    -32602,
                    &format!(
                        "「{name}」という操作はありません。tools/list で一覧を確かめてください。"
                    ),
                ));
            }
            match ops.call(name, &args) {
                Ok(out) => tool_result(&out),
                Err(e) => json!({
                    "content": [{ "type": "text", "text": format!("{}（{}）", e.message, e.code) }],
                    "isError": true,
                }),
            }
        }
        other => {
            return Some(error(
                id,
                -32601,
                &format!("「{other}」には応じられません。"),
            ))
        }
    };
    Some(json!({ "jsonrpc": "2.0", "id": id, "result": result }))
}

fn tool_result(out: &Output) -> Value {
    let text = serde_json::to_string_pretty(&out.json).unwrap_or_default();
    let mut content = vec![json!({ "type": "text", "text": text })];
    if let Some(png) = &out.image {
        content.push(json!({
            "type": "image",
            "data": base64::engine::general_purpose::STANDARD.encode(&png.bytes),
            "mimeType": "image/png",
        }));
    }
    let mut r = json!({ "content": content, "isError": out.is_error });
    if out.json.is_object() {
        r["structuredContent"] = out.json.clone();
    }
    r
}

fn error(id: Value, code: i64, message: &str) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })
}
