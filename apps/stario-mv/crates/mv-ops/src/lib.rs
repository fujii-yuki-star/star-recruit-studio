//! すたりおMV の外部 AI の操作口（γ0.1 の段階⑤・MV-0005）。
//!
//! **中身は1つ・入口は2つ**（MCP＝[`mcp`]・コマンド＝`stario-mv-ai`）。どちらも [`Ops::call`] を呼ぶ。
//! 操作の一覧の正典は `docs/stario_mv_docs/schemas/mv-operations.json`（[`CATALOG_JSON`]）。
//! ⚠️ 書き換えは必ず取引（[`tx`]）で＝当てたあとに形と中身の検査を通ったときだけ保存する（ADR-0074 決定3）。

pub mod mcp;
pub mod settings;
pub mod tx;

use mv_core::io::{check_schema, PROJECT_FILE};
use mv_core::model::{Project, FORMAT, SCHEMA_VERSION};
use mv_core::validate::{validate, Issue};
use mv_render::text::Fonts;
use mv_render::{Frame, Gpu, Renderer};
use serde_json::{json, Value};
use settings::Settings;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::{Duration, SystemTime};

/// 操作の一覧（正典）。γ の資料からそのまま埋め込む＝写しを作らない。
pub const CATALOG_JSON: &str =
    include_str!("../../../../../docs/stario_mv_docs/schemas/mv-operations.json");
/// 反映中の目印のファイル。
pub const LOCK_FILE: &str = "project.json.lock";
/// これより古い錠は、落ちた残りとみなして捨てる。
pub const STALE_LOCK: Duration = Duration::from_secs(600);
/// 1コマの絵の長辺の既定の上限（AI に渡す絵を重くしすぎない）。
pub const DEFAULT_MAX_SIZE: u32 = 960;

/// 操作の一覧（`tools` の中身）。
pub fn catalog() -> &'static Vec<Value> {
    static C: OnceLock<Vec<Value>> = OnceLock::new();
    C.get_or_init(|| {
        let v: Value = serde_json::from_str(CATALOG_JSON)
            .expect("操作の一覧が JSON として読めない（γ の資料が壊れている）");
        v["tools"]
            .as_array()
            .expect("操作の一覧に tools が無い（γ の資料が壊れている）")
            .clone()
    })
}

fn arg_validators() -> &'static HashMap<String, jsonschema::Validator> {
    static V: OnceLock<HashMap<String, jsonschema::Validator>> = OnceLock::new();
    V.get_or_init(|| {
        catalog()
            .iter()
            .map(|t| {
                let name = t["name"].as_str().expect("操作に name が無い").to_string();
                let v = jsonschema::draft202012::new(&t["inputSchema"])
                    .unwrap_or_else(|e| panic!("操作 {name} の引数の形が組み立てられない: {e}"));
                (name, v)
            })
            .collect()
    })
}

/// 中身が実装されている操作（⚠️ 一覧と食い違うと検査が落ちる）。
pub const HANDLED: &[&str] = &[
    "inspect",
    "validate",
    "renderFrame",
    "newIds",
    "applyTransaction",
    "createProject",
    "exportVideo",
];

/// 操作が失敗した理由。`code` は AI が見分けるための短い名前。
#[derive(Debug, Clone, PartialEq)]
pub struct OpError {
    pub code: &'static str,
    pub message: String,
}

impl OpError {
    fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

impl std::fmt::Display for OpError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}（{}）", self.message, self.code)
    }
}

impl std::error::Error for OpError {}

/// 1コマの絵（PNG）。
#[derive(Debug, Clone, PartialEq)]
pub struct Png {
    pub bytes: Vec<u8>,
    pub width: u32,
    pub height: u32,
}

/// 操作の結果。`is_error`＝反映を断ったなど（MCP では `isError`・コマンドでは終わりのコード 1）。
#[derive(Debug, Clone, PartialEq)]
pub struct Output {
    pub json: Value,
    pub image: Option<Png>,
    pub is_error: bool,
}

impl Output {
    fn ok(json: Value) -> Self {
        Self {
            json,
            image: None,
            is_error: false,
        }
    }
}

/// 操作口の本体。GPU とフォントは最初に描くときに用意して使い回す（MV-0005 決定5）。
pub struct Ops {
    pub settings: Settings,
    /// MCP を `--project` 付きで起動したときの既定の動画。
    pub default_project: Option<PathBuf>,
    renderer: Option<Renderer>,
}

