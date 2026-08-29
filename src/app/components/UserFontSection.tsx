// 持ち込みフォント（ADR-0038・#261）。手持ちの文字の形を足して、動画で使えるようにする。
//
// ⚠️ **技術用語を出さない**（§2-3）＝「フォント」は定着しているので使うが、「ttf」「@font-face」
// 「グリフ」等は出さない。見出しは「文字の形（フォント）」。
// ⚠️ **権利の注意文は出さない**（利用者判断 2026-08-26・ADR-0038）＝アプリは**再配布経路にならない**
// （フォントは動画にも焼き出しにも入らず、このパソコンの中だけ）ので、出しても利用者自身の行為への
// 一般的な注意にしかならない。
import { useEffect, useState } from "react";
import { useProjectStore } from "../store/projectStore";
import { showOpenFontDialog } from "../../infrastructure/dialog";
import { listUserFonts, type UserFont } from "../../infrastructure/userFontFs";
import { userFontCssFamily } from "../../domain/font/fontCatalog";

export function UserFontSection() {
  const [fonts, setFonts] = useState<UserFont[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const addUserFont = useProjectStore((s) => s.addUserFont);
  const removeUserFont = useProjectStore((s) => s.removeUserFont);
  const refreshUserFonts = useProjectStore((s) => s.refreshUserFonts);
  const userFontIds = useProjectStore((s) => s.userFontIds);
  const fontError = useProjectStore((s) => s.fontError);

  useEffect(() => {
    void refreshUserFonts();
  }, [refreshUserFonts]);
  // 一覧（名前つき）は id だけでは足りないので、id の並びが変わったら取り直す。
  useEffect(() => {
    // ⚠️ **調べられなかったら前の一覧を残す**（🟡19 のレビュー）＝`null` は「1つも無い」ではない。
    void listUserFonts().then((list) => { if (list) setFonts(list); });
  }, [userFontIds]);

  async function onAdd(): Promise<void> {
    setNotice("");
    setBusy(true);
    try {
      const path = await showOpenFontDialog();
      if (!path) return;
      // 既定の名前は選んだファイルの名前（拡張子なし）＝一覧で見分けられる。
      const base = (path.split(/[/\\]/).pop() ?? "").replace(/\.[^.]+$/, "");
      const id = await addUserFont(path, base);
      if (id) setNotice(`「${base}」を足しました。場面や文字の設定から選べます。`);
    } finally {
      setBusy(false);
    }
  }

  async function onRemove(f: UserFont): Promise<void> {
    setNotice("");
    setBusy(true);
    try {
      await removeUserFont(f.id);
      // ⚠️ **使っている動画があるかはここでは見ない**＝消したあとに公開前チェックが
      // 「見つからない文字の形」として断る（黙って別の字体で書き出さない・ADR-0038）。
      setNotice(`「${f.displayName}」を外しました。この文字の形を使っている動画は、書き出す前に選び直してください。`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h2 className="section-title">文字の形（フォント）</h2>
      <p className="page-desc text-pretty">
        手持ちの文字の形を足すと、動画の文字に使えます。足した文字の形はこのパソコンの中だけに置かれ、動画のファイルには入りません。
      </p>

      <div className="row">
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void onAdd()}>
          {busy ? "取り込んでいます…" : "文字の形を足す"}
        </button>
        <span className="text-sm text-muted">ttf・otf・woff・woff2</span>
      </div>
      {notice && <p className="field-hint mt">{notice}</p>}
      {fontError && <p className="form-error mt" role="alert">{fontError}</p>}

      <div className="mt">
        {fonts.length === 0 ? (
          <p className="field-hint">まだ足していません。同梱の文字の形はそのまま使えます。</p>
        ) : (
          <ul className="list-reset">
            {fonts.map((f) => (
              <li key={f.id} style={{ display: "flex", alignItems: "center", gap: "var(--gap-sm)" }}>
                {/* ⚠️ **その字形で名前を描く**（同梱フォントの選択UIと同じ流儀）＝見て選べる。 */}
                <span style={{ flex: 1, fontFamily: `'${userFontCssFamily(f.id)}', sans-serif`, fontSize: 18 }}>
                  {f.displayName}
                </span>
                <button type="button" className="btn" disabled={busy} onClick={() => void onRemove(f)}>
                  外す
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
