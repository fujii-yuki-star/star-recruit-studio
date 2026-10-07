import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// #942：`asset://` で配れる場所の書き方（`assetProtocol.scope`）は、**置き場所の深さと合っていないと
// 静かに 403 になる**。#926 で棚（`user_assets`）を足したとき `**` と書いてしまい、実機では絵が1枚も
// 出なかった（開発ブラウザは `isTauri()` が偽なので**構造的に再現しない**＝気づけなかった）。
//
// ⚠️ **実機で確かめた事実**（2026-08-31・Tauri 実アプリ・同じ `AppData\Roaming\<識別子>` の下）：
//   `user_assets\lib_asset_001.png`（直下）           → **403**（`user_assets/**` では当たらない）
//   `projects\<id>\assets\asset_001.png`（階層あり）  → 200（`projects/**` で当たる）
// つまり **`/**` は直下のファイルに当たらない**。直下だけの置き場は `/*` と書く。
//
// ⚠️ **広い方（`**`）へ「そろえる」誘惑がある**＝隣に `projects/**` が並んでいるので見た目は自然だが、
// それをやると**また 403 に戻る**。しかも #926 の作りは「読み込めなかったらその絵だけ落とす」ので
// **壊れた画像の印も出ず、静かに絵が無いだけ**になる＝気づけない。
const conf = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf-8")) as {
  app: { security: { assetProtocol: { scope: string[] } } };
};
const scope = conf.app.security.assetProtocol.scope;

describe("asset:// で配れる場所は、置き場所の深さと合っている（#942）", () => {
  it("棚（user_assets）は直下だけ＝`/*`（`/**` では 403 になる）", () => {
    const entry = scope.find((s) => s.includes("user_assets"));
    expect(entry).toBeDefined();
    // ⚠️ 「`**` を含まない」ではなく「`/*` で終わる」を見る＝`/**` は `/*` で終わらない。
    expect(entry?.endsWith("/*")).toBe(true);
    expect(entry?.endsWith("/**")).toBe(false);
  });

  it("動画のフォルダ（projects）は階層があるので `/**`", () => {
    // `projects/<id>/assets/<file>` と `projects/<id>/preview.png`＝どちらも直下ではない。
    const entry = scope.find((s) => s.includes("projects"));
    expect(entry).toBeDefined();
    expect(entry?.endsWith("/**")).toBe(true);
  });

  // #945：許可の**書き方**が合っていても、**起動した時点でそのフォルダが無い**と、その回の
  // `asset://` は全部 403 になる（設定の許可は起動の組み立て時に一度だけ広げられるため）。
  // ⚠️ **入れたばかりのアプリで、取り込んだ写真がどこにも映らない**という形で出る。しかも
  // 読み込み失敗はその絵を落とすだけなので**知らせも壊れた画像の印も出ない**。
  // → 起動時に「作る＋実行時に許可を足す」を通す。**許可範囲に足した場所を、そこへ書き忘れる**のが
  //   再発の形なので、両者の対応をここで固定する。
  it("許可範囲に書いた場所は、起動時にも作って許可している（#945）", () => {
    const rs = readFileSync("src-tauri/src/lib.rs", "utf-8");
    const fn = rs.match(/fn ensure_asset_scope_dirs[\s\S]*?\n\}/);
    expect(fn).not.toBeNull();
    // ⚠️ **コメントを落としてから見る**（変異チェックで判明）＝説明にも `allow_directory` と
    // 書いてあるので、そのままだと**要の1行を消しても通ってしまう**（コメントを検査していた）。
    const body = fn![0].split(/\r?\n/).filter((l) => !l.trim().startsWith("//")).join(" ");
    // ⚠️ **作るだけでは足りない**＝実行時に許可を足す口も通っていること（そこが #945 の要点）。
    expect(body).toMatch(/create_dir_all/);
    expect(body).toMatch(/allow_directory/);
    // 関数があっても、起動時に呼ばれていなければ意味がない。
    expect(rs).toMatch(/\.setup\([\s\S]{0,1500}ensure_asset_scope_dirs\(/);
    // 許可範囲の場所が、どちらもその関数の中で扱われていること。
    // ⚠️ **広さ（再帰かどうか）まで合わせる**＝`allow_directory` の第2引数は `true` で `**`、
    // `false` で `*` を足すので、設定が `/*` の場所を `true` で足すと**設定より広く許す**ことになる。
    for (const entry of scope) {
      const dir = entry.replace("$APPDATA/", "").replace(/\/\*+$/, "");   // projects / user_assets
      const recursive = entry.endsWith("/**");
      expect(body).toMatch(new RegExp(String.raw`${dir}_dir\(app\),\s*${recursive}`));
    }
  });

  it("`asset://` を使うのはこの2か所だけ（増えたらここも見直す）", () => {
    // ⚠️ **配る先が増えたら深さの確認が要る**＝`convertFileSrc` を呼ぶ場所が増えるということは、
    // 新しい置き場が `asset://` に載るということ。持ち込みフォント（バイト列で渡す）や
    // 見た目パターンの既定素材（data URL＝ADR-0021）はここに載っていない。
    const users = ["src/infrastructure/assetFs.ts", "src/infrastructure/assetLibraryFs.ts"]
      .filter((p) => readFileSync(p, "utf-8").includes("convertFileSrc("));
    expect(users).toHaveLength(2);
    expect(scope).toHaveLength(2);
  });
});
