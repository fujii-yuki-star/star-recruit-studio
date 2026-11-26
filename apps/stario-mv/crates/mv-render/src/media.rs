//! 映像・連番・SVG の素材（MV-0006 決定4）。
//!
//! - 映像＝FFmpeg で生の RGBA に読み出す（順に進む間は読み続け、戻る・遠くへ飛ぶときは読み直す）。
//! - 素材の中身を調べる（ffprobe）のもここ＝取り込み（mv-ops）と描く側で**同じ判定**を使う（色の行列・透過の読み手）。
//! - ⚠️ 前提は一定のコマの速さ（CFR）。

use crate::RenderError;
use serde_json::Value;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdout, Command, Stdio};

/// 戻る・この秒数より先へ飛ぶときは、読み続けずに読み直す。
pub const SEEK_AHEAD_SEC: f64 = 2.0;

/// ffprobe で調べた映像の情報。
#[derive(Debug, Clone, PartialEq)]
pub struct VideoInfo {
    pub codec: String,
    pub width: u32,
    pub height: u32,
    /// コマの速さ（分数）。
    pub fps: (u32, u32),
    /// コマ数（わかれば）。
    pub frame_count: Option<u64>,
    pub pix_fmt: String,
    pub color_space: Option<String>,
    pub color_range: Option<String>,
    /// WebM（VP8・VP9）の透過の印。
    pub alpha_mode: bool,
    /// 速さが一定でない疑い（r_frame_rate と avg_frame_rate が違う）。
    pub variable_rate: bool,
}

/// ffprobe で調べた音の情報。
#[derive(Debug, Clone, PartialEq)]
pub struct AudioInfo {
    pub channels: u32,
    pub sample_rate: u32,
}

/// ffprobe の結果。
#[derive(Debug, Clone, PartialEq)]
pub struct AvInfo {
    pub video: Option<VideoInfo>,
    pub audio: Option<AudioInfo>,
    pub duration_sec: Option<f64>,
}

impl VideoInfo {
    /// 透過を持つか（画素の形に透過があるか、WebM の透過の印）。
    pub fn has_alpha(&self) -> bool {
        let p = self.pix_fmt.as_str();
        self.alpha_mode
            || p.starts_with("yuva")
            || p.starts_with("rgba")
            || p.starts_with("bgra")
            || p.starts_with("argb")
            || p.starts_with("abgr")
            || p.starts_with("gbrap")
            || p.starts_with("ya")
            || p == "pal8"
    }

    /// YUV の素材か（色の行列と範囲の変換が要る）。
    pub fn is_yuv(&self) -> bool {
        let p = self.pix_fmt.as_str();
        p.starts_with("yuv") || p.starts_with("nv") || p.starts_with("p0") || p.starts_with("p2")
    }

    /// 色の行列（書かれていなければ、高さ 720 以上は BT.709・それ未満は BT.601＝MV-0006 決定4）。
    pub fn color_matrix(&self) -> &'static str {
        match self.color_space.as_deref() {
            Some("bt709") => "bt709",
            Some("bt470bg") | Some("smpte170m") | Some("bt601") => "bt601",
            Some("smpte240m") => "smpte240m",
            Some("fcc") => "fcc",
            Some("bt2020nc") | Some("bt2020c") | Some("bt2020") => "bt2020",
            _ if self.height >= 720 => "bt709",
            _ => "bt601",
        }
    }

    /// 範囲（書かれていなければ限定範囲）。
    pub fn range(&self) -> &'static str {
        match self.color_range.as_deref() {
            Some("pc") | Some("jpeg") => "pc",
            _ => "tv",
        }
    }

    /// 透過付きの WebM は libvpx の読み手でないと透過が取れない。
    pub fn alpha_decoder(&self) -> Option<&'static str> {
        if !self.alpha_mode {
            return None;
        }
        match self.codec.as_str() {
            "vp9" => Some("libvpx-vp9"),
            "vp8" => Some("libvpx"),
            _ => None,
        }
    }
}

/// ffmpeg の隣の ffprobe（無ければ PATH の ffprobe）。
pub fn ffprobe_beside(ffmpeg: &Path) -> PathBuf {
    let name = if cfg!(windows) {
        "ffprobe.exe"
    } else {
        "ffprobe"
    };
    let beside = ffmpeg.with_file_name(name);
    if beside.is_file() {
        beside
    } else {
        PathBuf::from(name)
    }
}

