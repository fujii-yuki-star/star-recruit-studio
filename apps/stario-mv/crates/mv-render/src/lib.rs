//! すたりおMV の描画の核＝ある時刻の1コマを描く（MV-0002・MV-0003）。
//!
//! ⚠️ プレビュー・書き出し・外部 AI の「1コマ描く」は**全部これを通す**（近似で書き写さない）。
//! 流れ＝レイヤーの中身を画素にする（CPU・[`raster`]）→ GPU で下から順に描画モードで混ぜる（[`composite.wgsl`]）。

pub mod media;
pub mod raster;
pub mod text;

use mv_core::eval::{invert, is_visible_at, mul, transform_at, Affine, EvalError};
use mv_core::model::{
    AssetKind, AssetSource, BlendMode, Composition, LayerType, Project, WorkingColorSpace,
};
use raster::Content;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use text::Fonts;

/// 描けなかった理由（⚠️ 黙って別の絵にしない＝必ずこれで知らせる）。
#[derive(Debug, Clone, PartialEq)]
pub enum RenderError {
    NoGpu(String),
    CompositionNotFound(String),
    /// この版ではまだ描けない（2段目の検査でも知らせるもの）。
    NotYetSupported(String),
    FontNotFound(String),
    Font(String),
    Asset(String),
    Eval(String),
    TooLarge {
        width: u32,
        height: u32,
    },
    Internal(String),
}

impl RenderError {
    fn eval(e: EvalError) -> Self {
        RenderError::Eval(format!("{e:?}"))
    }
}

impl std::fmt::Display for RenderError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            RenderError::NoGpu(e) => write!(f, "描くための GPU が見つかりません（{e}）。"),
            RenderError::CompositionNotFound(id) => write!(f, "コンポジション（{id}）が見つかりません。"),
            RenderError::NotYetSupported(what) => write!(f, "「{what}」はこの版ではまだ描けません。"),
            RenderError::FontNotFound(name) => write!(f, "フォント「{name}」が見つかりません。フォントを選び直すか、フォントを入れてください。"),
            RenderError::Font(e) | RenderError::Asset(e) | RenderError::Internal(e) => write!(f, "{e}"),
            RenderError::Eval(e) => write!(f, "値を求められませんでした（{e}）。"),
            RenderError::TooLarge { width, height } => write!(f, "大きすぎて描けません（{width}×{height}）。"),
        }
    }
}

impl std::error::Error for RenderError {}

/// GPU（画面なしでも使える）。
pub struct Gpu {
    pub device: wgpu::Device,
    pub queue: wgpu::Queue,
    pub adapter_name: String,
}

impl Gpu {
    /// 使える GPU を探す。専用の GPU が無ければソフトウェアの GPU（WARP など）でも動く＝CI でも描ける。
    pub fn new() -> Result<Self, RenderError> {
        let instance = wgpu::Instance::new(wgpu::InstanceDescriptor::new_without_display_handle());
        let adapter = pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions {
            power_preference: wgpu::PowerPreference::HighPerformance,
            ..Default::default()
        }))
        .or_else(|_| {
            pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions {
                force_fallback_adapter: true,
                ..Default::default()
            }))
        })
        .map_err(|e| RenderError::NoGpu(e.to_string()))?;
        let info = adapter.get_info();
        let (device, queue) =
            pollster::block_on(adapter.request_device(&wgpu::DeviceDescriptor::default()))
                .map_err(|e| RenderError::NoGpu(e.to_string()))?;
        Ok(Self {
            device,
            queue,
            adapter_name: format!("{} ({:?})", info.name, info.backend),
        })
    }
}

/// 描いた1コマ（RGBA8・乗算していない・sRGB）。
#[derive(Clone)]
pub struct Frame {
    pub width: u32,
    pub height: u32,
    pub data: Vec<u8>,
}

impl Frame {
    pub fn pixel(&self, x: u32, y: u32) -> [u8; 4] {
        let i = ((y * self.width + x) * 4) as usize;
        [
            self.data[i],
            self.data[i + 1],
            self.data[i + 2],
            self.data[i + 3],
        ]
    }
}

#[repr(C)]
#[derive(Clone, Copy, bytemuck::Pod, bytemuck::Zeroable)]
struct LayerUniform {
    m0: [f32; 4],
    m1: [f32; 4],
    opacity: f32,
    mode: u32,
    linear: u32,
    pad: u32,
}

