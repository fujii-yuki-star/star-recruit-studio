//! 描画の核の検査（MV-0003）。
//! ⚠️ 1つずつ「決まった画素の色」で確かめる（位置・重なりの順・不透明度・描画モード・色空間）＋見本の正解画像（golden）。
//! GPU は CI ではソフトウェアの GPU で動く＝正解画像との比べ方には少しの幅を持たせる（画素の値で ±3・ずれた画素 0.5% まで）。

use mv_core::id::{new_id, IdKind};
use mv_core::io::parse_project;
use mv_core::model::*;
use mv_render::text::Fonts;
use mv_render::{Frame, Gpu, RenderError, Renderer};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

const MINIMAL: &str =
    include_str!("../../../../../docs/stario_mv_docs/schemas/examples/minimal.json");

fn fonts_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../../public/fonts")
}

/// GPU の準備は重いので1つを使い回す（検査は並んで走るので鍵をかける）。
fn renderer() -> std::sync::MutexGuard<'static, Renderer> {
    static R: OnceLock<Mutex<Renderer>> = OnceLock::new();
    R.get_or_init(|| {
        let gpu = Gpu::new().expect("GPU が無い（CI でもソフトウェアの GPU で描けるはず）");
        eprintln!("GPU: {}", gpu.adapter_name);
        Mutex::new(Renderer::new(
            gpu,
            Fonts::load(&[&fonts_dir()]).expect("フォント"),
        ))
    })
    .lock()
    .unwrap_or_else(|e| e.into_inner())
}

fn render(p: &Project, frame: i64) -> Result<Frame, RenderError> {
    let id = p.main_composition_id.clone();
    renderer().render(p, &id, frame, Path::new("."))
}

/// 小さな空のプロジェクト（200×100・黒の背景）。
fn blank(space: WorkingColorSpace) -> Project {
    let comp = Composition {
        id: new_id(IdKind::Composition),
        name: "c".into(),
        width: 200,
        height: 100,
        fps: Rational { num: 30, den: 1 },
        duration_frames: 30,
        background: [0.0, 0.0, 0.0, 1.0],
        layers: vec![],
        markers: vec![],
    };
    Project {
        format: FORMAT.into(),
        schema_version: SCHEMA_VERSION.into(),
        id: new_id(IdKind::Project),
        name: "t".into(),
        created_at: "2026-11-26T00:00:00Z".into(),
        updated_at: "2026-11-26T00:00:00Z".into(),
        settings: ProjectSettings {
            working_color_space: space,
        },
        assets: vec![],
        main_composition_id: comp.id.clone(),
        compositions: vec![comp],
    }
}

fn base_layer(t: LayerType) -> Layer {
    Layer {
        id: new_id(IdKind::Layer),
        name: "l".into(),
        layer_type: t,
        enabled: true,
        locked: false,
        solo: None,
        label: None,
        in_frame: 0,
        out_frame: 30,
        start_frame: 0,
        parent_id: None,
        three_d: None,
        transform: Transform {
            anchor: Animatable::vector(&[0.0, 0.0]),
            position: Animatable::vector(&[0.0, 0.0]),
            scale: Animatable::vector(&[1.0, 1.0]),
            rotation: Animatable::number(0.0),
            opacity: Animatable::number(1.0),
            rotation_x: None,
            rotation_y: None,
        },
        blend_mode: BlendMode::Normal,
        track_matte: None,
        masks: vec![],
        effects: vec![],
        markers: vec![],
        asset_id: None,
        composition_id: None,
        time_remap: None,
        audio: None,
        text: None,
        shape: None,
        solid: None,
        camera: None,
    }
}

fn solid(color: Color, w: u32, h: u32) -> Layer {
    let mut l = base_layer(LayerType::Solid);
    l.solid = Some(SolidContent {
        color,
        width: w,
        height: h,
    });
    l
}

fn near(a: [u8; 4], b: [u8; 4], tol: u8) -> bool {
    a.iter().zip(b).all(|(x, y)| x.abs_diff(y) <= tol)
}

