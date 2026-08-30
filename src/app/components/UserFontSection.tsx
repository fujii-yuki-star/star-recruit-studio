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
import { DeleteConfirm } from "./DeleteConfirm";

export function UserFontSection() {
  const [fonts, setFonts] = useState<UserFont[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  // ⚠️ **外すのは確認を通す**（α-6 出口監査 🟡27）＝同じ画面の素材削除・接続キー削除は必ず確認を通すのに、
  // ここだけ1クリックで消えていた（**実体も消え、使っている動画の書き出しが止まる**）。
  const [confirming, setConfirming] = useState<string | null>(null);
  const addUserFont = useProjectStore((s) => s.addUserFont);
  const removeUserFont = useProjectStore((s) => s.removeUserFont);
  const fontNotice = useProjectStore((s) => s.fontNotice);
  const refreshUserFonts = useProjectStore((s) => s.refreshUserFonts);
  const userFontIds = useProjectStore((s) => s.userFontIds);
  const fontError = useProjectStore((s) => s.fontError);
  // ⚠️ **「調べられなかった」を「1つも無い」に見せない**（差分再監査・§2-5）＝公開前チェックは
  // 「調べられません」と言って書き出しを止めているのに、この画面が「まだ足していません」と言うと
  // **同じ状況で2つの違うことを言う**（ADR-0026②）。
  const userFontsUnreadable = useProjectStore((s) => s.userFontsUnreadable);

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
      // ⚠️ **外せたときだけ「外しました」と言う**（α-6 出口監査 🟡13・§2-5）＝失敗しても知らせを出すと、
      // 赤い理由と並ぶうえ**一覧にもそのまま残る**（何が起きたのか分からない）。理由は `fontError` が出す。
      if (!(await removeUserFont(f.id))) { setConfirming(null); return; }
      setConfirming(null);
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
      {/* 会社の見た目の指定を外した、などの知らせ（うまくいった話なので赤字にしない）。 */}
      {fontNotice && <p className="field-hint mt">{fontNotice}</p>}
      {fontError && <p className="form-error mt" role="alert">{fontError}</p>}

      <div className="mt">
        {userFontsUnreadable ? (
          <p className="form-error" role="alert">
            取り込んだ文字の形の一覧を読めませんでした。アプリを開き直してから、もう一度お試しください。
          </p>
        ) : fonts.length === 0 ? (
          <p className="field-hint">まだ足していません。同梱の文字の形はそのまま使えます。</p>
        ) : (
          <ul className="list-reset">
            {fonts.map((f) => (confirming === f.id ? (
              <li key={f.id}>
                <DeleteConfirm
                  busy={busy}
                  confirmLabel="外す"
                  busyLabel="外しています…"
                  message={`「${f.displayName}」を外しますか？このパソコンから消え、元に戻せません。この文字の形を使っている動画は、書き出す前に選び直すことになります。`}
                  onCancel={() => setConfirming(null)}
                  onConfirm={() => void onRemove(f)}
                />
              </li>
            ) : (
              <li key={f.id} style={{ display: "flex", alignItems: "center", gap: "var(--gap-sm)" }}>
                {/* ⚠️ **その字形で名前を描く**（同梱フォントの選択UIと同じ流儀）＝見て選べる。 */}
                <span style={{ flex: 1, fontFamily: `'${userFontCssFamily(f.id)}', sans-serif`, fontSize: 18 }}>
                  {f.displayName}
                </span>
                <button type="button" className="btn" disabled={busy} onClick={() => setConfirming(f.id)}>
                  外す
                </button>
              </li>
            )))}
          </ul>
        )}
      </div>
    </div>
  );
}