impl Ops {
    pub fn new(settings: Settings, default_project: Option<PathBuf>) -> Self {
        Self {
            settings,
            default_project,
            renderer: None,
        }
    }

    /// 操作を呼ぶ（引数はまず正典の一覧の形で確かめる）。
    pub fn call(&mut self, name: &str, args: &Value) -> Result<Output, OpError> {
        let Some(v) = arg_validators().get(name) else {
            return Err(OpError::new(
                "unknownTool",
                format!(
                    "「{name}」という操作はありません（使えるのは {}）。",
                    HANDLED.join("・")
                ),
            ));
        };
        let problems: Vec<String> = v
            .iter_errors(args)
            .take(5)
            .map(|e| format!("{}: {e}", e.instance_path))
            .collect();
        if !problems.is_empty() {
            return Err(OpError::new(
                "invalidArguments",
                format!(
                    "引数の形が操作の一覧（mv-operations.json）と合いません。直してから呼び直してください：{}",
                    problems.join("／")
                ),
            ));
        }
        match name {
            "inspect" => self.inspect(args),
            "validate" => self.validate(args),
            "renderFrame" => self.render_frame(args),
            "newIds" => new_ids(args),
            "applyTransaction" => self.apply_transaction(args),
            "createProject" => self.create_project(args),
            "exportVideo" => self.export_video(args),
            _ => Err(OpError::new(
                "notImplemented",
                format!("操作「{name}」は一覧にあるのに中身がありません（すたりおMV の不具合）。"),
            )),
        }
    }

    fn project_dir(&self, args: &Value) -> Result<PathBuf, OpError> {
        args.get("project")
            .and_then(Value::as_str)
            .map(PathBuf::from)
            .or_else(|| self.default_project.clone())
            .ok_or_else(|| {
                OpError::new(
                    "invalidArguments",
                    "動画のフォルダがわかりません。project に project.json のあるフォルダを渡してください。",
                )
            })
    }

    fn inspect(&self, args: &Value) -> Result<Output, OpError> {
        let dir = self.project_dir(args)?;
        let (doc, revision) = read_doc(&dir)?;
        if let Some(id) = args.get("layerId").and_then(Value::as_str) {
            for c in doc["compositions"].as_array().into_iter().flatten() {
                for l in c["layers"].as_array().into_iter().flatten() {
                    if l["id"].as_str() == Some(id) {
                        return Ok(Output::ok(json!({
                            "revision": revision, "compositionId": c["id"], "layer": l
                        })));
                    }
                }
            }
            return Err(OpError::new(
                "notFound",
                format!(
                    "レイヤー {id} が見つかりません。inspect（引数なし）で一覧を確かめてください。"
                ),
            ));
        }
        if let Some(id) = args.get("compositionId").and_then(Value::as_str) {
            let c = doc["compositions"]
                .as_array()
                .into_iter()
                .flatten()
                .find(|c| c["id"].as_str() == Some(id))
                .ok_or_else(|| {
                    OpError::new(
                        "notFound",
                        format!("コンポジション {id} が見つかりません。inspect（引数なし）で一覧を確かめてください。"),
                    )
                })?;
            return Ok(Output::ok(
                json!({ "revision": revision, "composition": c }),
            ));
        }
        if args.get("full").and_then(Value::as_bool) == Some(true) {
            return Ok(Output::ok(json!({ "revision": revision, "project": doc })));
        }
        let issues = check_doc(&doc).1;
        let comps: Vec<Value> = doc["compositions"]
            .as_array()
            .into_iter()
            .flatten()
            .map(|c| {
                json!({
                    "id": c["id"], "name": c["name"], "width": c["width"], "height": c["height"],
                    "fps": c["fps"], "durationFrames": c["durationFrames"],
                    "layers": c["layers"].as_array().into_iter().flatten().map(|l| json!({
                        "id": l["id"], "name": l["name"], "type": l["type"], "enabled": l["enabled"],
                        "inFrame": l["inFrame"], "outFrame": l["outFrame"],
                    })).collect::<Vec<_>>(),
                })
            })
            .collect();
        Ok(Output::ok(json!({
            "revision": revision,
            "name": doc["name"],
            "schemaVersion": doc["schemaVersion"],
            "mainCompositionId": doc["mainCompositionId"],
            "settings": doc["settings"],
            "assets": doc["assets"].as_array().into_iter().flatten().map(|a| json!({
                "id": a["id"], "kind": a["kind"], "name": a["name"]
            })).collect::<Vec<_>>(),
            "compositions": comps,
            "issueCount": issues.len(),
            "note": "レイヤーの並びは先頭が最前面。値の形はプロジェクトの正典 schema（mv-project.schema.json）のとおり。",
        })))
    }

