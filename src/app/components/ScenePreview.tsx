import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { ElementAnimation, Scene } from "../../domain/project/types";
import type { Template } from "../../domain/template/types";
import type { Fit } from "../../domain/enums";
import { ORIGINAL_AUDIO_VOLUME } from "../../domain/constants";
import { useMediaVolume } from "../hooks/useMediaVolume";
import { isSubtitleItem, layoutScene } from "../../renderer/layout";
import type { LayoutItem } from "../../renderer/layout";
import { layoutToSvg } from "../../renderer/sceneSvg";
import { splitVideoSceneSvgMulti } from "../../renderer/export/videoSceneSplit";
import { fitToObjectFit } from "./fitToObjectFit";
import { fitPercentOf, zoomedBox, type PreviewZoom } from "../../domain/preview/previewZoom";
import { safeAreaRect } from "../../domain/preview/safeArea";
import { ORIENTATION } from "../../domain/enums";
import { useSafeAreaPref } from "../hooks/useSafeAreaPref";
import { resolveLineSubtitle, type BoundaryFrame, type SceneSegmentSpec } from "../../domain/project/lineTimeline";
import { containBox, fallbackWidthCss } from "./previewFit";
import { animationsEndSec, slotIsAnimated } from "../../domain/project/sceneAnimation";
import { resolveVideoStartDelaySec } from "../../domain/project/videoStartTiming";
import { creditForLine, creditForSpeaker } from "../../domain/voice/narratorCredit";
import { sceneCreditVisibility } from "../../domain/project/sceneCredit";
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

/**
 * 仕上がり確認の再生中に動画スロットを実映像で流す video 要素（#432）。スロット矩形へ絶対配置し、
 * clipStartSec（開始位置）・speed（playbackRate）・clipEndSec（到達で停止＝最終フレーム保持）・元音声音量/ミュートを反映。
 * 位置/拡縮/回転/不透明度は書き出し（#442）と同じ layoutScene(t) 由来＝ADR-0001 パリティ。
 */