#[test]
fn 単色の位置とアンカー() {
    let mut p = blank(WorkingColorSpace::Srgb);
    let mut l = solid([1.0, 0.0, 0.0, 1.0], 50, 40);
    l.transform.position = Animatable::vector(&[10.0, 20.0]);
    p.compositions[0].layers.push(l);
    let f = render(&p, 0).unwrap();
    assert!(
        near(f.pixel(30, 40), [255, 0, 0, 255], 1),
        "中は赤: {:?}",
        f.pixel(30, 40)
    );
    assert!(
        near(f.pixel(5, 5), [0, 0, 0, 255], 1),
        "外は背景: {:?}",
        f.pixel(5, 5)
    );
    assert!(
        near(f.pixel(65, 40), [0, 0, 0, 255], 1),
        "右の外は背景: {:?}",
        f.pixel(65, 40)
    );
}

#[test]
fn 先頭のレイヤーが最前面() {
    let mut p = blank(WorkingColorSpace::Srgb);
    p.compositions[0]
        .layers
        .push(solid([0.0, 1.0, 0.0, 1.0], 200, 100)); // 先頭＝前
    p.compositions[0]
        .layers
        .push(solid([1.0, 0.0, 0.0, 1.0], 200, 100)); // 後ろ
    let f = render(&p, 0).unwrap();
    assert!(
        near(f.pixel(100, 50), [0, 255, 0, 255], 1),
        "{:?}",
        f.pixel(100, 50)
    );
}

#[test]
fn 見える範囲の外と隠したレイヤーは描かない() {
    let mut p = blank(WorkingColorSpace::Srgb);
    let mut l = solid([1.0, 1.0, 1.0, 1.0], 200, 100);
    l.in_frame = 10;
    l.out_frame = 20;
    p.compositions[0].layers.push(l);
    assert!(near(
        render(&p, 5).unwrap().pixel(100, 50),
        [0, 0, 0, 255],
        1
    ));
    assert!(near(
        render(&p, 10).unwrap().pixel(100, 50),
        [255, 255, 255, 255],
        1
    ));
    assert!(
        near(render(&p, 20).unwrap().pixel(100, 50), [0, 0, 0, 255], 1),
        "outFrame は含まない"
    );
    p.compositions[0].layers[0].enabled = false;
    assert!(near(
        render(&p, 15).unwrap().pixel(100, 50),
        [0, 0, 0, 255],
        1
    ));
}

#[test]
fn 不透明度は作業の色空間で混ざる() {
    // 白を 50% で黒に重ねる：linear なら光の半分（sRGB で約 188）、srgb なら値の半分（約 128）
    for (space, want) in [
        (WorkingColorSpace::Linear, 188u8),
        (WorkingColorSpace::Srgb, 128u8),
    ] {
        let mut p = blank(space);
        let mut l = solid([1.0, 1.0, 1.0, 1.0], 200, 100);
        l.transform.opacity = Animatable::number(0.5);
        p.compositions[0].layers.push(l);
        let px = render(&p, 0).unwrap().pixel(100, 50);
        assert!(px[0].abs_diff(want) <= 2, "{space:?}: {px:?}");
    }
}

#[test]
fn 中間の色は作業の色空間を通っても元の色に戻る() {
    // sRGB の 0.5 の灰色を、linear で合成して sRGB に戻す＝ 128 のまま（読むときと出すときの変換が対になっている）
    let mut p = blank(WorkingColorSpace::Linear);
    p.compositions[0]
        .layers
        .push(solid([0.5, 0.25, 0.75, 1.0], 200, 100));
    let px = render(&p, 0).unwrap().pixel(100, 50);
    assert!(near(px, [128, 64, 191, 255], 1), "{px:?}");
}

