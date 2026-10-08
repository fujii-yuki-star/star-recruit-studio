// このパソコンの中で声を文字にする（ADR-0058・#1387）。
//
// - 部品＝同梱の whisper.cpp（`whisper-cli`）と small（q5_1）。置き場所は `resource_dir/transcribe/{runtime,models}`。
//   無い・大きさが違う・照合が合わない＝**断る**（黙って外部の AI や見本へ落とさない＝ADR-0051 と同じ・決定6）。
// - **1回ごとに起こして終わらせる**（常駐しない＝使っていない間はメモリを取らない・決定2）。
// - 音は FFmpeg で**その部品が使っている範囲だけ**を 16kHz・1チャンネルに切り出して渡す（素材の秒の範囲）。
//   置き場は動画の `cache/`（素材ではない）＝終わったら消す。
// - ⚠️ **素材のバイトを画面に載せない**（波形と同じ）＝返すのは区切り（素材の頭からの秒と文）だけ。
// - ⚠️ **外へ送らない**（§2-6）＝ネットへ出る道を持たない（`whisper-cli` はファイルを読んで書くだけ）。

use crate::messages::{
    TRANSCRIBE_BROKEN, TRANSCRIBE_BUSY, TRANSCRIBE_CANCELLED, TRANSCRIBE_FAILED,
    TRANSCRIBE_MISSING, TRANSCRIBE_READ_FAILED,
};
use crate::proc::no_window_command;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Child, ExitStatus, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

/// 同梱のモデル（ADR-0058 決定1＝公開の q5_1 を SHA-256 で固定）。
pub const MODEL_FILE: &str = "ggml-small-q5_1.bin";
pub const MODEL_SIZE: u64 = 190_085_487;
pub const MODEL_SHA256: &str = "ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb";

/// 話している言葉（日本語に決める＝自動で見分けると、短い音や BGM で外れる）。
const LANGUAGE: &str = "ja";
/// whisper に渡す音（16kHz・1チャンネル＝whisper の入力の形）。
const SAMPLE_RATE: u32 = 16_000;
/// 進み具合の知らせの名前（画面が聞く）。
pub const PROGRESS_EVENT: &str = "transcribe_progress";

/// いま走っているか（1度に1つ＝CPU を取り合わせない・止める相手を1つに決める）。
static RUNNING: AtomicBool = AtomicBool::new(false);
/// いま走っている回の番号（画面が決めて渡す・0＝無し）。
static CURRENT_RUN: AtomicU64 = AtomicU64::new(0);
/// 止めてほしいと言われた回の番号（0＝無し）。⚠️ **回で見分ける**（PR #1392 レビュー）＝前の回へ向けた「止める」が
/// 次の回を止めない・始まる前に押した「止める」も、その回が始まった時点で効く。
static CANCEL_RUN: AtomicU64 = AtomicU64::new(0);
/// 走っている子プロセス（FFmpeg の切り出し／`whisper-cli`）。⚠️ **止める・アプリを閉じるときに kill する置き場**
/// （PR #1392 レビュー 🟡＝Windows では親が終わっても子は道連れにならない＝孤児になって CPU を使い続ける）。
static CHILD: Mutex<Option<Child>> = Mutex::new(None);
/// モデルの照合（重い）を済ませたか。`Some(true)`＝合った・`Some(false)`＝合わなかった（起動中は覚える）。
static SHA_CHECKED: Mutex<Option<bool>> = Mutex::new(None);

/// 進み具合の知らせ（どの回のものかを添える＝止めた直後に始めた次の回の棒に混ざらない）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub run_id: u64,
    pub percent: u8,
}

fn lock_child() -> std::sync::MutexGuard<'static, Option<Child>> {
    CHILD.lock().unwrap_or_else(|e| e.into_inner())
}

fn cancelled(run_id: u64) -> bool {
    CANCEL_RUN.load(Ordering::SeqCst) == run_id
}

/// 置き場の子プロセスを終わらせる（あれば）。
fn kill_child() {
    if let Some(mut c) = lock_child().take() {
        let _ = c.kill();
        let _ = c.wait();
    }
}

/// アプリを閉じる前に、走っている回を止める（`lib.rs` の `shutdown_side_processes` から＝後片づけは1か所）。
pub fn shutdown() {
    CANCEL_RUN.store(CURRENT_RUN.load(Ordering::SeqCst), Ordering::SeqCst);
    kill_child();
}

