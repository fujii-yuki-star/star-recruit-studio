import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { ElementAnimation, Scene } from "../../domain/project/types";
import type { Template } from "../../domain/template/types";
import type { Fit } from "../../domain/enums";
import { ORIGINAL_AUDIO_VOLUME } from "../../domain/constants";
import { layoutScene } from "../../renderer/layout";
import { layoutToSvg } from "../../renderer/sceneSvg";
import { splitVideoSceneSvgMulti } from "../../renderer/export/videoSceneSplit";
import { resolveLineSubtitle } from "../../domain/project/lineTimeline";
import { creditForLine, creditForSpeaker } from "../../domain/voice/narratorCredit";
import { fontFamilyForId, resolveFontId, cssFamilyForId } from "../../domain/font/fontCatalog";
import { getVoicevoxSpeaker } from "../../infrastructure/appSettings";
import { useProjectStore } from "../store/projectStore";

/** 動画スロットの再生情報（#432・仕上がり確認の実映像再生）。PreviewScreen が findVideoSlots＋URL解決して渡す。 */
export interface VideoSlotPlayback {
  slotLayerId: string;
  /** 再生用URL（asset://＝クリップ本体。サムネではない）。 */
  clipUrl: string;
  clipStartSec: number;
  clipEndSec?: number;
  speed: number;
  fit: Fit;
  useOriginalAudio: boolean;
  originalVolume?: number;
}

function fitToObjectFit(fit: Fit): "cover" | "contain" | "fill" {
  return fit === "contain" ? "contain" : fit === "stretch" ? "fill" : "cover";
}

/**
 * 仕上がり確認の再生中に動画スロットを実映像で流す video 要素（#432）。スロット矩形へ絶対配置し、
 * clipStartSec（開始位置）・speed（playbackRate）・clipEndSec（到達で停止＝最終フレーム保持）・元音声音量/ミュートを反映。
 * 位置/拡縮/回転/不透明度は書き出し（#442）と同じ layoutScene(t) 由来＝ADR-0001 パリティ。
 */
function SlotVideo({
  src, rectPct, rotation, opacity, fit, clipStartSec, clipEndSec, speed, muted, volume,
}: {
  src: string;
  rectPct: { left: string; top: string; width: string; height: string };
  rotation?: number;
  opacity?: number;
  fit: Fit;
  clipStartSec: number;
  clipEndSec?: number;
  speed: number;
  muted: boolean;
  volume: number;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  // >1.0 増幅用の Web Audio グラフ（volume>1 のときだけ張る）。null＝素の video.volume で足りる（≤1.0）。
  const audioRef = useRef<{ ctx: AudioContext; gain: GainNode } | null>(null);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    const start = (): void => {
      try { v.currentTime = clipStartSec; } catch { /* seek 不可なら loadedmetadata で再設定 */ }
      v.playbackRate = speed;
      // 自動再生不可（ポリシー）や非実装（jsdom）でも throw させない＝静止画で見える（下SVGの穴）＝§2-5。
      try {
        const p = v.play();
        if (p && typeof p.catch === "function") p.catch(() => {});
      } catch { /* noop */ }
    };
    const safePause = (): void => { try { v.pause(); } catch { /* 非実装(jsdom)/停止不可でも無害 */ } };
    const onTime = (): void => {
      // トリミング終端で停止＝最終フレーム保持（書き出しの eof_action=repeat と同じ見え方）。
      if (clipEndSec != null && v.currentTime >= clipEndSec) {
        safePause();
        try { v.currentTime = clipEndSec; } catch { /* noop */ }
      }
    };
    v.addEventListener("loadedmetadata", start);
    v.addEventListener("timeupdate", onTime);
    if (v.readyState >= 1) start(); // 既にメタデータ済みなら即開始
    return () => {
      v.removeEventListener("loadedmetadata", start);
      v.removeEventListener("timeupdate", onTime);
      safePause();
    };
  }, [src, clipStartSec, clipEndSec, speed]);
  // 元音声が 100% 超（最大 150%）のときは video.volume の上限(1.0)を超えられないため、Web Audio の GainNode で増幅して
  // 書き出し（FFmpeg volume=1.5）と一致させる（#432 P2）。AudioContext が無い環境（jsdom/古ブラウザ）は video.volume に
  // 1.0 クランプでフォールバック（≤1.0 は元から一致）。増幅の要否は場面内で不変（スロットの originalVolume）。
  const needsAmp = volume > 1;
  useEffect(() => {
    const v = ref.current;
    if (!v || !needsAmp || audioRef.current) return;
    const AC =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return; // フォールバック（video.volume クランプ）
    try {
      const ctx = new AC();
      const source = ctx.createMediaElementSource(v);
      const gain = ctx.createGain();
      source.connect(gain).connect(ctx.destination);
      audioRef.current = { ctx, gain };
      v.volume = 1; // 素の音量は最大＝最終音量は gain で作る
    } catch { /* 生成失敗は video.volume フォールバック */ }
    return () => {
      void audioRef.current?.ctx.close().catch(() => {});
      audioRef.current = null;
    };
  }, [needsAmp]);
  // ミュート/音量の即時反映（再生を止めずに）。graph があれば gain、無ければ video.volume（1.0クランプ）。
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    const wa = audioRef.current;
    if (wa) {
      wa.gain.gain.value = muted ? 0 : Math.max(0, volume);
      v.muted = false; // 音量は graph に一本化（要素側は素通し）
      void wa.ctx.resume().catch(() => {});
    } else {
      v.muted = muted || volume <= 0;
      v.volume = Math.min(1, Math.max(0, volume));
    }
  }, [muted, volume, needsAmp]);
  return (
    <video
      ref={ref}
      src={src}
      playsInline
      style={{
        position: "absolute",
        left: rectPct.left,
        top: rectPct.top,
        width: rectPct.width,
        height: rectPct.height,
        objectFit: fitToObjectFit(fit),
        transform: rotation ? `rotate(${rotation}deg)` : undefined,
        opacity: opacity ?? 1,
        pointerEvents: "none",
      }}
    />
  );
}

