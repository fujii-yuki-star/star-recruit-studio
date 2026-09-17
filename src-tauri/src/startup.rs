//! 起動の引数を読む（ADR-0042・#1184）。
//!
//! ⚠️ **持ち込みの AI が使う「口」**＝待ち受け（ポート）は作らず、**起こすときの引数**で頼む。
//! 誰に許すかは [ADR-0041]、口の形は [ADR-0042] にある。
//!
//! ⚠️ **ここは読むだけ**＝実際に取り込む・書き出すのは呼ぶ側。
//! 読む所を純粋関数に切り出してあるのは、**引数の取り違えを検査で留める**ため
//! （窓を起こさないと確かめられない形にすると、誰も確かめない）。

use std::path::PathBuf;

/// 起動のときに頼まれたこと。
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub enum StartupRequest {
    /// 何も頼まれていない（＝人が普通に起動した）。
    #[default]
    None,
    /// フォルダから取り込む。
    Import { folder: PathBuf },
    /// その動画を書き出す。
    Export { project_id: String, out: PathBuf },
    /// その動画の**読み上げの声を作る**（#1204）。
    ///
    /// ⚠️ **書き出しとは別の口にする**＝一度に両方やる形にすると、
    /// 「声は出来たが書き出しは失敗した」ときに**どこまで進んだかが終了コードで表せない**。
    MakeVoices { project_id: String },
}

/// 起動のときの頼まれごと一式。
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Startup {
    pub request: StartupRequest,
    /// 終わったら閉じるか。
    pub quit_when_done: bool,
    /// 後から渡された回か（`Startup` 自体は自分の起動なので常に偽。DTO 側で立てる）。
    pub forwarded: bool,
}

/// 引数が読めなかった理由（ADR-0042＝**終了コード 2** で返す側）。
///
/// ⚠️ **理由を持つ**＝「読めなかった」だけだと、頼んだ側（AI）が**何を直せばよいか分からない**（§2-5）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StartupArgError {
    /// 値が要る印なのに、後ろに値が無い。
    MissingValue { flag: String },
    /// 知らない印。
    Unknown { flag: String },
    /// `--export` に `--out` が無い（逆も同じ）。
    IncompleteExport,
    /// 取り込みと書き出しを同時に頼まれた。
    Conflicting,
}

const IMPORT: &str = "--import";
const EXPORT: &str = "--export";
const OUT: &str = "--out";
const MAKE_VOICES: &str = "--make-voices";
const QUIT: &str = "--quit-when-done";

/// 引数を読む（**実行ファイル自身の名前は含めない**）。
///
/// ⚠️ **知らない印は黙って読み飛ばさない**＝打ち間違い（`--exprot`）を「何も頼まれていない」として
/// 普通に起動すると、頼んだ側からは**成功したように見えて何も起きない**（§2-5 の行き止まり）。
/// ⚠️ **Windows が足す印まで弾かないよう、対象は `--` で始まるものだけ**にする。
pub fn parse_startup_args(args: &[String]) -> Result<Startup, StartupArgError> {
    let mut import: Option<PathBuf> = None;
    let mut export: Option<String> = None;
    let mut out: Option<PathBuf> = None;
    let mut make_voices: Option<String> = None;
    let mut quit_when_done = false;

    let mut i = 0;
    while i < args.len() {
        let a = args[i].as_str();
        // ⚠️ **印でないものは読み飛ばす**＝OS や起動の仕方によって余計なものが混ざりうる。
        if !a.starts_with("--") {
            i += 1;
            continue;
        }
        let take_value = |flag: &str| -> Result<String, StartupArgError> {
            args.get(i + 1)
                .filter(|v| !v.starts_with("--"))
                .cloned()
                .ok_or_else(|| StartupArgError::MissingValue {
                    flag: flag.to_string(),
                })
        };
        match a {
            IMPORT => {
                import = Some(PathBuf::from(take_value(IMPORT)?));
                i += 2;
            }
            EXPORT => {
                export = Some(take_value(EXPORT)?);
                i += 2;
            }
            OUT => {
                out = Some(PathBuf::from(take_value(OUT)?));
                i += 2;
            }
            MAKE_VOICES => {
                make_voices = Some(take_value(MAKE_VOICES)?);
                i += 2;
            }
            QUIT => {
                quit_when_done = true;
                i += 1;
            }
            _ => {
                return Err(StartupArgError::Unknown {
                    flag: a.to_string(),
                })
            }
        }
    }

    // ⚠️ **声を作るは単独でのみ受ける**＝取り込みや書き出しと混ぜると、
    // どこまで進んだかが**終了コード1つでは表せない**（ADR-0042 ④）。
    if let Some(project_id) = make_voices {
        if import.is_some() || export.is_some() || out.is_some() {
            return Err(StartupArgError::Conflicting);
        }
        return Ok(Startup {
            request: StartupRequest::MakeVoices { project_id },
            quit_when_done,
            forwarded: false,
        });
    }
    let request = match (import, export, out) {
        (None, None, None) => StartupRequest::None,
        (Some(folder), None, None) => StartupRequest::Import { folder },
        (None, Some(project_id), Some(out)) => StartupRequest::Export { project_id, out },
        // ⚠️ **片方だけは断る**＝`--export` だけだと保存先が無く、`--out` だけだと何を書き出すか無い。
        (None, Some(_), None) | (None, None, Some(_)) => {
            return Err(StartupArgError::IncompleteExport)
        }
        // ⚠️ **同時には受けない**＝どちらを先にするかを決めていない（決めていないものを推測で埋めない＝§9-2）。
        _ => return Err(StartupArgError::Conflicting),
    };
    Ok(Startup {
        request,
        quit_when_done,
        forwarded: false,
    })
}

