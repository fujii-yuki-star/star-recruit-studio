//! プロジェクトの形（MV-0001・schema 0.1.0）を Rust の型にしたもの。
//!
//! ⚠️ **正典は JSON Schema**（`docs/stario_mv_docs/schemas/mv-project.schema.json`）。この型はその写し。
//! 読むときは先に schema で形を確かめてから（[`crate::io`]）この型へ入れる＝ここで形を二重に決めない。
//! それでも `deny_unknown_fields` を付けて、schema を通らない物がここで黙って捨てられないようにしている。

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// この形式であることの目印。
pub const FORMAT: &str = "stario-mv-project";
/// この型が対応する schema の版。
pub const SCHEMA_VERSION: &str = "0.1.0";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Project {
    pub format: String,
    pub schema_version: String,
    pub id: String,
    pub name: String,
    pub created_at: String,
    pub updated_at: String,
    pub settings: ProjectSettings,
    pub assets: Vec<Asset>,
    pub compositions: Vec<Composition>,
    pub main_composition_id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProjectSettings {
    pub working_color_space: WorkingColorSpace,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum WorkingColorSpace {
    Srgb,
    Linear,
}

/// 分数（fps など）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Rational {
    pub num: u32,
    pub den: u32,
}

/// 色＝[赤, 緑, 青, 不透明度]（sRGB・0〜1）。
pub type Color = [f64; 4];

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Asset {
    pub id: String,
    pub kind: AssetKind,
    pub name: String,
    pub source: AssetSource,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sha256: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub meta: Option<AssetMeta>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AssetKind {
    Video,
    Image,
    ImageSequence,
    Svg,
    Audio,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "mode",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum AssetSource {
    /// プロジェクトのフォルダへコピーした（`assets/` からの相対）。
    Copied { path: String },
    /// コピーせずに元の場所を指す。
    Referenced { absolute_path: String },
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AssetMeta {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub width: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub height: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fps: Option<Rational>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duration_sec: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub frame_count: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub has_alpha: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub has_audio: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sample_rate: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub channels: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Composition {
    pub id: String,
    pub name: String,
    pub width: u32,
    pub height: u32,
    pub fps: Rational,
    pub duration_frames: u32,
    pub background: Color,
    /// ⚠️ **先頭が最前面**（MV-0001 決定6）。
    pub layers: Vec<Layer>,
    pub markers: Vec<Marker>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Marker {
    pub id: String,
    pub frame: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duration_frames: Option<u32>,
    pub kind: MarkerKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<Color>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MarkerKind {
    Beat,
    Bar,
    Section,
    Free,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LayerType {
    Video,
    Image,
    Text,
    Shape,
    Solid,
    Adjustment,
    Null,
    Camera,
    Audio,
    Precomp,
}

/// レイヤー（種類ごとの中身は、その種類のときだけ持つ＝schema の allOf で検査済み）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Layer {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub layer_type: LayerType,
    pub enabled: bool,
    pub locked: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub solo: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    pub in_frame: i64,
    pub out_frame: i64,
    pub start_frame: i64,
    pub parent_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub three_d: Option<bool>,
    pub transform: Transform,
    pub blend_mode: BlendMode,
    pub track_matte: Option<TrackMatte>,
    pub masks: Vec<Mask>,
    pub effects: Vec<Effect>,
    pub markers: Vec<Marker>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub asset_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub composition_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub time_remap: Option<Animatable>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub audio: Option<LayerAudio>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<TextDocument>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shape: Option<ShapeContent>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub solid: Option<SolidContent>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub camera: Option<CameraContent>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TrackMatte {
    pub layer_id: String,
    pub mode: TrackMatteMode,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TrackMatteMode {
    Alpha,
    AlphaInverted,
    Luma,
    LumaInverted,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LayerAudio {
    pub volume_db: Animatable,
    pub muted: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SolidContent {
    pub color: Color,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CameraContent {
    pub zoom: Animatable,
}

/// 変形（単位はピクセル・倍率・度・0〜1＝MV-0001 決定4）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Transform {
    pub anchor: Animatable,
    pub position: Animatable,
    pub scale: Animatable,
    pub rotation: Animatable,
    pub opacity: Animatable,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rotation_x: Option<Animatable>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rotation_y: Option<Animatable>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum BlendMode {
    Normal,
    Add,
    Multiply,
    Screen,
    Overlay,
    SoftLight,
    HardLight,
    ColorDodge,
    ColorBurn,
    Darken,
    Lighten,
    Difference,
    Exclusion,
    Hue,
    Saturation,
    Color,
    Luminosity,
}

/// どの数値も同じ形（MV-0001 決定4）＝固定値・キーフレーム・式のどれか1つ＋つなぎ。
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Animatable {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub value: Option<AnimValue>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub keyframes: Option<Vec<Keyframe>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expression: Option<Expression>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub links: Option<Vec<Link>>,
}

impl Animatable {
    /// 固定値の数値。
    pub fn number(v: f64) -> Self {
        Self {
            value: Some(AnimValue::Number(v)),
            ..Self::default()
        }
    }
    /// 固定値の並び（位置・大きさなど）。
    pub fn vector(v: &[f64]) -> Self {
        Self {
            value: Some(AnimValue::Vector(v.to_vec())),
            ..Self::default()
        }
    }
}

/// 数値か、数値の並び。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum AnimValue {
    Number(f64),
    Vector(Vec<f64>),
}

impl AnimValue {
    /// 次元（数値は 1）。
    pub fn dims(&self) -> usize {
        match self {
            AnimValue::Number(_) => 1,
            AnimValue::Vector(v) => v.len(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Keyframe {
    pub frame: i64,
    pub value: AnimValue,
    pub interpolation: Interpolation,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ease_out: Option<[f64; 2]>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ease_in: Option<[f64; 2]>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub spatial_out: Option<Vec<f64>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub spatial_in: Option<Vec<f64>>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Interpolation {
    Hold,
    Linear,
    Bezier,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Expression {
    pub language: String,
    pub source: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Link {
    pub kind: LinkKind,
    pub amount: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LinkKind {
    Audio,
    Beat,
    Property,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Mask {
    pub id: String,
    pub mode: MaskMode,
    pub path: MaskPath,
    pub feather: Animatable,
    pub opacity: Animatable,
    pub expansion: Animatable,
    pub inverted: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MaskMode {
    Add,
    Subtract,
    Intersect,
    Difference,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MaskPath {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub value: Option<Path>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub keyframes: Option<Vec<PathKeyframe>>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PathKeyframe {
    pub frame: i64,
    pub value: Path,
    pub interpolation: Interpolation,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ease_out: Option<[f64; 2]>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ease_in: Option<[f64; 2]>,
}

/// ベジェの形。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Path {
    pub closed: bool,
    pub vertices: Vec<[f64; 2]>,
    pub in_tangents: Vec<[f64; 2]>,
    pub out_tangents: Vec<[f64; 2]>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Effect {
    pub id: String,
    #[serde(rename = "type")]
    pub effect_type: String,
    pub version: u32,
    pub enabled: bool,
    /// 中身は種類ごとの定義で検査する（2段目・γ0.5 から）。
    pub params: BTreeMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Stroke {
    pub color: Color,
    pub width: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TextDocument {
    pub text: String,
    pub font_family: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub font_style: Option<String>,
    pub font_size: f64,
    pub fill: Color,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stroke: Option<Stroke>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub align: Option<TextAlign>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub line_height: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub letter_spacing: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub vertical: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub box_width: Option<f64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TextAlign {
    Left,
    Center,
    Right,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ShapeContent {
    pub kind: ShapeKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size: Option<Animatable>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub corner_radius: Option<Animatable>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<Path>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fill: Option<Color>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stroke: Option<Stroke>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ShapeKind {
    Rectangle,
    Ellipse,
    Path,
}
