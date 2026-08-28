// ブランドキット（ADR-0036・#351）。会社の既定フォント・色・ロゴをひとまとめに覚える。
//
// ⚠️ **技術用語を出さない**（§2-3）＝「ブランドキット」「アセット」は出さず「会社の見た目」と書く。
// ⚠️ **自動では遡及しない**（決定3・§2-5）＝既にある動画は「この動画に反映する」を押したときだけ変わる。
// 押す前に**何が変わるか**を見せる（#547 の「まとめて標準にする」と同型）。
import { useEffect, useState } from "react";
import { useProjectStore } from "../store/projectStore";
import { ColorPicker } from "./ColorPicker";
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

export function BrandKitSection() {
  const brandKit = useProjectStore((s) => s.brandKit);
  const userFonts = useProjectStore((s) => s.userFonts);
  const updateBrandKit = useProjectStore((s) => s.updateBrandKit);
  const refreshBrandKit = useProjectStore((s) => s.refreshBrandKit);
  const applyBrandKit = useProjectStore((s) => s.applyBrandKit);
  const projectFontId = useProjectStore((s) => s.meta.videoSettings.fontId);
  const hasLogoAsset = useProjectStore((s) => s.assets.some((a) => a.assetType === ASSET_TYPE.logo));
  const hasProject = useProjectStore((s) => s.scenes.length > 0);
  const [logos, setLogos] = useState<LibraryAsset[]>([]);
  const [newColor, setNewColor] = useState("#1f9ea3");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    void refreshBrandKit();
  }, [refreshBrandKit]);
  useEffect(() => {
    let alive = true;
    void listLibraryAssets().then((list) => {
      if (alive) setLogos(list.filter((a) => a.assetType === ASSET_TYPE.logo));
    });
    return () => {
      alive = false;
    };
  }, []);

  const colors = brandKit.colors ?? [];
  const plan = planBrandApply(brandKit, { fontId: projectFontId, hasLogoAsset });
  const nothingToApply = isNoopBrandApply(plan);

  const [error, setError] = useState("");

  async function onApply(): Promise<void> {
    setNotice("");
    setError("");
    // ⚠️ **できたときだけ「反映しました」と言う**（PR #888 レビュー 🟡・§2-5）＝ロゴの取り込みは
    // 失敗しうる（置き場から消えている等）。理由はこの画面には出ないので、ここで受け取って出す。
    const r = await applyBrandKit();
    if (r.ok) setNotice("この動画に反映しました。元に戻すときは「取り消す」を押してください。");
    else setError(r.error ?? "反映できませんでした。もう一度お試しください。");
  }

  return (
    <div className="card">
      <h2 className="section-title">会社の見た目</h2>
      <p className="page-desc text-pretty">
        よく使う文字の形・色・ロゴを覚えておくと、新しい動画に最初から入ります。
        すでに作った動画は自動では変わりません（下のボタンを押したときだけ反映します）。
      </p>

      <div className="field">
        <label className="field-label" htmlFor="brandFont">いつもの文字の形</label>
        <select
          id="brandFont"
          className="input"
          value={brandKit.fontId ?? ""}
          onChange={(e) => void updateBrandKit({ ...brandKit, fontId: e.target.value || undefined })}
        >
          <option value="">覚えない（毎回選ぶ）</option>
          {FONT_CATALOG.map((f) => (
            <option key={f.id} value={f.id}>{f.label}{f.id === DEFAULT_FONT_ID ? "（標準）" : ""}</option>
          ))}
          {/* ⚠️ **手持ちの文字の形も既定にできる**（ADR-0038 決定7・α-6 出口監査 🔴1）＝
              「`fontId` が `string` になれば持ち込みを既定にできる」と決めていたのに、
              ここが同梱3種のままで**決定が成立していなかった**。 */}
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
              <button type="button" aria-label={`${c} を外す`} onClick={() => void updateBrandKit(removeBrandColor(brandKit, c))}>
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
            disabled={colors.length >= BRAND_COLORS_MAX}
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
        {logos.length === 0 ? (
          <p className="field-hint">
            「よく使う素材」にロゴを置くと、ここで選べます。
          </p>
        ) : (
          <select
            id="brandLogo"
            className="input"
            value={brandKit.logoLibraryAssetId ?? ""}
            onChange={(e) => void updateBrandKit({ ...brandKit, logoLibraryAssetId: e.target.value || undefined })}
          >
            <option value="">覚えない</option>
            {logos.map((a) => (
              <option key={a.id} value={a.id}>{a.displayName}</option>
            ))}
          </select>
        )}
      </div>

      {hasProject && (
        <div className="mt">
          <hr className="divider" />
          {/* ⚠️ **押す前に何が変わるかを見せる**（決定3・#547 の「まとめて標準にする」と同型）。 */}
          <span className="field-label">いま開いている動画に反映する</span>
          {nothingToApply ? (
            <p className="field-hint">この動画は、覚えている見た目と同じです。反映するものはありません。</p>
          ) : (
            <>
              <ul className="list-reset field-hint">
                {plan.fontChanges && <li>・動画全体の文字の形が変わります</li>}
                {/* ⚠️ **既にあるロゴは置き換えない**（作り込みを消さない）＝足すのは持っていないときだけ。 */}
                {plan.addsLogo && <li>・ロゴを1つ足します（すでにあるロゴは置き換えません）</li>}
              </ul>
              <button type="button" className="btn btn-secondary" onClick={() => void onApply()}>
                この動画に反映する
              </button>
            </>
          )}
          {notice && <p className="field-hint mt">{notice}</p>}
          {error && <p className="form-error mt" role="alert">{error}</p>}
        </div>
      )}
    </div>
  );
}