// スロットの画像は assetSrcById（表示用src＝Tauri は asset://／ブラウザ開発は data URL）で差し込む。未設定はプレースホルダ枠。
export function ScenePreview({ scene, template, activeLineIndex, telops, timeSec, animations, videoPlayback, children }: { scene?: Scene; template?: Template; activeLineIndex?: number; telops?: { text: string; row: number }[]; timeSec?: number; animations?: ElementAnimation[]; videoPlayback?: { playing: boolean; muted: boolean; slots: VideoSlotPlayback[] }; children?: ReactNode }) {
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
  const credit = activeLine ? creditForLine(activeLine, baseCredit) : baseCredit;
  const fontFamily = fontFamilyForId(resolveFontId(scene.fontId, fontId));
  const assetSrc = (id: string | null): string | undefined =>
    id ? (assetSrcById[id] ?? templateAssetSrcById[id]) : undefined;
  // 場面のレイアウト（アニメ再生中は timeSec で補間済み＝書き出しと同一 layoutScene(t)・ADR-0001）。
  const layout = layoutScene(scene, template, layoutOpts);
  // responsive:true で SVG ルートを 100%（viewBox は canvas 実寸を保持）にし、外枠の実寸は計測結果に従う。
  // プレビューも書き出しと同じく常時クレジットを表示（ADR-0001 パリティ）。
  const svg = layoutToSvg(layout, { assetSrc, responsive: true, credit, fontFamily });

  // 実映像再生（#432）：再生中かつ動画スロットのある場面のみ、下SVG / video要素 / 上SVG の3層に分けて実映像を流す。
  // 分割は書き出し（splitVideoSceneSvgMulti）と同型＝スロットは穴（透過）にして video 要素で埋める＝ADR-0001 パリティ。
  const playbackSlots = videoPlayback?.playing ? videoPlayback.slots.filter((s) => s.clipUrl) : [];
  const split =
    playbackSlots.length > 0
      ? splitVideoSceneSvgMulti(layout, playbackSlots.map((s) => s.slotLayerId), assetSrc, undefined, fontFamily, credit, true)
      : null;

  const boxStyle: CSSProperties = {
    width: "100%",
    height: "100%",
    borderRadius: "var(--radius)",
    overflow: "hidden",
    background: "#fff",
    border: "1px solid var(--color-border)",
    boxShadow: "var(--shadow-sm)",
  };

  // 3層描画の中身（下SVG →〔スロットvideo→中間SVG〕* → 上SVG）を zIndex 昇順に重ねる。
  const buildVideoLayers = (s: NonNullable<typeof split>): ReactNode[] => {
    const layers: ReactNode[] = [
      <div key="below" style={{ position: "absolute", inset: 0 }} dangerouslySetInnerHTML={{ __html: s.belowSvg }} />,
    ];
    s.slots.forEach((sInfo, k) => {
      const clip = playbackSlots.find((p) => p.slotLayerId === sInfo.layerId);
      if (clip) {
        const vol = clip.useOriginalAudio ? (clip.originalVolume ?? ORIGINAL_AUDIO_VOLUME) : 0;
        layers.push(
          <SlotVideo
            key={`${scene.sceneId}:${sInfo.layerId}`}
            src={clip.clipUrl}
            rectPct={{
              left: `${(sInfo.rect.x / cw) * 100}%`,
              top: `${(sInfo.rect.y / ch) * 100}%`,
              width: `${(sInfo.rect.w / cw) * 100}%`,
              height: `${(sInfo.rect.h / ch) * 100}%`,
            }}
            rotation={sInfo.rotation}
            opacity={sInfo.opacity}
            fit={clip.fit}
            clipStartSec={clip.clipStartSec}
            clipEndSec={clip.clipEndSec}
            speed={clip.speed}
            muted={!!videoPlayback?.muted || !clip.useOriginalAudio}
            volume={vol}
          />,
        );
      }
      if (k < s.midSvgs.length) {
        layers.push(
          <div key={`mid:${k}`} style={{ position: "absolute", inset: 0, pointerEvents: "none" }} dangerouslySetInnerHTML={{ __html: s.midSvgs[k] }} />,
        );
      }
    });
    layers.push(
      <div key="above" style={{ position: "absolute", inset: 0, pointerEvents: "none" }} dangerouslySetInnerHTML={{ __html: s.aboveSvg }} />,
    );
    return layers;
  };

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
        {split ? (
          // 再生中・動画あり：3層（下SVG / 実映像 video / 上SVG）。穴の下SVGが背景、video が動画、上SVGが字幕/クレジット。
          <div role="img" aria-label="場面の仕上がり" style={{ ...boxStyle, position: "relative" }}>
            {buildVideoLayers(split)}
          </div>
        ) : (
          <div role="img" aria-label="場面の仕上がり" style={boxStyle} dangerouslySetInnerHTML={{ __html: svg }} />
        )}
        {/* 操作オーバーレイ（FREE/テンプレ編集）。fit 箱の子＝縦型でもプレビュー実寸と一致し、ドラッグ追従・配置が正確（#273）。 */}
        {children}
      </div>
    </div>
  );
}