/// 子プロセスを置き場に入れて、終わるか止められるまで待つ。止められたら kill して `TRANSCRIBE_CANCELLED`。
fn wait_child(child: Child, run_id: u64) -> Result<ExitStatus, String> {
    *lock_child() = Some(child);
    loop {
        if cancelled(run_id) {
            kill_child();
            return Err(TRANSCRIBE_CANCELLED.to_string());
        }
        {
            let mut g = lock_child();
            let Some(c) = g.as_mut() else {
                // 置き場が空＝止める・閉じる処理が先に kill した。
                return Err(TRANSCRIBE_CANCELLED.to_string());
            };
            match c.try_wait() {
                Ok(Some(st)) => {
                    g.take();
                    return Ok(st);
                }
                Ok(None) => {}
                Err(_) => {
                    drop(g);
                    kill_child();
                    return Err(TRANSCRIBE_FAILED.to_string());
                }
            }
        }
        std::thread::sleep(Duration::from_millis(100));
    }
}

/// 区切り1つ（素材の頭からの秒）。
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Segment {
    pub start_sec: f64,
    pub end_sec: f64,
    pub text: String,
}

/// 並列の数＝論理コアの半分（2〜8）。⚠️ 全部使うと編集の画面が引っかかる・増やしても伸びが小さい
/// （実測＝6並列 17.6 秒・10並列 14.5 秒＝ADR-0058）。
pub fn thread_count(logical: usize) -> usize {
    (logical / 2).clamp(2, 8)
}

/// FFmpeg で使っている範囲だけを切り出す引数（純粋）。`-ss` は `-i` の前（速い＝そこまで復号しない）。
pub fn extract_args(input: &Path, from_sec: f64, length_sec: f64, out_wav: &Path) -> Vec<String> {
    let mut a: Vec<String> = vec!["-v".into(), "error".into(), "-y".into()];
    if from_sec > 0.0 && from_sec.is_finite() {
        a.push("-ss".into());
        a.push(format!("{from_sec}"));
    }
    a.push("-i".into());
    a.push(input.to_string_lossy().into_owned());
    if length_sec > 0.0 && length_sec.is_finite() {
        a.push("-t".into());
        a.push(format!("{length_sec}"));
    }
    a.extend([
        "-vn".to_string(),
        "-ac".to_string(),
        "1".to_string(),
        "-ar".to_string(),
        SAMPLE_RATE.to_string(),
        "-c:a".to_string(),
        "pcm_s16le".to_string(),
        out_wav.to_string_lossy().into_owned(),
    ]);
    a
}

/// `whisper-cli` の引数（純粋）。**貪欲**（`-bs 1 -bo 1`）＝ビーム探索の約3倍速く、誤り率はほぼ同じ（ADR-0058 の実測）。
/// `-oj -of`＝時刻つきの JSON を書く（`.json` は `whisper-cli` が足す）。`-pp`＝進み具合を出す。
pub fn cli_args(model: &Path, wav: &Path, out_base: &Path, threads: usize) -> Vec<String> {
    vec![
        "-m".into(),
        model.to_string_lossy().into_owned(),
        "-f".into(),
        wav.to_string_lossy().into_owned(),
        "-l".into(),
        LANGUAGE.into(),
        "-t".into(),
        threads.to_string(),
        "-bs".into(),
        "1".into(),
        "-bo".into(),
        "1".into(),
        "-oj".into(),
        "-of".into(),
        out_base.to_string_lossy().into_owned(),
        "-np".into(),
        "-pp".into(),
    ]
}

/// 進み具合の行（`... progress = 45%`）から割合を取る（純粋）。
pub fn progress_of(line: &str) -> Option<u8> {
    let rest = line.split("progress =").nth(1)?;
    let n: u32 = rest.trim().trim_end_matches('%').trim().parse().ok()?;
    Some(n.min(100) as u8)
}

/// `whisper-cli` の JSON から区切りを取る（純粋）。時刻は `offsets`（ミリ秒）を使う。空の文は落とす。
/// 読めない形なら `None`（＝失敗として断る）。
pub fn parse_segments(json: &str) -> Option<Vec<Segment>> {
    let v: serde_json::Value = serde_json::from_str(json).ok()?;
    let items = v.get("transcription")?.as_array()?;
    let mut out = Vec::new();
    for it in items {
        let off = it.get("offsets")?;
        let from = off.get("from")?.as_f64()?;
        let to = off.get("to")?.as_f64()?;
        let text = it.get("text")?.as_str()?.trim().to_string();
        // JSON の数は NaN にならない＝`<=` で「長さが無い」を落とせる。
        if text.is_empty() || to <= from {
            continue;
        }
        out.push(Segment {
            start_sec: from / 1000.0,
            end_sec: to / 1000.0,
            text,
        });
    }
    Some(out)
}

