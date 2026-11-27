//! 2段目の検査＝中身（MV-0001 決定7・決定8）。
//!
//! 1段目（JSON Schema）で形は確かめてある前提。ここでは schema で表せないことを見る：
//! ID の重複／参照先の実在／循環／時間の前後／キーフレームの順／値の次元／
//! そして **この版ではまだ動かない機能**（入れ物はあるが描けない＝黙って無視しない）。

use crate::model::*;
use std::collections::{HashMap, HashSet};

/// この芯が描ける版（まだ使えない機能の知らせに出す）。
pub const SUPPORTED_RELEASE: &str = "γ0.1";

/// 見つかった問題の種類。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IssueCode {
    DuplicateId,
    MissingReference,
    WrongReferenceKind,
    SelfReference,
    ParentCycle,
    CompositionCycle,
    EmptyTimeRange,
    KeyframeOrder,
    ValueDimension,
    PathShape,
    /// 入れ物はあるが、この版ではまだ描けない（MV-0001 決定8）。
    NotYetSupported,
}

/// 見つかった問題1つ。`path` は JSON Pointer（どこを直せばよいか）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Issue {
    pub code: IssueCode,
    pub path: String,
    pub message: String,
}

/// まだ使えない機能と、使えるようになる版（ADR-0074 決定6 の表から）。⚠️ **1か所に置く**。
const NOT_YET: &[(&str, &str)] = &[
    ("タイムリマップ", "γ0.2"),
    ("2.5D（奥行き・カメラ）", "γ0.2"),
    ("つなぎ", "γ0.3"),
    ("音量のキーフレーム", "γ0.3"),
    ("縦書き", "γ0.4"),
    ("文字の縁取り", "γ0.4"),
    ("字の間", "γ0.4"),
    ("エフェクト", "γ0.5"),
    ("調整レイヤー", "γ0.5"),
    ("マスク", "γ0.6"),
    ("トラックマット", "γ0.6"),
    ("式", "γ0.7"),
];

fn not_yet(feature: &str) -> String {
    let since = NOT_YET
        .iter()
        .find(|(f, _)| *f == feature)
        .map(|(_, v)| *v)
        .unwrap_or("後の版");
    format!("「{feature}」はこの版（{SUPPORTED_RELEASE}）ではまだ描けません（{since} から）。外してから書き出してください。")
}

/// プロジェクトの中身を検査する。問題が無ければ空。
pub fn validate(project: &Project) -> Vec<Issue> {
    let mut v = Checker::default();
    v.check(project);
    v.issues
}

#[derive(Default)]
struct Checker {
    issues: Vec<Issue>,
}

impl Checker {
    fn push(&mut self, code: IssueCode, path: String, message: impl Into<String>) {
        self.issues.push(Issue {
            code,
            path,
            message: message.into(),
        });
    }

    fn check(&mut self, p: &Project) {
        self.check_unique_ids(p);

        let assets: HashMap<&str, &Asset> = p.assets.iter().map(|a| (a.id.as_str(), a)).collect();
        let comps: HashMap<&str, usize> = p
            .compositions
            .iter()
            .enumerate()
            .map(|(i, c)| (c.id.as_str(), i))
            .collect();

        if !comps.contains_key(p.main_composition_id.as_str()) {
            self.push(
                IssueCode::MissingReference,
                "/mainCompositionId".into(),
                format!(
                    "書き出しの既定のコンポジション（{}）が見つかりません。",
                    p.main_composition_id
                ),
            );
        }

        for (ci, comp) in p.compositions.iter().enumerate() {
            let cpath = format!("/compositions/{ci}");
            self.check_markers(
                &comp.markers,
                &format!("{cpath}/markers"),
                comp.duration_frames,
            );
            let layer_ids: HashMap<&str, usize> = comp
                .layers
                .iter()
                .enumerate()
                .map(|(i, l)| (l.id.as_str(), i))
                .collect();
            for (li, layer) in comp.layers.iter().enumerate() {
                let lpath = format!("{cpath}/layers/{li}");
                self.check_layer(layer, &lpath, comp, &layer_ids, &assets, &comps);
            }
            self.check_parent_cycles(comp, &cpath);
        }
        self.check_composition_cycles(p);
    }

