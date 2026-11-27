//! 芯の読み書きと2段目の検査（MV-0001 決定7・決定8）。
//! ⚠️ 正しい見本（γ の資料の minimal.json）を1か所ずつ壊して、**その問題だけ**が出ることを確かめる。

use mv_core::id::{new_id, IdKind};
use mv_core::io::{load_project, parse_project, save_project, LoadError};
use mv_core::model::*;
use mv_core::validate::{validate, IssueCode};

const MINIMAL: &str =
    include_str!("../../../../../docs/stario_mv_docs/schemas/examples/minimal.json");

fn minimal() -> Project {
    parse_project(MINIMAL).expect("見本が読めない")
}

fn codes(p: &Project) -> Vec<IssueCode> {
    validate(p).into_iter().map(|i| i.code).collect()
}

fn text_layer(p: &mut Project) -> &mut Layer {
    &mut p.compositions[0].layers[0]
}

fn solid_layer(p: &mut Project) -> &mut Layer {
    &mut p.compositions[0].layers[1]
}

#[test]
fn 見本は形も中身も通る() {
    assert_eq!(validate(&minimal()), vec![]);
}

#[test]
fn 保存して開き直すと同じ() {
    let dir = tempfile::tempdir().unwrap();
    let p = minimal();
    let path = save_project(dir.path(), &p).unwrap();
    assert!(path.ends_with("project.json"));
    assert!(dir.path().join("assets").is_dir());
    assert!(dir.path().join("cache").is_dir());
    assert!(
        !dir.path().join("project.json.writing").exists(),
        "一時ファイルが残っている"
    );
    let loaded = load_project(dir.path()).unwrap();
    assert_eq!(loaded.project, p);
    assert!(loaded.issues.is_empty());
}

#[test]
fn 形が正典と合わないものは型へ入れる前に止める() {
    let mut doc: serde_json::Value = serde_json::from_str(MINIMAL).unwrap();
    doc["compositions"][0]["layers"][0]["zIndex"] = 3.into();
    match parse_project(&doc.to_string()) {
        Err(LoadError::Schema(v)) => assert!(v
            .iter()
            .any(|i| i.path.contains("/compositions/0/layers/0"))),
        other => panic!("形の検査で止まっていない: {other:?}"),
    }
}

#[test]
fn ほかの形式は読まない() {
    let mut doc: serde_json::Value = serde_json::from_str(MINIMAL).unwrap();
    doc["format"] = "timeline".into();
    assert!(matches!(
        parse_project(&doc.to_string()),
        Err(LoadError::NotMvProject)
    ));
    assert!(matches!(parse_project("{"), Err(LoadError::Json(_))));
}

#[test]
fn id_の重複() {
    let mut p = minimal();
    let id = p.compositions[0].layers[0].id.clone();
    solid_layer(&mut p).id = id;
    assert_eq!(codes(&p), vec![IssueCode::DuplicateId]);
}

#[test]
fn 書き出しの既定のコンポジションが無い() {
    let mut p = minimal();
    p.main_composition_id = new_id(IdKind::Composition);
    assert_eq!(codes(&p), vec![IssueCode::MissingReference]);
}

#[test]
fn 素材が無い_種類が合わない() {
    let mut p = minimal();
    let asset_id = new_id(IdKind::Asset);
    {
        let l = solid_layer(&mut p);
        l.layer_type = LayerType::Image;
        l.solid = None;
        l.asset_id = Some(asset_id.clone());
    }
    assert_eq!(codes(&p), vec![IssueCode::MissingReference]);
    p.assets.push(Asset {
        id: asset_id,
        kind: AssetKind::Audio,
        name: "音".into(),
        source: AssetSource::Copied {
            path: "assets/a.wav".into(),
        },
        sha256: None,
        meta: None,
    });
    assert_eq!(codes(&p), vec![IssueCode::WrongReferenceKind]);
    p.assets[0].kind = AssetKind::Image;
    assert_eq!(codes(&p), vec![]);
}