/// 同梱物の場所。
fn bundle_paths(app: &AppHandle) -> Option<(PathBuf, PathBuf)> {
    let dir = app.path().resource_dir().ok()?.join("transcribe");
    let exe = dir.join("runtime").join(if cfg!(windows) {
        "whisper-cli.exe"
    } else {
        "whisper-cli"
    });
    Some((exe, dir.join("models").join(MODEL_FILE)))
}

/// モデルの照合（大きさは毎回・SHA-256 は起動中に1度だけ）。
fn check_model(model: &Path) -> Result<(), &'static str> {
    match std::fs::metadata(model) {
        Ok(m) if m.is_file() && m.len() == MODEL_SIZE => {}
        Ok(m) if m.is_file() => return Err(TRANSCRIBE_BROKEN),
        _ => return Err(TRANSCRIBE_MISSING),
    }
    let mut g = SHA_CHECKED.lock().map_err(|_| TRANSCRIBE_FAILED)?;
    let ok = match *g {
        Some(ok) => ok,
        None => {
            let ok = sha256_hex(model).as_deref() == Some(MODEL_SHA256);
            *g = Some(ok);
            ok
        }
    };
    if ok {
        Ok(())
    } else {
        Err(TRANSCRIBE_BROKEN)
    }
}

fn sha256_hex(path: &Path) -> Option<String> {
    let mut f = std::fs::File::open(path).ok()?;
    let mut h = Sha256::new();
    let mut buf = vec![0u8; 1 << 20];
    loop {
        match f.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => h.update(&buf[..n]),
            Err(_) => return None,
        }
    }
    Some(h.finalize().iter().map(|b| format!("{b:02x}")).collect())
}

/// 部品が入っているか（押す前に断れるように＝§2-5）。照合（重い）はしない。
#[tauri::command]
pub fn transcribe_available(app: AppHandle) -> bool {
    bundle_paths(&app).is_some_and(|(exe, model)| exe.is_file() && model.is_file())
}

/// その回を止める。走っていればすぐ終わらせる／まだ始まっていなければ、始まった時点で止まる。
#[tauri::command]
pub fn transcribe_cancel(run_id: u64) {
    CANCEL_RUN.store(run_id, Ordering::SeqCst);
    if RUNNING.load(Ordering::SeqCst) && CURRENT_RUN.load(Ordering::SeqCst) == run_id {
        kill_child();
    }
}

/// 声を文字にする。`from_sec`／`length_sec`＝素材の秒の範囲（部品が使っている所）。⚠️ 返すのは**切り出した範囲の頭からの秒**
/// （`-ss` を入力の前に置く＝素材の頭からではない）。タイムラインの秒へは画面側（`transcriptLinesOf`）が写す。
/// ⚠️ **メインスレッドを塞がない**（`audio_peaks` と同じ理由）＝別スレッドで走らせる。
#[tauri::command]
pub async fn transcribe_audio(
    app: AppHandle,
    project_id: String,
    rel_path: String,
    from_sec: f64,
    length_sec: f64,
    run_id: u64,
) -> Result<Vec<Segment>, String> {
    if RUNNING.swap(true, Ordering::SeqCst) {
        return Err(TRANSCRIBE_BUSY.to_string());
    }
    CURRENT_RUN.store(run_id, Ordering::SeqCst);
    let r = tauri::async_runtime::spawn_blocking(move || {
        transcribe_impl(&app, &project_id, &rel_path, from_sec, length_sec, run_id)
    })
    .await
    .unwrap_or_else(|_| Err(TRANSCRIBE_FAILED.to_string()));
    // 子が残っていたら終わらせる（中で panic した等＝居残りを作らない）。
    kill_child();
    CURRENT_RUN.store(0, Ordering::SeqCst);
    RUNNING.store(false, Ordering::SeqCst);
    r
}