/// ffprobe で映像・音の素材を調べる。
pub fn probe_av(ffprobe: &Path, path: &Path) -> Result<AvInfo, RenderError> {
    let out = Command::new(ffprobe)
        .args([
            "-v",
            "error",
            "-print_format",
            "json",
            "-show_format",
            "-show_streams",
        ])
        .arg(path)
        .stdin(Stdio::null())
        .output()
        .map_err(|e| {
            RenderError::Asset(format!(
                "素材を調べる道具（ffprobe・{}）を起動できませんでした（{e}）。FFmpeg と同じ場所に ffprobe を置いてください。",
                ffprobe.display()
            ))
        })?;
    if !out.status.success() {
        return Err(RenderError::Asset(format!(
            "素材を読めませんでした（{}）：{}",
            path.display(),
            String::from_utf8_lossy(&out.stderr).trim()
        )));
    }
    let v: Value = serde_json::from_slice(&out.stdout)
        .map_err(|e| RenderError::Asset(format!("素材の情報を読めませんでした（{e}）。")))?;
    Ok(parse_probe(&v))
}

fn num(v: &Value) -> Option<f64> {
    v.as_f64()
        .or_else(|| v.as_str().and_then(|s| s.parse().ok()))
}

fn ratio(s: Option<&str>) -> Option<(u32, u32)> {
    let (a, b) = s?.split_once('/')?;
    let (a, b): (u32, u32) = (a.parse().ok()?, b.parse().ok()?);
    (a > 0 && b > 0).then_some((a, b))
}

/// ffprobe の JSON を読む（純粋＝検査しやすい）。
pub fn parse_probe(v: &Value) -> AvInfo {
    let streams = v["streams"].as_array().cloned().unwrap_or_default();
    let video = streams
        .iter()
        .find(|s| {
            s["codec_type"] == "video" && s["disposition"]["attached_pic"].as_i64() != Some(1)
        })
        .and_then(|s| {
            let r = ratio(s["r_frame_rate"].as_str());
            let avg = ratio(s["avg_frame_rate"].as_str());
            let fps = r.or(avg)?;
            let tags = s["tags"].as_object();
            let alpha_mode = tags.is_some_and(|t| {
                t.iter()
                    .any(|(k, v)| k.eq_ignore_ascii_case("alpha_mode") && v == "1")
            });
            let as_f = |p: (u32, u32)| f64::from(p.0) / f64::from(p.1);
            Some(VideoInfo {
                codec: s["codec_name"].as_str().unwrap_or_default().to_string(),
                width: s["width"].as_u64()? as u32,
                height: s["height"].as_u64()? as u32,
                fps,
                frame_count: num(&s["nb_frames"]).map(|n| n as u64).filter(|n| *n > 0),
                pix_fmt: s["pix_fmt"].as_str().unwrap_or_default().to_string(),
                color_space: s["color_space"].as_str().map(String::from),
                color_range: s["color_range"].as_str().map(String::from),
                alpha_mode,
                variable_rate: avg.is_some_and(|a| (as_f(a) - as_f(fps)).abs() > 0.01),
            })
        });
    let audio = streams
        .iter()
        .find(|s| s["codec_type"] == "audio")
        .and_then(|s| {
            Some(AudioInfo {
                channels: s["channels"].as_u64()? as u32,
                sample_rate: num(&s["sample_rate"])? as u32,
            })
        });
    let duration_sec = num(&v["format"]["duration"]).or_else(|| {
        streams
            .iter()
            .find(|s| s["codec_type"] == "video" || s["codec_type"] == "audio")
            .and_then(|s| num(&s["duration"]))
    });
    AvInfo {
        video,
        audio,
        duration_sec,
    }
}

/// 映像の素材の読み手（1つの素材に1つ）。
pub struct VideoDecoder {
    ffmpeg: PathBuf,
    path: PathBuf,
    pub info: VideoInfo,
    child: Option<(Child, ChildStdout)>,
    /// 次に読めるコマの番号。
    next: i64,
    /// 最後に読んだコマ（同じコマを続けて頼まれたとき用）。
    last: Option<(i64, Vec<u8>)>,
}

