//! すたりおMV の描画の核＝ある時刻の1コマを描く（MV-0002・MV-0003）。
//!
//! ⚠️ プレビュー・書き出し・外部 AI の「1コマ描く」は**全部これを通す**（近似で書き写さない）。
//! 流れ＝レイヤーの中身を画素にする（CPU・[`raster`]）→ GPU で下から順に描画モードで混ぜる（[`composite.wgsl`]）。

pub mod media;
pub mod present;
pub mod raster;
pub mod text;

use mv_core::eval::{invert, is_visible_at, mul, transform_at, Affine, EvalError, IDENTITY};
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

    /// 窓（surface）に描ける GPU を選ぶ＝プレビューで、描画の核と窓の両方に同じものを使う（MV-0007 決定1）。
    pub fn for_surface(
        instance: &wgpu::Instance,
        surface: &wgpu::Surface,
    ) -> Result<(Self, wgpu::Adapter), RenderError> {
        let adapter = pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions {
            power_preference: wgpu::PowerPreference::HighPerformance,
            compatible_surface: Some(surface),
            ..Default::default()
        }))
        .map_err(|e| RenderError::NoGpu(e.to_string()))?;
        let info = adapter.get_info();
        let (device, queue) =
            pollster::block_on(adapter.request_device(&wgpu::DeviceDescriptor::default()))
                .map_err(|e| RenderError::NoGpu(e.to_string()))?;
        Ok((
            Self {
                device,
                queue,
                adapter_name: format!("{} ({:?})", info.name, info.backend),
            },
            adapter,
        ))
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
    /// 1＝中身が既に作業の色空間・乗算済み（入れ子）＝読むときに直さない。
    src_working: u32,
}

