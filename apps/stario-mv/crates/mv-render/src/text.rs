//! 文字の組版と画素化（cosmic-text）。
//!
//! ⚠️ **読み込んだフォントだけを使う**（パソコンに入っているフォントは見ない）＝どのパソコンでも同じ絵になる。
//! ⚠️ 指定のフォントが無いときは**黙って別のフォントにしない**（知らせる＝MV-0003 決定5）。

use crate::RenderError;
use cosmic_text::{
    Attrs, Buffer, Family, FontSystem, Metrics, Shaping, SwashCache, SwashContent, Weight,
};
use mv_core::model::{TextAlign, TextDocument};
use std::path::Path;

pub struct Fonts {
    system: FontSystem,
    cache: SwashCache,
}

/// 画素にした文字（RGBA8・乗算済み・sRGB）。
pub struct TextRaster {
    pub width: u32,
    pub height: u32,
    pub data: Vec<u8>,
    /// 画素 (0,0) の左上の角が、レイヤーの座標のどこか。
    pub origin: [f64; 2],
}

impl Fonts {
    /// フォントのファイル（.ttf・.otf・.ttc）を読み込む。フォルダを渡すと中のフォントを全部読む。
    pub fn load(paths: &[&Path]) -> Result<Self, RenderError> {
        let mut db = cosmic_text::fontdb::Database::new();
        for p in paths {
            if p.is_dir() {
                db.load_fonts_dir(p);
            } else {
                db.load_font_file(p).map_err(|e| {
                    RenderError::Font(format!(
                        "フォントを読めませんでした（{}・{e}）。",
                        p.display()
                    ))
                })?;
            }
        }
        if db.is_empty() {
            return Err(RenderError::Font(
                "フォントが1つも読み込めませんでした。フォントの置き場を確かめてください。".into(),
            ));
        }
        Ok(Self {
            system: FontSystem::new_with_locale_and_db("ja-JP".into(), db),
            cache: SwashCache::new(),
        })
    }

    /// 読み込んだフォントの名前（重複なし）。
    pub fn families(&self) -> Vec<String> {
        let mut v: Vec<String> = self
            .system
            .db()
            .faces()
            .flat_map(|f| f.families.iter().map(|(n, _)| n.clone()))
            .collect();
        v.sort();
        v.dedup();
        v
    }

    fn has_family(&self, name: &str) -> bool {
        self.system
            .db()
            .faces()
            .any(|f| f.families.iter().any(|(n, _)| n == name))
    }

    /// 文字を画素にする（k＝レイヤーの座標 1 単位あたりの画素）。
    pub fn render(&mut self, doc: &TextDocument, k: f64) -> Result<TextRaster, RenderError> {
        if !self.has_family(&doc.font_family) {
            return Err(RenderError::FontNotFound(doc.font_family.clone()));
        }
        let size = (doc.font_size * k) as f32;
        let line = (doc.font_size * doc.line_height.unwrap_or(1.2) * k) as f32;
        let mut buffer = Buffer::new(&mut self.system, Metrics::new(size, line));
        buffer.set_size(doc.box_width.map(|w| (w * k) as f32), None);
        let weight = match doc.font_style.as_deref() {
            Some(s) if s.to_lowercase().contains("bold") => Weight::BOLD,
            _ => Weight::NORMAL,
        };
        let attrs = Attrs::new()
            .family(Family::Name(&doc.font_family))
            .weight(weight);
        buffer.set_text(&doc.text, &attrs, Shaping::Advanced, None);
        buffer.shape_until_scroll(&mut self.system, false);

        let align = doc.align.unwrap_or(TextAlign::Left);
        let mut first_baseline: Option<f32> = None;
        // (x, y, 画像の幅, 高さ, 中身, 乗算済みにした RGBA)
        let mut glyphs: Vec<(i32, i32, u32, u32, Vec<u8>)> = Vec::new();
        let fill = doc.fill;
        for run in buffer.layout_runs() {
            first_baseline.get_or_insert(run.line_y);
            let x_off = match align {
                TextAlign::Left => 0.0,
                TextAlign::Center => -run.line_w / 2.0,
                TextAlign::Right => -run.line_w,
            };
            for g in run.glyphs.iter() {
                let phys = g.physical((x_off, run.line_y), 1.0);
                let Some(img) = self
                    .cache
                    .get_image(&mut self.system, phys.cache_key)
                    .as_ref()
                else {
                    continue;
                };
                let (w, h) = (img.placement.width, img.placement.height);
                if w == 0 || h == 0 {
                    continue;
                }
                let mut rgba = vec![0u8; (w * h * 4) as usize];
                match img.content {
                    SwashContent::Mask => {
                        for (i, m) in img.data.iter().enumerate() {
                            let a = (*m as f64 / 255.0) * fill[3];
                            rgba[i * 4] = (fill[0] * a * 255.0).round() as u8;
                            rgba[i * 4 + 1] = (fill[1] * a * 255.0).round() as u8;
                            rgba[i * 4 + 2] = (fill[2] * a * 255.0).round() as u8;
                            rgba[i * 4 + 3] = (a * 255.0).round() as u8;
                        }
                    }
                    SwashContent::Color => {
                        for i in 0..(w * h) as usize {
                            let a = img.data[i * 4 + 3] as u32;
                            for c in 0..3 {
                                rgba[i * 4 + c] =
                                    ((img.data[i * 4 + c] as u32 * a + 127) / 255) as u8;
                            }
                            rgba[i * 4 + 3] = a as u8;
                        }
                    }
                    SwashContent::SubpixelMask => continue,
                }
                glyphs.push((
                    phys.x + img.placement.left,
                    phys.y - img.placement.top,
                    w,
                    h,
                    rgba,
                ));
            }
        }
        let baseline = first_baseline.unwrap_or(0.0) as f64;
        if glyphs.is_empty() {
            return Ok(TextRaster {
                width: 1,
                height: 1,
                data: vec![0; 4],
                origin: [0.0, 0.0],
            });
        }
        let min_x = glyphs.iter().map(|g| g.0).min().unwrap();
        let min_y = glyphs.iter().map(|g| g.1).min().unwrap();
        let max_x = glyphs.iter().map(|g| g.0 + g.2 as i32).max().unwrap();
        let max_y = glyphs.iter().map(|g| g.1 + g.3 as i32).max().unwrap();
        let (tw, th) = ((max_x - min_x) as u32, (max_y - min_y) as u32);
        if tw as u64 * th as u64 > 16384 * 16384 {
            return Err(RenderError::TooLarge {
                width: tw,
                height: th,
            });
        }
        let mut data = vec![0u8; (tw * th * 4) as usize];
        for (gx, gy, w, h, rgba) in glyphs {
            for y in 0..h {
                for x in 0..w {
                    let s = ((y * w + x) * 4) as usize;
                    let d =
                        ((((gy - min_y) as u32 + y) * tw + (gx - min_x) as u32 + x) * 4) as usize;
                    let sa = rgba[s + 3] as u32;
                    for c in 0..4 {
                        // 重なりは「上に重ねる」（乗算済み）
                        data[d + c] = (rgba[s + c] as u32
                            + (data[d + c] as u32 * (255 - sa) + 127) / 255)
                            .min(255) as u8;
                    }
                }
            }
        }
        Ok(TextRaster {
            width: tw,
            height: th,
            data,
            origin: [min_x as f64 / k, (min_y as f64 - baseline) / k],
        })
    }
}
