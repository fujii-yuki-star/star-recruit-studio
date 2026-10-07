//! フォルダから動画を取り込む（ADR-0042 決定⑥・#1184）。
//!
//! ⚠️ **ここは「持ち場の外へ書かない」ための層**＝`--import` は**呼ぶ側が丸ごと決める文字列**が
//! 入ってくるので、既存の取り込み（「開く」ダイアログの戻り値を前提にした守り）とは前提が違う。
//!
//! 守り方は ADR-0042 決定⑥のとおり**読む側は広く・書く側は狭く**：
//! - 読む＝`canonicalize` してから使う（リンクはここで解ける）。実在と `project.json` だけ確かめる
//! - **書く＝`projects/<id>/` の下だけ**（**ここが本当の守り**）
//! - 中身を信用しない＝相対の道は**既存の `is_safe_rel_path`**（写しを作らない）
//!
//! ⚠️ **AI に新しい力を与える訳ではない**＝AI は元から自分でファイルを読める。
//! 守るべきなのは**アプリが自分の持ち場の外へ書かないこと**。

use std::path::{Path, PathBuf};

use crate::assets::is_safe_rel_path;

/// 取り込めなかった理由（画面が文にする＝§2-5）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ImportFolderError {
    /// そのフォルダが無い／開けない。
    NotFound,
    /// フォルダではない。
    NotADirectory,
    /// 中に `project.json` が無い。
    NoProjectJson,
    /// 読み書きで失敗した（道とともに）。
    Io(String),
}

/// 取り込む元として使えるか確かめ、**正規化した道**を返す。
///
/// ⚠️ **正規化してから使う**＝リンク（シンボリックリンク・ジャンクション）はここで解ける。
/// ⚠️ **ネットワーク上の道も断らない**＝断る理由が無い（中身はどうせ手元へコピーする）。
pub fn resolve_import_source(folder: &Path) -> Result<PathBuf, ImportFolderError> {
    let root = std::fs::canonicalize(folder).map_err(|_| ImportFolderError::NotFound)?;
    if !root.is_dir() {
        return Err(ImportFolderError::NotADirectory);
    }
    if !root.join("project.json").is_file() {
        return Err(ImportFolderError::NoProjectJson);
    }
    Ok(root)
}

/// 取り込む元にあるファイルを、**持ち場に置いてよい道だけ**選んで並べる（相対・`/` 区切り）。
///
/// ⚠️ **選べなかったものは黙って落とす**＝ここで断ると、**関係ないゴミ1つで取り込みが丸ごと止まる**。
/// 落ちたぶんは呼ぶ側が数で受け取り、記録に残す（§2-5＝黙って減らさない）。
/// ⚠️ **リンクは辿らない**＝辿ると、持ち場の外の中身を**持ち場の中へ写す**ことになる。
pub fn safe_files_under(root: &Path) -> Result<(Vec<String>, usize), ImportFolderError> {
    let mut out: Vec<String> = Vec::new();
    let mut skipped = 0usize;
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let entries = std::fs::read_dir(&dir)
            .map_err(|e| ImportFolderError::Io(format!("{}: {e}", dir.display())))?;
        for entry in entries.flatten() {
            let path = entry.path();
            // ⚠️ **`symlink_metadata` で見る**＝`metadata` は辿ってしまうので、リンクだと気づけない。
            let meta = match std::fs::symlink_metadata(&path) {
                Ok(m) => m,
                Err(_) => {
                    skipped += 1;
                    continue;
                }
            };
            let is_symlink = meta.file_type().is_symlink();
            // ⚠️ **`!is_symlink &&` を足さない**（変異チェックで等価と分かった）＝
            // `symlink_metadata` は**リンク自身**を見るので、フォルダへのリンクは `is_dir()` が偽。
            // 足しても何も変わらず、**守っているように見えるだけ**になる。
            // ⚠️ **本当の守りは `symlink_metadata` を使うこと**＝`metadata` にすると辿ってしまい、
            // そのときは `is_symlink` も偽になるので、条件を足してあっても効かない。
            if meta.is_dir() {
                stack.push(path);
                continue;
            }
            match keep_file(is_symlink, rel_of(root, &path)) {
                Some(rel) => out.push(rel),
                None => skipped += 1,
            }
        }
    }
    out.sort();
    Ok((out, skipped))
}