#[test]
fn 見える範囲が空() {
    let mut p = minimal();
    let l = text_layer(&mut p);
    l.out_frame = l.in_frame;
    assert_eq!(codes(&p), vec![IssueCode::EmptyTimeRange]);
}

#[test]
fn キーフレームの順が戻る() {
    let mut p = minimal();
    let ks = text_layer(&mut p)
        .transform
        .opacity
        .keyframes
        .as_mut()
        .unwrap();
    ks[1].frame = ks[0].frame;
    assert_eq!(codes(&p), vec![IssueCode::KeyframeOrder]);
}

#[test]
fn 値の数が合わない() {
    let mut p = minimal();
    text_layer(&mut p).transform.scale = Animatable::number(1.0);
    assert_eq!(codes(&p), vec![IssueCode::ValueDimension]);
    let mut p = minimal();
    text_layer(&mut p)
        .transform
        .position
        .keyframes
        .as_mut()
        .unwrap()[0]
        .value = AnimValue::Vector(vec![1.0, 2.0, 3.0]);
    assert_eq!(codes(&p), vec![IssueCode::ValueDimension]);
}

#[test]
fn 図形の形の頂点とハンドルの数が合わない() {
    let mut p = minimal();
    let l = solid_layer(&mut p);
    l.layer_type = LayerType::Shape;
    l.solid = None;
    l.shape = Some(ShapeContent {
        kind: ShapeKind::Path,
        size: None,
        corner_radius: None,
        path: Some(Path {
            closed: true,
            vertices: vec![[0.0, 0.0], [1.0, 1.0]],
            in_tangents: vec![[0.0, 0.0]],
            out_tangents: vec![[0.0, 0.0], [0.0, 0.0]],
        }),
        fill: None,
        stroke: None,
    });
    assert_eq!(codes(&p), vec![IssueCode::PathShape]);
}

#[test]
fn 親が自分_見つからない_循環() {
    let mut p = minimal();
    let own = text_layer(&mut p).id.clone();
    text_layer(&mut p).parent_id = Some(own);
    assert_eq!(
        codes(&p),
        vec![IssueCode::SelfReference, IssueCode::ParentCycle]
    );

    let mut p = minimal();
    text_layer(&mut p).parent_id = Some(new_id(IdKind::Layer));
    assert_eq!(codes(&p), vec![IssueCode::MissingReference]);

    let mut p = minimal();
    let a = p.compositions[0].layers[0].id.clone();
    let b = p.compositions[0].layers[1].id.clone();
    text_layer(&mut p).parent_id = Some(b);
    solid_layer(&mut p).parent_id = Some(a);
    let c = codes(&p);
    assert_eq!(
        c.iter().filter(|x| **x == IssueCode::ParentCycle).count(),
        2,
        "{c:?}"
    );
}

/// MV-0010 決定5：γ0.2 から親子付けとヌルは描ける（「まだ描けない」と言わない）。
#[test]
fn 親子付けとヌルは問題にしない() {
    let mut p = minimal();
    let null = p.compositions[0].layers[1].id.clone();
    let l = solid_layer(&mut p);
    l.layer_type = LayerType::Null;
    l.solid = None;
    // 文字をヌルの子にする
    text_layer(&mut p).parent_id = Some(null);
    assert_eq!(codes(&p), vec![]);
}

#[test]
fn 入れ子のコンポジションの循環() {
    let mut p = minimal();
    let mut inner = p.compositions[0].clone();
    inner.id = new_id(IdKind::Composition);
    for l in &mut inner.layers {
        l.id = new_id(IdKind::Layer);
    }
    let outer_id = p.compositions[0].id.clone();
    let inner_id = inner.id.clone();
    // 外 → 中 → 外
    {
        let l = solid_layer(&mut p);
        l.layer_type = LayerType::Precomp;
        l.solid = None;
        l.composition_id = Some(inner_id);
    }
    {
        let l = &mut inner.layers[1];
        l.layer_type = LayerType::Precomp;
        l.solid = None;
        l.composition_id = Some(outer_id);
    }
    p.compositions.push(inner);
    let c = codes(&p);
    assert_eq!(
        c.iter()
            .filter(|x| **x == IssueCode::CompositionCycle)
            .count(),
        2,
        "{c:?}"
    );
}