    fn check_unique_ids(&mut self, p: &Project) {
        let mut all: Vec<(&str, String)> = vec![(p.id.as_str(), "/id".into())];
        for (i, a) in p.assets.iter().enumerate() {
            all.push((&a.id, format!("/assets/{i}/id")));
        }
        for (ci, c) in p.compositions.iter().enumerate() {
            all.push((&c.id, format!("/compositions/{ci}/id")));
            for (mi, m) in c.markers.iter().enumerate() {
                all.push((&m.id, format!("/compositions/{ci}/markers/{mi}/id")));
            }
            for (li, l) in c.layers.iter().enumerate() {
                let lp = format!("/compositions/{ci}/layers/{li}");
                all.push((&l.id, format!("{lp}/id")));
                for (i, x) in l.effects.iter().enumerate() {
                    all.push((&x.id, format!("{lp}/effects/{i}/id")));
                }
                for (i, x) in l.masks.iter().enumerate() {
                    all.push((&x.id, format!("{lp}/masks/{i}/id")));
                }
                for (i, x) in l.markers.iter().enumerate() {
                    all.push((&x.id, format!("{lp}/markers/{i}/id")));
                }
            }
        }
        let mut first: HashMap<&str, String> = HashMap::new();
        for (id, path) in all {
            match first.get(id) {
                Some(at) => {
                    let msg = format!(
                        "ID {id} が {at} と重なっています。どちらかを新しい ID にしてください。"
                    );
                    self.push(IssueCode::DuplicateId, path, msg);
                }
                None => {
                    first.insert(id, path);
                }
            }
        }
    }