/// **並べてよい1つか**（純粋＝ディスクを触らない）。
///
/// ⚠️ **判定を関数へ出す**＝フォルダを歩く形のままだと、**リンクを作れない環境では確かめられない**
/// （Windows のリンク作成は権限が要る）。歩く所と決める所を分けて、決める所を直接叩く
/// （α-7 で学んだ「拾い方そのものを検査する」＝門番に穴が空かないようにする形）。
/// ⚠️ **リンクは並べない**＝辿ると、**持ち場の外の中身を持ち場の中へ写す**ことになる。
fn keep_file(is_symlink: bool, rel: Option<String>) -> Option<String> {
    if is_symlink {
        return None;
    }
    rel.filter(|r| is_safe_rel_path(r))
}

/// `root` からの相対の道を `/` 区切りで出す（外に出るなら `None`）。
fn rel_of(root: &Path, path: &Path) -> Option<String> {
    let rel = path.strip_prefix(root).ok()?;
    let mut parts: Vec<String> = Vec::new();
    for c in rel.components() {
        match c {
            std::path::Component::Normal(s) => parts.push(s.to_string_lossy().into_owned()),
            // ⚠️ **普通の名前以外は受けない**＝`..` や根っこが混ざる形は、そもそも相対として扱わない。
            _ => return None,
        }
    }
    if parts.is_empty() {
        return None;
    }
    Some(parts.join("/"))
}