/// 画面へ渡す形（ADR-0042 ④＝**画面は自分が何を頼まれたかを知ってから**描き始める）。
///
/// ⚠️ **技術語を画面へ出さない**（§2-3）＝ここは**画面が分岐に使う値**であって、表示する文ではない。
/// 出す文は画面の側が持つ。
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartupRequestDto {
    /// `"none"` / `"import"` / `"export"` / `"makeVoices"`。
    pub kind: &'static str,
    /// 取り込むフォルダ（`kind="import"` のときだけ）。
    pub folder: Option<String>,
    /// 書き出す動画の id（`kind="export"` のときだけ）。
    pub project_id: Option<String>,
    /// 書き出し先（`kind="export"` のときだけ）。
    pub out: Option<String>,
    /// 終わったら閉じるか。
    pub quit_when_done: bool,
    /// ⚠️ **後から渡されたものか**（ADR-0042 決定③＝すでに動いているアプリへ引数を渡した回）。
    /// **真のときは絶対に閉じない**＝利用者が開いて使っているアプリを、外から来た
    /// `--quit-when-done` が勝手に閉じてよいわけがない（**仕事の持ち主が違う**）。
    pub forwarded: bool,
    /// 引数が読めなかったとき、**何が悪かったか**（画面が文にする＝§2-5）。
    /// ⚠️ **`None` ＝読めた**。読めなかった回は `kind="none"` になるので、これが無いと
    /// 「普通の起動」と見分けがつかない。
    pub arg_error: Option<StartupArgErrorDto>,
}

/// 引数が読めなかった理由（画面へ渡す形）。
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartupArgErrorDto {
    /// `"missingValue"` / `"unknown"` / `"incompleteExport"` / `"conflicting"`。
    pub kind: &'static str,
    /// どの印か（分かるときだけ）。
    pub flag: Option<String>,
}

impl From<&StartupArgError> for StartupArgErrorDto {
    fn from(e: &StartupArgError) -> Self {
        match e {
            StartupArgError::MissingValue { flag } => Self {
                kind: "missingValue",
                flag: Some(flag.clone()),
            },
            StartupArgError::Unknown { flag } => Self {
                kind: "unknown",
                flag: Some(flag.clone()),
            },
            StartupArgError::IncompleteExport => Self {
                kind: "incompleteExport",
                flag: None,
            },
            StartupArgError::Conflicting => Self {
                kind: "conflicting",
                flag: None,
            },
        }
    }
}

/// すでに動いているアプリへ渡された引数を、画面へ渡す形にする（ADR-0042 決定③）。
///
/// ⚠️ **`forwarded: true` を立てる**＝受け取った側が**閉じない**と決められるようにする。
pub fn forwarded_dto(args: &[String]) -> StartupRequestDto {
    let mut dto = StartupState::from_args(args).to_dto();
    dto.forwarded = true;
    // ⚠️ **閉じる頼みは持ち越さない**＝渡された側は他人の仕事で閉じない。
    dto.quit_when_done = false;
    dto
}

/// 起動のときに読んだものを、アプリが動いている間ずっと持っておく置き場。
#[derive(Default)]
pub struct StartupState {
    pub startup: Startup,
    pub arg_error: Option<StartupArgError>,
}

impl StartupState {
    /// 実行ファイルの引数から作る（**自分の名前は落とす**）。
    pub fn from_env() -> Self {
        let args: Vec<String> = std::env::args().skip(1).collect();
        Self::from_args(&args)
    }