    fn validate(&self, args: &Value) -> Result<Output, OpError> {
        let dir = self.project_dir(args)?;
        let (doc, revision) = read_doc(&dir)?;
        let issues = check_doc(&doc).1;
        Ok(Output::ok(json!({
            "revision": revision,
            "ok": issues.is_empty(),
            "issues": issues,
        })))
    }

    fn renderer(&mut self) -> Result<&mut Renderer, OpError> {
        if self.renderer.is_none() {
            let mut dirs: Vec<PathBuf> = std::env::var_os("STARIO_MV_FONTS")
                .map(PathBuf::from)
                .into_iter()
                .collect();
            dirs.extend(self.settings.font_dirs.iter().cloned());
            if dirs.is_empty() {
                return Err(OpError::new(
                    "settings",
                    format!(
                        "フォントの場所がわかりません。環境変数 STARIO_MV_FONTS か、設定（{}）の fontDirs にフォントのフォルダを書いてください。",
                        settings::config_dir().join(settings::SETTINGS_FILE).display()
                    ),
                ));
            }
            let refs: Vec<&Path> = dirs.iter().map(PathBuf::as_path).collect();
            let fonts = Fonts::load(&refs).map_err(|e| OpError::new("render", e.to_string()))?;
            let gpu = Gpu::new().map_err(|e| OpError::new("render", e.to_string()))?;
            self.renderer = Some(Renderer::new(gpu, fonts));
        }
        Ok(self.renderer.as_mut().expect("直前で用意した"))
    }

    fn render_png(
        &mut self,
        project: &Project,
        dir: &Path,
        comp_id: Option<&str>,
        frame: i64,
        max_size: u32,
    ) -> Result<(String, Png), OpError> {
        let comp_id = comp_id.unwrap_or(&project.main_composition_id).to_string();
        let comp = project
            .compositions
            .iter()
            .find(|c| c.id == comp_id)
            .ok_or_else(|| {
                OpError::new(
                    "notFound",
                    format!("コンポジション {comp_id} が見つかりません。inspect で ID を確かめてください。"),
                )
            })?;
        if frame >= i64::from(comp.duration_frames) {
            return Err(OpError::new(
                "invalidArguments",
                format!(
                    "コマ {frame} はコンポジションの長さ（{} コマ・0〜{}）の外です。",
                    comp.duration_frames,
                    comp.duration_frames.saturating_sub(1)
                ),
            ));
        }
        let f = self
            .renderer()?
            .render(project, &comp_id, frame, dir)
            .map_err(|e| OpError::new("render", e.to_string()))?;
        Ok((comp_id, encode_png(&f, max_size)?))
    }

    fn render_frame(&mut self, args: &Value) -> Result<Output, OpError> {
        let dir = self.project_dir(args)?;
        let loaded = mv_core::io::load_project(&dir).map_err(load_err)?;
        let frame = args["frame"].as_i64().unwrap_or(0);
        let max = max_size(args);
        let (comp_id, png) = self.render_png(
            &loaded.project,
            &dir,
            args.get("compositionId").and_then(Value::as_str),
            frame,
            max,
        )?;
        let mut out = json!({
            "compositionId": comp_id, "frame": frame, "width": png.width, "height": png.height,
        });
        if let Some(p) = args.get("out").and_then(Value::as_str) {
            let p = PathBuf::from(p);
            if !self
                .settings
                .is_allowed(&p, &[dir.join(mv_core::io::CACHE_DIR)])
            {
                return Err(not_allowed(&p));
            }
            write_file(&p, &png.bytes)?;
            out["savedTo"] = json!(p.display().to_string());
        }
        Ok(Output {
            json: out,
            image: Some(png),
            is_error: false,
        })
    }

