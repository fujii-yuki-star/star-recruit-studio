//! レイヤーの中身を画素にする（CPU）。合成は GPU（[`crate::composite`]）。
//!
//! 座標の約束（MV-0003 決定3＝AE と同じ）：
//! - 単色・画像＝中身の左上がレイヤーの (0,0)。
//! - 図形（四角・楕円）＝中身の中心がレイヤーの (0,0)。自由な形＝頂点の座標がそのままレイヤーの座標。
//! - 文字＝1行目のベースラインの、揃えの点がレイヤーの (0,0)。

use crate::text::Fonts;
use crate::RenderError;
use mv_core::eval::{number_at, vec_at};
use mv_core::model::{Color, Layer, ShapeContent, ShapeKind};

/// 端の外に 1 画素の透明を足す（GPU で双線形に読むと縁がなめらかになる＝はみ出しが透明になる）。
pub const PAD: u32 = 1;

/// 画素にしたレイヤーの中身。
#[derive(Clone)]
pub struct Content {
    pub width: u32,
    pub height: u32,
    /// RGBA8・**乗算済み**・sRGB の値。
    pub data: Vec<u8>,
    /// 画素 (0,0) の左上の角が、レイヤーの座標のどこか。
    pub origin: [f64; 2],
    /// レイヤーの座標 1 単位が何画素か（拡大されても粗くならないように細かく描く）。
    pub px_per_unit: f64,
}

fn paint(c: &Color) -> tiny_skia::Paint<'static> {
    let mut p = tiny_skia::Paint::default();
    p.set_color(
        tiny_skia::Color::from_rgba(c[0] as f32, c[1] as f32, c[2] as f32, c[3] as f32)
            .unwrap_or(tiny_skia::Color::TRANSPARENT),
    );
    p.anti_alias = true;
    p
}

fn pixmap(w: u32, h: u32) -> Result<tiny_skia::Pixmap, RenderError> {
    tiny_skia::Pixmap::new(w.max(1), h.max(1)).ok_or(RenderError::TooLarge {
        width: w,
        height: h,
    })
}

fn content_from(pm: tiny_skia::Pixmap, origin: [f64; 2], k: f64) -> Content {
    Content {
        width: pm.width(),
        height: pm.height(),
        data: pm.take(),
        origin,
        px_per_unit: k,
    }
}

/// 単色（左上が (0,0)・大きさは単色の幅×高さ）。
pub fn solid(color: &Color, w: u32, h: u32, k: f64) -> Result<Content, RenderError> {
    let pw = (w as f64 * k).ceil() as u32 + 2 * PAD;
    let ph = (h as f64 * k).ceil() as u32 + 2 * PAD;
    let mut pm = pixmap(pw, ph)?;
    let rect = tiny_skia::Rect::from_xywh(
        PAD as f32,
        PAD as f32,
        (w as f64 * k) as f32,
        (h as f64 * k) as f32,
    )
    .ok_or(RenderError::TooLarge {
        width: w,
        height: h,
    })?;
    pm.fill_rect(rect, &paint(color), tiny_skia::Transform::identity(), None);
    Ok(content_from(pm, [-(PAD as f64) / k, -(PAD as f64) / k], k))
}