    fn check_markers(&mut self, markers: &[Marker], path: &str, _duration: u32) {
        for (i, m) in markers.iter().enumerate() {
            if m.frame < 0 {
                self.push(
                    IssueCode::EmptyTimeRange,
                    format!("{path}/{i}/frame"),
                    "マーカーのフレームが 0 より前です。",
                );
            }
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn check_layer(
        &mut self,
        l: &Layer,
        lpath: &str,
        comp: &Composition,
        layer_ids: &HashMap<&str, usize>,
        assets: &HashMap<&str, &Asset>,
        comps: &HashMap<&str, usize>,
    ) {
        if l.in_frame >= l.out_frame {
            self.push(IssueCode::EmptyTimeRange, format!("{lpath}/outFrame"), format!("「{}」の見える範囲が空です（inFrame {} ≥ outFrame {}）。outFrame を inFrame より後ろにしてください。", l.name, l.in_frame, l.out_frame));
        }

        // 参照
        if let Some(pid) = &l.parent_id {
            if pid == &l.id {
                self.push(
                    IssueCode::SelfReference,
                    format!("{lpath}/parentId"),
                    "自分自身を親にしています。",
                );
            } else if !layer_ids.contains_key(pid.as_str()) {
                self.push(
                    IssueCode::MissingReference,
                    format!("{lpath}/parentId"),
                    format!("親のレイヤー（{pid}）が同じコンポジションに見つかりません。"),
                );
            }
        }
        if let Some(tm) = &l.track_matte {
            if tm.layer_id == l.id {
                self.push(
                    IssueCode::SelfReference,
                    format!("{lpath}/trackMatte/layerId"),
                    "自分自身をトラックマットにしています。",
                );
            } else if !layer_ids.contains_key(tm.layer_id.as_str()) {
                self.push(
                    IssueCode::MissingReference,
                    format!("{lpath}/trackMatte/layerId"),
                    format!(
                        "トラックマットのレイヤー（{}）が同じコンポジションに見つかりません。",
                        tm.layer_id
                    ),
                );
            }
            self.push(
                IssueCode::NotYetSupported,
                format!("{lpath}/trackMatte"),
                not_yet("トラックマット"),
            );
        }
        if let Some(aid) = &l.asset_id {
            match assets.get(aid.as_str()) {
                None => self.push(IssueCode::MissingReference, format!("{lpath}/assetId"), format!("素材（{aid}）が見つかりません。素材を取り込み直すか、別の素材を選んでください。")),
                Some(a) => {
                    let ok = match l.layer_type {
                        LayerType::Video => matches!(a.kind, AssetKind::Video | AssetKind::ImageSequence),
                        LayerType::Image => matches!(a.kind, AssetKind::Image | AssetKind::Svg),
                        LayerType::Audio => matches!(a.kind, AssetKind::Audio | AssetKind::Video),
                        _ => true,
                    };
                    if !ok {
                        self.push(IssueCode::WrongReferenceKind, format!("{lpath}/assetId"), format!("「{}」の種類に合わない素材（{:?}）を指しています。", l.name, a.kind));
                    }
                }
            }
        }
        if let Some(cid) = &l.composition_id {
            if cid == &comp.id {
                self.push(
                    IssueCode::SelfReference,
                    format!("{lpath}/compositionId"),
                    "コンポジションが自分自身を入れ子にしています。",
                );
            } else if !comps.contains_key(cid.as_str()) {
                self.push(
                    IssueCode::MissingReference,
                    format!("{lpath}/compositionId"),
                    format!("入れ子のコンポジション（{cid}）が見つかりません。"),
                );
            }
        }

        // まだ描けない種類・機能
        match l.layer_type {
            LayerType::Camera => self.push(
                IssueCode::NotYetSupported,
                format!("{lpath}/type"),
                not_yet("2.5D（奥行き・カメラ）"),
            ),
            LayerType::Adjustment => self.push(
                IssueCode::NotYetSupported,
                format!("{lpath}/type"),
                not_yet("調整レイヤー"),
            ),
            _ => {}
        }
        let three_d = l.three_d == Some(true);
        if three_d || l.transform.rotation_x.is_some() || l.transform.rotation_y.is_some() {
            self.push(
                IssueCode::NotYetSupported,
                format!("{lpath}/threeD"),
                not_yet("2.5D（奥行き・カメラ）"),
            );
        }
        if l.time_remap.is_some() {
            self.push(
                IssueCode::NotYetSupported,
                format!("{lpath}/timeRemap"),
                not_yet("タイムリマップ"),
            );
        }
        if !l.effects.is_empty() {
            self.push(
                IssueCode::NotYetSupported,
                format!("{lpath}/effects"),
                not_yet("エフェクト"),
            );
        }
        if !l.masks.is_empty() {
            self.push(
                IssueCode::NotYetSupported,
                format!("{lpath}/masks"),
                not_yet("マスク"),
            );
        }
        if let Some(t) = &l.text {
            if t.vertical == Some(true) {
                self.push(
                    IssueCode::NotYetSupported,
                    format!("{lpath}/text/vertical"),
                    not_yet("縦書き"),
                );
            }
            // ⚠️ 描画の核はまだ描けない＝黙って無視しないために知らせる（MV-0003 決定5）
            if t.stroke.is_some() {
                self.push(
                    IssueCode::NotYetSupported,
                    format!("{lpath}/text/stroke"),
                    not_yet("文字の縁取り"),
                );
            }
            if t.letter_spacing.is_some_and(|s| s != 0.0) {
                self.push(
                    IssueCode::NotYetSupported,
                    format!("{lpath}/text/letterSpacing"),
                    not_yet("字の間"),
                );
            }
        }

        // 値の形
        let t = &l.transform;
        let tp = format!("{lpath}/transform");
        self.check_anim(&t.anchor, &format!("{tp}/anchor"), &[2]);
        self.check_anim(
            &t.position,
            &format!("{tp}/position"),
            if three_d { &[3] } else { &[2] },
        );
        self.check_anim(&t.scale, &format!("{tp}/scale"), &[2]);
        self.check_anim(&t.rotation, &format!("{tp}/rotation"), &[1]);
        self.check_anim(&t.opacity, &format!("{tp}/opacity"), &[1]);
        if let Some(a) = &t.rotation_x {
            self.check_anim(a, &format!("{tp}/rotationX"), &[1]);
        }
        if let Some(a) = &t.rotation_y {
            self.check_anim(a, &format!("{tp}/rotationY"), &[1]);
        }
        if let Some(a) = &l.time_remap {
            self.check_anim(a, &format!("{lpath}/timeRemap"), &[1]);
        }
        if let Some(a) = &l.audio {
            self.check_anim(&a.volume_db, &format!("{lpath}/audio/volumeDb"), &[1]);
            // ⚠️ 書き出しは音量を1つの値で混ぜる＝キーフレームは黙って無視せず知らせる
            if a.volume_db.keyframes.is_some() {
                self.push(
                    IssueCode::NotYetSupported,
                    format!("{lpath}/audio/volumeDb"),
                    not_yet("音量のキーフレーム"),
                );
            }
        }
        if let Some(c) = &l.camera {
            self.check_anim(&c.zoom, &format!("{lpath}/camera/zoom"), &[1]);
        }
        if let Some(s) = &l.shape {
            if let Some(a) = &s.size {
                self.check_anim(a, &format!("{lpath}/shape/size"), &[2]);
            }
            if let Some(a) = &s.corner_radius {
                self.check_anim(a, &format!("{lpath}/shape/cornerRadius"), &[1]);
            }
            if let Some(path) = &s.path {
                self.check_path(path, &format!("{lpath}/shape/path"));
            }
            if s.kind != ShapeKind::Path && s.size.is_none() {
                self.push(
                    IssueCode::ValueDimension,
                    format!("{lpath}/shape/size"),
                    "四角・楕円には大きさ（size）が要ります。",
                );
            }
            if s.kind == ShapeKind::Path && s.path.is_none() {
                self.push(
                    IssueCode::PathShape,
                    format!("{lpath}/shape/path"),
                    "自由な形には形（path）が要ります。",
                );
            }
        }
        for (i, m) in l.masks.iter().enumerate() {
            let mp = format!("{lpath}/masks/{i}");
            self.check_anim(&m.feather, &format!("{mp}/feather"), &[1]);
            self.check_anim(&m.opacity, &format!("{mp}/opacity"), &[1]);
            self.check_anim(&m.expansion, &format!("{mp}/expansion"), &[1]);
            if let Some(v) = &m.path.value {
                self.check_path(v, &format!("{mp}/path/value"));
            }
            if let Some(ks) = &m.path.keyframes {
                for (k, kf) in ks.iter().enumerate() {
                    self.check_path(&kf.value, &format!("{mp}/path/keyframes/{k}/value"));
                }
                self.check_frames_ascending(
                    ks.iter().map(|k| k.frame),
                    &format!("{mp}/path/keyframes"),
                );
            }
        }
        self.check_markers(
            &l.markers,
            &format!("{lpath}/markers"),
            comp.duration_frames,
        );
    }

    /// 動かせる値の形を見る（次元・キーフレームの順・まだ使えない式とつなぎ）。
    fn check_anim(&mut self, a: &Animatable, path: &str, dims: &[usize]) {
        if a.expression.is_some() {
            self.push(
                IssueCode::NotYetSupported,
                format!("{path}/expression"),
                not_yet("式"),
            );
        }
        if a.links.as_ref().is_some_and(|l| !l.is_empty()) {
            self.push(
                IssueCode::NotYetSupported,
                format!("{path}/links"),
                not_yet("つなぎ"),
            );
        }
        let want = || {
            dims.iter()
                .map(|d| d.to_string())
                .collect::<Vec<_>>()
                .join("か")
        };
        if let Some(v) = &a.value {
            if !dims.contains(&v.dims()) {
                self.push(
                    IssueCode::ValueDimension,
                    format!("{path}/value"),
                    format!(
                        "値の数が合いません（{} 個・必要なのは {} 個）。",
                        v.dims(),
                        want()
                    ),
                );
            }
        }
        if let Some(ks) = &a.keyframes {
            for (i, k) in ks.iter().enumerate() {
                if !dims.contains(&k.value.dims()) {
                    self.push(
                        IssueCode::ValueDimension,
                        format!("{path}/keyframes/{i}/value"),
                        format!(
                            "値の数が合いません（{} 個・必要なのは {} 個）。",
                            k.value.dims(),
                            want()
                        ),
                    );
                }
                for (name, h) in [("spatialIn", &k.spatial_in), ("spatialOut", &k.spatial_out)] {
                    if let Some(h) = h {
                        if h.len() != k.value.dims() {
                            self.push(
                                IssueCode::ValueDimension,
                                format!("{path}/keyframes/{i}/{name}"),
                                "動きの道筋のハンドルの数が、値の数と合いません。",
                            );
                        }
                    }
                }
            }
            self.check_frames_ascending(ks.iter().map(|k| k.frame), &format!("{path}/keyframes"));
        }
    }

    fn check_frames_ascending(&mut self, frames: impl Iterator<Item = i64>, path: &str) {
        let mut prev: Option<i64> = None;
        for (i, f) in frames.enumerate() {
            if let Some(p) = prev {
                if f <= p {
                    self.push(IssueCode::KeyframeOrder, format!("{path}/{i}/frame"), format!("キーフレームのフレームが前のキー（{p}）と重なっているか、前に戻っています。フレームの順に並べてください。"));
                }
            }
            prev = Some(f);
        }
    }

    fn check_path(&mut self, path: &Path, at: &str) {
        let n = path.vertices.len();
        if path.in_tangents.len() != n || path.out_tangents.len() != n {
            self.push(
                IssueCode::PathShape,
                at.to_string(),
                format!(
                    "形の頂点（{n} 個）と、入る・出るハンドルの数（{}・{}）が合いません。",
                    path.in_tangents.len(),
                    path.out_tangents.len()
                ),
            );
        }
    }

    fn check_parent_cycles(&mut self, comp: &Composition, cpath: &str) {
        let parent: HashMap<&str, &str> = comp
            .layers
            .iter()
            .filter_map(|l| l.parent_id.as_deref().map(|p| (l.id.as_str(), p)))
            .collect();
        for (li, l) in comp.layers.iter().enumerate() {
            let mut seen = HashSet::new();
            let mut cur = l.id.as_str();
            seen.insert(cur);
            while let Some(&p) = parent.get(cur) {
                if p == l.id {
                    self.push(
                        IssueCode::ParentCycle,
                        format!("{cpath}/layers/{li}/parentId"),
                        format!(
                            "「{}」の親をたどると自分に戻ります（親子が循環しています）。",
                            l.name
                        ),
                    );
                    break;
                }
                if !seen.insert(p) {
                    break; // 自分を含まない輪（その輪の中のレイヤー自身で知らせる）
                }
                cur = p;
            }
        }
    }

    fn check_composition_cycles(&mut self, p: &Project) {
        let edges: HashMap<&str, Vec<&str>> = p
            .compositions
            .iter()
            .map(|c| {
                (
                    c.id.as_str(),
                    c.layers
                        .iter()
                        .filter_map(|l| l.composition_id.as_deref())
                        .collect(),
                )
            })
            .collect();
        for (ci, c) in p.compositions.iter().enumerate() {
            // c から出発して c に戻れるか
            let mut stack: Vec<&str> = edges.get(c.id.as_str()).cloned().unwrap_or_default();
            let mut seen: HashSet<&str> = HashSet::new();
            while let Some(n) = stack.pop() {
                if n == c.id {
                    if !edges[c.id.as_str()].contains(&c.id.as_str()) {
                        self.push(
                            IssueCode::CompositionCycle,
                            format!("/compositions/{ci}"),
                            format!(
                                "コンポジション「{}」の入れ子をたどると自分に戻ります。",
                                c.name
                            ),
                        );
                    }
                    break;
                }
                if seen.insert(n) {
                    if let Some(next) = edges.get(n) {
                        stack.extend(next.iter().copied());
                    }
                }
            }
        }
    }
}