fn transcribe_impl(
    app: &AppHandle,
    project_id: &str,
    rel_path: &str,
    from_sec: f64,
    length_sec: f64,
    run_id: u64,
) -> Result<Vec<Segment>, String> {
    let (exe, model) = bundle_paths(app).ok_or(TRANSCRIBE_MISSING)?;
    if !exe.is_file() {
        return Err(TRANSCRIBE_MISSING.to_string());
    }
    check_model(&model)?;
    let input = crate::ffmpeg::resolve_project_file(app, project_id, rel_path)
        .map_err(|_| TRANSCRIBE_READ_FAILED.to_string())?;
    if !input.is_file() {
        return Err(TRANSCRIBE_READ_FAILED.to_string());
    }
    // ⚠️ **動画のフォルダの規則を共有する**（PR #1392 レビュー 🟡）＝素材のパスから遡って探すと、素材の中に
    //   `projects` という名のフォルダがあるとそこで止まる。起動時の掃除（`projects/*/cache`）と同じ場所に置く。
    let cache = crate::assets::project_dir(app, project_id)
        .map_err(|_| TRANSCRIBE_READ_FAILED.to_string())?
        .join("cache");
    std::fs::create_dir_all(&cache).map_err(|_| TRANSCRIBE_FAILED.to_string())?;
    let stem = cache.join(format!("transcribe_{}", std::process::id()));
    let wav = stem.with_extension("wav");
    let json = stem.with_extension("json");
    // ⚠️ **必ず片づける**（成功・失敗・止めた、どの道でも）＝素材ではないファイルを動画のフォルダに残さない。
    let ffmpeg = crate::ffmpeg::resolve_ffmpeg(app);
    let progress_app = app.clone();
    let on_progress = move |percent: u8| {
        let _ = progress_app.emit(PROGRESS_EVENT, Progress { run_id, percent });
    };
    let r = run(
        &ffmpeg,
        &exe,
        &model,
        &input,
        from_sec,
        length_sec,
        &wav,
        &stem,
        &json,
        run_id,
        on_progress,
    );
    let _ = std::fs::remove_file(&wav);
    let _ = std::fs::remove_file(&json);
    r
}