#[test]
fn 描画モード() {
    let cases = [
        (BlendMode::Multiply, [0.5, 0.5, 0.5, 1.0], [128, 0, 0]),
        (BlendMode::Screen, [0.5, 0.5, 0.5, 1.0], [255, 128, 128]),
        (BlendMode::Add, [0.0, 0.5, 0.0, 1.0], [255, 128, 0]),
        (BlendMode::Difference, [1.0, 1.0, 1.0, 1.0], [0, 255, 255]),
        (BlendMode::Darken, [0.5, 0.5, 0.5, 1.0], [128, 0, 0]),
        (BlendMode::Lighten, [0.5, 0.5, 0.5, 1.0], [255, 128, 128]),
    ];
    for (mode, top, want) in cases {
        let mut p = blank(WorkingColorSpace::Srgb);
        let mut l = solid(top, 200, 100);
        l.blend_mode = mode;
        p.compositions[0].layers.push(l);
        p.compositions[0]
            .layers
            .push(solid([1.0, 0.0, 0.0, 1.0], 200, 100));
        let px = render(&p, 0).unwrap().pixel(100, 50);
        assert!(
            near(px, [want[0], want[1], want[2], 255], 2),
            "{mode:?}: {px:?}"
        );
    }
}

#[test]
fn 図形は中心が原点() {
    let mut p = blank(WorkingColorSpace::Srgb);
    let mut l = base_layer(LayerType::Shape);
    l.shape = Some(ShapeContent {
        kind: ShapeKind::Ellipse,
        size: Some(Animatable::vector(&[80.0, 80.0])),
        corner_radius: None,
        path: None,
        fill: Some([0.0, 0.0, 1.0, 1.0]),
        stroke: None,
    });
    l.transform.position = Animatable::vector(&[100.0, 50.0]);
    p.compositions[0].layers.push(l);
    let f = render(&p, 0).unwrap();
    assert!(
        near(f.pixel(100, 50), [0, 0, 255, 255], 1),
        "中心: {:?}",
        f.pixel(100, 50)
    );
    assert!(
        near(f.pixel(65, 15), [0, 0, 0, 255], 1),
        "四角の角＝楕円の外: {:?}",
        f.pixel(65, 15)
    );
    // 中心が (100,50) なら楕円は x 60〜140：左の端の内側は青・右の外は背景（左上を原点にすると右へずれる）
    assert!(
        near(f.pixel(70, 50), [0, 0, 255, 255], 1),
        "左の端の内側: {:?}",
        f.pixel(70, 50)
    );
    assert!(
        near(f.pixel(150, 50), [0, 0, 0, 255], 1),
        "右の外: {:?}",
        f.pixel(150, 50)
    );
}

#[test]
fn キーフレームで動く() {
    let mut p = blank(WorkingColorSpace::Srgb);
    let mut l = solid([1.0, 1.0, 1.0, 1.0], 20, 20);
    let k = |frame, x: f64| Keyframe {
        frame,
        value: AnimValue::Vector(vec![x, 40.0]),
        interpolation: Interpolation::Linear,
        ease_out: None,
        ease_in: None,
        spatial_out: None,
        spatial_in: None,
    };
    l.transform.position = Animatable {
        keyframes: Some(vec![k(0, 0.0), k(10, 100.0)]),
        ..Default::default()
    };
    p.compositions[0].layers.push(l);
    assert!(near(
        render(&p, 0).unwrap().pixel(10, 50),
        [255, 255, 255, 255],
        1
    ));
    let f5 = render(&p, 5).unwrap();
    assert!(
        near(f5.pixel(60, 50), [255, 255, 255, 255], 1),
        "5 フレームで 50 進む"
    );
    assert!(near(f5.pixel(10, 50), [0, 0, 0, 255], 1));
}

