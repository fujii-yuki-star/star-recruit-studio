//! 方式 (b)＝Rust の描画を窓に直接出し、画面（WebView）を上に重ねる。
//! あわせて、方式 (a) のための「Rust → 画面へ大きなコマを送る速さ」と、一致の比較用の画素も出す。

use spike_scene::{render_frames_and_wait, render_offscreen, Scene, BACKGROUND};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Arc;
use std::time::Instant;
use tauri::{Emitter, Manager};

#[derive(Default)]
struct NativeState {
    running: Arc<AtomicBool>,
    count: Arc<AtomicU32>,
}

#[derive(Clone, serde::Serialize)]
struct Stats {
    fps: f64,
    cpu_ms: f64,
    count: u32,
    adapter: String,
    format: String,
}

/// 窓に直接描き始める（別のスレッドで回し続け、1秒ごとに速さを画面へ知らせる）。
#[tauri::command]
fn start_native(app: tauri::AppHandle, state: tauri::State<NativeState>, count: u32, vsync: bool) -> Result<(), String> {
    if state.running.swap(true, Ordering::SeqCst) {
        state.count.store(count, Ordering::SeqCst);
        return Ok(());
    }
    state.count.store(count, Ordering::SeqCst);
    let window = app.get_webview_window("main").ok_or("no window")?;
    let running = state.running.clone();
    let count_ref = state.count.clone();
    std::thread::spawn(move || {
        let instance = wgpu::Instance::new(wgpu::InstanceDescriptor::new_without_display_handle());
        let surface = match instance.create_surface(window.clone()) {
            Ok(s) => s,
            Err(e) => {
                let _ = app.emit("native-error", format!("surface: {e}"));
                return;
            }
        };
        let adapter = match pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions { power_preference: wgpu::PowerPreference::HighPerformance, compatible_surface: Some(&surface), ..Default::default() })) {
            Ok(a) => a,
            Err(e) => {
                let _ = app.emit("native-error", format!("adapter: {e}"));
                return;
            }
        };
        let (device, queue) = pollster::block_on(adapter.request_device(&wgpu::DeviceDescriptor::default())).expect("device");
        let size = window.inner_size().unwrap();
        let mut config = surface.get_default_config(&adapter, size.width.max(1), size.height.max(1)).expect("config");
        config.present_mode = if vsync { wgpu::PresentMode::AutoVsync } else { wgpu::PresentMode::AutoNoVsync };
        surface.configure(&device, &config);
        let scene = Scene::new(&device, config.format);
        let info = adapter.get_info();
        let adapter_name = format!("{} ({:?})", info.name, info.backend);
        let start = Instant::now();
        let mut frames = 0u32;
        let mut cpu_total = 0f64;
        let mut tick = Instant::now();
        while running.load(Ordering::SeqCst) {
            let size = window.inner_size().unwrap();
            if size.width != config.width || size.height != config.height {
                config.width = size.width.max(1);
                config.height = size.height.max(1);
                surface.configure(&device, &config);
            }
            let frame = match surface.get_current_texture() {
                wgpu::CurrentSurfaceTexture::Success(f) | wgpu::CurrentSurfaceTexture::Suboptimal(f) => f,
                _ => {
                    surface.configure(&device, &config);
                    continue;
                }
            };
            let t0 = Instant::now();
            let view = frame.texture.create_view(&Default::default());
            scene.render(&device, &queue, &view, config.width, config.height, start.elapsed().as_secs_f32(), count_ref.load(Ordering::SeqCst), BACKGROUND);
            cpu_total += t0.elapsed().as_secs_f64() * 1000.0;
            queue.present(frame);
            frames += 1;
            if tick.elapsed().as_secs_f64() >= 1.0 {
                let secs = tick.elapsed().as_secs_f64();
                let _ = app.emit(
                    "native-stats",
                    Stats { fps: frames as f64 / secs, cpu_ms: cpu_total / frames.max(1) as f64, count: count_ref.load(Ordering::SeqCst), adapter: adapter_name.clone(), format: format!("{}x{} {:?}", config.width, config.height, config.format) },
                );
                frames = 0;
                cpu_total = 0.0;
                tick = Instant::now();
            }
        }
    });
    Ok(())
}

#[tauri::command]
fn stop_native(state: tauri::State<NativeState>) {
    state.running.store(false, Ordering::SeqCst);
}