const ACCUM_FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::Rgba16Float;
const OUT_FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::Rgba8Unorm;

/// 描く道具（GPU の準備・フォント・中身の画素の控え）。
pub struct Renderer {
    gpu: Gpu,
    fonts: Fonts,
    layout: wgpu::BindGroupLayout,
    layer_pipeline: wgpu::RenderPipeline,
    final_pipeline: wgpu::RenderPipeline,
    sampler: wgpu::Sampler,
    /// 中身の画素の控え（同じ中身を毎コマ作り直さない）。鍵＝中身を決めるものの写し。
    cache: HashMap<String, Content>,
    /// 映像の素材を読む FFmpeg（映像のレイヤーがあるときだけ要る＝MV-0006 決定4）。
    ffmpeg: Option<PathBuf>,
    /// 映像の素材の読み手（素材の場所ごと）。
    videos: HashMap<PathBuf, media::VideoDecoder>,
}

impl Renderer {
    pub fn new(gpu: Gpu, fonts: Fonts) -> Self {
        let d = &gpu.device;
        let shader = d.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("composite"),
            source: wgpu::ShaderSource::Wgsl(include_str!("composite.wgsl").into()),
        });
        let tex_entry = |binding| wgpu::BindGroupLayoutEntry {
            binding,
            visibility: wgpu::ShaderStages::FRAGMENT,
            ty: wgpu::BindingType::Texture {
                sample_type: wgpu::TextureSampleType::Float { filterable: true },
                view_dimension: wgpu::TextureViewDimension::D2,
                multisampled: false,
            },
            count: None,
        };
        let layout = d.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: None,
            entries: &[
                wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Uniform,
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
                tex_entry(1),
                wgpu::BindGroupLayoutEntry {
                    binding: 2,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                    count: None,
                },
                tex_entry(3),
            ],
        });
        let pl = d.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: None,
            bind_group_layouts: &[Some(&layout)],
            immediate_size: 0,
        });
        let pipeline = |entry: &str, format| {
            d.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                label: Some(entry),
                layout: Some(&pl),
                vertex: wgpu::VertexState {
                    module: &shader,
                    entry_point: Some("vs_full"),
                    buffers: &[],
                    compilation_options: Default::default(),
                },
                fragment: Some(wgpu::FragmentState {
                    module: &shader,
                    entry_point: Some(entry),
                    targets: &[Some(wgpu::ColorTargetState {
                        format,
                        blend: None,
                        write_mask: wgpu::ColorWrites::ALL,
                    })],
                    compilation_options: Default::default(),
                }),
                primitive: wgpu::PrimitiveState::default(),
                depth_stencil: None,
                multisample: wgpu::MultisampleState::default(),
                multiview_mask: None,
                cache: None,
            })
        };
        let layer_pipeline = pipeline("fs_layer", ACCUM_FORMAT);
        let final_pipeline = pipeline("fs_final", OUT_FORMAT);
        let sampler = d.create_sampler(&wgpu::SamplerDescriptor {
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            ..Default::default()
        });
        Self {
            gpu,
            fonts,
            layout,
            layer_pipeline,
            final_pipeline,
            sampler,
            cache: HashMap::new(),
            ffmpeg: None,
            videos: HashMap::new(),
        }
    }

    /// 映像の素材を読む FFmpeg の場所を渡す（書き出しと同じ探し方で見つけたもの）。
    pub fn set_ffmpeg(&mut self, ffmpeg: PathBuf) {
        if self.ffmpeg.as_ref() != Some(&ffmpeg) {
            self.videos.clear();
        }
        self.ffmpeg = Some(ffmpeg);
    }

    pub fn adapter_name(&self) -> &str {
        &self.gpu.adapter_name
    }

    /// コンポジションのある時刻を描く。`project_dir`＝素材（`assets/`）を読む場所。
    pub fn render(
        &mut self,
        project: &Project,
        composition_id: &str,
        frame: i64,
        project_dir: &Path,
    ) -> Result<Frame, RenderError> {
        let comp = project
            .compositions
            .iter()
            .find(|c| c.id == composition_id)
            .ok_or_else(|| RenderError::CompositionNotFound(composition_id.into()))?;
        let linear = project.settings.working_color_space == WorkingColorSpace::Linear;
        let (w, h) = (comp.width, comp.height);
        let d = &self.gpu.device;
        let accum = |label| {
            d.create_texture(&wgpu::TextureDescriptor {
                label: Some(label),
                size: wgpu::Extent3d {
                    width: w,
                    height: h,
                    depth_or_array_layers: 1,
                },
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format: ACCUM_FORMAT,
                usage: wgpu::TextureUsages::RENDER_ATTACHMENT
                    | wgpu::TextureUsages::TEXTURE_BINDING,
                view_formats: &[],
            })
        };
        let mut a = accum("accum-a");
        let mut b = accum("accum-b");

        // 背景（sRGB の値 → 作業の色空間・乗算済み）
        let bg = comp.background;
        let conv = |c: f64| if linear { srgb_to_linear(c) } else { c };
        let clear = wgpu::Color {
            r: conv(bg[0]) * bg[3],
            g: conv(bg[1]) * bg[3],
            b: conv(bg[2]) * bg[3],
            a: bg[3],
        };
        let mut enc = d.create_command_encoder(&Default::default());
        let a_view = a.create_view(&Default::default());
        let clear_pass = enc.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: None,
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                view: &a_view,
                depth_slice: None,
                resolve_target: None,
                ops: wgpu::Operations {
                    load: wgpu::LoadOp::Clear(clear),
                    store: wgpu::StoreOp::Store,
                },
            })],
            depth_stencil_attachment: None,
            timestamp_writes: None,
            occlusion_query_set: None,
            multiview_mask: None,
        });
        drop(clear_pass);
        self.gpu.queue.submit(Some(enc.finish()));

        let any_solo = comp.layers.iter().any(|l| l.solo == Some(true));
        // ⚠️ 先頭が最前面（MV-0001 決定6）＝描くのは末尾から
        for layer in comp.layers.iter().rev() {
            if !is_visible_at(layer, frame) || (any_solo && layer.solo != Some(true)) {
                continue;
            }
            let Some((content, m)) =
                self.layer_content(project, comp, layer, frame, project_dir)?
            else {
                continue;
            };
            self.composite_layer(&content, m, layer, frame, linear, &a, &b)?;
            std::mem::swap(&mut a, &mut b);
        }
        self.finish(&a, w, h, linear)
    }

    /// レイヤーの中身と、中身の画素 → コンポジションの画素 への変換。描くものが無ければ None。
    fn layer_content(
        &mut self,
        project: &Project,
        comp: &Composition,
        layer: &mv_core::model::Layer,
        frame: i64,
        project_dir: &Path,
    ) -> Result<Option<(Content, Affine)>, RenderError> {
        let f = frame as f64;
        let t = transform_at(&layer.transform, f).map_err(RenderError::eval)?;
        if t.opacity <= 0.0 {
            return Ok(None);
        }
        // 拡大されても粗くならない細かさ（1〜8 倍）
        let k = t.scale[0]
            .abs()
            .max(t.scale[1].abs())
            .clamp(1.0, 8.0)
            .ceil();
        let (key, content) = match layer.layer_type {
            LayerType::Solid => {
                let s = layer
                    .solid
                    .as_ref()
                    .ok_or_else(|| RenderError::Internal("単色の中身が無い".into()))?;
                let key = format!("solid|{:?}|{}|{}|{k}", s.color, s.width, s.height);
                (key, None)
            }
            LayerType::Shape => {
                let s = layer
                    .shape
                    .as_ref()
                    .ok_or_else(|| RenderError::Internal("図形の中身が無い".into()))?;
                let size = s
                    .size
                    .as_ref()
                    .map(|a| mv_core::eval::vec_at::<2>(a, f))
                    .transpose()
                    .map_err(RenderError::eval)?;
                let radius = s
                    .corner_radius
                    .as_ref()
                    .map(|a| mv_core::eval::number_at(a, f))
                    .transpose()
                    .map_err(RenderError::eval)?;
                (format!("shape|{}|{size:?}|{radius:?}|{k}", layer.id), None)
            }
            LayerType::Text => {
                let doc = layer
                    .text
                    .as_ref()
                    .ok_or_else(|| RenderError::Internal("文字の中身が無い".into()))?;
                (format!("text|{doc:?}|{k}"), None)
            }
            LayerType::Image => {
                let (kind, path) = asset_path(project, layer, project_dir)?;
                let svg = kind == AssetKind::Svg;
                let key = if svg {
                    format!("svg|{}|{k}", path.display())
                } else {
                    format!("image|{}", path.display())
                };
                if self.cache.contains_key(&key) {
                    (key, None)
                } else {
                    let bytes = read_asset(&path)?;
                    let c = if svg {
                        raster::svg(&bytes, k)?
                    } else {
                        raster::image(&bytes)?
                    };
                    (key, Some(c))
                }
            }
            LayerType::Audio => return Ok(None),
            LayerType::Video => {
                // ⚠️ 映像のコマは控えに入れない（毎コマ変わる＝控えると記憶を食いつぶす）
                let (kind, path) = asset_path(project, layer, project_dir)?;
                let t_sec = (frame - layer.start_frame) as f64 * f64::from(comp.fps.den)
                    / f64::from(comp.fps.num);
                let content = match kind {
                    AssetKind::ImageSequence => {
                        let fps = asset_fps(project, layer).unwrap_or(30.0);
                        let idx = (t_sec * fps + 1e-6).floor();
                        let count = project
                            .assets
                            .iter()
                            .find(|a| Some(&a.id) == layer.asset_id.as_ref())
                            .and_then(|a| a.meta.as_ref())
                            .and_then(|m| m.frame_count);
                        if idx < 0.0 || count.is_some_and(|c| idx as u64 >= u64::from(c)) {
                            return Ok(None);
                        }
                        let p = media::sequence_path(&path, idx as u64).ok_or_else(|| {
                            RenderError::Asset(format!(
                                "連番の名前の末尾に番号がありません（{}）。",
                                path.display()
                            ))
                        })?;
                        if count.is_none() && !p.is_file() {
                            return Ok(None);
                        }
                        raster::image(&read_asset(&p)?)?
                    }
                    _ => {
                        let ffmpeg = self.ffmpeg.clone().ok_or_else(|| {
                            RenderError::Asset(
                                "映像を読むには FFmpeg が要ります。FFmpeg の場所を設定してください。"
                                    .into(),
                            )
                        })?;
                        if !self.videos.contains_key(&path) {
                            let d = media::VideoDecoder::open(&ffmpeg, &path)?;
                            if d.info.alpha_mode && d.info.alpha_decoder().is_none() {
                                return Err(RenderError::Asset(format!(
                                    "この映像の透過（{}）を読めません。",
                                    d.info.codec
                                )));
                            }
                            self.videos.insert(path.clone(), d);
                        }
                        let d = self.videos.get_mut(&path).expect("直前で開いた");
                        let idx = d.frame_index(t_sec);
                        let (w, h) = (d.info.width, d.info.height);
                        match d.frame(idx)? {
                            Some(px) => raster::rgba(w, h, px),
                            None => return Ok(None),
                        }
                    }
                };
                let px_to_local: Affine = [
                    1.0 / content.px_per_unit,
                    0.0,
                    0.0,
                    1.0 / content.px_per_unit,
                    content.origin[0],
                    content.origin[1],
                ];
                return Ok(Some((content, mul(t.matrix(), px_to_local))));
            }
            other => {
                return Err(RenderError::NotYetSupported(format!(
                    "{other:?} のレイヤー"
                )))
            }
        };
        if let Some(c) = content {
            self.cache.insert(key.clone(), c);
        }
        if !self.cache.contains_key(&key) {
            let c = match layer.layer_type {
                LayerType::Solid => {
                    let s = layer.solid.as_ref().unwrap();
                    raster::solid(&s.color, s.width, s.height, k)?
                }
                LayerType::Shape => raster::shape(layer.shape.as_ref().unwrap(), f, k)?,
                LayerType::Text => raster::text(layer, &mut self.fonts, k)?,
                _ => unreachable!(),
            };
            self.cache.insert(key.clone(), c);
        }
        let content = self.cache.get(&key).unwrap().clone();
        // 中身の画素 → レイヤーの座標 → コンポジションの座標
        let px_to_local: Affine = [
            1.0 / content.px_per_unit,
            0.0,
            0.0,
            1.0 / content.px_per_unit,
            content.origin[0],
            content.origin[1],
        ];
        Ok(Some((content, mul(t.matrix(), px_to_local))))
    }

    #[allow(clippy::too_many_arguments)]
    fn composite_layer(
        &self,
        content: &Content,
        m: Affine,
        layer: &mv_core::model::Layer,
        frame: i64,
        linear: bool,
        back: &wgpu::Texture,
        out: &wgpu::Texture,
    ) -> Result<(), RenderError> {
        let d = &self.gpu.device;
        let q = &self.gpu.queue;
        let tex = d.create_texture(&wgpu::TextureDescriptor {
            label: Some("content"),
            size: wgpu::Extent3d {
                width: content.width,
                height: content.height,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8Unorm,
            usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
            view_formats: &[],
        });
        q.write_texture(
            wgpu::TexelCopyTextureInfo {
                texture: &tex,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            &content.data,
            wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(content.width * 4),
                rows_per_image: Some(content.height),
            },
            wgpu::Extent3d {
                width: content.width,
                height: content.height,
                depth_or_array_layers: 1,
            },
        );
        // コンポジションの画素 → 中身の画素
        let inv = invert(m).ok_or_else(|| {
            RenderError::Eval(format!(
                "「{}」の大きさが 0 です（{frame} フレーム）",
                layer.name
            ))
        })?;
        let opacity = transform_at(&layer.transform, frame as f64)
            .map_err(RenderError::eval)?
            .opacity;
        let u = LayerUniform {
            m0: [inv[0] as f32, inv[1] as f32, inv[2] as f32, inv[3] as f32],
            m1: [
                inv[4] as f32,
                inv[5] as f32,
                content.width as f32,
                content.height as f32,
            ],
            opacity: opacity as f32,
            mode: blend_id(layer.blend_mode),
            linear: linear as u32,
            pad: 0,
        };
        self.pass(&self.layer_pipeline, &u, &tex, back, out);
        Ok(())
    }

    fn pass(
        &self,
        pipeline: &wgpu::RenderPipeline,
        u: &LayerUniform,
        content: &wgpu::Texture,
        back: &wgpu::Texture,
        out: &wgpu::Texture,
    ) {
        let d = &self.gpu.device;
        let ub = d.create_buffer(&wgpu::BufferDescriptor {
            label: None,
            size: std::mem::size_of::<LayerUniform>() as u64,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        self.gpu.queue.write_buffer(&ub, 0, bytemuck::bytes_of(u));
        let bg = d.create_bind_group(&wgpu::BindGroupDescriptor {
            label: None,
            layout: &self.layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: ub.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: wgpu::BindingResource::TextureView(
                        &content.create_view(&Default::default()),
                    ),
                },
                wgpu::BindGroupEntry {
                    binding: 2,
                    resource: wgpu::BindingResource::Sampler(&self.sampler),
                },
                wgpu::BindGroupEntry {
                    binding: 3,
                    resource: wgpu::BindingResource::TextureView(
                        &back.create_view(&Default::default()),
                    ),
                },
            ],
        });
        let mut enc = d.create_command_encoder(&Default::default());
        {
            let view = out.create_view(&Default::default());
            let mut p = enc.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: None,
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &view,
                    depth_slice: None,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT),
                        store: wgpu::StoreOp::Store,
                    },
                })],
                depth_stencil_attachment: None,
                timestamp_writes: None,
                occlusion_query_set: None,
                multiview_mask: None,
            });
            p.set_pipeline(pipeline);
            p.set_bind_group(0, &bg, &[]);
            p.draw(0..3, 0..1);
        }
        self.gpu.queue.submit(Some(enc.finish()));
    }

    fn finish(
        &self,
        accum: &wgpu::Texture,
        w: u32,
        h: u32,
        linear: bool,
    ) -> Result<Frame, RenderError> {
        let d = &self.gpu.device;
        let out = d.create_texture(&wgpu::TextureDescriptor {
            label: Some("out"),
            size: wgpu::Extent3d {
                width: w,
                height: h,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: OUT_FORMAT,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
            view_formats: &[],
        });
        // 仕上げの段は中身を読まない（同じ形の束を使うため、小さな空の中身を渡す）
        let dummy = d.create_texture(&wgpu::TextureDescriptor {
            label: None,
            size: wgpu::Extent3d {
                width: 1,
                height: 1,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8Unorm,
            usage: wgpu::TextureUsages::TEXTURE_BINDING,
            view_formats: &[],
        });
        let u = LayerUniform {
            m0: [0.0; 4],
            m1: [0.0; 4],
            opacity: 1.0,
            mode: 0,
            linear: linear as u32,
            pad: 0,
        };
        self.pass(&self.final_pipeline, &u, &dummy, accum, &out);
        read_back(&self.gpu, &out, w, h)
    }
}

fn read_back(gpu: &Gpu, tex: &wgpu::Texture, w: u32, h: u32) -> Result<Frame, RenderError> {
    let row = w * 4;
    let padded = row.div_ceil(256) * 256;
    let buf = gpu.device.create_buffer(&wgpu::BufferDescriptor {
        label: None,
        size: (padded * h) as u64,
        usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
        mapped_at_creation: false,
    });
    let mut enc = gpu.device.create_command_encoder(&Default::default());
    enc.copy_texture_to_buffer(
        wgpu::TexelCopyTextureInfo {
            texture: tex,
            mip_level: 0,
            origin: wgpu::Origin3d::ZERO,
            aspect: wgpu::TextureAspect::All,
        },
        wgpu::TexelCopyBufferInfo {
            buffer: &buf,
            layout: wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(padded),
                rows_per_image: Some(h),
            },
        },
        wgpu::Extent3d {
            width: w,
            height: h,
            depth_or_array_layers: 1,
        },
    );
    gpu.queue.submit(Some(enc.finish()));
    let slice = buf.slice(..);
    let (tx, rx) = futures_channel::oneshot::channel();
    slice.map_async(wgpu::MapMode::Read, move |r| {
        let _ = tx.send(r);
    });
    let _ = gpu.device.poll(wgpu::PollType::Wait {
        submission_index: None,
        timeout: None,
    });
    pollster::block_on(rx)
        .map_err(|e| RenderError::Internal(e.to_string()))?
        .map_err(|e| RenderError::Internal(e.to_string()))?;
    let mapped = slice
        .get_mapped_range()
        .map_err(|e| RenderError::Internal(format!("{e:?}")))?;
    let mut data = Vec::with_capacity((row * h) as usize);
    for y in 0..h {
        let s = (y * padded) as usize;
        data.extend_from_slice(&mapped[s..s + row as usize]);
    }
    drop(mapped);
    buf.unmap();
    Ok(Frame {
        width: w,
        height: h,
        data,
    })
}

