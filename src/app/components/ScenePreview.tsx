import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { ElementAnimation, Scene } from "../../domain/project/types";
import type { Template } from "../../domain/template/types";
import { layoutScene } from "../../renderer/layout";
import { layoutToSvg } from "../../renderer/sceneSvg";
import { resolveLineSubtitle } from "../../domain/project/lineTimeline";
import { creditForLine, creditForSpeaker } from "../../domain/voice/narratorCredit";
import { fontFamilyForId, resolveFontId, cssFamilyForId } from "../../domain/font/fontCatalog";
import { getVoicevoxSpeaker } from "../../infrastructure/appSettings";
import { useProjectStore } from "../store/projectStore";

// スロットの画像は assetSrcById（表示用src＝Tauri は asset://／ブラウザ開発は data URL）で差し込む。未設定はプレースホルダ枠。
export function ScenePreview({ scene, template, activeLineIndex, telops, timeSec, animations, children }: { scene?: Scene; template?: Template; activeLineIndex?: number; telops?: { text: string; row: number }[]; timeSec?: number; animations?: ElementAnimation[]; children?: ReactNode }) {
  const assetSrcById = useProjectStore((s) => s.assetSrcById);
  // テンプレ既定素材（tmpl_asset_*）の表示用 src。場面素材（assetSrcById）に無い id をフォールバック解決（ADR-0021）。
  const templateAssetSrcById = useProjectStore((s) => s.templateAssetSrcById);
  const fontId = useProjectStore((s) => s.meta.videoSettings.fontId);
  const ref = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<{ width: number; height: number } | null>(null);
  // テンプレ向き（canvas）。未設定時は 16:9 を仮置き（プレースホルダ表示用）。
  const cw = template?.canvas.width ?? 16;
  const ch = template?.canvas.height ?? 9;

  // プレビューを「使える領域」に収める（縦型でもスクロールせず全体が見えるように）。
  // 高さの基準＝直近のスクロール領域（場面編集の確認エリア等）。無ければ viewport。さらに 72vh を上限にする。
  // 横幅が制約になる横型では実質「幅100%」になり、従来の重ね合わせ（FREEオーバーレイ）と整合する。
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      // 外側 div 自身の内容幅（width:100% で親のパディングを除いた実利用可能幅）。親 clientWidth はパディング込みでズレる。
      const availW = el.clientWidth;
      let sc: HTMLElement | null = el.parentElement;
      while (sc && !/(auto|scroll)/.test(getComputedStyle(sc).overflowY)) sc = sc.parentElement;
      // プレビュー上端から、スクロール領域（無ければ viewport）の下端までの実空間に収める。
      // 領域の総高ではなく「上端の位置」を考慮するので、上に見出し等があってもはみ出さない。
      const elTop = el.getBoundingClientRect().top;
      const scBottom = sc ? Math.min(sc.getBoundingClientRect().bottom, window.innerHeight) : window.innerHeight;
      const availH = scBottom - elTop - 12;
      if (availW <= 0 || availH <= 0) return;
      const scale = Math.min(availW / cw, availH / ch);
      const w = Math.floor(cw * scale);
      const h = Math.floor(ch * scale);
      // 同値なら state を変えない（ResizeObserver の無限ループ防止）。
      setFit((prev) => (prev && prev.width === w && prev.height === h ? prev : { width: w, height: h }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (el.parentElement) ro.observe(el.parentElement);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [cw, ch]);

  // 選んだフォント（場面→動画全体で解決）を確実にロードする。未ロードだと一瞬フォールバック表示になるが、
  // 読み込み後にブラウザが自動で再描画する（書き出しは ExportScreen 側で事前ロード済み・ADR-0004）。
  useEffect(() => {
    if (typeof document === "undefined" || !document.fonts) return;
    const fam = cssFamilyForId(resolveFontId(scene?.fontId, fontId));
    void document.fonts.load(`400 1em "${fam}"`).catch(() => {});
    void document.fonts.load(`700 1em "${fam}"`).catch(() => {});
  }, [scene?.fontId, fontId]);

  if (!scene || !template) {
    return (
      <div className="preview-stage">
        <span className="preview-stage-label">表示する場面がありません</span>
      </div>
    );
  }

  // 掛け合い（明示 lines）は有効行の字幕をプレビューに反映（追加A/B）。activeLineIndex＝再生中の有効行・未指定は先頭行。
  // activeLineIndex<0 は「間」（頭空白＝先頭行 startSec まで）＝有効行なし＝字幕なしで映像だけ（#386・A案＝間は字幕なし）。
  const hasLines = !!(scene.lines && scene.lines.length > 0);
  const inGap = hasLines && typeof activeLineIndex === "number" && activeLineIndex < 0;
  const activeLine = hasLines && !inGap
    ? scene.lines![activeLineIndex ?? 0] ?? scene.lines![0]
    : undefined;
  const lineSub = activeLine ? resolveLineSubtitle(activeLine, scene) : undefined;
  // 掛け合いで字幕を上書きするか（行の字幕、または「間」の非表示 null）。
  const applyLineSub = inGap || !!lineSub;
  // タイムラインのテロップ（ADR-0018・並行テロップ③(8)）＝再生位置の overlay テロップを段違いで重ねる（書き出しと同一 item＝パリティ）。
  const hasTelops = !!(telops && telops.length > 0);
  // キーフレームアニメ（④・ADR-0019）＝再生位置 timeSec で補間して描く（書き出しと同一 layoutScene(t)＝パリティ）。
  const hasAnim = !!(animations && animations.length > 0);
  const layoutOpts = applyLineSub || hasTelops || hasAnim
    ? {
        // 間（inGap）は字幕なし＝null。行があれば enabled で text/null。
        ...(applyLineSub ? { subtitleText: inGap ? null : lineSub && lineSub.enabled ? lineSub.text : null } : {}),
        // テロップは動画全体フォント（場面フォントに左右されない＝書き出しと一致・ADR-0001）。
        ...(hasTelops ? { telops, telopFontId: resolveFontId(null, fontId) } : {}),
        ...(hasAnim ? { timeSec: timeSec ?? 0, animations } : {}),
      }
    : undefined;
  // 常時クレジットは選択話者のキャラを動的に（#177）。掛け合いは有効行の話者に連動（#243・書き出しと一致）。
  const baseCredit = creditForSpeaker(getVoicevoxSpeaker());
  // responsive:true で SVG ルートを 100%（viewBox は canvas 実寸を保持）にし、外枠の実寸は計測結果に従う。
  const svg = layoutToSvg(layoutScene(scene, template, layoutOpts), {
    assetSrc: (id) => (id ? (assetSrcById[id] ?? templateAssetSrcById[id]) : undefined),
    responsive: true,
    // プレビューも書き出しと同じく常時クレジットを表示（ADR-0001 パリティ）。
    credit: activeLine ? creditForLine(activeLine, baseCredit) : baseCredit,
    // 場面フォント（scene.fontId）→ 無ければ動画全体（videoSettings.fontId）。書き出しと一致（ADR-0001）。
    fontFamily: fontFamilyForId(resolveFontId(scene.fontId, fontId)),
  });

  return (
    <div ref={ref} style={{ width: "100%", display: "flex", justifyContent: "center" }}>
      {/* fit 箱（プレビューの実寸＝canvas と同比）。操作オーバーレイ（children）はこの箱の子にして実寸と一致させる（#273）。 */}
      <div
        style={{
          position: "relative",
          width: fit ? fit.width : "100%",
          height: fit?.height,
          flexShrink: 0,
          aspectRatio: `${cw} / ${ch}`,
        }}
      >
        <div
          role="img"
          aria-label="場面の仕上がり"
          style={{
            width: "100%",
            height: "100%",
            borderRadius: "var(--radius)",
            overflow: "hidden",
            background: "#fff",
            border: "1px solid var(--color-border)",
            boxShadow: "var(--shadow-sm)",
          }}
          dangerouslySetInnerHTML={{ __html: svg }}
        />
        {/* 操作オーバーレイ（FREE/テンプレ編集）。fit 箱の子＝縦型でもプレビュー実寸と一致し、ドラッグ追従・配置が正確（#273）。 */}
        {children}
      </div>
    </div>
  );
}