#[test]
fn 文字を描く_無いフォントは知らせる() {
    let mut p = blank(WorkingColorSpace::Srgb);
    let mut l = base_layer(LayerType::Text);
    l.text = Some(TextDocument {
        text: "あア亜".into(),
        font_family: "Gen Interface JP".into(),
        font_style: None,
        font_size: 40.0,
        fill: [1.0, 1.0, 1.0, 1.0],
        stroke: None,
        align: Some(TextAlign::Center),
        line_height: None,
        letter_spacing: None,
        vertical: None,
        box_width: None,
    });
    l.transform.position = Animatable::vector(&[100.0, 70.0]);
    p.compositions[0].layers.push(l);
    let f = render(&p, 0).unwrap();
    // ベースライン（y=70）より上・中央の左右に白い画素がある
    let lit = |x0: u32, x1: u32| {
        (x0..x1)
            .flat_map(|x| (35..70).map(move |y| (x, y)))
            .filter(|(x, y)| f.pixel(*x, *y)[0] > 128)
            .count()
    };
    assert!(
        lit(40, 100) > 50 && lit(100, 160) > 50,
        "中央揃えで左右に文字: {} {}",
        lit(40, 100),
        lit(100, 160)
    );
    assert_eq!(lit(0, 30), 0, "左の端までは届かない");
    assert_eq!(
        (0..200)
            .flat_map(|x| (80..100).map(move |y| (x, y)))
            .filter(|(x, y)| f.pixel(*x, *y)[0] > 128)
            .count(),
        0,
        "ベースラインより十分下には無い"
    );

    p.compositions[0].layers[0]
        .text
        .as_mut()
        .unwrap()
        .font_family = "無いフォント".into();
    assert_eq!(
        render(&p, 0).err(),
        Some(RenderError::FontNotFound("無いフォント".into()))
    );
}

#[test]
fn 画像を読む() {
    let dir = std::env::temp_dir().join(format!("mv-render-test-{}", new_id(IdKind::Asset)));
    std::fs::create_dir_all(dir.join("assets")).unwrap();
    let img = image::RgbaImage::from_fn(4, 4, |_, _| image::Rgba([0, 255, 0, 255]));
    img.save(dir.join("assets/g.png")).unwrap();
    let mut p = blank(WorkingColorSpace::Srgb);
    let asset_id = new_id(IdKind::Asset);
    p.assets.push(Asset {
        id: asset_id.clone(),
        kind: AssetKind::Image,
        name: "g".into(),
        source: AssetSource::Copied {
            path: "assets/g.png".into(),
        },
        sha256: None,
        meta: None,
    });
    let mut l = base_layer(LayerType::Image);
    l.asset_id = Some(asset_id);
    l.transform.position = Animatable::vector(&[10.0, 10.0]);
    l.transform.scale = Animatable::vector(&[10.0, 10.0]);
    p.compositions[0].layers.push(l);
    let id = p.main_composition_id.clone();
    let f = renderer().render(&p, &id, 0, &dir).unwrap();
    assert!(
        near(f.pixel(30, 30), [0, 255, 0, 255], 2),
        "{:?}",
        f.pixel(30, 30)
    );
    assert!(
        near(f.pixel(60, 30), [0, 0, 0, 255], 2),
        "{:?}",
        f.pixel(60, 30)
    );
    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn まだ描けないレイヤーは知らせる() {
    let mut p = blank(WorkingColorSpace::Srgb);
    p.compositions[0].layers.push(base_layer(LayerType::Null));
    assert!(matches!(
        render(&p, 0),
        Err(RenderError::NotYetSupported(_))
    ));
}

/// 見本の正解画像（golden）。`UPDATE_GOLDEN=1` で作り直す。
#[test]
fn 見本の正解画像と同じ() {
    let p = parse_project(MINIMAL).unwrap();
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/golden");
    for frame in [0, 10, 30] {
        let f = render(&p, frame).unwrap();
        let path = dir.join(format!("minimal_f{frame}.png"));
        if std::env::var("UPDATE_GOLDEN").is_ok() {
            image::RgbaImage::from_raw(f.width, f.height, f.data.clone())
                .unwrap()
                .save(&path)
                .unwrap();
            continue;
        }
        let want = image::open(&path)
            .unwrap_or_else(|e| {
                panic!(
                    "正解画像が無い（{}）。UPDATE_GOLDEN=1 で作る: {e}",
                    path.display()
                )
            })
            .to_rgba8();
        assert_eq!((want.width(), want.height()), (f.width, f.height));
        let off = want
            .as_raw()
            .chunks(4)
            .zip(f.data.chunks(4))
            .filter(|(a, b)| a.iter().zip(b.iter()).any(|(x, y)| x.abs_diff(*y) > 3))
            .count();
        let total = (f.width * f.height) as usize;
        assert!(
            off * 200 <= total,
            "{frame} フレーム：正解画像とずれた画素が {off}／{total}"
        );
    }
}
