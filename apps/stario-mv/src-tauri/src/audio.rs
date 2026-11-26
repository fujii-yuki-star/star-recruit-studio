//! プレビューの音（MV-0007 決定6）＝書き出しと同じ混ぜ方の音を、機器へ流す。
//!
//! - 混ぜるのは `mv_export::mix_pcm`（書き出しと同じ filter）。ここは**鳴らすだけ**。
//! - 鳴らした量（`pos`）がそのまま再生の時計になる＝絵は音に合わせる（音を絵に合わせない）。

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

/// 鳴らす側と糸で分け合うもの。
#[derive(Default)]
pub struct Shared {
    /// 混ぜた音（ステレオ・左右交互）。
    pub pcm: Mutex<Option<Arc<Vec<f32>>>>,
    /// 次に鳴らす位置（1つの時刻＝左右1組を1と数える）。
    pub pos: AtomicU64,
    pub playing: AtomicBool,
}

/// 機器の `out`（`channels` 個ずつ交互）を、ステレオの `pcm` の `pos` から埋める。戻り値＝進めた量。
/// 機器が1つなら左右を平均、3つ以上なら左右以外は無音。音の終わりより後は無音。
pub fn fill(out: &mut [f32], channels: usize, pcm: &[f32], pos: u64) -> u64 {
    let ch = channels.max(1);
    let frames = out.len() / ch;
    for i in 0..frames {
        let src = (pos as usize + i) * 2;
        let l = pcm.get(src).copied().unwrap_or(0.0);
        let r = pcm.get(src + 1).copied().unwrap_or(0.0);
        let o = &mut out[i * ch..(i + 1) * ch];
        o.fill(0.0);
        if ch == 1 {
            o[0] = (l + r) * 0.5;
        } else {
            o[0] = l;
            o[1] = r;
        }
    }
    frames as u64
}

/// 音の出口（機器ごとに1つ・糸が持つ）。
pub struct AudioOut {
    _stream: cpal::Stream,
    pub rate: u32,
    pub shared: Arc<Shared>,
}

impl AudioOut {
    /// 既定の出力の機器を開く。
    pub fn open() -> Result<Self, String> {
        let host = cpal::default_host();
        let device = host
            .default_output_device()
            .ok_or("音を出せる機器が見つかりません（絵だけ再生します）。")?;
        let supported = device
            .default_output_config()
            .map_err(|e| format!("音の機器の設定を読めませんでした（{e}・絵だけ再生します）。"))?;
        let config = supported.config();
        let channels = usize::from(config.channels);
        let shared = Arc::new(Shared::default());
        let s = shared.clone();
        let err = |e| eprintln!("音の機器でエラー：{e}");
        let stream = match supported.sample_format() {
            cpal::SampleFormat::F32 => device.build_output_stream::<f32, _, _>(
                config,
                move |out, _| callback(&s, out, channels),
                err,
                None,
            ),
            cpal::SampleFormat::I16 => {
                let mut buf: Vec<f32> = Vec::new();
                device.build_output_stream::<i16, _, _>(
                    config,
                    move |out, _| {
                        buf.resize(out.len(), 0.0);
                        callback(&s, &mut buf, channels);
                        for (o, v) in out.iter_mut().zip(&buf) {
                            *o = (v.clamp(-1.0, 1.0) * 32767.0) as i16;
                        }
                    },
                    err,
                    None,
                )
            }
            other => {
                return Err(format!(
                    "この音の機器の形（{other:?}）には対応していません（絵だけ再生します）。"
                ))
            }
        }
        .map_err(|e| format!("音の機器を開けませんでした（{e}・絵だけ再生します）。"))?;
        stream
            .play()
            .map_err(|e| format!("音の機器を始められませんでした（{e}・絵だけ再生します）。"))?;
        Ok(Self {
            _stream: stream,
            rate: config.sample_rate,
            shared,
        })
    }
}