/// 見本を壊す手順。
type Breaker = Box<dyn Fn(&mut Project)>;

#[test]
fn まだ描けない機能は知らせる() {
    let cases: Vec<(&str, Breaker)> = vec![
        (
            "エフェクト",
            Box::new(|p| {
                solid_layer(p).effects.push(Effect {
                    id: new_id(IdKind::Effect),
                    effect_type: "stario.blur.gaussian".into(),
                    version: 1,
                    enabled: true,
                    params: Default::default(),
                })
            }),
        ),
        (
            "式",
            Box::new(|p| {
                text_layer(p).transform.rotation = Animatable {
                    expression: Some(Expression {
                        language: "x".into(),
                        source: "0".into(),
                    }),
                    ..Default::default()
                }
            }),
        ),
        (
            "つなぎ",
            Box::new(|p| {
                text_layer(p).transform.rotation.links = Some(vec![Link {
                    kind: LinkKind::Beat,
                    amount: 1.0,
                }])
            }),
        ),
        (
            "2.5D（奥行き・カメラ）",
            Box::new(|p| {
                let l = text_layer(p);
                l.three_d = Some(true);
                l.transform.position = Animatable::vector(&[0.0, 0.0, 0.0]);
            }),
        ),
        (
            "縦書き",
            Box::new(|p| text_layer(p).text.as_mut().unwrap().vertical = Some(true)),
        ),
        (
            "文字の縁取り",
            Box::new(|p| {
                text_layer(p).text.as_mut().unwrap().stroke = Some(Stroke {
                    color: [0.0, 0.0, 0.0, 1.0],
                    width: 2.0,
                })
            }),
        ),
        (
            "字の間",
            Box::new(|p| text_layer(p).text.as_mut().unwrap().letter_spacing = Some(0.1)),
        ),
    ];
    for (feature, apply) in cases {
        let mut p = minimal();
        apply(&mut p);
        let issues = validate(&p);
        assert_eq!(
            issues.iter().map(|i| i.code).collect::<Vec<_>>(),
            vec![IssueCode::NotYetSupported],
            "{feature}: {issues:?}"
        );
        assert!(
            issues[0].message.contains(feature),
            "{feature}: {}",
            issues[0].message
        );
        assert!(issues[0].message.contains("γ0.1"), "{}", issues[0].message);
    }
}

#[test]
fn 音量のキーフレームはまだ書き出せないと知らせる() {
    let mut p = minimal();
    let asset_id = new_id(IdKind::Asset);
    p.assets.push(Asset {
        id: asset_id.clone(),
        kind: AssetKind::Audio,
        name: "音".into(),
        source: AssetSource::Copied {
            path: "assets/a.wav".into(),
        },
        sha256: None,
        meta: None,
    });
    let l = solid_layer(&mut p);
    l.layer_type = LayerType::Audio;
    l.solid = None;
    l.asset_id = Some(asset_id);
    let k = |frame, v| Keyframe {
        frame,
        value: AnimValue::Number(v),
        interpolation: Interpolation::Linear,
        ease_out: None,
        ease_in: None,
        spatial_out: None,
        spatial_in: None,
    };
    l.audio = Some(LayerAudio {
        volume_db: Animatable::number(0.0),
        muted: false,
    });
    assert_eq!(codes(&p), vec![], "固定の音量は通る");
    solid_layer(&mut p).audio = Some(LayerAudio {
        volume_db: Animatable {
            keyframes: Some(vec![k(0, 0.0), k(10, -6.0)]),
            ..Default::default()
        },
        muted: false,
    });
    let issues = validate(&p);
    assert_eq!(
        issues.iter().map(|i| i.code).collect::<Vec<_>>(),
        vec![IssueCode::NotYetSupported]
    );
    assert!(issues[0].message.contains("音量のキーフレーム"));
}