    /// 読んだ結果を持つ（**読めなくても起動は止めない**＝画面が理由を出せるように持ち越す）。
    ///
    /// ⚠️ **ここで落とさない**＝引数が変でもアプリが開かないと、人は何が起きたか分からない（§2-5）。
    pub fn from_args(args: &[String]) -> Self {
        match parse_startup_args(args) {
            Ok(startup) => Self {
                startup,
                arg_error: None,
            },
            // ⚠️ **読めなくても「閉じる頼み」は覚えておく**（PR レビュー 🔴）＝落としてしまうと、
            // `--exprot x --quit-when-done` のような回は**断りを出したまま永久に閉じない**
            // ＝頼んだ側（AI）は終わらない仕事を待ち続ける（§2-5 の行き止まり）。
            Err(e) => Self {
                startup: Startup {
                    request: StartupRequest::None,
                    quit_when_done: args.iter().any(|a| a == QUIT),
                    forwarded: false,
                },
                arg_error: Some(e),
            },
        }
    }

    /// 終わったときに返す番号（ADR-0042 ④）。
    ///
    /// ⚠️ **`2` は「引数が読めない」**＝`0`（できた）・`1`（できなかった）と分ける。
    /// 頼んだ側は、**指定の書き間違い**と**やってみて駄目だった**を**直し方が違う**ので区別したい。
    pub fn exit_code(&self, ok: bool) -> i32 {
        if self.arg_error.is_some() {
            return 2;
        }
        if ok {
            0
        } else {
            1
        }
    }