    fn apply_transaction(&mut self, args: &Value) -> Result<Output, OpError> {
        let dir = self.project_dir(args)?;
        let dry = args.get("dryRun").and_then(Value::as_bool) == Some(true);
        // 試すだけなら書かない＝錠は要らない（返す版で、反映のときに衝突を見分けられる）
        let _lock = if dry { None } else { Some(Lock::take(&dir)?) };
        let (before, revision) = read_doc(&dir)?;
        if let Some(base) = args.get("baseRevision").and_then(Value::as_str) {
            if base != revision {
                return Err(OpError::new(
                    "conflict",
                    format!(
                        "動画が別の操作で変わっています（今の版 {revision}）。inspect で読み直してから、取引を作り直してください。"
                    ),
                ));
            }
        }
        let ops = args["ops"].as_array().cloned().unwrap_or_default();
        let mut after = before.clone();
        let created = tx::apply_ops(&mut after, &ops).map_err(|f| {
            let name = ops[f.index]["op"].as_str().unwrap_or("?").to_string();
            OpError::new(
                "opFailed",
                format!(
                    "{} 番目の操作（{name}）を当てられませんでした。何も変えていません：{}",
                    f.index, f.message
                ),
            )
        })?;
        if !dry {
            after["updatedAt"] = json!(now_rfc3339());
        }
        let (project, issues) = check_doc(&after);
        let created: Vec<Value> = created
            .iter()
            .map(|c| json!({ "opIndex": c.index, "kind": c.kind, "id": c.id }))
            .collect();
        let mut out = json!({
            "dryRun": dry,
            "applied": false,
            "revision": revision,
            "created": created,
            "changes": tx::diff(&before, &after),
            "issues": issues,
        });
        let ok = issues.is_empty();
        if !ok {
            out["message"] = json!(
                "検査に問題が残るので、何も変えていません。issues の path（JSON Pointer）の所を直した取引を送り直してください。"
            );
        }
        let project = project.filter(|_| ok);
        if let (Some(p), false) = (&project, dry) {
            mv_core::io::save_project(&dir, p)
                .map_err(|e| OpError::new("io", format!("保存できませんでした（{e}）。")))?;
            out["applied"] = json!(true);
            out["revision"] = json!(read_doc(&dir)?.1);
        }
        let mut image = None;
        if let (Some(r), Some(p)) = (args.get("render"), &project) {
            let (comp_id, png) = self.render_png(
                p,
                &dir,
                r.get("compositionId").and_then(Value::as_str),
                r["frame"].as_i64().unwrap_or(0),
                max_size(r),
            )?;
            out["frame"] = json!({ "compositionId": comp_id, "frame": r["frame"], "width": png.width, "height": png.height });
            image = Some(png);
        }
        Ok(Output {
            json: out,
            image,
            is_error: !ok && !dry,
        })
    }

    fn create_project(&mut self, args: &Value) -> Result<Output, OpError> {
        let dir = PathBuf::from(args["dir"].as_str().unwrap_or_default());
        if !self.settings.is_allowed(&dir, &[]) {
            return Err(not_allowed(&dir));
        }
        if dir.exists()
            && fs::read_dir(&dir)
                .map(|mut d| d.next().is_some())
                .unwrap_or(true)
        {
            return Err(OpError::new(
                "invalidArguments",
                format!(
                    "{} は空ではありません。無いフォルダか、空のフォルダを指定してください。",
                    dir.display()
                ),
            ));
        }
        let now = now_rfc3339();
        let comp_id = mv_core::id::new_id(mv_core::id::IdKind::Composition);
        let doc = json!({
            "format": FORMAT,
            "schemaVersion": SCHEMA_VERSION,
            "id": mv_core::id::new_id(mv_core::id::IdKind::Project),
            "name": args["name"],
            "createdAt": now, "updatedAt": now,
            "settings": { "workingColorSpace": args.get("workingColorSpace").cloned().unwrap_or(json!("linear")) },
            "assets": [],
            "compositions": [{
                "id": comp_id, "name": "本編",
                "width": args["width"], "height": args["height"], "fps": args["fps"],
                "durationFrames": args["durationFrames"],
                "background": args.get("background").cloned().unwrap_or(json!([0, 0, 0, 1])),
                "layers": [], "markers": [],
            }],
            "mainCompositionId": comp_id,
        });
        let (project, issues) = check_doc(&doc);
        let Some(project) = project.filter(|_| issues.is_empty()) else {
            return Err(OpError::new(
                "invalidArguments",
                format!("その値では動画を作れません：{}", json!(issues)),
            ));
        };
        mv_core::io::save_project(&dir, &project)
            .map_err(|e| OpError::new("io", format!("保存できませんでした（{e}）。")))?;
        Ok(Output::ok(json!({
            "project": dir.display().to_string(),
            "revision": read_doc(&dir)?.1,
            "mainCompositionId": comp_id,
        })))
    }