/// 切り出し → 文字にする → 読む（アプリに頼らない形＝検査から直接呼べる）。
#[allow(clippy::too_many_arguments)]
fn run(
    ffmpeg: &Path,
    exe: &Path,
    model: &Path,
    input: &Path,
    from_sec: f64,
    length_sec: f64,
    wav: &Path,
    stem: &Path,
    json: &Path,
    run_id: u64,
    on_progress: impl Fn(u8) + Send + 'static,
) -> Result<Vec<Segment>, String> {
    if cancelled(run_id) {
        return Err(TRANSCRIBE_CANCELLED.to_string());
    }
    // ⚠️ **切り出しも置き場に入れて待つ**（PR #1392 レビュー 🟡）＝同期で待つと、長い動画の切り出しの間は止めても効かず、
    //   閉じると ffmpeg.exe が孤児になる。
    let ff = no_window_command(ffmpeg)
        .args(extract_args(input, from_sec, length_sec, wav))
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| TRANSCRIBE_READ_FAILED.to_string())?;
    let st = wait_child(ff, run_id)?;
    if !st.success() || !wav.is_file() {
        return Err(TRANSCRIBE_READ_FAILED.to_string());
    }
    let logical = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4);
    let mut child = no_window_command(exe)
        .args(cli_args(model, wav, stem, thread_count(logical)))
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|_| TRANSCRIBE_FAILED.to_string())?;
    // 進み具合は別のスレッドで読む（読まないと出力の管が詰まって止まる）。
    if let Some(err) = child.stderr.take() {
        std::thread::spawn(move || {
            for line in BufReader::new(err).lines().map_while(Result::ok) {
                if let Some(p) = progress_of(&line) {
                    on_progress(p);
                }
            }
        });
    }
    let status = wait_child(child, run_id)?;
    if !status.success() {
        return Err(TRANSCRIBE_FAILED.to_string());
    }
    let text = std::fs::read_to_string(json).map_err(|_| TRANSCRIBE_FAILED.to_string())?;
    parse_segments(&text).ok_or_else(|| TRANSCRIBE_FAILED.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn threads_are_half_within_bounds() {
        assert_eq!(thread_count(1), 2);
        assert_eq!(thread_count(4), 2);
        assert_eq!(thread_count(14), 7);
        assert_eq!(thread_count(64), 8);
    }

    #[test]
    fn extract_args_cut_only_the_used_range() {
        let a = extract_args(Path::new("in.mp4"), 2.5, 10.0, Path::new("o.wav"));
        let i = a.iter().position(|s| s == "-i").unwrap();
        // `-ss` は `-i` の前（速い）・`-t` は後。
        assert_eq!(a[i - 2..i], ["-ss".to_string(), "2.5".to_string()]);
        assert_eq!(a[i + 2..i + 4], ["-t".to_string(), "10".to_string()]);
        assert!(a.windows(2).any(|w| w == ["-ar", "16000"]));
        assert!(a.windows(2).any(|w| w == ["-ac", "1"]));
        // 頭から・長さが分からないときは付けない。
        let b = extract_args(Path::new("in.mp4"), 0.0, f64::NAN, Path::new("o.wav"));
        assert!(!b.contains(&"-ss".to_string()));
        assert!(!b.contains(&"-t".to_string()));
    }

    #[test]
    fn cli_args_are_greedy_japanese_json() {
        let a = cli_args(Path::new("m.bin"), Path::new("a.wav"), Path::new("out"), 6);
        for pair in [
            ["-l", "ja"],
            ["-t", "6"],
            ["-bs", "1"],
            ["-bo", "1"],
            ["-of", "out"],
        ] {
            assert!(a.windows(2).any(|w| w == pair), "{pair:?}");
        }
        assert!(a.contains(&"-oj".to_string()));
    }

    #[test]
    fn progress_lines() {
        assert_eq!(
            progress_of("whisper_print_progress_callback: progress =  45%"),
            Some(45)
        );
        assert_eq!(progress_of("progress = 100%"), Some(100));
        // 100 を越えた値が来ても 100 で止める（画面の進み具合の棒がはみ出さない）。
        assert_eq!(progress_of("progress = 120%"), Some(100));
        assert_eq!(progress_of("whisper_init: loading model"), None);
    }

    #[test]
    fn parse_uses_offsets_and_drops_empty() {
        let j = r#"{"transcription":[
            {"timestamps":{"from":"00:00:00,300","to":"00:00:05,440"},"offsets":{"from":300,"to":5440},"text":" こんにちは。"},
            {"timestamps":{},"offsets":{"from":5440,"to":5440},"text":"ゼロ"},
            {"timestamps":{},"offsets":{"from":6000,"to":7000},"text":"  "},
            {"timestamps":{},"offsets":{"from":9460,"to":17320},"text":"当社は2015年に創業し"}
        ]}"#;
        let s = parse_segments(j).unwrap();
        assert_eq!(
            s,
            vec![
                Segment {
                    start_sec: 0.3,
                    end_sec: 5.44,
                    text: "こんにちは。".into()
                },
                Segment {
                    start_sec: 9.46,
                    end_sec: 17.32,
                    text: "当社は2015年に創業し".into()
                },
            ]
        );
        assert!(parse_segments("{}").is_none());
        assert!(parse_segments("not json").is_none());
    }

    #[test]
    fn model_missing_and_wrong_size_are_told_apart() {
        let dir = std::env::temp_dir().join(format!("stario_transcribe_m_{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join(MODEL_FILE);
        // 無い＝入れ直す／大きさが違う＝壊れている（照合〔重い〕の前に大きさで断る）。
        assert_eq!(check_model(&p), Err(TRANSCRIBE_MISSING));
        std::fs::write(&p, b"short").unwrap();
        assert_eq!(check_model(&p), Err(TRANSCRIBE_BROKEN));
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 止めるのは**その回だけ**（前の回への「止める」で次の回を止めない）。
    /// ⚠️ 置き場（`CHILD`）と番号は全体で1つ＝この2つの検査は同じ置き場を使うので、1本にまとめる（並列で走らせない）。
    #[cfg(windows)]
    #[test]
    fn wait_child_stops_only_the_cancelled_run_and_empties_the_slot() {
        let slow = || {
            no_window_command("cmd")
                .args(["/C", "ping -n 6 127.0.0.1 > NUL"])
                .spawn()
                .unwrap()
        };
        // 別の回（7）への「止める」は効かない＝最後まで待って終わる…のは遅いので、短い処理で確かめる。
        CANCEL_RUN.store(7, Ordering::SeqCst);
        let quick = no_window_command("cmd")
            .args(["/C", "exit 0"])
            .spawn()
            .unwrap();
        assert!(wait_child(quick, 8).is_ok_and(|s| s.success()));
        assert!(lock_child().is_none(), "終わった子を置き場に残さない");
        // 自分の回への「止める」は、始まる前に押しても効き、子を kill して置き場を空にする。
        CANCEL_RUN.store(9, Ordering::SeqCst);
        let started = std::time::Instant::now();
        assert_eq!(wait_child(slow(), 9), Err(TRANSCRIBE_CANCELLED.to_string()));
        assert!(
            started.elapsed() < Duration::from_secs(2),
            "{:?}",
            started.elapsed()
        );
        assert!(lock_child().is_none(), "止めた子を置き場に残さない");
        // 閉じる処理（`shutdown`）は、走っている回を止めて子を終わらせる。
        CANCEL_RUN.store(0, Ordering::SeqCst);
        CURRENT_RUN.store(10, Ordering::SeqCst);
        let t = std::thread::spawn(move || wait_child(slow(), 10));
        std::thread::sleep(Duration::from_millis(300));
        shutdown();
        assert_eq!(t.join().unwrap(), Err(TRANSCRIBE_CANCELLED.to_string()));
        assert!(lock_child().is_none());
        CURRENT_RUN.store(0, Ordering::SeqCst);
        CANCEL_RUN.store(0, Ordering::SeqCst);
    }

    /// 同梱の部品を置いた手元でだけ回す（CI には部品が無い）：
    /// `cargo test --lib transcribe::tests::real_bundle -- --ignored --nocapture`
    /// 環境変数 `TRANSCRIBE_PROBE_WAV`＝日本語の話し声（例：ADR-0058 の実測に使った clean.wav）。
    #[test]
    #[ignore]
    fn real_bundle_transcribes_the_used_range() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR"));
        let exe = root.join("resources/transcribe/runtime/whisper-cli.exe");
        let model = root.join("resources/transcribe/models").join(MODEL_FILE);
        let ffmpeg = root.join("resources/ffmpeg/bin/ffmpeg.exe");
        let input =
            PathBuf::from(std::env::var("TRANSCRIBE_PROBE_WAV").expect("TRANSCRIBE_PROBE_WAV"));
        assert_eq!(check_model(&model), Ok(()));
        let dir = std::env::temp_dir().join(format!("stario_transcribe_{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let stem = dir.join("t");
        let seen = std::sync::Arc::new(std::sync::atomic::AtomicU8::new(0));
        let seen2 = seen.clone();
        // 9.3 秒から 15 秒ぶん＝2文目（「当社は…」）と3文目の頭。
        let segs = run(
            &ffmpeg,
            &exe,
            &model,
            &input,
            9.3,
            15.0,
            &stem.with_extension("wav"),
            &stem,
            &stem.with_extension("json"),
            101,
            move |p| {
                seen2.store(p, Ordering::SeqCst);
            },
        )
        .unwrap();
        let _ = std::fs::remove_dir_all(&dir);
        println!("{segs:#?}");
        assert!(
            segs.first()
                .is_some_and(|s| s.text.contains("当社") && s.start_sec < 0.5),
            "{segs:?}"
        );
        assert!(segs.iter().all(|s| s.end_sec <= 15.5));
        assert!(seen.load(Ordering::SeqCst) > 0, "進み具合が一度も届かない");
    }

    /// 止めると、走っている `whisper-cli` を終わらせて「止めました」で戻る（手元でだけ）。
    #[test]
    #[ignore]
    fn real_bundle_cancel_stops_the_process() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR"));
        let exe = root.join("resources/transcribe/runtime/whisper-cli.exe");
        let model = root.join("resources/transcribe/models").join(MODEL_FILE);
        let ffmpeg = root.join("resources/ffmpeg/bin/ffmpeg.exe");
        let input =
            PathBuf::from(std::env::var("TRANSCRIBE_PROBE_WAV").expect("TRANSCRIBE_PROBE_WAV"));
        let dir = std::env::temp_dir().join(format!("stario_transcribe_c_{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let stem = dir.join("t");
        std::thread::spawn(|| {
            std::thread::sleep(Duration::from_millis(2500));
            CANCEL_RUN.store(202, Ordering::SeqCst);
        });
        let started = std::time::Instant::now();
        let r = run(
            &ffmpeg,
            &exe,
            &model,
            &input,
            0.0,
            f64::NAN,
            &stem.with_extension("wav"),
            &stem,
            &stem.with_extension("json"),
            202,
            |_| {},
        );
        CANCEL_RUN.store(0, Ordering::SeqCst);
        let _ = std::fs::remove_dir_all(&dir);
        assert_eq!(r, Err(TRANSCRIBE_CANCELLED.to_string()));
        // 64 秒の音を最後まで文字にすると約 18 秒＝止めたなら、その前に戻る。
        assert!(
            started.elapsed() < Duration::from_secs(6),
            "{:?}",
            started.elapsed()
        );
    }
}