fn callback(s: &Shared, out: &mut [f32], channels: usize) {
    if !s.playing.load(Ordering::Acquire) {
        out.fill(0.0);
        return;
    }
    // ⚠️ 鳴らす側では待たない（取れなければ無音）
    let pcm = s.pcm.try_lock().ok().and_then(|g| g.clone());
    match pcm {
        Some(pcm) => {
            let pos = s.pos.load(Ordering::Acquire);
            let n = fill(out, channels, &pcm, pos);
            s.pos.fetch_add(n, Ordering::AcqRel);
        }
        None => out.fill(0.0),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 機器の数に合わせて埋め終わりより後は無音() {
        let pcm = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6];
        let mut o = [9.0f32; 8];
        assert_eq!(fill(&mut o, 2, &pcm, 1), 4);
        assert_eq!(o, [0.3, 0.4, 0.5, 0.6, 0.0, 0.0, 0.0, 0.0]);
        let mut o = [9.0f32; 3];
        assert_eq!(fill(&mut o, 1, &pcm, 0), 3);
        assert!(
            (o[0] - 0.15).abs() < 1e-6 && (o[2] - 0.55).abs() < 1e-6,
            "{o:?}"
        );
        let mut o = [9.0f32; 8];
        assert_eq!(fill(&mut o, 4, &pcm, 0), 2, "4つの機器＝左右以外は無音");
        assert_eq!(o, [0.1, 0.2, 0.0, 0.0, 0.3, 0.4, 0.0, 0.0]);
    }

    #[test]
    fn 止めているあいだは鳴らさず進めない() {
        let s = Shared::default();
        *s.pcm.lock().unwrap() = Some(Arc::new(vec![0.5; 100]));
        let mut o = [9.0f32; 4];
        callback(&s, &mut o, 2);
        assert_eq!(o, [0.0; 4]);
        assert_eq!(s.pos.load(Ordering::Acquire), 0);
        s.playing.store(true, Ordering::Release);
        callback(&s, &mut o, 2);
        assert_eq!(o, [0.5; 4]);
        assert_eq!(s.pos.load(Ordering::Acquire), 2, "鳴らした量が時計");
    }
}

/// 実際の音の機器で、鳴らした量の時計が実時間と合うか（⚠️ 機器が要る＝CI では回さない。手で `cargo test -p stario-mv -- --ignored`）。
#[cfg(test)]
mod device_tests {
    use super::*;

    #[test]
    #[ignore = "音の機器が要る（CI には無い）"]
    fn 鳴らした量の時計は実時間と合う() {
        let a = AudioOut::open().expect("音の機器");
        let secs = 2.0;
        let pcm: Vec<f32> = (0..(f64::from(a.rate) * secs) as usize)
            .flat_map(|i| {
                let v = (i as f32 * 440.0 * std::f32::consts::TAU / a.rate as f32).sin() * 0.05;
                [v, v]
            })
            .collect();
        *a.shared.pcm.lock().unwrap() = Some(Arc::new(pcm));
        a.shared.pos.store(0, Ordering::Release);
        let t0 = std::time::Instant::now();
        a.shared.playing.store(true, Ordering::Release);
        std::thread::sleep(std::time::Duration::from_millis(1000));
        let pos = a.shared.pos.load(Ordering::Acquire) as f64 / f64::from(a.rate);
        let wall = t0.elapsed().as_secs_f64();
        a.shared.playing.store(false, Ordering::Release);
        eprintln!(
            "機器の速さ {} Hz・音の時計 {pos:.3} 秒・実時間 {wall:.3} 秒",
            a.rate
        );
        assert!(
            (pos - wall).abs() < 0.1,
            "音の時計 {pos} と実時間 {wall} がずれている"
        );
        let stopped = a.shared.pos.load(Ordering::Acquire);
        std::thread::sleep(std::time::Duration::from_millis(200));
        assert_eq!(
            a.shared.pos.load(Ordering::Acquire),
            stopped,
            "止めたら進まない"
        );
    }
}