    fn export_video(&mut self, args: &Value) -> Result<Output, OpError> {
        let dir = self.project_dir(args)?;
        let out = PathBuf::from(args["out"].as_str().unwrap_or_default());
        if !self.settings.is_allowed(&out, &[]) {
            return Err(not_allowed(&out));
        }
        let loaded = mv_core::io::load_project(&dir).map_err(load_err)?;
        let ffmpeg = mv_export::locate_ffmpeg(self.settings.ffmpeg.as_deref(), &[])
            .map_err(|e| OpError::new("export", e.to_string()))?;
        let opts = mv_export::ExportOptions {
            ffmpeg,
            out,
            composition_id: args
                .get("compositionId")
                .and_then(Value::as_str)
                .map(String::from),
            encoder: None,
        };
        let cancel = std::sync::atomic::AtomicBool::new(false);
        let renderer = self.renderer()?;
        let r = mv_export::export(renderer, &loaded.project, &dir, &opts, |_, _| {}, &cancel)
            .map_err(|e| OpError::new("export", e.to_string()))?;
        Ok(Output::ok(json!({
            "out": r.out.display().to_string(),
            "frames": r.frames,
            "encoder": r.encoder,
            "audioLayers": r.audio_layers,
        })))
    }
}

fn new_ids(args: &Value) -> Result<Output, OpError> {
    use mv_core::id::{new_id, IdKind};
    let kind = match args["kind"].as_str() {
        Some("layer") => IdKind::Layer,
        Some("composition") => IdKind::Composition,
        _ => IdKind::Marker,
    };
    let n = args.get("count").and_then(Value::as_u64).unwrap_or(1);
    let ids: Vec<String> = (0..n).map(|_| new_id(kind)).collect();
    Ok(Output::ok(json!({ "ids": ids })))
}

/// 動画のフォルダから JSON と版（中身の SHA-256）を読む。
pub fn read_doc(dir: &Path) -> Result<(Value, String), OpError> {
    let p = dir.join(PROJECT_FILE);
    let bytes = fs::read(&p).map_err(|e| {
        OpError::new(
            "load",
            format!(
                "{} を読めませんでした（{e}）。project に動画のフォルダ（project.json のある所）を渡してください。",
                p.display()
            ),
        )
    })?;
    let doc: Value = serde_json::from_slice(&bytes).map_err(|e| {
        OpError::new(
            "load",
            format!("project.json が JSON として壊れています（{e}）。"),
        )
    })?;
    if doc.get("format").and_then(Value::as_str) != Some(FORMAT) {
        return Err(OpError::new(
            "load",
            format!("すたりおMV の動画ではありません（format が {FORMAT} ではない）。"),
        ));
    }
    Ok((doc, revision_of(&bytes)))
}