/// 合成の「足す」（モーションブラーの平均＝MV-0013 決定3）。描画モードの番号と重ならない値。
const ACCUMULATE: u32 = 100;

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

    /// 描く道具の GPU（プレビューが窓へ写すときに同じものを使う）。
    pub fn gpu(&self) -> &Gpu {
        &self.gpu
    }

    /// コンポジションのある時刻を描く（書き出しと同じ）。
    pub fn render(
        &mut self,
        project: &Project,
        composition_id: &str,
        frame: i64,
        project_dir: &Path,
    ) -> Result<Frame, RenderError> {
        let tex = self.render_texture(project, composition_id, frame, project_dir)?;
        let size = tex.size();
        read_back(&self.gpu, &tex, size.width, size.height)
    }

    /// コンポジションのある時刻を描いて、GPU に置いたままの絵を返す（乗算していない sRGB の RGBA8）。
    /// `project_dir`＝素材（`assets/`）を読む場所。⚠️ プレビューはこれを窓へ写す＝書き出しと同じ絵（MV-0007 決定1）。
    pub fn render_texture(
        &mut self,
        project: &Project,
        composition_id: &str,
        frame: i64,
        project_dir: &Path,
    ) -> Result<wgpu::Texture, RenderError> {
        let comp = project
            .compositions
            .iter()
            .find(|c| c.id == composition_id)
            .ok_or_else(|| RenderError::CompositionNotFound(composition_id.into()))?;
        let linear = project.settings.working_color_space == WorkingColorSpace::Linear;
        let accum = self.render_accum(project, comp, frame, project_dir, linear, true, 0)?;
        self.finish(&accum, comp.width, comp.height, linear)
    }

    /// コンポジションのある時刻を、作業の色空間・乗算済みの絵として描く（仕上げの前）。
    /// `with_background`＝背景の色で塗る（入れ子の中は塗らない＝透明な地・MV-0011 決定1）。`depth`＝入れ子の深さ。
    #[allow(clippy::too_many_arguments)]
    fn render_accum(
        &mut self,
        project: &Project,
        comp: &mv_core::model::Composition,
        frame: i64,
        project_dir: &Path,
        linear: bool,
        with_background: bool,
        depth: u32,
    ) -> Result<wgpu::Texture, RenderError> {
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
        let bg = if with_background {
            comp.background
        } else {
            [0.0, 0.0, 0.0, 0.0]
        };
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

        // ⚠️ 先頭が最前面（MV-0001 決定6）＝描くのは末尾から
        for layer in shown_layers(comp, frame).into_iter().rev() {
            // 入れ子＝中を同じ描画の核で描き、作業の色空間の絵のまま重ねる（MV-0011 決定1）
            let (tex, cw, ch, m, src_working) = if layer.layer_type == LayerType::Precomp {
                match self.precomp_content(
                    project,
                    comp,
                    layer,
                    frame,
                    project_dir,
                    linear,
                    depth,
                )? {
                    Some((tex, iw, ih, m)) => (tex, iw, ih, m, true),
                    None => continue,
                }
            } else {
                match self.layer_content(project, comp, layer, frame, project_dir)? {
                    Some((content, m)) => (
                        self.upload(&content),
                        content.width,
                        content.height,
                        m,
                        false,
                    ),
                    None => continue,
                }
            };
            // モーションブラー（MV-0013）＝1コマの中の時刻の変形で描いて平均する
            match mv_core::eval::blur_times(comp, layer, frame as f64) {
                Some(times) => self.composite_blurred(
                    &tex,
                    cw,
                    ch,
                    m,
                    comp,
                    layer,
                    frame,
                    &times,
                    linear,
                    src_working,
                    &a,
                    &b,
                )?,
                None => self.composite_texture(
                    &tex,
                    cw,
                    ch,
                    m,
                    layer,
                    frame,
                    linear,
                    src_working,
                    &a,
                    &b,
                )?,
            }
            std::mem::swap(&mut a, &mut b);
        }
        Ok(a)
    }

    /// 作業の色空間の絵を置く入れ物（コンポジションの大きさ・最初は透明＝wgpu は 0 で埋める）。
    fn accum_texture(&self, w: u32, h: u32, label: &str) -> wgpu::Texture {
        self.gpu.device.create_texture(&wgpu::TextureDescriptor {
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
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::TEXTURE_BINDING,
            view_formats: &[],
        })
    }

    /// モーションブラー（MV-0013 決定2・決定3）：そのレイヤーだけを透明な地に各時刻の変形で描いて平均し、
    /// 平均した絵（作業の色空間・乗算済み）に描画モードを1回だけ掛けて重ねる。動いていなければ1回で描く。
    #[allow(clippy::too_many_arguments)]
    fn composite_blurred(
        &self,
        tex: &wgpu::Texture,
        cw: u32,
        ch: u32,
        m: Affine,
        comp: &mv_core::model::Composition,
        layer: &mv_core::model::Layer,
        frame: i64,
        times: &[f64],
        linear: bool,
        src_working: bool,
        back: &wgpu::Texture,
        out: &wgpu::Texture,
    ) -> Result<(), RenderError> {
        let f = frame as f64;
        let w0 = mv_core::eval::world_matrix(comp, layer, f).map_err(RenderError::eval)?;
        // 中身の画素 → レイヤーの座標（そのコマの変形を外したもの）
        let local = match invert(w0) {
            Some(i) => mul(i, m),
            None => {
                return self.composite_texture(
                    tex,
                    cw,
                    ch,
                    m,
                    layer,
                    frame,
                    linear,
                    src_working,
                    back,
                    out,
                )
            }
        };
        let mut samples = Vec::with_capacity(times.len());
        for &t in times {
            let wt = mv_core::eval::world_matrix(comp, layer, t).map_err(RenderError::eval)?;
            let op = transform_at(&layer.transform, t)
                .map_err(RenderError::eval)?
                .opacity;
            samples.push((mul(wt, local), op));
        }
        let op0 = samples[0].1;
        if samples
            .iter()
            .all(|(mt, op)| *mt == samples[0].0 && *op == op0)
        {
            // 動いていない＝ぼかさない（そのコマの変形で1回）
            return self.composite_texture(
                tex,
                cw,
                ch,
                m,
                layer,
                frame,
                linear,
                src_working,
                back,
                out,
            );
        }
        let (w, h) = (comp.width, comp.height);
        let clear = self.accum_texture(w, h, "blur-clear");
        let single = self.accum_texture(w, h, "blur-single");
        let mut acc = self.accum_texture(w, h, "blur-acc-a");
        let mut next = self.accum_texture(w, h, "blur-acc-b");
        let weight = 1.0 / samples.len() as f64;
        for (mt, op) in &samples {
            if invert(*mt).is_none() {
                // その時刻は大きさが 0＝何も写らない（透明のまま平均に入る）
                continue;
            }
            // そのレイヤーだけ（普通の重ね方・その時刻の不透明度）
            self.draw(
                tex,
                cw,
                ch,
                *mt,
                *op,
                0,
                linear,
                src_working,
                &layer.name,
                frame,
                &clear,
                &single,
            )?;
            // 足して平均する
            self.draw(
                &single,
                w,
                h,
                IDENTITY,
                weight,
                ACCUMULATE,
                linear,
                true,
                &layer.name,
                frame,
                &acc,
                &next,
            )?;
            std::mem::swap(&mut acc, &mut next);
        }
        // 平均した絵を、描画モードで1回（不透明度は各時刻で掛けた）
        self.draw(
            &acc,
            w,
            h,
            IDENTITY,
            1.0,
            blend_id(layer.blend_mode),
            linear,
            true,
            &layer.name,
            frame,
            back,
            out,
        )
    }

    /// 入れ子のレイヤーの中身（作業の色空間の絵・大きさ・中身の画素 → コンポジションの画素）。描くものが無ければ None。
    #[allow(clippy::too_many_arguments, clippy::type_complexity)]
    fn precomp_content(
        &mut self,
        project: &Project,
        comp: &mv_core::model::Composition,
        layer: &mv_core::model::Layer,
        frame: i64,
        project_dir: &Path,
        linear: bool,
        depth: u32,
    ) -> Result<Option<(wgpu::Texture, u32, u32, Affine)>, RenderError> {
        let f = frame as f64;
        let t = transform_at(&layer.transform, f).map_err(RenderError::eval)?;
        if t.opacity <= 0.0 {
            return Ok(None);
        }
        let inner = nested_comp(project, layer)?;
        let Some(inner_frame) = nested_frame(comp, inner, layer, frame)? else {
            return Ok(None);
        };
        if depth + 1 > MAX_NEST_DEPTH {
            return Err(RenderError::Eval(format!(
                "「{}」の入れ子が深すぎます（{MAX_NEST_DEPTH} 段まで）。入れ子を減らしてください。",
                layer.name
            )));
        }
        let tex = self.render_accum(
            project,
            inner,
            inner_frame,
            project_dir,
            linear,
            false,
            depth + 1,
        )?;
        let world = mv_core::eval::world_matrix(comp, layer, f).map_err(RenderError::eval)?;
        Ok(Some((tex, inner.width, inner.height, world)))
    }

    /// 見えているレイヤーの枠＝中身の四隅をコンポジションの画素で（MV-0008 決定6）。並びは先頭が最前面。
    /// ⚠️ 描くときと同じ中身の大きさ・変形を通す（`layer_content`）＝画面で近似で描き写さない。描くものの無いレイヤー（音・透明）は入れない。
    /// ⚠️ 中身は縁をなめらかにする余白を持つ＝枠は描いた絵の外枠（中身の大きさより1画素ほど広いことがある）。
    pub fn layer_quads(
        &mut self,
        project: &Project,
        composition_id: &str,
        frame: i64,
        project_dir: &Path,
    ) -> Result<Vec<LayerQuad>, RenderError> {
        let comp = project
            .compositions
            .iter()
            .find(|c| c.id == composition_id)
            .ok_or_else(|| RenderError::CompositionNotFound(composition_id.into()))?;
        let mut out = Vec::new();
        for layer in shown_layers(comp, frame) {
            // ヌルは描かないが、選べる・掴めるように 100×100 の枠を返す（AE のヌルと同じ＝MV-0010 決定5）
            if layer.layer_type == LayerType::Null {
                let m = mv_core::eval::world_matrix(comp, layer, frame as f64)
                    .map_err(RenderError::eval)?;
                out.push(LayerQuad {
                    layer_id: layer.id.clone(),
                    corners: quad_of(m, NULL_SIZE, NULL_SIZE),
                    parent_linear: parent_linear(comp, layer, frame)?,
                });
                continue;
            }
            if layer.layer_type == LayerType::Precomp {
                let inner = nested_comp(project, layer)?;
                let m = mv_core::eval::world_matrix(comp, layer, frame as f64)
                    .map_err(RenderError::eval)?;
                out.push(LayerQuad {
                    layer_id: layer.id.clone(),
                    corners: quad_of(m, inner.width, inner.height),
                    parent_linear: parent_linear(comp, layer, frame)?,
                });
                continue;
            }
            if let Some((content, m)) =
                self.layer_content(project, comp, layer, frame, project_dir)?
            {
                out.push(LayerQuad {
                    layer_id: layer.id.clone(),
                    corners: quad_of(m, content.width, content.height),
                    parent_linear: parent_linear(comp, layer, frame)?,
                });
            }
        }
        Ok(out)
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
        // 親の変形まで掛ける（MV-0010 決定5）。⚠️ 不透明度は自分のだけ（親のは引き継がない）
        let world = mv_core::eval::world_matrix(comp, layer, f).map_err(RenderError::eval)?;
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
            // ヌルは描かない（親にするための入れ物＝MV-0010 決定5）
            LayerType::Null => return Ok(None),
            LayerType::Video => {
                // ⚠️ 映像のコマは控えに入れない（毎コマ変わる＝控えると記憶を食いつぶす）
                let (kind, path) = asset_path(project, layer, project_dir)?;
                // 素材の秒（タイムリマップがあればその値・MV-0012 決定1）
                let t_sec = mv_core::eval::source_sec(comp, layer, frame as f64)
                    .map_err(RenderError::eval)?;
                let remapped = layer.time_remap.is_some();
                let content = match kind {
                    AssetKind::ImageSequence => {
                        let fps = asset_fps(project, layer).unwrap_or(30.0);
                        let count = project
                            .assets
                            .iter()
                            .find(|a| Some(&a.id) == layer.asset_id.as_ref())
                            .and_then(|a| a.meta.as_ref())
                            .and_then(|m| m.frame_count);
                        let mut idx = (t_sec * fps + 1e-6).floor();
                        if remapped {
                            idx = hold_index(idx as i64, count.map(u64::from)) as f64;
                        }
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
                        let mut idx = d.frame_index(t_sec);
                        if remapped {
                            idx = hold_index(idx, d.info.frame_count);
                        }
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
                return Ok(Some((content, mul(world, px_to_local))));
            }
            other => {
                return Err(RenderError::NotYetSupported(format!(
                    "{}のレイヤー",
                    layer_type_name(other)
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
        Ok(Some((content, mul(world, px_to_local))))
    }

    #[allow(clippy::too_many_arguments)]
    /// 中身（乗算済み・sRGB の RGBA8）を GPU へ。
    fn upload(&self, content: &Content) -> wgpu::Texture {
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
        tex
    }

    /// 中身の絵（GPU）を、変換 `m` で重ねる。`src_working`＝中身が既に作業の色空間・乗算済み（入れ子＝MV-0011 決定1）。
    #[allow(clippy::too_many_arguments)]
    fn composite_texture(
        &self,
        tex: &wgpu::Texture,
        cw: u32,
        ch: u32,
        m: Affine,
        layer: &mv_core::model::Layer,
        frame: i64,
        linear: bool,
        src_working: bool,
        back: &wgpu::Texture,
        out: &wgpu::Texture,
    ) -> Result<(), RenderError> {
        let opacity = transform_at(&layer.transform, frame as f64)
            .map_err(RenderError::eval)?
            .opacity;
        self.draw(
            tex,
            cw,
            ch,
            m,
            opacity,
            blend_id(layer.blend_mode),
            linear,
            src_working,
            &layer.name,
            frame,
            back,
            out,
        )
    }

    /// 中身の絵を、変換 `m`・不透明度・描画モード（[`blend_id`] か [`ACCUMULATE`]）で `back` に重ねて `out` へ。
    #[allow(clippy::too_many_arguments)]
    fn draw(
        &self,
        tex: &wgpu::Texture,
        cw: u32,
        ch: u32,
        m: Affine,
        opacity: f64,
        mode: u32,
        linear: bool,
        src_working: bool,
        name: &str,
        frame: i64,
        back: &wgpu::Texture,
        out: &wgpu::Texture,
    ) -> Result<(), RenderError> {
        // コンポジションの画素 → 中身の画素
        let inv = invert(m).ok_or_else(|| {
            RenderError::Eval(format!("「{name}」の大きさが 0 です（{frame} フレーム）"))
        })?;
        let u = LayerUniform {
            m0: [inv[0] as f32, inv[1] as f32, inv[2] as f32, inv[3] as f32],
            m1: [inv[4] as f32, inv[5] as f32, cw as f32, ch as f32],
            opacity: opacity as f32,
            mode,
            linear: linear as u32,
            src_working: src_working as u32,
        };
        self.pass(&self.layer_pipeline, &u, tex, back, out);
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
    ) -> Result<wgpu::Texture, RenderError> {
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
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT
                | wgpu::TextureUsages::COPY_SRC
                | wgpu::TextureUsages::TEXTURE_BINDING,
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
            src_working: 0,
        };
        self.pass(&self.final_pipeline, &u, &dummy, accum, &out);
        Ok(out)
    }
}

/// GPU の絵を CPU へ読み戻す（書き出し・検査）。
pub fn read_back(gpu: &Gpu, tex: &wgpu::Texture, w: u32, h: u32) -> Result<Frame, RenderError> {
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

/// レイヤーの種類の名前（知らせる文に出す・AE の呼び名）。
pub fn layer_type_name(t: LayerType) -> &'static str {
    match t {
        LayerType::Video => "映像",
        LayerType::Image => "画像",
        LayerType::Text => "文字",
        LayerType::Shape => "シェイプ",
        LayerType::Solid => "平面",
        LayerType::Adjustment => "調整",
        LayerType::Null => "ヌル",
        LayerType::Camera => "カメラ",
        LayerType::Audio => "音",
        LayerType::Precomp => "プリコンポーズ",
    }
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

/// レイヤーの枠（MV-0008 決定6）。`corners`＝中身の左上・右上・右下・左下を、コンポジションの画素で。
#[derive(Debug, Clone, PartialEq)]
pub struct LayerQuad {
    pub layer_id: String,
    pub corners: [[f64; 2]; 4],
    /// 親の変形の向きと大きさ（[a, b, c, d]・親が無ければ単位）。画面で掴んだ量を、位置（親の座標）の差へ戻すのに使う。
    pub parent_linear: [f64; 4],
}

/// 入れ子の深さの上限（MV-0011 決定1）。
pub const MAX_NEST_DEPTH: u32 = 16;

/// 入れ子のレイヤーが指すコンポジション。
fn nested_comp<'a>(
    project: &'a Project,
    layer: &mv_core::model::Layer,
) -> Result<&'a mv_core::model::Composition, RenderError> {
    let id = layer.composition_id.as_deref().unwrap_or_default();
    project
        .compositions
        .iter()
        .find(|c| c.id == id)
        .ok_or_else(|| RenderError::CompositionNotFound(id.into()))
}

/// 外のフレーム → 入れ子の中のフレーム（MV-0011 決定2＝秒にして中の fps で切り捨て）。中の長さの外なら None。
/// タイムリマップがあれば、その秒の中のフレーム・範囲の外は端で止める（MV-0012 決定1）。
pub fn nested_frame(
    outer: &mv_core::model::Composition,
    inner: &mv_core::model::Composition,
    layer: &mv_core::model::Layer,
    frame: i64,
) -> Result<Option<i64>, RenderError> {
    let sec = mv_core::eval::source_sec(outer, layer, frame as f64).map_err(RenderError::eval)?;
    let f = (sec * f64::from(inner.fps.num) / f64::from(inner.fps.den) + 1e-6).floor() as i64;
    let count = u64::from(inner.duration_frames);
    Ok(if layer.time_remap.is_some() {
        Some(hold_index(f, Some(count)))
    } else {
        (0..count as i64).contains(&f).then_some(f)
    })
}

/// タイムリマップの範囲の外は端のコマで止める（MV-0012 決定1＝AE と同じ）。コマ数がわからなければ 0 より前だけ止める。
pub fn hold_index(k: i64, count: Option<u64>) -> i64 {
    let k = k.max(0);
    match count {
        Some(c) if c > 0 => k.min(c as i64 - 1),
        _ => k,
    }
}

/// ヌルの枠の大きさ（レイヤーの座標・AE のヌルと同じ 100×100）。
pub const NULL_SIZE: u32 = 100;

/// 親の変形（親の親まで）の向きと大きさの部分。親が無ければ単位。
fn parent_linear(
    comp: &mv_core::model::Composition,
    layer: &mv_core::model::Layer,
    frame: i64,
) -> Result<[f64; 4], RenderError> {
    let Some(p) = layer
        .parent_id
        .as_deref()
        .and_then(|id| comp.layers.iter().find(|l| l.id == id))
    else {
        return Ok([1.0, 0.0, 0.0, 1.0]);
    };
    let m = mv_core::eval::world_matrix(comp, p, frame as f64).map_err(RenderError::eval)?;
    Ok([m[0], m[1], m[2], m[3]])
}

/// そのフレームで見えているレイヤー（見せる設定・見える範囲・ソロ）。並びは先頭が最前面。
/// ⚠️ 描くとき（末尾から）と枠を求めるときで同じものを通す。
pub fn shown_layers(comp: &mv_core::model::Composition, frame: i64) -> Vec<&mv_core::model::Layer> {
    let any_solo = comp.layers.iter().any(|l| l.solo == Some(true));
    comp.layers
        .iter()
        .filter(|l| is_visible_at(l, frame) && (!any_solo || l.solo == Some(true)))
        .collect()
}

/// 中身（`w`×`h` 画素）の四隅を、変換 `m`（中身の画素 → コンポジションの画素）で写す。
pub fn quad_of(m: Affine, w: u32, h: u32) -> [[f64; 2]; 4] {
    let (w, h) = (f64::from(w), f64::from(h));
    [[0.0, 0.0], [w, 0.0], [w, h], [0.0, h]].map(|p| mv_core::eval::apply(m, p))
}

#[cfg(test)]
mod quad_tests {
    use super::*;

    #[test]
    fn 四隅は変換で写す_回転も() {
        // 2 倍して (10, 20) へ
        assert_eq!(
            quad_of([2.0, 0.0, 0.0, 2.0, 10.0, 20.0], 3, 4),
            [[10.0, 20.0], [16.0, 20.0], [16.0, 28.0], [10.0, 28.0]]
        );
        // 90 度（x→y）
        let q = quad_of([0.0, 1.0, -1.0, 0.0, 0.0, 0.0], 2, 1);
        assert_eq!(q[1], [0.0, 2.0]);
        assert_eq!(q[3], [-1.0, 0.0]);
    }
}