function SlotVideo({
  src, rectPct, rotation, opacity, fit, clipStartSec, clipEndSec, speed, startDelaySec, muted, volume,
}: {
  src: string;
  rectPct: { left: string; top: string; width: string; height: string };
  rotation?: number;
  opacity?: number;
  fit: Fit;
  clipStartSec: number;
  clipEndSec?: number;
  speed: number;
  /** 再生開始の遅延秒（#444/ADR-0027）。0=先頭から（従来）。>0 は [0,d] を代表フレームで静止して待つ。 */
  startDelaySec: number;
  muted: boolean;
  volume: number;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  // >1.0 増幅用の Web Audio グラフ（volume>1 のときだけ張る）。null＝素の video.volume で足りる（≤1.0）。
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    let releaseTimer: ReturnType<typeof setTimeout> | undefined;
    // 自動再生不可（ポリシー）や非実装（jsdom）でも throw させない＝静止画で見える（下SVGの穴）＝§2-5。
    const playNow = (): void => {
      try {
        const p = v.play();
        if (p && typeof p.catch === "function") p.catch(() => {});
      } catch { /* noop */ }
    };
    const start = (): void => {
      if (releaseTimer) clearTimeout(releaseTimer); // 再入で二重予約しない
      try { v.currentTime = clipStartSec; } catch { /* seek 不可なら loadedmetadata で再設定 */ }
      v.playbackRate = speed;
      // #444/ADR-0027：開始遅延 d>0 は代表フレーム（clipStart）で待ち、scene-time d で play()。playbackRate=speed のまま
      // なので以降 currentTime=clipStart+(t−d)*speed=clipTimeAtSceneTime（書き出しと一致＝ADR-0001・per-frame seek 不要）。
      if (startDelaySec > 0) {
        try { v.pause(); } catch { /* noop */ }
        releaseTimer = setTimeout(playNow, startDelaySec * 1000);
      } else {
        playNow();
      }
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
      if (releaseTimer) clearTimeout(releaseTimer);
      v.removeEventListener("loadedmetadata", start);
      v.removeEventListener("timeupdate", onTime);
      safePause();
    };
  }, [src, clipStartSec, clipEndSec, speed, startDelaySec]);
  // 音量（消音・100%超の増幅）は**タイムライン形式と共有**（#512 段2）＝同じ仕組みを2つ持たない。
  useMediaVolume(ref, { volume, muted });
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
export function ScenePreview({ scene, template, activeLineIndex, boundaryFrame, subtitleSegment, timeSec, animations, videoPlayback, hideItemIds, hideSubtitles, zoom = 'fit', onFitPercent, showSafeArea, children }: { scene?: Scene; template?: Template; activeLineIndex?: number; boundaryFrame?: BoundaryFrame; subtitleSegment?: SceneSegmentSpec; timeSec?: number; animations?: ElementAnimation[]; videoPlayback?: { playing: boolean; muted: boolean; slots: VideoSlotPlayback[] }; hideItemIds?: readonly string[]; hideSubtitles?: boolean; /** 拡大率（#142）。省略＝領域に合わせる（従来どおり＝既存の呼び出しは無変更）。 */ zoom?: PreviewZoom; /**
   * 安全領域（セーフエリア）の枠を出すか（#265）。**編集を助けるためだけ**＝書き出しには焼かない。
   * 省略＝利用者の記憶に従う。`false` を渡すと**記憶に関わらず出さない**（仕上がり確認など、
   * 編集しない画面で線を出さないため）。`true` を渡しても記憶が「出さない」なら出さない。
   */ showSafeArea?: boolean; /** フィット時の実寸%を親へ返す（段を「いまの見え方」から数えるため）。 */ onFitPercent?: (percent: number) => void; children?: ReactNode }) {
  const assetSrcById = useProjectStore((s) => s.assetSrcById);
  // テンプレ既定素材（tmpl_asset_*）の表示用 src。場面素材（assetSrcById）に無い id をフォールバック解決（ADR-0021）。
  const templateAssetSrcById = useProjectStore((s) => s.templateAssetSrcById);
  const fontId = useProjectStore((s) => s.meta.videoSettings.fontId);
  // クレジットの見せ方（ADR-0025・#359）。**画面から渡してもらわず自分で読む**＝渡し忘れた画面だけ
  // 「動画には入らないのに出ている」になる（PR #881 レビューで実際に3画面のうち2画面が漏れていた）。
  const creditDisplay = useProjectStore((s) => s.meta.videoSettings.creditDisplay);
  const projectScenes = useProjectStore((s) => s.scenes);
  const ref = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<{ width: number; height: number } | null>(null);
  // テンプレ向き（canvas）。未設定時は 16:9 を仮置き（プレースホルダ表示用）。
  const cw = template?.canvas.width ?? 16;
  const ch = template?.canvas.height ?? 9;
  // 安全領域の枠（#265）。向きは**見た目パターンが持つもの**を見る（`aspectRatio`）＝
  // 動画全体の設定ではなく、いま描いているキャンバスに合わせる（向き違いの見た目でもずれない）。
  const safeRect = safeAreaRect({ width: cw, height: ch }, template?.aspectRatio ?? ORIENTATION.landscape);
  // ⚠️ **記憶からも読む**（#265）＝画面ごとに渡し忘れると「場面編集では出るのに見た目パターン編集では
  // 出ない」になる。明示の `showSafeArea` は**出さない側へ倒す上書き**（仕上がり確認では線を出さない）。
  const [safeAreaPref] = useSafeAreaPref();
  const drawSafeArea = showSafeArea !== false && safeAreaPref;

  /**
   * フィット時が実寸の何%か（#142）。**段を「いまの見え方」から数える**ために親へ返す
   *（フィットが 63% のときに拡大したら 75% へ＝100% へ飛ばすと**縮んで見える**ことがある）。
   */
  const fitPct = fitPercentOf(fit?.width ?? 0, cw);
  useEffect(() => {
    onFitPercent?.(fitPct);
  }, [fitPct, onFitPercent]);

  // プレビューを「使える領域」に収める（縦型でもスクロールせず全体が見えるように）。
  // 高さの基準＝直近のスクロール領域（場面編集の確認エリア等）の下端（無ければ viewport 下端）までの、プレビュー上端からの実利用高。
  // 計測前/空振り（fit=null）の間は CSS フォールバック（fallbackWidthCss＝幅を「(100vh−予備)×アスペクト比」で絞る）で縦型もはみ出さない。
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
      // 幅が未確定（レイアウト前で 0）の間は計測しない＝CSS フォールバック（fallbackWidthCss）が縦型でもはみ出さない箱にする。
      if (availW <= 0 || availH <= 0) return;
      const { width: w, height: h } = containBox(cw, ch, availW, availH);
      // 同値なら state を変えない（ResizeObserver の無限ループ防止）。
      setFit((prev) => (prev && prev.width === w && prev.height === h ? prev : { width: w, height: h }));
    };
    measure();
    // レイアウト確定後にもう一度（初回計測が幅0で空振りしても、縦型プレビューがフォールバックのまま残らないよう拾う）。
    const raf = requestAnimationFrame(measure);
    const ro = new ResizeObserver(measure);
    if (el.parentElement) ro.observe(el.parentElement);
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(raf);
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
  // 字幕上書き（string=表示／null=非表示／undefined=テンプレ既定＝scene.texts）とクレジット行を解決する。
  // boundaryFrame（切替プレビューの端フレーム・sceneSegmentSpecs 準拠）があればそれを優先＝0 秒行除外/頭の間/フォールバックを
  // 書き出しと一致させる（#408 Part 2 レビュー P1）。無ければ activeLineIndex から（再生中の有効行）。
  const subtitleOverride: string | null | undefined = boundaryFrame
    ? boundaryFrame.subtitleText
    : inGap
      ? null
      : lineSub
        ? lineSub.enabled ? lineSub.text : null
        : undefined;
  const creditLine = boundaryFrame ? boundaryFrame.creditLine : activeLine;
  const applyLineSub = subtitleOverride !== undefined;
  // タイムラインのテロップ（ADR-0018・並行テロップ③(8)）＝再生位置の overlay テロップを段違いで重ねる（書き出しと同一 item＝パリティ）。
  // キーフレームアニメ（④・ADR-0019）＝再生位置 timeSec で補間して描く（書き出しと同一 layoutScene(t)＝パリティ）。
  const hasAnim = !!(animations && animations.length > 0);
  // FREE 字幕（ADR-0029）の対象解決用「その瞬間のセグメント」は**呼び出し側が sceneSegmentSpecs/segmentAt から作って渡す**
  // （PreviewScreen/SceneEditScreen）＝書き出しと同一の正準経路。activeLine から再構成しない（全ゼロ長行フォールバックで
  // 書き出し〔lineId なし＝allLines 非表示〕とズレるのを防ぐ・P1-2）。未指定は layout の場面全体1区間＝単独 narration が texts.subtitle を読む。
  const layoutOpts = applyLineSub || hasAnim || subtitleSegment
    ? {
        // 字幕上書き（間/OFF は null・行は text）。undefined（テンプレ既定）は applyLineSub=false で載せない。
        ...(applyLineSub ? { subtitleText: subtitleOverride } : {}),
        // テロップは動画全体フォント（場面フォントに左右されない＝書き出しと一致・ADR-0001）。
        ...(hasAnim ? { timeSec: timeSec ?? 0, animations } : {}),
        // FREE 字幕要素の対象解決（ADR-0029）＝呼び出し側が渡す正準セグメント。
        ...(subtitleSegment ? { subtitleSegment } : {}),
      }
    : undefined;
  // クレジットは選択話者のキャラを動的に（#177）。掛け合いは有効行の話者に連動（#243・書き出しと一致）。
  const baseCredit = creditForSpeaker(getVoicevoxSpeaker());
  const creditText = creditLine ? creditForLine(creditLine, baseCredit) : baseCredit;
  // 出す/出さないは**書き出しと同じ共有関数**（`sceneCreditVisibility`・ADR-0001）。
  // 見た目パターンの画面が描く**見本の場面**はプロジェクトの場面ではない（index が無い）＝
  // そこは従来どおり出す（「出来上がり」ではなく見た目の見本なので、動画の設定に従わせる意味がない）。
  // ⚠️ `useMemo` は使わない＝この上に「表示する場面がありません」の早期 return があるので、
  // ここでフックを足すと条件付き呼び出しになる（hooks 規則）。場面数ぶんの一次走査で、
  // 同じ描画で走る `layoutScene`＋SVG 組み立てに対して無視できる。
  const creditIndex = projectScenes.findIndex((s) => s.sceneId === scene.sceneId);
  const credit =
    creditIndex < 0 || sceneCreditVisibility(projectScenes, creditDisplay)[creditIndex]
      ? creditText
      : undefined;
  const fontFamily = fontFamilyForId(resolveFontId(scene.fontId, fontId));
  const assetSrc = (id: string | null): string | undefined =>
    id ? (assetSrcById[id] ?? templateAssetSrcById[id]) : undefined;
  // 場面のレイアウト（アニメ再生中は timeSec で補間済み＝書き出しと同一 layoutScene(t)・ADR-0001）。
  const fullLayout = layoutScene(scene, template, layoutOpts);
  // hideItemIds＝インライン編集中の要素をSVGから伏せる（#549）。編集中は textarea が同じ体裁で同じ位置に文字を出すため、
  // 伏せないと二重表示になる（入力は即 store へ反映＝SVG も毎打鍵更新されるため）。**プレビュー限定の編集用アフォーダンス**で、
  // 正準 layoutScene の結果を後段で間引くだけ＝書き出しは hideItemIds を渡さないのでパリティに影響しない（ADR-0001）。
  const layout = hideItemIds && hideItemIds.length > 0
    ? { ...fullLayout, items: fullLayout.items.filter((i) => !hideItemIds.includes(i.id)) }
    : fullLayout;
  // responsive:true で SVG ルートを 100%（viewBox は canvas 実寸を保持）にし、外枠の実寸は計測結果に従う。
  // プレビューも書き出しと同じく常時クレジットを表示（ADR-0001 パリティ）。
  // 「字幕を入れる」OFF（hideSubtitles）は、書き出しと同じ itemFilter＋同じ述語（isSubtitleItem）で字幕を消す
  // ＝プレビュー＝書き出しのパリティ（ADR-0026③・#547 P2-7）。静止・実映像再生の両経路に同じ filter を渡す。
  const subtitleFilter = hideSubtitles ? (it: LayoutItem) => !isSubtitleItem(it) : undefined;
  const svg = layoutToSvg(layout, { assetSrc, responsive: true, ...(credit != null ? { credit } : {}), fontFamily, itemFilter: subtitleFilter });

  // 実映像再生（#432）：再生中かつ動画スロットのある場面のみ、下SVG / video要素 / 上SVG の3層に分けて実映像を流す。
  // 分割は書き出し（splitVideoSceneSvgMulti）と同型＝スロットは穴（透過）にして video 要素で埋める＝ADR-0001 パリティ。
  const playbackSlots = videoPlayback?.playing ? videoPlayback.slots.filter((s) => s.clipUrl) : [];
  const split =
    playbackSlots.length > 0
      ? splitVideoSceneSvgMulti(layout, playbackSlots.map((s) => s.slotLayerId), assetSrc, subtitleFilter, fontFamily, credit, true)
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
  // #444/ADR-0027：動画スロットの再生開始遅延 d を書き出しと同じ resolve で求める（窓 W=min(尺, animEnd)）。
  // playbackRate=speed のまま d 秒後に play() すると currentTime=clipStart+(t−d)*speed＝clipTimeAtSceneTime（export と一致）。
  const sceneWindowSec = Math.min(scene.durationSec, animationsEndSec(animations ?? []));
  const buildVideoLayers = (s: NonNullable<typeof split>): ReactNode[] => {
    const layers: ReactNode[] = [
      <div key="below" style={{ position: "absolute", inset: 0 }} dangerouslySetInnerHTML={{ __html: s.belowSvg }} />,
    ];
    s.slots.forEach((sInfo, k) => {
      const clip = playbackSlots.find((p) => p.slotLayerId === sInfo.layerId);
      if (clip) {
        const vol = clip.useOriginalAudio ? (clip.originalVolume ?? ORIGINAL_AUDIO_VOLUME) : 0;
        // #444：このスロット自身がアニメ対象のときだけ開始遅延を効かせる（非対象は d=0＝先頭から・書き出し/precheck と同一門番）。
        const startDelaySec = slotIsAnimated(animations ?? [], [sInfo.layerId], scene.groups)
          ? resolveVideoStartDelaySec(scene.slotVideoStart?.[sInfo.layerId], sceneWindowSec)
          : 0;
        layers.push(
          <SlotVideo
            key={`${scene.sceneId}:${sInfo.layerId}`}
            src={clip.clipUrl}
            startDelaySec={startDelaySec}
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
    <div
      ref={ref}
      style={{
        width: "100%",
        display: "flex",
        // ⚠️ **拡大したら送って見る**（#142）＝収まらない側をスクロールで見る。フィットのときは
        // 中央寄せのまま（いままでの見え方を変えない）。
        justifyContent: zoom === 'fit' ? "center" : "flex-start",
        overflow: zoom === 'fit' ? undefined : "auto",
      }}
    >
      {/* fit 箱（プレビューの実寸＝canvas と同比）。操作オーバーレイ（children）はこの箱の子にして実寸と一致させる（#273）。 */}
      <div
        style={{
          position: "relative",
          // fit（JS 計測）があれば実寸。計測前/空振り時は fallbackWidthCss で「使える高さ×アスペクト比」に幅を絞り、
          // 縦型（9:16）でも箱高さ ≤ (100vh − 予備) に収める（従来の width:100% だと縦型が画面をはみ出していた）。
          // ⚠️ **CSS の `transform: scale` ではなく実寸を変える**（#142）＝操作オーバーレイは
          // `getBoundingClientRect()` から縮尺を導く（`scale = rect.width / canvas.width`）ので、
          // **箱が実際に大きくなれば座標整合は自動で取れる**。`transform` だとレイアウトが
          // 追従せず、**掴んだ場所と実際の位置がずれる**。
          width: fit ? zoomedBox(fit, zoom, fitPct).width : fallbackWidthCss(cw, ch),
          // ⚠️ **拡大時は「はみ出してよい」**＝`maxWidth:100%` のままだと**拡大しても縮められて
          // 見た目が変わらない**（拡大の意味が消える）。外側が横スクロールで受ける。
          maxWidth: zoom === 'fit' ? "100%" : undefined,
          height: fit ? zoomedBox(fit, zoom, fitPct).height : undefined,
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
        {/* ⚠️ **安全領域の枠**（#265）＝端で切られやすいところを見せる**編集の補助**。
            書き出しには焼かない（`layoutScene` を通らない＝プレビュー＝書き出しの一致に関わらない）。
            ⚠️ **箱の子にする**＝拡大しても一緒に伸びる（`fit` 箱の実寸に追従＝#142・#273 と同じ理由）。
            ⚠️ **割合で置く**＝`canvas` の大きさに依らず同じ見え方（`safeAreaRect` と同じ数字を使う）。 */}
        {drawSafeArea && (
          <div
            aria-hidden="true"
            className="safe-area-guide"
            style={{
              left: `${(safeRect.x / cw) * 100}%`,
              top: `${(safeRect.y / ch) * 100}%`,
              width: `${(safeRect.w / cw) * 100}%`,
              height: `${(safeRect.h / ch) * 100}%`,
            }}
          />
        )}
        {/* 操作オーバーレイ（FREE/テンプレ編集）。fit 箱の子＝縦型でもプレビュー実寸と一致し、ドラッグ追従・配置が正確（#273）。 */}
        {children}
      </div>
    </div>
  );
}
