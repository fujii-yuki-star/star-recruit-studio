// ブランドキット（ADR-0036・#351）。会社の既定フォント・色・ロゴをひとまとめに覚える。
//
// ⚠️ **技術用語を出さない**（§2-3）＝「ブランドキット」「アセット」は出さず「会社の見た目」と書く。
// ⚠️ **自動では遡及しない**（決定3・§2-5）＝既にある動画は「この動画に反映する」を押したときだけ変わる。
// 押す前に**何が変わるか**を見せる（#547 の「まとめて標準にする」と同型）。
import { useEffect, useMemo, useState } from "react";
import type { ScreenId } from "../data/mockData";
import { hasOpenProject, isExportBusy, useProjectStore } from "../store/projectStore";
import { useTimelineStore } from "../store/timelineStore";
import { ColorPicker } from "./ColorPicker";
import { DeleteConfirm } from "./DeleteConfirm";
import { FONT_CATALOG, DEFAULT_FONT_ID } from "../../domain/font/fontCatalog";
import { listLibraryAssets } from "../../infrastructure/assetLibraryFs";
import type { LibraryAsset } from "../../domain/asset/assetLibrary";
import { ASSET_TYPE } from "../../domain/enums";
import {
  addBrandColor,
  BRAND_COLORS_MAX,
  isNoopBrandApply,
  planBrandApply,
  removeBrandColor,
} from "../../domain/brand/brandKit";