fn asset_path(
    project: &Project,
    layer: &mv_core::model::Layer,
    project_dir: &Path,
) -> Result<(AssetKind, PathBuf), RenderError> {
    let id = layer
        .asset_id
        .as_deref()
        .ok_or_else(|| RenderError::Internal("素材を指していない".into()))?;
    let asset = project
        .assets
        .iter()
        .find(|a| a.id == id)
        .ok_or_else(|| RenderError::Asset(format!("素材（{id}）が見つかりません。")))?;
    let path = match &asset.source {
        AssetSource::Copied { path } => project_dir.join(path),
        AssetSource::Referenced { absolute_path } => PathBuf::from(absolute_path),
    };
    Ok((asset.kind, path))
}

fn asset_fps(project: &Project, layer: &mv_core::model::Layer) -> Option<f64> {
    let a = project
        .assets
        .iter()
        .find(|a| Some(&a.id) == layer.asset_id.as_ref())?;
    let f = a.meta.as_ref()?.fps?;
    (f.num > 0 && f.den > 0).then(|| f64::from(f.num) / f64::from(f.den))
}

fn read_asset(path: &Path) -> Result<Vec<u8>, RenderError> {
    std::fs::read(path).map_err(|e| {
        RenderError::Asset(format!(
            "素材のファイルを読めませんでした（{}・{e}）。素材を取り込み直してください。",
            path.display()
        ))
    })
}

fn srgb_to_linear(c: f64) -> f64 {
    if c <= 0.04045 {
        c / 12.92
    } else {
        ((c + 0.055) / 1.055).powf(2.4)
    }
}

/// 描画モードの番号（composite.wgsl の switch と同じ並び）。
fn blend_id(m: BlendMode) -> u32 {
    match m {
        BlendMode::Normal => 0,
        BlendMode::Add => 1,
        BlendMode::Multiply => 2,
        BlendMode::Screen => 3,
        BlendMode::Overlay => 4,
        BlendMode::SoftLight => 5,
        BlendMode::HardLight => 6,
        BlendMode::ColorDodge => 7,
        BlendMode::ColorBurn => 8,
        BlendMode::Darken => 9,
        BlendMode::Lighten => 10,
        BlendMode::Difference => 11,
        BlendMode::Exclusion => 12,
        BlendMode::Hue => 13,
        BlendMode::Saturation => 14,
        BlendMode::Color => 15,
        BlendMode::Luminosity => 16,
    }
}