/// 図形。
pub fn shape(s: &ShapeContent, frame: f64, k: f64) -> Result<Content, RenderError> {
    let stroke_w = s.stroke.as_ref().map(|st| st.width).unwrap_or(0.0);
    let path = match s.kind {
        ShapeKind::Rectangle | ShapeKind::Ellipse => {
            let size = s
                .size
                .as_ref()
                .map(|a| vec_at::<2>(a, frame))
                .transpose()
                .map_err(RenderError::eval)?
                .unwrap_or([0.0, 0.0]);
            let (w, h) = (size[0].max(0.0), size[1].max(0.0));
            let rect = tiny_skia::Rect::from_xywh(
                (-w / 2.0) as f32,
                (-h / 2.0) as f32,
                w as f32,
                h as f32,
            );
            let Some(rect) = rect else { return empty(k) };
            if s.kind == ShapeKind::Ellipse {
                tiny_skia::PathBuilder::from_oval(rect)
            } else {
                let r = s
                    .corner_radius
                    .as_ref()
                    .map(|a| number_at(a, frame))
                    .transpose()
                    .map_err(RenderError::eval)?
                    .unwrap_or(0.0)
                    .clamp(0.0, w.min(h) / 2.0);
                if r > 0.0 {
                    rounded_rect(rect, r as f32)
                } else {
                    Some(tiny_skia::PathBuilder::from_rect(rect))
                }
            }
        }
        ShapeKind::Path => s.path.as_ref().and_then(|p| {
            let mut pb = tiny_skia::PathBuilder::new();
            let n = p.vertices.len();
            if n == 0 {
                return None;
            }
            pb.move_to(p.vertices[0][0] as f32, p.vertices[0][1] as f32);
            let seg = |pb: &mut tiny_skia::PathBuilder, i: usize, j: usize| {
                let (a, b) = (p.vertices[i], p.vertices[j]);
                let c1 = [a[0] + p.out_tangents[i][0], a[1] + p.out_tangents[i][1]];
                let c2 = [b[0] + p.in_tangents[j][0], b[1] + p.in_tangents[j][1]];
                pb.cubic_to(
                    c1[0] as f32,
                    c1[1] as f32,
                    c2[0] as f32,
                    c2[1] as f32,
                    b[0] as f32,
                    b[1] as f32,
                );
            };
            for i in 0..n - 1 {
                seg(&mut pb, i, i + 1);
            }
            if p.closed {
                seg(&mut pb, n - 1, 0);
                pb.close();
            }
            pb.finish()
        }),
    };
    let Some(path) = path else { return empty(k) };
    let b = path.bounds();
    let margin = stroke_w / 2.0 + 1.0;
    let (x0, y0) = (b.left() as f64 - margin, b.top() as f64 - margin);
    let (x1, y1) = (b.right() as f64 + margin, b.bottom() as f64 + margin);
    let pw = ((x1 - x0) * k).ceil() as u32 + 2 * PAD;
    let ph = ((y1 - y0) * k).ceil() as u32 + 2 * PAD;
    let mut pm = pixmap(pw, ph)?;
    let tf = tiny_skia::Transform::from_row(
        k as f32,
        0.0,
        0.0,
        k as f32,
        ((-x0) * k) as f32 + PAD as f32,
        ((-y0) * k) as f32 + PAD as f32,
    );
    if let Some(fill) = &s.fill {
        pm.fill_path(&path, &paint(fill), tiny_skia::FillRule::Winding, tf, None);
    }
    if let Some(st) = &s.stroke {
        let stroke = tiny_skia::Stroke {
            width: st.width as f32,
            ..Default::default()
        };
        pm.stroke_path(&path, &paint(&st.color), &stroke, tf, None);
    }
    Ok(content_from(
        pm,
        [x0 - PAD as f64 / k, y0 - PAD as f64 / k],
        k,
    ))
}

fn rounded_rect(r: tiny_skia::Rect, rad: f32) -> Option<tiny_skia::Path> {
    // 角の丸み＝4分の1円を3次ベジェで近似（0.5523）
    let c = 0.552_284_8 * rad;
    let (l, t, rr, b) = (r.left(), r.top(), r.right(), r.bottom());
    let mut pb = tiny_skia::PathBuilder::new();
    pb.move_to(l + rad, t);
    pb.line_to(rr - rad, t);
    pb.cubic_to(rr - rad + c, t, rr, t + rad - c, rr, t + rad);
    pb.line_to(rr, b - rad);
    pb.cubic_to(rr, b - rad + c, rr - rad + c, b, rr - rad, b);
    pb.line_to(l + rad, b);
    pb.cubic_to(l + rad - c, b, l, b - rad + c, l, b - rad);
    pb.line_to(l, t + rad);
    pb.cubic_to(l, t + rad - c, l + rad - c, t, l + rad, t);
    pb.close();
    pb.finish()
}

fn empty(k: f64) -> Result<Content, RenderError> {
    Ok(Content {
        width: 1,
        height: 1,
        data: vec![0; 4],
        origin: [0.0, 0.0],
        px_per_unit: k,
    })
}