/// 取り込む元から、**持ち場の中の宛先**へ写す。写した数と落とした数を返す。
///
/// ⚠️ **宛先は呼ぶ側が決める**＝この関数は「その下だけに書く」ことを守る。
/// ⚠️ **1つも写せなければ失敗**＝`project.json` すら無い状態の空フォルダを「取り込めた」にしない。
pub fn copy_project_folder(src: &Path, dst: &Path) -> Result<(usize, usize), ImportFolderError> {
    let root = resolve_import_source(src)?;
    let (files, skipped) = safe_files_under(&root)?;
    std::fs::create_dir_all(dst)
        .map_err(|e| ImportFolderError::Io(format!("{}: {e}", dst.display())))?;
    let mut copied = 0usize;
    for rel in &files {
        // ⚠️ **ここでもう一度確かめる**（並べた後に増やされても効くように＝守りは出口に置く）。
        if !is_safe_rel_path(rel) {
            continue;
        }
        let to = dst.join(rel.replace('/', std::path::MAIN_SEPARATOR_STR));
        if let Some(parent) = to.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| ImportFolderError::Io(format!("{}: {e}", parent.display())))?;
        }
        std::fs::copy(
            root.join(rel.replace('/', std::path::MAIN_SEPARATOR_STR)),
            &to,
        )
        .map_err(|e| ImportFolderError::Io(format!("{rel}: {e}")))?;
        copied += 1;
    }
    // ⚠️ **いまは届かない（変異チェックで生き残る＝等価）**＝`resolve_import_source` が
    // `project.json` の実在を確かめており、その道は必ず `is_safe_rel_path` を通るので、
    // ここへ来る時点で**最低1つは写っている**。
    // ⚠️ **それでも残す**＝入口の条件を1つ緩めた瞬間に「**中身の無い動画が取り込めた**」になる側なので、
    // 黙って成功を返すのではなく、断る形にしておく（§2-5）。
    if copied == 0 {
        return Err(ImportFolderError::NoProjectJson);
    }
    Ok((copied, skipped))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("stario_imp_{}_{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).expect("置き場");
        d
    }

    fn write(p: &Path, rel: &str, body: &str) {
        let f = p.join(rel);
        if let Some(parent) = f.parent() {
            std::fs::create_dir_all(parent).expect("親");
        }
        std::fs::write(f, body).expect("書ける");
    }

    #[test]
    fn 動画のデータが無いフォルダは断る() {
        let d = tmp("nojson");
        assert_eq!(
            resolve_import_source(&d),
            Err(ImportFolderError::NoProjectJson)
        );
        // ⚠️ **ファイルを渡された場合も断る**（フォルダを指定してもらう）。
        write(&d, "project.json", "{}");
        assert_eq!(
            resolve_import_source(&d.join("project.json")),
            Err(ImportFolderError::NotADirectory)
        );
    }

    #[test]
    fn 無いフォルダは断る() {
        let d = tmp("missing").join("ここには無い");
        assert_eq!(resolve_import_source(&d), Err(ImportFolderError::NotFound));
    }

    #[test]
    fn 下の階層まで並べる() {
        let d = tmp("walk");
        write(&d, "project.json", "{}");
        write(&d, "assets/asset_001.png", "x");
        write(&d, "voices/clip_016.wav", "y");
        let (files, skipped) = safe_files_under(&d).expect("並ぶ");
        assert_eq!(
            files,
            vec![
                "assets/asset_001.png".to_string(),
                "project.json".to_string(),
                "voices/clip_016.wav".to_string()
            ]
        );
        assert_eq!(skipped, 0);
    }

    /// ⚠️ **持ち場の外へ書かないことが本当の守り**（ADR-0042 決定⑥）＝
    /// 写した先が、渡した宛先の**下だけ**であることを確かめる。
    #[test]
    fn 写し先は宛先の下だけ() {
        let src = tmp("src");
        write(&src, "project.json", "{}");
        write(&src, "assets/a.png", "x");
        let dst = tmp("dst").join("proj_20260917_001");
        let (copied, skipped) = copy_project_folder(&src, &dst).expect("写せる");
        assert_eq!((copied, skipped), (2, 0));
        assert!(dst.join("project.json").is_file());
        assert!(dst.join("assets/a.png").is_file());
        // 宛先の親には何も置いていない。
        let parent: Vec<String> = std::fs::read_dir(dst.parent().expect("親"))
            .expect("読める")
            .flatten()
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(parent, vec!["proj_20260917_001".to_string()]);
    }

    /// ⚠️ **リンクは並べない**（ADR-0042 決定⑥）＝辿ると持ち場の外の中身を中へ写す。
    /// ⚠️ **判定だけを直接叩く**＝Windows でリンクを作るには権限が要るので、
    /// フォルダを歩く形のままだと**確かめられない**（＝確かめていないのに緑になる）。
    #[test]
    fn リンクは並べない() {
        assert_eq!(
            keep_file(false, Some("assets/a.png".into())),
            Some("assets/a.png".into())
        );
        assert_eq!(
            keep_file(true, Some("assets/a.png".into())),
            None,
            "リンクを並べている"
        );
    }

    /// ⚠️ **危うい相対の道は並べない**＝既存の `is_safe_rel_path` に通す（写しを作らない）。
    #[test]
    fn 危うい相対の道は並べない() {
        for rel in ["../外.png", "C:evil.txt", "/根っこ.png", ""] {
            assert_eq!(keep_file(false, Some(rel.into())), None, "rel={rel}");
        }
        // ⚠️ **実在しうる名前でも落ちる**＝`..` を含む名前（`写真..png`）は弾かれる。
        // 落としたことは数で返すので、黙って減らしてはいない。
        assert_eq!(keep_file(false, Some("写真..png".into())), None);
        assert_eq!(keep_file(false, None), None, "外を指す道を並べている");
    }

    /// ⚠️ **並べる所でも、落としたぶんを数える**＝黙って減らさない（§2-5）。
    #[test]
    fn 落としたぶんを数える() {
        let d = tmp("skip");
        write(&d, "project.json", "{}");
        write(&d, "写真..png", "x");
        let (files, skipped) = safe_files_under(&d).expect("並ぶ");
        assert_eq!(files, vec!["project.json".to_string()]);
        assert_eq!(skipped, 1, "落としたのに数えていない");
    }

    /// ⚠️ **1つも写せないなら成功にしない**＝空を「取り込めた」にすると、
    /// 画面には中身の無い動画が出る（§2-5 の行き止まり）。
    #[test]
    fn 何も写せなければ成功にしない() {
        let src = tmp("empty");
        let dst = tmp("empty_dst").join("proj_20260917_002");
        assert_eq!(
            copy_project_folder(&src, &dst),
            Err(ImportFolderError::NoProjectJson)
        );
    }
}