export function BrandKitSection({ onNavigate }: { onNavigate?: (screen: ScreenId) => void } = {}) {
  const brandKit = useProjectStore((s) => s.brandKit);
  const undo = useProjectStore((s) => s.undo);
  const userFonts = useProjectStore((s) => s.userFonts);
  const updateBrandKit = useProjectStore((s) => s.updateBrandKit);
  // ⚠️ **覚え直しが書けなかった理由**（α-6 出口監査 🟡23）＝黙って覚えた顔をしない（§2-5）。
  const brandKitError = useProjectStore((s) => s.brandKitError);
  const brandKitUnreadable = useProjectStore((s) => s.brandKitUnreadable);
  const rebuildBrandKit = useProjectStore((s) => s.rebuildBrandKit);
  const [rebuilding, setRebuilding] = useState(false);
  // ⚠️ **「変更はできません」と書いた欄は押せなくする**（差分再監査 🟡・§2-5 派生）＝
  // `updateBrandKit` は読めていない間**必ず断る**ので、押せるままだと**選択が元へ戻って**
  // 2つ目の赤字が増えるだけ（同じ状態に断り方が2通り）。同じ画面の書き出し中のボタンは
  // 既に `disabled`＋`title` で押す前に断っており、そちらへ揃える。
  const unreadableGuard = brandKitUnreadable
    ? { disabled: true, title: "会社の見た目を読めていないので、いまは変えられません。アプリを開き直してからお試しください。" }
    : {};
  const refreshBrandKit = useProjectStore((s) => s.refreshBrandKit);
  const applyBrandKit = useProjectStore((s) => s.applyBrandKit);
  const projectFontId = useProjectStore((s) => s.meta.videoSettings.fontId);
  const hasLogoAsset = useProjectStore((s) => s.assets.some((a) => a.assetType === ASSET_TYPE.logo));
  // ⚠️ **場面ごとに文字の形を選んだ場面は変わらない**（α-6 出口監査 🟡31）＝数えて先に見せる。
  // ⚠️ **選ぶのは `scenes` そのもの**＝選ぶ式の中で `map` すると**毎回ちがう配列**が返り、
  // zustand が「変わった」と見て**描き直しが止まらなくなる**（実際に無限ループになった）。
  const scenes = useProjectStore((s) => s.scenes);
  const sceneFontIds = useMemo(() => scenes.map((sc) => sc.fontId), [scenes]);
  // 覚えている字体が、同梱にも手持ちの一覧にも無いか（外した／まだ読めていない）。
  const missingBrandFont =
    brandKit.fontId != null
    && !FONT_CATALOG.some((f) => f.id === brandKit.fontId)
    && !userFonts.some((f) => f.id === brandKit.fontId);
  // ⚠️ **開いているかは共有の1つから採る**（差分再監査 6巡目 🟡）＝`projectId` だけで見ると、
  // 白紙から作った直後（まだ番号を採っていない）を「開いていません」と言ってしまう
  //（実際は開いている＝嘘の理由・§2-5）。同じ問いを画面ごとに書き直さない。
  const hasProject = useProjectStore(hasOpenProject);
  const projectName = useProjectStore((s) => s.meta.projectName);
  /**
   * タイムライン形式の文書が**メモリに載っている**か（差分再監査 4巡目 🔴）。
   *
   * ⚠️ **「タイムラインを見ている」ではない**＝両形式は同時に開いたままにでき、**閉じる導線が無い**。
   * これで反映そのものを塞ぐと、一度タイムラインを開いた**セッション中ずっと**、場面形式の動画にも
   * 反映できなくなる（しかも理由は事実と違う）＝解除できない行き止まり（§2-5）。
   * ⚠️ **塞がずに名指しで解く**＝「どちらの文書の話か」は反映先の名前を出せば分かる（このPRの主眼）。
   * 使うのは**場面形式の動画を開いていないとき**の案内だけ（「開いていません」は嘘になるため）。
   */
  const timelineOpen = useTimelineStore((s) => s.doc != null);
  // ⚠️ **書き出し中は押せなくする**（α-6 出口監査 🟡14）＝store 側は断るのに画面は押せてしまい、
  // コメントの「押せないようにもしてある」が実態と違っていた（押す前に理由を出す＝§2-5）。
  const isExporting = useProjectStore((s) => isExportBusy(s.exportRun.phase));
  const [logos, setLogos] = useState<LibraryAsset[]>([]);
  const [logosUnreadable, setLogosUnreadable] = useState(false);
  const [newColor, setNewColor] = useState("#1f9ea3");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    void refreshBrandKit();
  }, [refreshBrandKit]);
  useEffect(() => {
    let alive = true;
    void listLibraryAssets().then((list) => {
      if (!alive) return;
      // ⚠️ **「読めなかった」を「1つも無い」に見せない**（PR #909 レビュー ℹ️）＝前の一覧を残す
      // だけだと、**初回に失敗したとき**は空のまま「ロゴがまだありません」と出る（置いてあるのに）。
      setLogosUnreadable(list == null);
      if (list) setLogos(list.filter((a) => a.assetType === ASSET_TYPE.logo));
    });
    return () => {
      alive = false;
    };
  }, []);

  const colors = brandKit.colors ?? [];
  const plan = planBrandApply(brandKit, { fontId: projectFontId, hasLogoAsset, sceneFontIds });
  const nothingToApply = isNoopBrandApply(plan);

  const [error, setError] = useState("");
  // 失敗したが**一部は入っている**（フォントだけ変わってロゴが取り込めなかった等）。
  const [partlyApplied, setPartlyApplied] = useState(false);
  // ⚠️ **取り消しでロゴは戻らない**（差分再監査）＝履歴は `{meta,parts,scenes}` だけ（ADR-0020＝
  // assets は入れない）。「元に戻す」で全部戻るかのように見せず、**戻らないもの**をその場で言う。
  const [undoRestoresFont, setUndoRestoresFont] = useState(false);
  const [logoAdded, setLogoAdded] = useState(false);

  async function onApply(): Promise<void> {
    setNotice("");
    setError("");
    // ⚠️ **できたときだけ「反映しました」と言う**（PR #888 レビュー 🟡・§2-5）＝ロゴの取り込みは
    // 失敗しうる（置き場から消えている等）。理由はこの画面には出ないので、ここで受け取って出す。
    const r = await applyBrandKit();
    // ⚠️ **この画面には「取り消す」が無い**（α-6 出口監査 🟡30）＝`UndoRedoButtons` は
    // たたき台・公開前チェック・編集のツールバーにしか置いていない。**その場に押すものが無い**のに
    // 「「取り消す」を押してください」と言うのは、実行できない次の行動を名指しすること（§2-5）。
    // 知らせの中に戻す導線を出す。
    if (r.ok) setNotice("この動画に反映しました。");
    // ⚠️ **一部だけ入ったときも戻せるようにする**（PR #902 レビュー）＝フォントは入ったがロゴの
    // 取り込みで失敗した、が起こりうる。理由だけ出して戻す導線を出さないと、**変わったまま戻せない**。
    else setError(r.error ?? "反映できませんでした。もう一度お試しください。");
    setPartlyApplied(!r.ok && r.applied);
    // ⚠️ **取り消しが何を戻すか**（差分再監査）＝戻るのは文字の形だけ（履歴に assets は入らない）。
    // 戻せるのは**文字の形が変わったときだけ**（成功なら計画・部分失敗なら `applied`＝入ったのは文字の形）。
    setUndoRestoresFont(r.ok ? plan.fontChanges : r.applied);
    setLogoAdded(r.addedLogo);
  }

  return (
    <div className="card">
      <h2 className="section-title">会社の見た目</h2>
      <p className="page-desc text-pretty">
        よく使う文字の形・色・ロゴを覚えておくと、新しい動画に最初から入ります。
        すでに作った動画は自動では変わりません（下のボタンを押したときだけ反映します）。
      </p>

      {/* ⚠️ **読めていないことを言う**（`/canon-check` 🟡・§2-5）＝黙っていると**空のキット**
          （「覚えない」・色0件・ロゴ無し）を見せる＝兄弟の欄（よく使う素材・文字の形）は同じ状況で
          「読めませんでした」と言うので、ここだけ黙ると**同じ状況で違うことを言う**（ADR-0026②）。
          ⚠️ **覚えている中身は上書きしない**ので、この間は変えられない（変えると消える）。 */}
      {brandKitUnreadable && (
        <div className="notice notice-warn" role="alert">
          <p>
            会社の見た目を読めませんでした。覚えている内容を失わないよう、いまは変更できません。
            アプリを開き直すと直ることがあります。
          </p>
          {/* ⚠️ **行き止まりを作らない**（差分再監査 🟡・§2-5）＝上書きを断る門を下ろせるのは
              「読み込みの成功」だけなので、ファイルが本当に壊れていると**二度と変えられない**。
              利用者が**押したときだけ**通る出口を置く（何が失われるかを先に言う）。 */}
          {rebuilding ? (
            <DeleteConfirm
              message="覚えていた文字の形・色・ロゴは読み取れないため、作り直すと空になります。よろしいですか？"
              confirmLabel="作り直す"
              onCancel={() => setRebuilding(false)}
              onConfirm={() => { setRebuilding(false); void rebuildBrandKit(); }}
            />
          ) : (
            <button type="button" className="btn" onClick={() => setRebuilding(true)}>
              直らないときは作り直す
            </button>
          )}
        </div>
      )}

      <div className="field">
        <label className="field-label" htmlFor="brandFont">いつもの文字の形</label>
        <select
          id="brandFont"
          className="input"
          value={brandKit.fontId ?? ""}
          {...unreadableGuard}
          onChange={(e) => void updateBrandKit({ ...brandKit, fontId: e.target.value || undefined })}
        >
          <option value="">覚えない（毎回選ぶ）</option>
          {FONT_CATALOG.map((f) => (
            <option key={f.id} value={f.id}>{f.label}{f.id === DEFAULT_FONT_ID ? "（標準）" : ""}</option>
          ))}
          {/* ⚠️ **手持ちの文字の形も既定にできる**（ADR-0038 決定7・α-6 出口監査 🔴1）＝
              「`fontId` が `string` になれば持ち込みを既定にできる」と決めていたのに、
              ここが同梱3種のままで**決定が成立していなかった**。 */}
          {/* ⚠️ **覚えているのに一覧に無い字体の受け皿を置く**（α-6 出口監査・再監査で発覚）＝
              「外す」はキットに触らないので、既定にしていた字体を外すと**一致する選択肢が消え**、
              覚えているのに画面は「覚えない（毎回選ぶ）」を見せる（そのまま新しい動画へは焼き込まれる）。
              ⚠️ `FontPicker` で潰した失敗と**同型**＝片方だけ直すと同じ穴が残る。 */}
          {missingBrandFont && (
            <option value={brandKit.fontId}>取り込んだ文字の形（見つかりません）</option>
          )}
          {userFonts.map((f) => (
            <option key={f.id} value={f.id}>{f.displayName}（手持ち）</option>
          ))}
        </select>
      </div>

      <div className="field">
        <span className="field-label">会社の色（{colors.length}／{BRAND_COLORS_MAX}）</span>
        {/* ⚠️ **色を選ぶところの候補の先頭に出る**（決定4）＝既定の色は残る。 */}
        <p className="field-hint">ここに入れた色は、色を選ぶときにいちばん上に並びます。</p>
        <div className="chip-input-row">
          {colors.map((c) => (
            <span key={c} className="chip">
              <span style={{ width: 14, height: 14, borderRadius: 3, background: c, display: "inline-block" }} />
              {c}
              <button type="button" aria-label={`${c} を外す`} {...unreadableGuard} onClick={() => void updateBrandKit(removeBrandColor(brandKit, c))}>
                ×
              </button>
            </span>
          ))}
        </div>
        <div className="row">
          <ColorPicker value={newColor} onChange={setNewColor} ariaLabel="足す色を選ぶ" />
          <button
            type="button"
            className="btn"
            {...unreadableGuard}
            disabled={brandKitUnreadable || colors.length >= BRAND_COLORS_MAX}
            onClick={() => void updateBrandKit(addBrandColor(brandKit, newColor))}
          >
            この色を覚える
          </button>
        </div>
        {colors.length >= BRAND_COLORS_MAX && (
          // ⚠️ **上限で古い色を黙って捨てない**＝押せない理由を出す（§2-5）。
          <p className="field-hint">覚えられる色がいっぱいです。どれかを外してから足してください。</p>
        )}
      </div>

      <div className="field">
        <label className="field-label" htmlFor="brandLogo">いつものロゴ</label>
        {/* ⚠️ **覚えるのは1つだけ**（決定6）＝白抜き版などは「よく使う素材」から取り込む。 */}
        <p className="field-hint">
          新しい動画に最初から入れておく1枚です。ほかの版は「よく使う素材」から取り込めます。
        </p>
        {logosUnreadable ? (
          <p className="form-error" role="alert">
            よく使う素材の一覧を読めませんでした。アプリを開き直してから、もう一度お試しください。
          </p>
        ) : logos.length === 0 ? (
          // ⚠️ **場所と行き方まで書く**（α-6 出口監査 ℹ️・§2-5）＝「よく使う素材」がどこにあるか
          // 書いていないうえ、そこへ行く導線も無く**次の行動が取れない**行き止まりだった。
          <p className="field-hint">
            ロゴがまだありません。素材の画面の「よく使う素材」に置くと、ここで選べます。
            {onNavigate && (
              <>
                {" "}
                <button type="button" className="btn btn-ghost text-sm" onClick={() => onNavigate("materials")}>
                  素材の画面へ
                </button>
              </>
            )}
          </p>
        ) : (
          <select
            id="brandLogo"
            className="input"
            value={brandKit.logoLibraryAssetId ?? ""}
            {...unreadableGuard}
            onChange={(e) => void updateBrandKit({ ...brandKit, logoLibraryAssetId: e.target.value || undefined })}
          >
            <option value="">覚えない</option>
            {logos.map((a) => (
              <option key={a.id} value={a.id}>{a.displayName}</option>
            ))}
          </select>
        )}
      </div>

      {/* ⚠️ **覚え直しの失敗は、動画を開いていなくても出す**（α-6 出口監査 🟡23）＝
          この欄（文字の形・色・ロゴ）は動画を開いていなくても触れる。 */}
      {brandKitError && <p className="form-error mt" role="alert">{brandKitError}</p>}

      {/* ⚠️ **塊ごと黙って消さない**（α-6 出口監査 ℹ️）＝動画を開いていないと反映の一式が
          何も言わずに消えるので、**そこに何かがあったこと**が分からない。見出しは残し、
          押せない理由（＝先に動画を開く）をその場に出す（§2-5）。 */}
      <div className="mt">
        <hr className="divider" />
        {/* ⚠️ **どの動画に入るかを名指しする**（差分再監査 3巡目）＝開いている文書が2種類あるので、
            「いま開いている動画」だけでは**どちらのことか分からない**。 */}
        {/* ⚠️ **名指しと断りを食い違わせない**（PR #912 レビュー 🟡）＝場面形式とタイムラインは
            **同時に開いていられる**ので、`hasProject` だけで名前を出すと「「◯◯」に反映する」の
            直後に「反映できません」が並ぶ。名指しは**反映できるときだけ**にする。 */}
        <span className="field-label">
          {hasProject && projectName ? `「${projectName}」に反映する` : "いま開いている動画に反映する"}
        </span>
        {!hasProject ? (
          // ⚠️ **タイムラインだけ開いているときに「開いていません」と言わない**（嘘の理由・§2-5）。
          <p className="field-hint">
            {timelineOpen
              ? "タイムラインで作った動画には、ここからは反映できません。会社の見た目は、新しく作る動画に最初から入ります。"
              : "いまは動画を開いていません。動画を開くと、ここから反映できます。"}
          </p>
        ) : (
        <>
          {/* ⚠️ **押す前に何が変わるかを見せる**（決定3・#547 の「まとめて標準にする」と同型）。 */}
          {nothingToApply ? (
            <p className="field-hint">この動画は、覚えている見た目と同じです。反映するものはありません。</p>
          ) : (
            <>
              <ul className="list-reset field-hint">
                {plan.fontChanges && <li>・動画全体の文字の形が変わります</li>}
                {/* ⚠️ **既にあるロゴは置き換えない**（作り込みを消さない）＝足すのは持っていないときだけ。 */}
                {plan.addsLogo && <li>・ロゴを1つ足します（すでにあるロゴは置き換えません）</li>}
                {/* ⚠️ **変わらないものも先に見せる**（🟡31）＝場面ごとの指定は動画全体より優先されるので、
                    その場面は反映しても見た目が変わらない。言わないと押したあとに自分で気づくしかない。 */}
                {plan.keptScenes > 0 && (
                  <li>・自分で文字の形を選んでいる場面{plan.keptScenes}個は、そのままです</li>
                )}
              </ul>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={isExporting}
                title={isExporting ? "書き出しが終わるまでお待ちください" : undefined}
                onClick={() => void onApply()}
              >
                この動画に反映する
              </button>
            </>
          )}
          {error && partlyApplied && (
            <div className="row mt" style={{ alignItems: "center", gap: "var(--gap-sm)" }}>
              <p className="field-hint" style={{ margin: 0 }}>一部だけ反映されています。</p>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => { undo(); setError(""); setPartlyApplied(false); }}
              >
                元に戻す
              </button>
            </div>
          )}
          {notice && (
            <div className="row mt" style={{ alignItems: "center", gap: "var(--gap-sm)" }}>
              <p className="field-hint" style={{ margin: 0 }}>
                {notice}
                {/* ⚠️ **戻らないものを言う**（差分再監査・§2-5）＝足したロゴは素材なので、
                    取り消しの対象（`{meta,parts,scenes}`＝ADR-0020）に入っていない。 */}
                {logoAdded && "（足したロゴは素材に残ります。外すときは素材の画面から。）"}
              </p>
              {/* ⚠️ **その場で戻せるようにする**（α-6 出口監査 🟡30）＝この画面には共通の
                  「取り消す」が無いので、案内するだけだと押すものが見つからない（§2-5）。
                  ⚠️ **戻すものが無いときは出さない**＝ロゴを足しただけなら取り消しは何も戻さない
                  （押しても何も起きないボタンを置かない）。 */}
              {undoRestoresFont && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => { undo(); setNotice(""); setLogoAdded(false); setUndoRestoresFont(false); }}
                >
                  元に戻す
                </button>
              )}
            </div>
          )}
          {error && <p className="form-error mt" role="alert">{error}</p>}
        </>
        )}
      </div>
    </div>
  );
}