impl VideoDecoder {
    /// 開く（ffprobe で調べる）。
    pub fn open(ffmpeg: &Path, path: &Path) -> Result<Self, RenderError> {
        if !path.is_file() {
            return Err(RenderError::Asset(format!(
                "素材のファイルが見つかりません（{}）。素材を取り込み直してください。",
                path.display()
            )));
        }
        let info = probe_av(&ffprobe_beside(ffmpeg), path)?
            .video
            .ok_or_else(|| {
                RenderError::Asset(format!(
                    "映像が入っていません（{}）。映像の素材を選んでください。",
                    path.display()
                ))
            })?;
        Ok(Self {
            ffmpeg: ffmpeg.to_path_buf(),
            path: path.to_path_buf(),
            info,
            child: None,
            next: 0,
            last: None,
        })
    }

    fn fps(&self) -> f64 {
        f64::from(self.info.fps.0) / f64::from(self.info.fps.1)
    }

    /// 素材の時刻（秒）に表示されているコマの番号（AE と同じ＝切り捨て）。
    pub fn frame_index(&self, t_sec: f64) -> i64 {
        (t_sec * self.fps() + 1e-6).floor() as i64
    }

    fn spawn(&mut self, k: i64) -> Result<(), RenderError> {
        self.kill();
        let mut cmd = Command::new(&self.ffmpeg);
        cmd.args(["-hide_banner", "-loglevel", "error", "-nostdin"]);
        if let Some(dec) = self.info.alpha_decoder() {
            cmd.args(["-c:v", dec]);
        }
        // 半コマ手前から＝k が最初に出る（FFmpeg の正確な位置合わせは、その時刻以降に始まるコマから出す）
        let t = ((k as f64 - 0.5) / self.fps()).max(0.0);
        cmd.arg("-ss").arg(format!("{t:.6}"));
        cmd.arg("-i").arg(&self.path);
        let mut vf = String::from("scale=");
        if self.info.is_yuv() {
            vf.push_str(&format!(
                "in_color_matrix={}:in_range={}:",
                self.info.color_matrix(),
                self.info.range()
            ));
        }
        vf.push_str("flags=accurate_rnd+full_chroma_int,format=rgba");
        // ⚠️ コマをそのまま出す（既定は一定の速さに合わせるため、最初のコマを複製してずれる）
        cmd.args([
            "-map",
            "0:v:0",
            "-an",
            "-sn",
            "-fps_mode",
            "passthrough",
            "-vf",
            &vf,
        ])
        .args(["-f", "rawvideo", "-pix_fmt", "rgba", "-"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
        let mut child = cmd.spawn().map_err(|e| {
            RenderError::Asset(format!(
                "映像を読む道具（FFmpeg）を起動できませんでした（{e}）。"
            ))
        })?;
        let out = child
            .stdout
            .take()
            .ok_or_else(|| RenderError::Internal("FFmpeg の出口が無い".into()))?;
        self.child = Some((child, out));
        self.next = k;
        Ok(())
    }

    fn read_one(&mut self) -> Result<Option<Vec<u8>>, RenderError> {
        let n = (self.info.width as usize) * (self.info.height as usize) * 4;
        let Some((_, out)) = self.child.as_mut() else {
            return Ok(None);
        };
        let mut buf = vec![0u8; n];
        let mut got = 0;
        while got < n {
            match out.read(&mut buf[got..]) {
                Ok(0) => break,
                Ok(m) => got += m,
                Err(e) => {
                    return Err(RenderError::Asset(format!(
                        "映像を読めませんでした（{}・{e}）。",
                        self.path.display()
                    )))
                }
            }
        }
        if got < n {
            // 終わり（素材の最後のコマより後）
            self.kill();
            return Ok(None);
        }
        self.next += 1;
        Ok(Some(buf))
    }

    /// コマ k の画素（RGBA8・乗算していない）。素材の外なら None。
    pub fn frame(&mut self, k: i64) -> Result<Option<&[u8]>, RenderError> {
        if k < 0 || self.info.frame_count.is_some_and(|c| k as u64 >= c) {
            return Ok(None);
        }
        if self.last.as_ref().is_some_and(|(lk, _)| *lk == k) {
            return Ok(self.last.as_ref().map(|(_, d)| d.as_slice()));
        }
        let ahead = (SEEK_AHEAD_SEC * self.fps()).ceil() as i64;
        if self.child.is_none() || k < self.next || k > self.next + ahead {
            self.spawn(k)?;
        }
        while self.next < k {
            if self.read_one()?.is_none() {
                return Ok(None);
            }
        }
        match self.read_one()? {
            Some(d) => {
                self.last = Some((k, d));
                Ok(self.last.as_ref().map(|(_, d)| d.as_slice()))
            }
            None => Ok(None),
        }
    }

    fn kill(&mut self) {
        if let Some((mut c, _)) = self.child.take() {
            let _ = c.kill();
            let _ = c.wait();
        }
    }
}

impl Drop for VideoDecoder {
    fn drop(&mut self) {
        self.kill();
    }
}

/// 連番の k 番目のファイル（先頭のファイル名の末尾の数字を手がかりに、桁数をそろえる）。
pub fn sequence_path(first: &Path, k: u64) -> Option<PathBuf> {
    let (prefix, digits, ext) = split_sequence_name(first)?;
    let start: u64 = digits.parse().ok()?;
    let name = format!("{prefix}{:0width$}{ext}", start + k, width = digits.len());
    Some(first.with_file_name(name))
}

/// 連番の名前を「前・数字・拡張子」に分ける（例：`shot_0012.png` → `shot_`・`0012`・`.png`）。
pub fn split_sequence_name(p: &Path) -> Option<(String, String, String)> {
    let name = p.file_name()?.to_str()?;
    let (stem, ext) = match name.rfind('.') {
        Some(i) => (&name[..i], &name[i..]),
        None => (name, ""),
    };
    let n = stem
        .chars()
        .rev()
        .take_while(|c| c.is_ascii_digit())
        .count();
    if n == 0 {
        return None;
    }
    let cut = stem.len() - n;
    Some((
        stem[..cut].to_string(),
        stem[cut..].to_string(),
        ext.to_string(),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn 連番の名前() {
        let p = Path::new("C:/x/shot_0098.png");
        assert_eq!(
            split_sequence_name(p),
            Some(("shot_".into(), "0098".into(), ".png".into()))
        );
        assert_eq!(
            sequence_path(p, 3).unwrap(),
            Path::new("C:/x/shot_0101.png")
        );
        assert_eq!(split_sequence_name(Path::new("a.png")), None);
        assert_eq!(
            sequence_path(Path::new("9.tif"), 2).unwrap(),
            Path::new("11.tif"),
            "桁があふれたらそのまま伸ばす"
        );
    }

    #[test]
    fn ffprobe_の結果を読む() {
        let v = json!({
            "streams": [
                {"codec_type": "video", "codec_name": "mjpeg", "width": 10, "height": 10, "r_frame_rate": "90000/1", "disposition": {"attached_pic": 1}},
                {"codec_type": "video", "codec_name": "vp9", "width": 1920, "height": 1080, "pix_fmt": "yuv420p",
                 "r_frame_rate": "30000/1001", "avg_frame_rate": "30000/1001", "nb_frames": "300",
                 "tags": {"ALPHA_MODE": "1"}, "disposition": {"attached_pic": 0}},
                {"codec_type": "audio", "channels": 1, "sample_rate": "48000"}
            ],
            "format": {"duration": "10.010000"}
        });
        let i = parse_probe(&v);
        let vi = i.video.unwrap();
        assert_eq!(vi.codec, "vp9", "表紙の絵は映像として数えない");
        assert_eq!(vi.fps, (30000, 1001));
        assert_eq!(vi.frame_count, Some(300));
        assert!(vi.alpha_mode && vi.has_alpha());
        assert_eq!(vi.alpha_decoder(), Some("libvpx-vp9"));
        assert!(!vi.variable_rate);
        assert_eq!(
            vi.color_matrix(),
            "bt709",
            "書かれていなければ HD は BT.709"
        );
        assert_eq!(vi.range(), "tv");
        assert_eq!(
            i.audio,
            Some(AudioInfo {
                channels: 1,
                sample_rate: 48000
            })
        );
        assert_eq!(i.duration_sec, Some(10.01));
        let sd = VideoInfo {
            height: 480,
            color_space: None,
            ..vi.clone()
        };
        assert_eq!(sd.color_matrix(), "bt601");
        let vfr = parse_probe(
            &json!({"streams": [{"codec_type": "video", "codec_name": "h264", "width": 2, "height": 2,
            "pix_fmt": "yuv420p", "r_frame_rate": "60/1", "avg_frame_rate": "2997/100"}]}),
        );
        assert!(vfr.video.unwrap().variable_rate);
    }
}
