//! 描いた絵を窓（プレビューの欄）へ写す（MV-0007 決定1）。
//!
//! ⚠️ ここは**写すだけ**＝色も形も変えない。欄に合わせて縦横の比を保って縮め、余りは帯にする。
//! 描画の核の出力は乗算していない sRGB の値なので、窓は sRGB の印が付かない形（`Bgra8Unorm` など）で受ける＝二重に変換しない。

use bytemuck::{Pod, Zeroable};

/// 窓の中の矩形（物理の画素）。
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Rect {
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
}

/// 欄（`panel`）の中に、縦横の比を保って最大に収める矩形（中央寄せ）。
pub fn fit(panel: Rect, content_w: u32, content_h: u32) -> Rect {
    if panel.w <= 0.0 || panel.h <= 0.0 || content_w == 0 || content_h == 0 {
        return Rect {
            x: panel.x,
            y: panel.y,
            w: 0.0,
            h: 0.0,
        };
    }
    let s = (panel.w / content_w as f32).min(panel.h / content_h as f32);
    let (w, h) = (content_w as f32 * s, content_h as f32 * s);
    Rect {
        x: panel.x + (panel.w - w) / 2.0,
        y: panel.y + (panel.h - h) / 2.0,
        w,
        h,
    }
}

/// 窓の画素の形を選ぶ（sRGB の印が付かないもの＝描画の核の値をそのまま写せる）。
pub fn pick_surface_format(formats: &[wgpu::TextureFormat]) -> Option<wgpu::TextureFormat> {
    formats.iter().copied().find(|f| {
        matches!(
            f,
            wgpu::TextureFormat::Bgra8Unorm | wgpu::TextureFormat::Rgba8Unorm
        )
    })
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct Uniform {
    /// 写す先の矩形（x, y, w, h・物理の画素）。
    rect: [f32; 4],
    /// 欄の外の色（帯と背景）。
    clear: [f32; 4],
    /// 欄（帯を塗る範囲）。
    panel: [f32; 4],
}

const SHADER: &str = r#"
struct U { rect: vec4<f32>, clear: vec4<f32>, panel: vec4<f32> };
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var img: texture_2d<f32>;
@group(0) @binding(2) var smp: sampler;

@vertex
fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4<f32> {
    let p = vec2<f32>(f32((i << 1u) & 2u), f32(i & 2u));
    return vec4<f32>(p * 2.0 - 1.0, 0.0, 1.0);
}

@fragment
fn fs(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
    let uv = (pos.xy - u.rect.xy) / u.rect.zw;
    let c = textureSampleLevel(img, smp, clamp(uv, vec2<f32>(0.0), vec2<f32>(1.0)), 0.0);
    let inside = all(uv >= vec2<f32>(0.0)) && all(uv <= vec2<f32>(1.0)) && u.rect.z > 0.0;
    if (inside) {
        // 透明な所は帯の色の上に重ねる（乗算していない値）
        return vec4<f32>(mix(u.clear.rgb, c.rgb, c.a), 1.0);
    }
    return u.clear;
}
"#;

/// 写す道具（窓の画素の形ごとに1つ）。
pub struct Presenter {
    pipeline: wgpu::RenderPipeline,
    layout: wgpu::BindGroupLayout,
    sampler: wgpu::Sampler,
    blank: wgpu::Texture,
}

impl Presenter {
    pub fn new(device: &wgpu::Device, format: wgpu::TextureFormat) -> Self {
        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("present"),
            source: wgpu::ShaderSource::Wgsl(SHADER.into()),
        });
        let layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("present"),
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
                wgpu::BindGroupLayoutEntry {
                    binding: 1,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Texture {
                        sample_type: wgpu::TextureSampleType::Float { filterable: true },
                        view_dimension: wgpu::TextureViewDimension::D2,
                        multisampled: false,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 2,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                    count: None,
                },
            ],
        });
        let pl = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("present"),
            bind_group_layouts: &[Some(&layout)],
            immediate_size: 0,
        });
        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("present"),
            layout: Some(&pl),
            vertex: wgpu::VertexState {
                module: &shader,
                entry_point: Some("vs"),
                buffers: &[],
                compilation_options: Default::default(),
            },
            fragment: Some(wgpu::FragmentState {
                module: &shader,
                entry_point: Some("fs"),
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
        });
        let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            ..Default::default()
        });
        let blank = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("present-blank"),
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
        Self {
            pipeline,
            layout,
            sampler,
            blank,
        }
    }

    /// `image`（無ければ帯の色だけ）を、`panel` の中に収めて `target` へ写す。窓全体は `clear` で塗る。
    pub fn draw(
        &self,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        target: &wgpu::TextureView,
        panel: Rect,
        image: Option<&wgpu::Texture>,
        clear: [f32; 4],
    ) {
        let (tex, rect) = match image {
            Some(t) => {
                let s = t.size();
                (t, fit(panel, s.width, s.height))
            }
            None => (
                &self.blank,
                Rect {
                    x: 0.0,
                    y: 0.0,
                    w: 0.0,
                    h: 0.0,
                },
            ),
        };
        let u = Uniform {
            rect: [rect.x, rect.y, rect.w, rect.h],
            clear,
            panel: [panel.x, panel.y, panel.w, panel.h],
        };
        let ub = device.create_buffer(&wgpu::BufferDescriptor {
            label: None,
            size: std::mem::size_of::<Uniform>() as u64,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        queue.write_buffer(&ub, 0, bytemuck::bytes_of(&u));
        let view = tex.create_view(&Default::default());
        let bg = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: None,
            layout: &self.layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: ub.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: wgpu::BindingResource::TextureView(&view),
                },
                wgpu::BindGroupEntry {
                    binding: 2,
                    resource: wgpu::BindingResource::Sampler(&self.sampler),
                },
            ],
        });
        let mut enc = device.create_command_encoder(&Default::default());
        {
            let mut p = enc.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("present"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: target,
                    depth_slice: None,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color::BLACK),
                        store: wgpu::StoreOp::Store,
                    },
                })],
                depth_stencil_attachment: None,
                timestamp_writes: None,
                occlusion_query_set: None,
                multiview_mask: None,
            });
            p.set_pipeline(&self.pipeline);
            p.set_bind_group(0, &bg, &[]);
            p.draw(0..3, 0..1);
        }
        queue.submit(Some(enc.finish()));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 縦横の比を保って中央に収める() {
        let panel = Rect {
            x: 10.0,
            y: 20.0,
            w: 400.0,
            h: 400.0,
        };
        assert_eq!(
            fit(panel, 1920, 1080),
            Rect {
                x: 10.0,
                y: 107.5,
                w: 400.0,
                h: 225.0
            },
            "横長は上下に帯"
        );
        assert_eq!(
            fit(panel, 1080, 1920),
            Rect {
                x: 97.5,
                y: 20.0,
                w: 225.0,
                h: 400.0
            },
            "縦長は左右に帯"
        );
        assert_eq!(fit(panel, 0, 10).w, 0.0);
    }

    #[test]
    fn 窓は_srgb_の印が付かない形を選ぶ() {
        use wgpu::TextureFormat as F;
        assert_eq!(
            pick_surface_format(&[F::Bgra8UnormSrgb, F::Bgra8Unorm, F::Rgba16Float]),
            Some(F::Bgra8Unorm)
        );
        assert_eq!(pick_surface_format(&[F::Bgra8UnormSrgb]), None);
    }
}