/// 方式 (a) で映像のコマを画面へ送る場合の速さを測る＝指定の大きさの生のバイト列を返す。
#[tauri::command]
fn ipc_bench(size: usize) -> tauri::ipc::Response {
    tauri::ipc::Response::new(vec![7u8; size])
}

/// 方式 (b) で映像のコマを GPU へ上げる速さ（1920×1080 RGBA を n 回 write_texture して待つ）。
#[tauri::command]
fn native_upload_bench(n: u32) -> Result<f64, String> {
    let instance = wgpu::Instance::new(wgpu::InstanceDescriptor::new_without_display_handle());
    let adapter = pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions::default())).map_err(|e| e.to_string())?;
    let (device, queue) = pollster::block_on(adapter.request_device(&wgpu::DeviceDescriptor::default())).map_err(|e| e.to_string())?;
    let (w, h) = (1920u32, 1080u32);
    let tex = device.create_texture(&wgpu::TextureDescriptor {
        label: None,
        size: wgpu::Extent3d { width: w, height: h, depth_or_array_layers: 1 },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: wgpu::TextureFormat::Rgba8Unorm,
        usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
        view_formats: &[],
    });
    let data = vec![128u8; (w * h * 4) as usize];
    let t0 = Instant::now();
    for _ in 0..n {
        queue.write_texture(
            wgpu::TexelCopyTextureInfo { texture: &tex, mip_level: 0, origin: wgpu::Origin3d::ZERO, aspect: wgpu::TextureAspect::All },
            &data,
            wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(w * 4), rows_per_image: Some(h) },
            wgpu::Extent3d { width: w, height: h, depth_or_array_layers: 1 },
        );
        queue.submit(None);
        let _ = device.poll(wgpu::PollType::Wait { submission_index: None, timeout: None });
    }
    Ok(t0.elapsed().as_secs_f64() * 1000.0 / n as f64)
}

/// 一致の比較用＝ネイティブで画面なしに描いた画素。
#[tauri::command]
fn native_readback(width: u32, height: u32, time: f32, count: u32) -> Result<tauri::ipc::Response, String> {
    let instance = wgpu::Instance::new(wgpu::InstanceDescriptor::new_without_display_handle());
    let adapter = pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions { power_preference: wgpu::PowerPreference::HighPerformance, ..Default::default() })).map_err(|e| e.to_string())?;
    let (device, queue) = pollster::block_on(adapter.request_device(&wgpu::DeviceDescriptor::default())).map_err(|e| e.to_string())?;
    let px = pollster::block_on(render_offscreen(&device, &queue, width, height, time, count));
    Ok(tauri::ipc::Response::new(px))
}

/// 測った結果を試作のフォルダへ書く（自動で回した結果を読み返すため）。
#[tauri::command]
fn save_results(json: String) -> Result<(), String> {
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("..");
    std::fs::write(dir.join("results.json"), json).map_err(|e| e.to_string())
}

/// 今どの段階かを書く（外から画面を撮る時機を合わせる）。
#[tauri::command]
fn phase(name: String) -> Result<(), String> {
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("..");
    std::fs::write(dir.join("phase.txt"), name).map_err(|e| e.to_string())
}

#[tauri::command]
fn quit(app: tauri::AppHandle) {
    app.exit(0);
}

/// GPU の重さ（ミリ秒／コマ）。最初の1回（準備）を除いて測る。
#[tauri::command]
fn native_gpu_bench(width: u32, height: u32, count: u32, frames: u32) -> Result<f64, String> {
    let instance = wgpu::Instance::new(wgpu::InstanceDescriptor::new_without_display_handle());
    let adapter = pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions { power_preference: wgpu::PowerPreference::HighPerformance, ..Default::default() })).map_err(|e| e.to_string())?;
    let (device, queue) = pollster::block_on(adapter.request_device(&wgpu::DeviceDescriptor::default())).map_err(|e| e.to_string())?;
    pollster::block_on(render_frames_and_wait(&device, &queue, width, height, count, 2));
    let t0 = Instant::now();
    pollster::block_on(render_frames_and_wait(&device, &queue, width, height, count, frames));
    Ok(t0.elapsed().as_secs_f64() * 1000.0 / frames as f64)
}

fn main() {
    tauri::Builder::default()
        .manage(NativeState::default())
        .invoke_handler(tauri::generate_handler![start_native, stop_native, ipc_bench, native_upload_bench, native_readback, native_gpu_bench, save_results, phase, quit])
        .run(tauri::generate_context!())
        .expect("run");
}