/// 画像（左上が (0,0)・素材の大きさ）。⚠️ 拡大の細かさ k は画像には効かない（元の画素のまま＝GPU が拡大する）。
pub fn image(bytes: &[u8]) -> Result<Content, RenderError> {
    let img = image::load_from_memory(bytes)
        .map_err(|e| RenderError::Asset(format!("画像を読めませんでした（{e}）。")))?
        .to_rgba8();
    let (w, h) = img.dimensions();
    Ok(rgba(w, h, img.as_raw()))
}

/// 乗算していない RGBA8 の画素（画像・映像のコマ・連番）→ 中身（左上が (0,0)）。
pub fn rgba(w: u32, h: u32, src: &[u8]) -> Content {
    let pw = w + 2 * PAD;
    let ph = h + 2 * PAD;
    let mut data = vec![0u8; (pw * ph * 4) as usize];
    for y in 0..h {
        let row = &src[(y * w * 4) as usize..((y + 1) * w * 4) as usize];
        let dst0 = (((y + PAD) * pw + PAD) * 4) as usize;
        for (x, p) in row.as_chunks::<4>().0.iter().enumerate() {
            let a = p[3] as u32;
            let i = dst0 + x * 4;
            data[i] = ((p[0] as u32 * a + 127) / 255) as u8;
            data[i + 1] = ((p[1] as u32 * a + 127) / 255) as u8;
            data[i + 2] = ((p[2] as u32 * a + 127) / 255) as u8;
            data[i + 3] = p[3];
        }
    }
    Content {
        width: pw,
        height: ph,
        data,
        origin: [-(PAD as f64), -(PAD as f64)],
        px_per_unit: 1.0,
    }
}

/// SVG の書かれた大きさ（幅・高さ）。
pub fn svg_size(bytes: &[u8]) -> Result<(f64, f64), RenderError> {
    let tree = svg_tree(bytes)?;
    let s = tree.size();
    Ok((f64::from(s.width()), f64::from(s.height())))
}

fn svg_tree(bytes: &[u8]) -> Result<resvg::usvg::Tree, RenderError> {
    // ⚠️ SVG の中の文字は、フォントを渡していないので描けない＝黙って消さずに知らせる
    if String::from_utf8_lossy(bytes).contains("<text") {
        return Err(RenderError::NotYetSupported(
            "SVG の中の文字（文字をパスに変換してから取り込んでください）".into(),
        ));
    }
    resvg::usvg::Tree::from_data(bytes, &resvg::usvg::Options::default())
        .map_err(|e| RenderError::Asset(format!("SVG を読めませんでした（{e}）。")))
}

/// SVG（左上が (0,0)・拡大されても粗くならないよう k 倍で描く）。
pub fn svg(bytes: &[u8], k: f64) -> Result<Content, RenderError> {
    let tree = svg_tree(bytes)?;
    let s = tree.size();
    let pw = (f64::from(s.width()) * k).ceil() as u32 + 2 * PAD;
    let ph = (f64::from(s.height()) * k).ceil() as u32 + 2 * PAD;
    let mut pm = pixmap(pw, ph)?;
    resvg::render(
        &tree,
        tiny_skia::Transform::from_row(k as f32, 0.0, 0.0, k as f32, PAD as f32, PAD as f32),
        &mut pm.as_mut(),
    );
    Ok(content_from(pm, [-(PAD as f64) / k, -(PAD as f64) / k], k))
}

/// 文字（1行目のベースラインの揃えの点が (0,0)）。
pub fn text(layer: &Layer, fonts: &mut Fonts, k: f64) -> Result<Content, RenderError> {
    let doc = layer
        .text
        .as_ref()
        .ok_or_else(|| RenderError::Internal("文字のレイヤーに文字が無い".into()))?;
    let raster = fonts.render(doc, k)?;
    let pw = raster.width + 2 * PAD;
    let ph = raster.height + 2 * PAD;
    let mut data = vec![0u8; (pw * ph * 4) as usize];
    for y in 0..raster.height {
        let src = (y * raster.width * 4) as usize;
        let dst = (((y + PAD) * pw + PAD) * 4) as usize;
        data[dst..dst + (raster.width * 4) as usize]
            .copy_from_slice(&raster.data[src..src + (raster.width * 4) as usize]);
    }
    Ok(Content {
        width: pw,
        height: ph,
        data,
        origin: [
            raster.origin[0] - PAD as f64 / k,
            raster.origin[1] - PAD as f64 / k,
        ],
        px_per_unit: k,
    })
}
