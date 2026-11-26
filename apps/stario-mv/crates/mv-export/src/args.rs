//! FFmpeg の引数を組み立てる（純粋＝検査しやすい）。⚠️ 文字列の一致だけで安心しない＝本物の FFmpeg にも通す（tests）。

use mv_core::model::Rational;

/// H.264 を出せる道具（上から順に試す＝[`crate::pick_encoder`]）。
/// ⚠️ α の同梱 FFmpeg（LGPL）には libx264 が無い。あれば使う（本人だけが使う道具＝配布の制約を持ち込まない・ADR-0074）。
pub const H264_ENCODERS: &[&str] = &[
    "libx264",
    "h264_nvenc",
    "h264_amf",
    "h264_qsv",
    "h264_mf",
    "libopenh264",
];

/// 書き出しに混ぜる音1つ。
#[derive(Debug, Clone, PartialEq)]
pub struct AudioInput {
    pub path: String,
    /// 素材の何秒目から使うか。
    pub source_start_sec: f64,
    /// 何秒ぶん使うか。
    pub duration_sec: f64,
    /// 書き出しの何秒目に置くか。
    pub at_sec: f64,
    pub volume_db: f64,
    /// 素材の音の数（1＝モノラル）。⚠️ モノラルは左右に**そのままの大きさ**で配る（FFmpeg の既定は −3 dB 下げる・AE は下げない）。
    pub channels: u32,
}

/// 書き出しの設定（純粋な値）。
#[derive(Debug, Clone, PartialEq)]
pub struct EncodeSpec {
    pub width: u32,
    pub height: u32,
    pub fps: Rational,
    pub encoder: String,
    pub audio: Vec<AudioInput>,
    pub duration_sec: f64,
    pub out: String,
}

fn quality_args(encoder: &str) -> Vec<String> {
    let v: &[&str] = match encoder {
        "libx264" => &["-preset", "slow", "-crf", "16"],
        "h264_nvenc" => &[
            "-preset", "p7", "-tune", "hq", "-rc", "vbr", "-cq", "17", "-b:v", "0",
        ],
        "h264_amf" => &[
            "-quality", "quality", "-rc", "cqp", "-qp_i", "17", "-qp_p", "17",
        ],
        "h264_qsv" => &["-preset", "veryslow", "-global_quality", "17"],
        // Media Foundation と OpenH264 は品質の指定が効きにくい＝ビットレートで（上位 PC 前提で高め）
        _ => &["-b:v", "40M"],
    };
    v.iter().map(|s| s.to_string()).collect()
}

/// 生の RGBA を標準入力で受け、H.264（BT.709・限定範囲）の MP4 にする引数。
pub fn encode_args(s: &EncodeSpec) -> Vec<String> {
    let mut a: Vec<String> = vec!["-hide_banner", "-loglevel", "error", "-y"]
        .into_iter()
        .map(String::from)
        .collect();
    // 映像＝標準入力の生の RGBA（sRGB）
    a.extend(["-f", "rawvideo", "-pix_fmt", "rgba", "-s"].map(String::from));
    a.push(format!("{}x{}", s.width, s.height));
    a.push("-framerate".into());
    a.push(format!("{}/{}", s.fps.num, s.fps.den));
    a.extend(["-i", "-"].map(String::from));
    for au in &s.audio {
        a.extend([
            "-ss".to_string(),
            fmt(au.source_start_sec),
            "-t".into(),
            fmt(au.duration_sec),
            "-i".into(),
            au.path.clone(),
        ]);
    }
    // 音を混ぜる
    let mut filter = Vec::new();
    if !s.audio.is_empty() {
        let mut labels = String::new();
        for (i, au) in s.audio.iter().enumerate() {
            let delay_ms = (au.at_sec * 1000.0).round().max(0.0) as i64;
            let to_stereo = if au.channels == 1 {
                "pan=stereo|c0=c0|c1=c0,aresample=48000"
            } else {
                "aformat=sample_rates=48000:channel_layouts=stereo"
            };
            filter.push(format!(
                "[{}:a]{to_stereo},adelay={delay_ms}:all=1,volume={}dB[a{i}]",
                i + 1,
                fmt(au.volume_db)
            ));
            labels.push_str(&format!("[a{i}]"));
        }
        // ⚠️ normalize=0＝重ねても勝手に小さくしない（音量はレイヤーの設定どおり）
        filter.push(format!(
            "{labels}amix=inputs={}:duration=longest:normalize=0,apad,atrim=0:{}[aout]",
            s.audio.len(),
            fmt(s.duration_sec)
        ));
    }
    // 色＝sRGB → BT.709 の限定範囲（ADR-0069 と同じ考え方）。⚠️ 色の情報（VUI）を書かない道具があるので、流れに直接書き込む。
    filter.push("[0:v]scale=out_color_matrix=bt709:out_range=tv:flags=accurate_rnd+full_chroma_int,format=yuv420p[vout]".into());
    a.push("-filter_complex".into());
    a.push(filter.join(";"));
    a.extend(["-map", "[vout]"].map(String::from));
    if !s.audio.is_empty() {
        a.extend(["-map", "[aout]", "-c:a", "aac", "-b:a", "320k"].map(String::from));
    }
    a.extend(["-c:v".to_string(), s.encoder.clone()]);
    a.extend(quality_args(&s.encoder));
    a.extend(
        [
            "-color_primaries",
            "bt709",
            "-color_trc",
            "bt709",
            "-colorspace",
            "bt709",
            "-color_range",
            "tv",
        ]
        .map(String::from),
    );
    a.extend(["-bsf:v", "h264_metadata=colour_primaries=1:transfer_characteristics=1:matrix_coefficients=1:video_full_range_flag=0"].map(String::from));
    a.extend(["-movflags", "+faststart", "-f", "mp4"].map(String::from));
    a.push(s.out.clone());
    a
}