/// MV-0010 決定5：親の親まで変形を掛ける（子 → 親 → 親の親）。親の不透明度は掛けない。
#[test]
fn 親の親まで変形を掛ける() {
    let mut p = minimal();
    let mut grand = p.compositions[0].layers[1].clone();
    grand.id = new_id(IdKind::Layer);
    grand.layer_type = LayerType::Null;
    grand.solid = None;
    grand.parent_id = None;
    grand.transform.anchor = Animatable::vector(&[0.0, 0.0]);
    grand.transform.position = Animatable::vector(&[1000.0, 0.0]);
    grand.transform.scale = Animatable::vector(&[1.0, 1.0]);
    grand.transform.rotation = Animatable::number(0.0);
    let mut parent = grand.clone();
    parent.id = new_id(IdKind::Layer);
    parent.parent_id = Some(grand.id.clone());
    parent.transform.position = Animatable::vector(&[0.0, 0.0]);
    parent.transform.scale = Animatable::vector(&[2.0, 2.0]);
    let mut child = parent.clone();
    child.id = new_id(IdKind::Layer);
    child.parent_id = Some(parent.id.clone());
    child.transform.position = Animatable::vector(&[10.0, 5.0]);
    child.transform.scale = Animatable::vector(&[1.0, 1.0]);
    let c = &mut p.compositions[0];
    c.layers = vec![child.clone(), parent, grand];
    let m = mv_core::eval::world_matrix(c, &child, 0.0).unwrap();
    // 子の (0,0) → 親で (10,5)×2 → 親の親で +1000
    assert_eq!(mv_core::eval::apply(m, [0.0, 0.0]), [1020.0, 10.0]);
    assert_eq!(
        mv_core::eval::apply(m, [1.0, 0.0]),
        [1022.0, 10.0],
        "親の大きさも掛かる"
    );
}

/// MV-0012 決定1：タイムリマップは受け付ける・素材の秒はリマップの値（無ければ startFrame からの進み）。
#[test]
fn タイムリマップは通り_素材の秒はその値() {
    let mut p = minimal();
    let asset_id = new_id(IdKind::Asset);
    p.assets.push(Asset {
        id: asset_id.clone(),
        kind: AssetKind::Video,
        name: "映像".into(),
        source: AssetSource::Copied {
            path: "assets/v.mp4".into(),
        },
        sha256: None,
        meta: None,
    });
    let l = solid_layer(&mut p);
    l.layer_type = LayerType::Video;
    l.solid = None;
    l.asset_id = Some(asset_id);
    l.start_frame = 6;
    let fps = {
        let c = &p.compositions[0];
        f64::from(c.fps.num) / f64::from(c.fps.den)
    };
    let c = &p.compositions[0];
    let l = c
        .layers
        .iter()
        .find(|l| l.layer_type == LayerType::Video)
        .unwrap()
        .clone();
    let s = mv_core::eval::source_sec(c, &l, 6.0 + fps).unwrap();
    assert!(
        (s - 1.0).abs() < 1e-9,
        "リマップなし＝startFrame から 1 秒: {s}"
    );
    solid_layer_video(&mut p).time_remap = Some(Animatable::number(2.5));
    assert_eq!(codes(&p), vec![], "タイムリマップは γ0.2 で描ける");
    let c = &p.compositions[0];
    let l = c
        .layers
        .iter()
        .find(|l| l.layer_type == LayerType::Video)
        .unwrap();
    assert_eq!(mv_core::eval::source_sec(c, l, 6.0 + fps).unwrap(), 2.5);
}

fn solid_layer_video(p: &mut Project) -> &mut Layer {
    p.compositions[0]
        .layers
        .iter_mut()
        .find(|l| l.layer_type == LayerType::Video)
        .unwrap()
}
