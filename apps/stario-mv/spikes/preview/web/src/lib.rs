//! 方式 (a)＝Rust の描画を WebAssembly にして、画面の中の WebGPU で描く。
#![cfg(target_arch = "wasm32")]

use spike_scene::{render_frames_and_wait, render_offscreen, Scene, BACKGROUND};
use wasm_bindgen::prelude::*;
use wasm_bindgen::JsCast;

#[wasm_bindgen]
pub struct Runner {
    surface: wgpu::Surface<'static>,
    device: wgpu::Device,
    queue: wgpu::Queue,
    scene: Scene,
    config: wgpu::SurfaceConfiguration,
    count: u32,
}

async fn gpu(instance: &wgpu::Instance, surface: Option<&wgpu::Surface<'static>>) -> Result<(wgpu::Adapter, wgpu::Device, wgpu::Queue), JsValue> {
    let adapter = instance
        .request_adapter(&wgpu::RequestAdapterOptions { power_preference: wgpu::PowerPreference::HighPerformance, compatible_surface: surface, ..Default::default() })
        .await
        .map_err(|e| JsValue::from_str(&format!("adapter: {e}")))?;
    let (device, queue) = adapter.request_device(&wgpu::DeviceDescriptor::default()).await.map_err(|e| JsValue::from_str(&format!("device: {e}")))?;
    Ok((adapter, device, queue))
}

#[wasm_bindgen]
pub async fn create(canvas_id: String, count: u32) -> Result<Runner, JsValue> {
    let canvas: web_sys::HtmlCanvasElement = web_sys::window().unwrap().document().unwrap().get_element_by_id(&canvas_id).ok_or("no canvas")?.dyn_into()?;
    let (w, h) = (canvas.width(), canvas.height());
    let instance = wgpu::Instance::new(wgpu::InstanceDescriptor { backends: wgpu::Backends::BROWSER_WEBGPU, ..wgpu::InstanceDescriptor::new_without_display_handle() });
    let surface = instance.create_surface(wgpu::SurfaceTarget::Canvas(canvas)).map_err(|e| JsValue::from_str(&format!("surface: {e}")))?;
    let (adapter, device, queue) = gpu(&instance, Some(&surface)).await?;
    let config = surface.get_default_config(&adapter, w, h).ok_or("no surface config")?;
    surface.configure(&device, &config);
    let scene = Scene::new(&device, config.format);
    Ok(Runner { surface, device, queue, scene, config, count })
}

#[wasm_bindgen]
impl Runner {
    pub fn frame(&mut self, time: f32) -> Result<(), JsValue> {
        let frame = match self.surface.get_current_texture() {
            wgpu::CurrentSurfaceTexture::Success(f) | wgpu::CurrentSurfaceTexture::Suboptimal(f) => f,
            _ => {
                self.surface.configure(&self.device, &self.config);
                return Ok(());
            }
        };
        let view = frame.texture.create_view(&Default::default());
        self.scene.render(&self.device, &self.queue, &view, self.config.width, self.config.height, time, self.count, BACKGROUND);
        self.queue.present(frame);
        Ok(())
    }

    pub fn set_count(&mut self, count: u32) {
        self.count = count;
    }

    pub fn adapter_info(&self) -> String {
        format!("{}x{} {:?}", self.config.width, self.config.height, self.config.format)
    }
}

/// 一致の比較用＝画面なしで描いて画素を返す。
#[wasm_bindgen]
pub async fn readback(width: u32, height: u32, time: f32, count: u32) -> Result<Vec<u8>, JsValue> {
    let instance = wgpu::Instance::new(wgpu::InstanceDescriptor { backends: wgpu::Backends::BROWSER_WEBGPU, ..wgpu::InstanceDescriptor::new_without_display_handle() });
    let (_a, device, queue) = gpu(&instance, None).await?;
    Ok(render_offscreen(&device, &queue, width, height, time, count).await)
}

/// GPU の重さ（ミリ秒／コマ）。最初の1回（準備）を除いて測る。
#[wasm_bindgen]
pub async fn gpu_bench(width: u32, height: u32, count: u32, frames: u32) -> Result<f64, JsValue> {
    let instance = wgpu::Instance::new(wgpu::InstanceDescriptor { backends: wgpu::Backends::BROWSER_WEBGPU, ..wgpu::InstanceDescriptor::new_without_display_handle() });
    let (_a, device, queue) = gpu(&instance, None).await?;
    render_frames_and_wait(&device, &queue, width, height, count, 2).await;
    let perf = web_sys::window().unwrap().performance().unwrap();
    let t0 = perf.now();
    render_frames_and_wait(&device, &queue, width, height, count, frames).await;
    Ok((perf.now() - t0) / frames as f64)
}
