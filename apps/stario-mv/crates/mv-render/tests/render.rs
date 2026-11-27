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
    // ⚠️ ヌルは γ0.2 で描けるようになった（MV-0010）＝まだ描けないカメラで確かめる
    p.compositions[0].layers.push(base_layer(LayerType::Camera));
    match render(&p, 0) {
        Err(RenderError::NotYetSupported(m)) => {
            assert!(m.contains("カメラのレイヤー"), "種類は日本語の名前で: {m}")
        }
        r => panic!("{:?}", r.map(|_| ())),
    }
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

/// プレビューは描画の核の絵を窓へ写すだけ（MV-0007 決定1）＝色を変えず、比を保って欄に収め、余りは帯。
#[test]
fn プレビューへ写すと比を保って帯が付き色は変わらない() {
    use mv_render::present::{Presenter, Rect};
    let mut p = blank(WorkingColorSpace::Linear);
    p.compositions[0].background = [0.2, 0.6, 0.4, 1.0];
    let id = p.main_composition_id.clone();
    let mut r = renderer();
    let img = r.render_texture(&p, &id, 0, Path::new(".")).unwrap();
    let want = r.render(&p, &id, 0, Path::new(".")).unwrap().pixel(10, 10);
    let gpu = r.gpu();
    let fmt = wgpu::TextureFormat::Rgba8Unorm;
    let target = gpu.device.create_texture(&wgpu::TextureDescriptor {
        label: None,
        size: wgpu::Extent3d {
            width: 120,
            height: 120,
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: fmt,
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
        view_formats: &[],
    });
    let pr = Presenter::new(&gpu.device, fmt);
    let clear = [0.1, 0.1, 0.1, 1.0];
    // 欄＝(10,10)〜(110,110)。200×100 の絵は 100×50 になり、上下に 25 ずつ帯
    pr.draw(
        &gpu.device,
        &gpu.queue,
        &target.create_view(&Default::default()),
        Rect {
            x: 10.0,
            y: 10.0,
            w: 100.0,
            h: 100.0,
        },
        Some(&img),
        clear,
    );
    let f = mv_render::read_back(gpu, &target, 120, 120).unwrap();
    assert!(
        near(f.pixel(60, 60), want, 1),
        "中央は描画の核と同じ色: {:?} ≠ {want:?}",
        f.pixel(60, 60)
    );
    assert!(near(f.pixel(15, 40), want, 1), "絵の左上の近く");
    assert!(
        near(f.pixel(60, 30), [26, 26, 26, 255], 1),
        "上の帯: {:?}",
        f.pixel(60, 30)
    );
    assert!(near(f.pixel(60, 90), [26, 26, 26, 255], 1), "下の帯");
    assert!(near(f.pixel(5, 60), [26, 26, 26, 255], 1), "欄の外");
}

/// 枠（MV-0008 決定6）＝描くときと同じ中身の大きさ・変形で、四隅をコンポジションの画素で返す。並びは先頭が最前面。
#[test]
fn 枠は描くときと同じ大きさと変形_見えないものとソロの外は入れない() {
    let mut p = blank(WorkingColorSpace::Srgb);
    let mut a = solid([1.0, 0.0, 0.0, 1.0], 50, 40);
    a.transform.anchor = Animatable::vector(&[25.0, 20.0]);
    a.transform.position = Animatable::vector(&[100.0, 50.0]);
    a.transform.scale = Animatable::vector(&[2.0, 1.0]);
    let mut b = solid([0.0, 1.0, 0.0, 1.0], 10, 10);
    b.transform.position = Animatable::vector(&[5.0, 6.0]);
    let mut hidden = solid([0.0, 0.0, 1.0, 1.0], 10, 10);
    hidden.enabled = false;
    let mut later = solid([0.0, 0.0, 1.0, 1.0], 10, 10);
    later.in_frame = 10;
    let mut clear = solid([0.0, 0.0, 1.0, 1.0], 10, 10);
    clear.transform.opacity = Animatable::number(0.0);
    let (ida, idb) = (a.id.clone(), b.id.clone());
    p.compositions[0].layers = vec![a, b, hidden, later, clear];
    let id = p.main_composition_id.clone();
    let q = renderer().layer_quads(&p, &id, 0, Path::new(".")).unwrap();
    assert_eq!(
        q.iter().map(|x| x.layer_id.clone()).collect::<Vec<_>>(),
        vec![ida.clone(), idb.clone()]
    );
    // 50×40 を横 2 倍・アンカーは中心 → (100,50) が中心の 100×40
    let c = q[0].corners;
    // ⚠️ 中身は縁をなめらかにする余白（数画素未満）を持つ＝描いた絵の外枠なので、その分だけ広くてよい
    let close = |p: [f64; 2], e: [f64; 2]| (p[0] - e[0]).abs() <= 1.0 && (p[1] - e[1]).abs() <= 1.0;
    assert!(
        close(c[0], [50.0, 30.0]) && close(c[2], [150.0, 70.0]),
        "{c:?}"
    );
    assert!(close(q[1].corners[0], [5.0, 6.0]) && close(q[1].corners[2], [15.0, 16.0]));
    // ソロがあれば、ソロの外は入れない
    p.compositions[0].layers[1].solo = Some(true);
    let q = renderer().layer_quads(&p, &id, 0, Path::new(".")).unwrap();
    assert_eq!(
        q.iter().map(|x| x.layer_id.clone()).collect::<Vec<_>>(),
        vec![idb]
    );
}

/// MV-0010 決定5：親の変形を子に掛ける・親の不透明度は引き継がない・ヌルは描かないが枠（100×100）は返す。
#[test]
fn 親の変形を子に掛け_ヌルは描かず枠だけ返す() {
    let mut p = blank(WorkingColorSpace::Srgb);
    let mut null = base_layer(LayerType::Null);
    null.transform.position = Animatable::vector(&[100.0, 50.0]);
    null.transform.scale = Animatable::vector(&[2.0, 2.0]);
    // 親が透明でも、子は見える（不透明度は引き継がない）
    null.transform.opacity = Animatable::number(0.0);
    let mut child = solid([1.0, 0.0, 0.0, 1.0], 10, 10);
    child.transform.position = Animatable::vector(&[5.0, 0.0]);
    child.parent_id = Some(null.id.clone());
    let (nid, cid) = (null.id.clone(), child.id.clone());
    p.compositions[0].layers = vec![child, null];
    let f = render(&p, 0).unwrap();
    // 子は (100+5×2, 50) から 20×20 に描かれる
    assert!(
        near(f.pixel(120, 60), [255, 0, 0, 255], 1),
        "{:?}",
        f.pixel(120, 60)
    );
    assert!(
        near(f.pixel(105, 60), [0, 0, 0, 255], 1),
        "親の大きさで広がる前の所は背景"
    );
    // ヌルそのものは描かない（ヌルの枠の所＝子の外は背景）
    assert!(near(f.pixel(190, 95), [0, 0, 0, 255], 1));
    let id = p.main_composition_id.clone();
    let q = renderer().layer_quads(&p, &id, 0, Path::new(".")).unwrap();
    assert_eq!(
        q.iter().map(|x| x.layer_id.clone()).collect::<Vec<_>>(),
        vec![cid, nid]
    );
    // ⚠️ 縁の余白（中身の画素で1つ）は親の大きさ（2 倍）の分だけ広がる＝2 画素まで許す
    let close = |a: [f64; 2], e: [f64; 2]| (a[0] - e[0]).abs() <= 2.0 && (a[1] - e[1]).abs() <= 2.0;
    assert!(
        close(q[0].corners[0], [110.0, 50.0]) && close(q[0].corners[2], [130.0, 70.0]),
        "{:?}",
        q[0].corners
    );
    assert_eq!(
        q[0].parent_linear,
        [2.0, 0.0, 0.0, 2.0],
        "子は親の向きと大きさ"
    );
    // ヌルの枠＝100×100 を親（自分）の大きさで＝200×200
    assert_eq!(q[1].corners[0], [100.0, 50.0]);
    assert_eq!(q[1].corners[2], [300.0, 250.0]);
    assert_eq!(q[1].parent_linear, [1.0, 0.0, 0.0, 1.0]);
    // 不透明なヌルも描かない（不透明度 0 で先に抜ける道と別に確かめる）
    p.compositions[0].layers[1].transform.opacity = Animatable::number(1.0);
    let f = render(&p, 0).expect("ヌルは描けないレイヤーではない");
    assert!(
        near(f.pixel(190, 95), [0, 0, 0, 255], 1),
        "{:?}",
        f.pixel(190, 95)
    );
}

/// 入れ子（MV-0011）：中を透明な地で描いて重ねる・中の時刻・範囲の外は描かない・作業の色空間のまま（直接描いたのと同じ色）。
#[test]
fn 入れ子は中を透明な地で描き中の時刻で重ねる() {
    for space in [WorkingColorSpace::Linear, WorkingColorSpace::Srgb] {
        let mut p = blank(space);
        // 中：40×20・背景は緑（外では塗らない）・10 フレーム目から半透明の赤
        let mut inner = p.compositions[0].clone();
        inner.id = new_id(IdKind::Composition);
        inner.width = 40;
        inner.height = 20;
        inner.duration_frames = 20;
        inner.background = [0.0, 1.0, 0.0, 1.0];
        // ⚠️ 0 と 1 でない色にする＝純色だと色の直し方を二重にしても同じ値で、取り違えが見えない（変異チェックで生き残った）
        let mut red = solid([1.0, 0.5, 0.2, 1.0], 40, 20);
        red.in_frame = 10;
        red.out_frame = 20;
        red.transform.opacity = Animatable::number(0.5);
        inner.layers = vec![red];
        // 外：入れ子を (100, 50) に・中の 0 秒を外の 5 フレーム目に
        let mut pre = base_layer(LayerType::Precomp);
        pre.composition_id = Some(inner.id.clone());
        pre.transform.position = Animatable::vector(&[100.0, 50.0]);
        pre.start_frame = 5;
        p.compositions[0].layers = vec![pre];
        p.compositions.push(inner.clone());
        // 外の 14 フレーム＝中の 9＝赤はまだ＝何も無い（中の背景の緑も出ない）
        let f = render(&p, 14).unwrap();
        assert!(
            near(f.pixel(110, 60), [0, 0, 0, 255], 1),
            "{space:?} {:?}",
            f.pixel(110, 60)
        );
        // 外の 15 フレーム＝中の 10＝赤が出る。直接（入れ子でなく）描いたのと同じ色
        let f = render(&p, 15).unwrap();
        let mut direct = blank(space);
        let mut r = inner.layers[0].clone();
        r.in_frame = 0;
        r.transform.position = Animatable::vector(&[100.0, 50.0]);
        direct.compositions[0].layers = vec![r];
        let g = render(&direct, 15).unwrap();
        assert!(
            near(f.pixel(110, 60), g.pixel(110, 60), 1),
            "{space:?} 入れ子 {:?} 直接 {:?}",
            f.pixel(110, 60),
            g.pixel(110, 60)
        );
        assert!(f.pixel(110, 60)[0] > 100, "赤が出る {:?}", f.pixel(110, 60));
        assert!(
            near(f.pixel(150, 60), [0, 0, 0, 255], 1),
            "入れ子の外は背景"
        );
        // 中の長さの外（外の 25 フレーム＝中の 20）は描かない
        let f = render(&p, 25).unwrap();
        assert!(near(f.pixel(110, 60), [0, 0, 0, 255], 1));
        // 枠＝中のコンポジションの大きさ
        let id = p.main_composition_id.clone();
        let q = renderer().layer_quads(&p, &id, 15, Path::new(".")).unwrap();
        assert_eq!(q[0].corners[0], [100.0, 50.0]);
        assert_eq!(q[0].corners[2], [140.0, 70.0]);
    }
}

#[test]
fn 入れ子の時刻は秒で中の_fps_へ切り捨て() {
    let mut outer = blank(WorkingColorSpace::Srgb).compositions[0].clone();
    outer.fps = Rational { num: 30, den: 1 };
    let mut inner = outer.clone();
    inner.fps = Rational { num: 24, den: 1 };
    inner.duration_frames = 48;
    let mut l = base_layer(LayerType::Precomp);
    l.start_frame = 10;
    // 外 10 → 0 秒 → 中 0 ／ 外 25 → 0.5 秒 → 中 12 ／ 外 9 → 前 ／ 外 70 → 2 秒 → 中 48＝外
    assert_eq!(nf(&outer, &inner, &l, 10), Some(0));
    assert_eq!(nf(&outer, &inner, &l, 25), Some(12));
    assert_eq!(
        nf(&outer, &inner, &l, 11),
        Some(0),
        "1/30 秒は中の 0.8 コマ＝切り捨て"
    );
    assert_eq!(nf(&outer, &inner, &l, 9), None);
    assert_eq!(nf(&outer, &inner, &l, 69), Some(47));
    assert_eq!(nf(&outer, &inner, &l, 70), None);
}

fn nf(outer: &Composition, inner: &Composition, l: &Layer, frame: i64) -> Option<i64> {
    mv_render::nested_frame(outer, inner, l, frame).unwrap()
}

fn lin(frame: i64, v: f64) -> Keyframe {
    Keyframe {
        frame,
        value: AnimValue::Number(v),
        interpolation: Interpolation::Linear,
        ease_out: None,
        ease_in: None,
        spatial_out: None,
        spatial_in: None,
    }
}

#[test]
fn 入れ子のタイムリマップは素材の秒で範囲の外は端で止める() {
    let mut outer = blank(WorkingColorSpace::Srgb).compositions[0].clone();
    outer.fps = Rational { num: 30, den: 1 };
    let mut inner = outer.clone();
    inner.fps = Rational { num: 24, den: 1 };
    inner.duration_frames = 48;
    let mut l = base_layer(LayerType::Precomp);
    l.start_frame = 10;
    // 外 0〜30 で中の 2 秒 → 0 秒（逆再生）。startFrame は使わない
    l.time_remap = Some(Animatable {
        keyframes: Some(vec![lin(0, 2.0), lin(30, 0.0)]),
        ..Default::default()
    });
    // 外 15 → 1 秒 → 中 24
    assert_eq!(nf(&outer, &inner, &l, 15), Some(24));
    // 外 0 → 2 秒 → 中 48＝範囲の外 → 最後のコマ 47 で止める
    assert_eq!(nf(&outer, &inner, &l, 0), Some(47));
    // 外 30 以降 → 0 秒 → 中 0
    assert_eq!(nf(&outer, &inner, &l, 40), Some(0));
    // 負の秒 → 0 で止める
    l.time_remap = Some(Animatable::number(-1.0));
    assert_eq!(nf(&outer, &inner, &l, 5), Some(0));
}

#[test]
fn 端で止める() {
    assert_eq!(mv_render::hold_index(-3, Some(10)), 0);
    assert_eq!(mv_render::hold_index(4, Some(10)), 4);
    assert_eq!(mv_render::hold_index(10, Some(10)), 9);
    assert_eq!(mv_render::hold_index(99, None), 99);
}

#[test]
fn 連番の映像はタイムリマップの秒のコマを見せ_範囲の外は端で止める() {
    let dir = std::env::temp_dir().join(format!("mv-render-test-{}", new_id(IdKind::Asset)));
    std::fs::create_dir_all(dir.join("assets")).unwrap();
    // 0＝赤・1＝緑・2＝青（10 fps）
    for (i, c) in [[255u8, 0, 0], [0, 255, 0], [0, 0, 255]].iter().enumerate() {
        image::RgbaImage::from_fn(4, 4, |_, _| image::Rgba([c[0], c[1], c[2], 255]))
            .save(dir.join(format!("assets/s_{i:03}.png")))
            .unwrap();
    }
    let mut p = blank(WorkingColorSpace::Srgb);
    let asset_id = new_id(IdKind::Asset);
    p.assets.push(Asset {
        id: asset_id.clone(),
        kind: AssetKind::ImageSequence,
        name: "s".into(),
        source: AssetSource::Copied {
            path: "assets/s_000.png".into(),
        },
        sha256: None,
        meta: Some(AssetMeta {
            fps: Some(Rational { num: 10, den: 1 }),
            frame_count: Some(3),
            ..Default::default()
        }),
    });
    let mut l = base_layer(LayerType::Video);
    l.asset_id = Some(asset_id);
    l.transform.position = Animatable::vector(&[10.0, 10.0]);
    l.transform.scale = Animatable::vector(&[10.0, 10.0]);
    p.compositions[0].layers.push(l);
    let id = p.main_composition_id.clone();
    let px = |p: &Project, f: i64| renderer().render(p, &id, f, &dir).unwrap().pixel(30, 30);
    // リマップなし＝0 フレームは赤・範囲の外（3 コマ目以降＝0.3 秒）は描かない
    assert!(near(px(&p, 0), [255, 0, 0, 255], 2));
    let fps = f64::from(p.compositions[0].fps.num) / f64::from(p.compositions[0].fps.den);
    let after = (0.35 * fps).ceil() as i64;
    assert!(
        near(px(&p, after), [0, 0, 0, 255], 2),
        "リマップなしは素材の外を描かない"
    );
    // 固定値 0.15 秒＝コマ 1＝緑（どのフレームでも）
    p.compositions[0].layers[0].time_remap = Some(Animatable::number(0.15));
    assert!(near(px(&p, 0), [0, 255, 0, 255], 2), "{:?}", px(&p, 0));
    // 素材の外（5 秒）＝最後のコマ（青）で止める
    p.compositions[0].layers[0].time_remap = Some(Animatable::number(5.0));
    assert!(
        near(px(&p, after), [0, 0, 255, 255], 2),
        "{:?}",
        px(&p, after)
    );
    std::fs::remove_dir_all(&dir).ok();
}