    /// 画面へ渡す形にする。
    pub fn to_dto(&self) -> StartupRequestDto {
        let (kind, folder, project_id, out) = match &self.startup.request {
            StartupRequest::None => ("none", None, None, None),
            StartupRequest::Import { folder } => (
                "import",
                Some(folder.to_string_lossy().into_owned()),
                None,
                None,
            ),
            StartupRequest::Export { project_id, out } => (
                "export",
                None,
                Some(project_id.clone()),
                Some(out.to_string_lossy().into_owned()),
            ),
            StartupRequest::MakeVoices { project_id } => {
                ("makeVoices", None, Some(project_id.clone()), None)
            }
        };
        StartupRequestDto {
            kind,
            folder,
            project_id,
            out,
            quit_when_done: self.startup.quit_when_done,
            forwarded: false,
            arg_error: self.arg_error.as_ref().map(StartupArgErrorDto::from),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn a(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn 何も渡されなければ_普通の起動() {
        let s = parse_startup_args(&a(&[])).expect("読める");
        assert_eq!(s.request, StartupRequest::None);
        assert!(!s.quit_when_done);
    }

    #[test]
    fn 取り込みと書き出しを読む() {
        let s = parse_startup_args(&a(&["--import", "C:/x/proj_1"])).expect("読める");
        assert_eq!(
            s.request,
            StartupRequest::Import {
                folder: PathBuf::from("C:/x/proj_1")
            }
        );
        let s = parse_startup_args(&a(&[
            "--export",
            "proj_20260916_001",
            "--out",
            "C:/out/a.mp4",
            "--quit-when-done",
        ]))
        .expect("読める");
        assert_eq!(
            s.request,
            StartupRequest::Export {
                project_id: "proj_20260916_001".into(),
                out: PathBuf::from("C:/out/a.mp4")
            }
        );
        assert!(s.quit_when_done);
    }

    /// ⚠️ **並びを変えても同じ**＝頼む側（AI）が順番を覚えていなくてよい。
    #[test]
    fn 印の並びは問わない() {
        let s = parse_startup_args(&a(&[
            "--quit-when-done",
            "--out",
            "C:/out/a.mp4",
            "--export",
            "proj_1",
        ]))
        .expect("読める");
        assert_eq!(
            s.request,
            StartupRequest::Export {
                project_id: "proj_1".into(),
                out: PathBuf::from("C:/out/a.mp4")
            }
        );
    }

    /// ⚠️ **打ち間違いを黙って飲まない**＝「何も頼まれていない」として普通に起動すると、
    /// 頼んだ側からは**成功したように見えて何も起きない**（§2-5 の行き止まり）。
    #[test]
    fn 知らない印は断る() {
        assert_eq!(
            parse_startup_args(&a(&["--exprot", "proj_1"])),
            Err(StartupArgError::Unknown {
                flag: "--exprot".into()
            })
        );
    }

    /// ⚠️ **値が次の印に食われない**＝`--import --quit-when-done` を
    /// 「フォルダ名が `--quit-when-done`」と読むと、**存在しない所を取り込みに行く**。
    #[test]
    fn 値が無ければ断る() {
        for args in [
            a(&["--import"]),
            a(&["--import", "--quit-when-done"]),
            a(&["--export", "proj_1", "--out"]),
        ] {
            assert!(
                matches!(
                    parse_startup_args(&args),
                    Err(StartupArgError::MissingValue { .. })
                ),
                "args={args:?}"
            );
        }
    }

    /// ⚠️ **片方だけの書き出しは断る**＝保存先が無い／何を書き出すかが無い。
    #[test]
    fn 書き出しは二つそろって初めて受ける() {
        assert_eq!(
            parse_startup_args(&a(&["--export", "proj_1"])),
            Err(StartupArgError::IncompleteExport)
        );
        assert_eq!(
            parse_startup_args(&a(&["--out", "C:/out/a.mp4"])),
            Err(StartupArgError::IncompleteExport)
        );
    }

    /// ⚠️ **同時には受けない**＝どちらを先にするかを決めていない（決めていないものを推測で埋めない）。
    #[test]
    fn 取り込みと書き出しを同時には受けない() {
        assert_eq!(
            parse_startup_args(&a(&[
                "--import", "C:/x", "--export", "proj_1", "--out", "C:/o.mp4"
            ])),
            Err(StartupArgError::Conflicting)
        );
    }

    /// ⚠️ **読めなかったことを画面まで持ち越す**＝ここを落とすと、頼まれごとが `none` になるので
    /// **「普通の起動」と見分けがつかない**＝頼んだ側には成功したように見えて何も起きない（§2-5）。
    /// ⚠️ **変異チェックで生き残ったので足した**＝読む所（`parse_startup_args`）だけ検査していて、
    /// **渡す所**（`to_dto`）を見ていなかった。
    #[test]
    fn 読めなかった理由が画面まで届く() {
        let st = StartupState::from_args(&a(&["--exprot", "proj_1"]));
        let dto = st.to_dto();
        assert_eq!(dto.kind, "none", "読めなければ頼まれごとは無し");
        let e = dto
            .arg_error
            .expect("理由が落ちている＝普通の起動と見分けがつかない");
        assert_eq!(e.kind, "unknown");
        assert_eq!(e.flag.as_deref(), Some("--exprot"));
    }

    /// ⚠️ **読めたときは理由を出さない**＝毎回「何か変です」が出ると、本当に変な回が埋もれる。
    #[test]
    fn 読めたときは理由を出さない() {
        let dto = StartupState::from_args(&a(&["--import", "C:/x"])).to_dto();
        assert_eq!(dto.kind, "import");
        assert_eq!(dto.folder.as_deref(), Some("C:/x"));
        assert!(dto.arg_error.is_none(), "読めたのに理由が付いている");
    }

    /// ⚠️ **書き出しの3つが、そのまま画面へ届く**＝どれか1つでも落ちると、別の動画を別の場所へ書く。
    #[test]
    fn 書き出しの頼まれごとが画面まで届く() {
        let dto = StartupState::from_args(&a(&[
            "--export",
            "proj_20260916_001",
            "--out",
            "C:/out/a.mp4",
            "--quit-when-done",
        ]))
        .to_dto();
        assert_eq!(dto.kind, "export");
        assert_eq!(dto.project_id.as_deref(), Some("proj_20260916_001"));
        assert_eq!(dto.out.as_deref(), Some("C:/out/a.mp4"));
        assert!(dto.quit_when_done);
    }

    /// ⚠️ **後から渡された頼まれごとでは閉じない**（ADR-0042 決定③）＝
    /// 利用者が開いて使っているアプリを、外から来た `--quit-when-done` が閉じてよいわけがない
    /// （**仕事の持ち主が違う**）。閉じない判断ができるように、印を立てて渡す。
    #[test]
    fn 渡された頼まれごとは_閉じる頼みを持ち越さない() {
        let dto = forwarded_dto(&a(&[
            "--export",
            "proj_1",
            "--out",
            "C:/o.mp4",
            "--quit-when-done",
        ]));
        assert_eq!(dto.kind, "export", "頼まれごと自体は届く");
        assert!(dto.forwarded, "渡されたことが分からない");
        assert!(!dto.quit_when_done, "他人の仕事で閉じようとしている");
    }

    /// ⚠️ **読めなくても「閉じる頼み」は覚えている**（PR レビュー 🔴）＝落とすと、
    /// 断りを出したまま**永久に閉じない**（頼んだ側は終わらない仕事を待ち続ける）。
    #[test]
    fn 読めない指定でも_閉じる頼みは覚えている() {
        let st = StartupState::from_args(&a(&["--exprot", "x", "--quit-when-done"]));
        assert!(st.arg_error.is_some(), "読めたことになっている");
        assert!(st.startup.quit_when_done, "閉じられないので永久に残る");
    }

    /// ⚠️ **番号で返す**（ADR-0042 ④）＝`2`（指定が読めない）と `1`（やって駄目だった）は
    /// **直し方が違う**ので、頼んだ側が区別できるようにする。
    #[test]
    fn 終わりの番号は三つに分かれる() {
        let ok_case = StartupState::from_args(&a(&["--import", "C:/x"]));
        assert_eq!(ok_case.exit_code(true), 0);
        assert_eq!(ok_case.exit_code(false), 1);
        let bad = StartupState::from_args(&a(&["--exprot", "x"]));
        assert_eq!(
            bad.exit_code(true),
            2,
            "読めない指定を「できた」で返している"
        );
        assert_eq!(bad.exit_code(false), 2);
    }

    /// ⚠️ **自分の起動では印が立たない**＝立ててしまうと、AI が起こした回も閉じなくなる。
    #[test]
    fn 自分の起動では渡された印が立たない() {
        let dto = StartupState::from_args(&a(&[
            "--export",
            "proj_1",
            "--out",
            "C:/o.mp4",
            "--quit-when-done",
        ]))
        .to_dto();
        assert!(!dto.forwarded);
        assert!(dto.quit_when_done, "自分の起動なのに閉じられない");
    }

    /// ⚠️ **印でないものは読み飛ばす**＝起動の仕方によって余計なものが混ざりうる。
    #[test]
    fn 印でないものは読み飛ばす() {
        let s = parse_startup_args(&a(&["ごみ", "--quit-when-done"])).expect("読める");
        assert_eq!(s.request, StartupRequest::None);
        assert!(s.quit_when_done);
    }
}

#[cfg(test)]
mod make_voices_tests {
    use super::*;

    fn a(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| s.to_string()).collect()
    }

    /// ⚠️ **声を作る口**（#1204）＝これが無いと、外の AI は「作る→声→書き出す」の**真ん中を通れない**。
    #[test]
    fn make_voices_is_read() {
        let s = parse_startup_args(&a(&["--make-voices", "proj_20260917_001"])).expect("読める");
        assert_eq!(
            s.request,
            StartupRequest::MakeVoices {
                project_id: "proj_20260917_001".to_string()
            }
        );
    }

    /// ⚠️ **値が要る**＝印だけでは何の動画か分からない。
    #[test]
    fn make_voices_needs_value() {
        let e = parse_startup_args(&a(&["--make-voices"])).expect_err("断る");
        assert!(matches!(e, StartupArgError::MissingValue { .. }));
    }

    /// ⚠️ **次の印を値として飲み込まない**。
    #[test]
    fn make_voices_does_not_eat_next_flag() {
        let e = parse_startup_args(&a(&["--make-voices", "--quit-when-done"])).expect_err("断る");
        assert!(matches!(e, StartupArgError::MissingValue { .. }));
    }

    /// ⚠️ **書き出しと混ぜない**＝どこまで進んだかが終了コード1つでは表せない。
    #[test]
    fn make_voices_conflicts_with_export() {
        let e = parse_startup_args(&a(&[
            "--make-voices",
            "proj_1",
            "--export",
            "proj_1",
            "--out",
            "C:/x.mp4",
        ]))
        .expect_err("断る");
        assert!(matches!(e, StartupArgError::Conflicting));
    }

    /// ⚠️ **取り込みとも混ぜない**。
    #[test]
    fn make_voices_conflicts_with_import() {
        let e = parse_startup_args(&a(&["--make-voices", "proj_1", "--import", "C:/x"]))
            .expect_err("断る");
        assert!(matches!(e, StartupArgError::Conflicting));
    }

    /// ⚠️ **閉じる頼みは一緒に受ける**（終わったら閉じる＝AI が待てる）。
    #[test]
    fn make_voices_keeps_quit_when_done() {
        let s = parse_startup_args(&a(&["--make-voices", "proj_1", "--quit-when-done"])).expect("読める");
        assert!(s.quit_when_done);
    }

    /// ⚠️ **画面へ渡す形**＝種類と動画の番号が乗る。
    #[test]
    fn make_voices_dto() {
        let dto = StartupState::from_args(&a(&["--make-voices", "proj_1"])).to_dto();
        assert_eq!(dto.kind, "makeVoices");
        assert_eq!(dto.project_id.as_deref(), Some("proj_1"));
        assert_eq!(dto.out, None);
    }
}