/// 版＝中身の SHA-256（16進）。
pub fn revision_of(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// 形（1段目）と中身（2段目）を検査する。形が通れば型へ入れた動画も返す。
pub fn check_doc(doc: &Value) -> (Option<Project>, Vec<Value>) {
    let schema = check_schema(doc);
    if !schema.is_empty() {
        let v = schema
            .into_iter()
            .map(|i| json!({ "stage": "schema", "code": "schema", "path": i.path, "message": i.message }))
            .collect();
        return (None, v);
    }
    match serde_json::from_value::<Project>(doc.clone()) {
        Ok(p) => {
            let v = validate(&p).iter().map(issue_json).collect();
            (Some(p), v)
        }
        Err(e) => (
            None,
            vec![
                json!({ "stage": "schema", "code": "schema", "path": "", "message": format!("正典の形は通ったが芯の型へ入らない（すたりおMV の不具合）: {e}") }),
            ],
        ),
    }
}

fn issue_json(i: &Issue) -> Value {
    json!({ "stage": "content", "code": format!("{:?}", i.code), "path": i.path, "message": i.message })
}

fn load_err(e: mv_core::io::LoadError) -> OpError {
    OpError::new("load", e.to_string())
}

fn not_allowed(p: &Path) -> OpError {
    OpError::new(
        "notAllowed",
        format!(
            "{} は利用者が許したフォルダの外です。許したフォルダの中を指定するか、利用者に `stario-mv-ai allow <フォルダ>` で許してもらってください。",
            p.display()
        ),
    )
}

fn max_size(args: &Value) -> u32 {
    args.get("maxSize")
        .and_then(Value::as_u64)
        .map(|v| v.min(u64::from(u32::MAX)) as u32)
        .unwrap_or(DEFAULT_MAX_SIZE)
}

/// 描いたコマを PNG にする（長辺が `max_size` を超えれば縮める・0 なら縮めない）。
pub fn encode_png(f: &Frame, max_size: u32) -> Result<Png, OpError> {
    let img = image::RgbaImage::from_raw(f.width, f.height, f.data.clone()).ok_or_else(|| {
        OpError::new(
            "render",
            "描いたコマの大きさが合いません（すたりおMV の不具合）。",
        )
    })?;
    let long = f.width.max(f.height);
    let img = if max_size > 0 && long > max_size {
        let s = f64::from(max_size) / f64::from(long);
        let w = ((f64::from(f.width) * s).round() as u32).max(1);
        let h = ((f64::from(f.height) * s).round() as u32).max(1);
        image::imageops::resize(&img, w, h, image::imageops::FilterType::Triangle)
    } else {
        img
    };
    let mut bytes = Vec::new();
    img.write_to(
        &mut std::io::Cursor::new(&mut bytes),
        image::ImageFormat::Png,
    )
    .map_err(|e| OpError::new("render", format!("PNG にできませんでした（{e}）。")))?;
    Ok(Png {
        bytes,
        width: img.width(),
        height: img.height(),
    })
}

fn write_file(p: &Path, bytes: &[u8]) -> Result<(), OpError> {
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| OpError::new("io", format!("フォルダを作れませんでした（{e}）。")))?;
    }
    fs::write(p, bytes)
        .map_err(|e| OpError::new("io", format!("{} に書けませんでした（{e}）。", p.display())))
}

/// 反映中の錠（同時に2つの書き込みが走らないように＝待たずに断る）。
struct Lock(PathBuf);

impl Lock {
    fn take(dir: &Path) -> Result<Self, OpError> {
        let p = dir.join(LOCK_FILE);
        for _ in 0..2 {
            match fs::OpenOptions::new().write(true).create_new(true).open(&p) {
                Ok(_) => return Ok(Self(p)),
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                    let stale = fs::metadata(&p)
                        .and_then(|m| m.modified())
                        .ok()
                        .and_then(|t| SystemTime::now().duration_since(t).ok())
                        .is_some_and(|age| age > STALE_LOCK);
                    if !stale {
                        break;
                    }
                    let _ = fs::remove_file(&p);
                }
                Err(e) => {
                    return Err(OpError::new(
                        "io",
                        format!("錠のファイルを作れませんでした（{e}）。"),
                    ))
                }
            }
        }
        Err(OpError::new(
            "locked",
            "ほかの操作がこの動画に反映している途中です。少し待ってから inspect で読み直し、送り直してください。",
        ))
    }
}

impl Drop for Lock {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}

/// 今の時刻（UTC・RFC 3339・秒まで）。
pub fn now_rfc3339() -> String {
    let secs = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    rfc3339(secs)
}

/// UNIX 時刻（秒）→ RFC 3339（UTC）。日付は Howard Hinnant の civil_from_days。
pub fn rfc3339(secs: i64) -> String {
    let days = secs.div_euclid(86_400);
    let rem = secs.rem_euclid(86_400);
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + i64::from(m <= 2);
    format!(
        "{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}Z",
        rem / 3600,
        rem % 3600 / 60,
        rem % 60
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 時刻の書き方() {
        assert_eq!(rfc3339(0), "1970-01-01T00:00:00Z");
        assert_eq!(rfc3339(951_782_400), "2000-02-29T00:00:00Z");
        assert_eq!(rfc3339(1_795_737_599), "2026-11-26T23:59:59Z");
    }
}