/// その道具が本当に使えるか確かめる引数（小さな1コマを捨て先へ）。
pub fn probe_encoder_args(encoder: &str) -> Vec<String> {
    let mut a: Vec<String> = [
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "lavfi",
        "-i",
        "color=c=black:s=256x256:d=0.1:r=30",
        "-frames:v",
        "2",
        "-c:v",
    ]
    .map(String::from)
    .to_vec();
    a.push(encoder.into());
    a.extend(["-pix_fmt", "yuv420p", "-f", "null", "-"].map(String::from));
    a
}

/// 小数を FFmpeg に渡す形（指数表記にしない）。
pub fn fmt(v: f64) -> String {
    let s = format!("{v:.6}");
    let s = s.trim_end_matches('0').trim_end_matches('.');
    if s.is_empty() || s == "-0" {
        "0".into()
    } else {
        s.into()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn spec(audio: Vec<AudioInput>) -> EncodeSpec {
        EncodeSpec {
            width: 1920,
            height: 1080,
            fps: Rational {
                num: 30000,
                den: 1001,
            },
            encoder: "h264_mf".into(),
            audio,
            duration_sec: 3.0,
            out: "o.mp4".into(),
        }
    }

    #[test]
    fn 映像だけ() {
        let a = encode_args(&spec(vec![])).join(" ");
        assert!(
            a.contains("-f rawvideo -pix_fmt rgba -s 1920x1080 -framerate 30000/1001 -i -"),
            "{a}"
        );
        assert!(a.contains("out_color_matrix=bt709:out_range=tv"), "{a}");
        assert!(
            a.contains("matrix_coefficients=1"),
            "色の情報を流れに書く: {a}"
        );
        assert!(!a.contains("[aout]"), "音が無ければ音の流れを作らない: {a}");
        assert!(a.ends_with("-f mp4 o.mp4"), "{a}");
    }

    #[test]
    fn 音は置く時刻と音量どおりに混ぜる() {
        let au = |p: &str, at: f64, db: f64, ch: u32| AudioInput {
            path: p.into(),
            source_start_sec: 0.5,
            duration_sec: 1.0,
            at_sec: at,
            volume_db: db,
            channels: ch,
        };
        let a = encode_args(&spec(vec![
            au("x.wav", 1.25, -6.0, 2),
            au("y.wav", 0.0, 0.0, 1),
        ]));
        let j = a.join(" ");
        assert!(j.contains("-ss 0.5 -t 1 -i x.wav"), "{j}");
        let f = &a[a.iter().position(|x| x == "-filter_complex").unwrap() + 1];
        assert!(f.contains("[1:a]aformat=sample_rates=48000:channel_layouts=stereo,adelay=1250:all=1,volume=-6dB[a0]"), "{f}");
        assert!(
            f.contains("[2:a]pan=stereo|c0=c0|c1=c0,aresample=48000,adelay=0:all=1,volume=0dB[a1]"),
            "モノラルは左右へそのまま: {f}"
        );
        assert!(
            f.contains("[a0][a1]amix=inputs=2:duration=longest:normalize=0,apad,atrim=0:3[aout]"),
            "{f}"
        );
    }

    #[test]
    fn 小数の書き方() {
        assert_eq!(fmt(1.0), "1");
        assert_eq!(fmt(0.5), "0.5");
        assert_eq!(fmt(-6.0), "-6");
        assert_eq!(fmt(1e-9), "0");
        assert_eq!(fmt(2.0 / 3.0), "0.666667");
    }
}
