// 全場面を「共有レイアウト → SVG → PNG(data URL)」に焼き、書き出し入力を組み立てる（ADR-0001/0004）。
// 動画ありシーンは下/上2枚の透過PNG＋クリップ情報を渡す（ADR-0006）。FFmpeg呼び出しは infrastructure に分離。
import { TRANSITION_DIRECTION, TRANSITION_TYPE, type Fit } from '../../domain/enums';
import { FPS } from '../../domain/constants';
import type { ElementAnimation, Scene } from '../../domain/project/types';
import type { Template } from '../../domain/template/types';
import { resolveTransition, transitionTimeline } from '../../domain/project/sceneTransitions';
import type { ResolvedTransition } from '../../domain/project/sceneTransitions';
import { sceneSegmentSpecs } from '../../domain/project/lineTimeline';
import { animationsEndSec, sceneAnimationActive } from '../../domain/project/sceneAnimation';
import { layoutScene } from '../layout';
import type { LayoutItem } from '../layout';
import { layoutToSvg } from '../sceneSvg';
import { creditForLine, NARRATOR_CREDIT } from '../../domain/voice/narratorCredit';
import { wavDurationSec } from '../../domain/voice/wavDuration';
import { svgToPngDataUrl } from './rasterize';
import { splitVideoSceneSvgMulti } from './videoSceneSplit';
import type { VideoSlotInfo } from './findVideoSlot';

/** ResolvedTransition を FFmpeg xfade の transition 名へ（none はハードカット＝"none"）。 */
function xfadeName(r: ResolvedTransition): string {
  if (r.type === TRANSITION_TYPE.fade) return 'fade';
  if (r.type === TRANSITION_TYPE.slide) {
    if (r.direction === TRANSITION_DIRECTION.right) return 'slideright';
    if (r.direction === TRANSITION_DIRECTION.up) return 'slideup';
    if (r.direction === TRANSITION_DIRECTION.down) return 'slidedown';
    return 'slideleft';
  }
  return 'none';
}

/** 動画ありシーンの書き出し入力（infrastructure の ExportVideoInput と構造一致）。 */
export interface ExportVideoData {
  /** 下層PNG（不透明・全面）。belowFramesDir（動画×アニメ・#435 P1）指定時は省略。 */
  belowPngBase64?: string;
  /** 全尺の上PNG（従来の1枚）。aboveSegments / aboveFramesDir 指定時は省略。 */
  abovePngBase64?: string;
  /** 掛け合い×動画：行区間つき上PNG（字幕/クレジット差し替え・表示窓 [startSec, endSec)）。 */
  aboveSegments?: { pngBase64: string; startSec: number; endSec: number }[];
  /** 動画×アニメ（#435）：最上層を per-frame で焼くステージング済みフレームdir名。指定時は abovePngBase64 の代わり。 */
  aboveFramesDir?: string;
  /** 動画×アニメ（#435 P1）：下層を per-frame で焼くフレームdir名。指定時は belowPngBase64 の代わり。 */
  belowFramesDir?: string;
  /** 動画×アニメ（#435 P1）：中間層を per-frame で焼くフレームdir名（枚数＝動画本数−1）。指定時は midLayers の代わり。 */
  midFramesDirs?: string[];
  /** per-frame（below/mid/above）フレームレート（既定 30）。 */
  aboveFramesFps?: number;
  /** 掛け合い×動画：行ごとのナレーション（delaySec 秒に配置・windowSec の窓で切り詰め＝#385）。 */
  narrationSegments?: { audioBase64: string; delaySec: number; windowSec: number }[];
  clipRelPath: string;
  slotX: number;
  slotY: number;
  slotW: number;
  slotH: number;
  fit: Fit;
  clipStartSec: number;
  clipEndSec?: number;
  useOriginalAudio: boolean;
  originalVolume?: number;
  speed: number;
  /** 連続する動画レイヤーの間の静止層PNG（透過・base64・枚数＝動画本数−1・#431）。1動画では空/省略。 */
  midLayers?: string[];
  /** 2本目以降の動画レイヤー（zIndex 昇順・先頭動画の上・#431）。1動画では空/省略。先頭動画は上のフィールド。 */
  videoLayers?: {
    clipRelPath: string;
    slotX: number;
    slotY: number;
    slotW: number;
    slotH: number;
    fit: Fit;
    clipStartSec: number;
    clipEndSec?: number;
    useOriginalAudio: boolean;
    originalVolume?: number;
    speed: number;
  }[];
}

/** 書き出し1場面ぶんの入力（infrastructure の ExportSceneInput と構造一致）。 */
export interface ExportSceneData {
  pngBase64?: string;
  /** アニメ場面のフレーム列（④・ADR-0019 per-frame）。指定時は fps とともに Rust が image2 で1動画に焼く（pngBase64 は未使用）。 */
  framesBase64?: string[];
  /** ステージング済みフレームの相対ディレクトリ名（stageFrame 使用時）。framesBase64 の代わりに渡す＝巨大IPC回避。 */
  framesDir?: string;
  /** framesBase64 のフレームレート（既定 30）。 */
  fps?: number;
  durationSec: number;
  audioBase64?: string;
  narrationVolume?: number;
  video?: ExportVideoData;
  /** この場面に「入る」トランジション（ADR-0009 T2）。先頭場面・none では未設定（ハードカット）。 */
  transition?: { name: string; durationSec: number; offsetSec: number };
  /**
   * 論理的な「場面」の先頭セグメントか（#430・ADR-0026）。掛け合いの間/行など同一場面の後続セグメントは false。
   * Rust は同じ場面のセグメントを先に -c copy 連結し、**場面クリップ単位**で xfade する＝入場遷移を「間」や
   * 行の短さで縮めない（transition の duration/offset も front が per-scene で解決済み）。
   */
  sceneStart?: boolean;
}

/**
 * 場面（掛け合いのときは lineId 行）ごとのナレーション音声と解決済み音量(§6)を返すコールバック。
 * narrationVolume は常に返し、audioBase64 が無い（undefined）場面/行は無音になる。lineId 省略＝場面の単一 narration。
 */
export type NarrationFor = (
  scene: Scene,
  lineId?: string,
) => { audioBase64?: string; narrationVolume: number } | undefined;

/** 場面ごとの動画スロット情報を返すコールバック（undefined＝静止画シーン）。 */
/** 場面の動画スロットを**すべて**返すコールバック（空配列＝静止画シーン・#431 複数動画）。 */
export type VideoSlotsFor = (scene: Scene) => VideoSlotInfo[];

/** 場面ごとの要素アニメーション（timelineOverlay.animations の sceneId 一致分）を返すコールバック（④・ADR-0019）。 */
export type AnimationsFor = (scene: Scene) => ElementAnimation[];

/**
 * アニメ場面のフレームを1枚ずつディスクへ書き出すコールバック（巨大IPC回避＝#書き出しRangeError）。
 * 指定時は framesBase64 を溜めず framesDir 参照だけ返す（数百フレームの base64 を1回の invoke に載せない）。
 * 省略時（テスト等）は従来どおり framesBase64 に集約する。
 */
export type StageAnimationFrame = (framesDir: string, frameIndex: number, dataUrl: string) => Promise<void>;

/** 書き出しの横断設定。 */
export interface ExportOptions {
  /** 字幕(subtitle レイヤー)を入れるか。false なら字幕を描かない。既定 true。 */
  withSubtitle?: boolean;
  /**
   * 出力解像度（未指定ならテンプレキャンバス＝フルHD）。SVG は viewBox 持ちなので縮小して焼ける。
   * width/height は1組で受ける（片方だけ指定で縦横比が崩れるのを型で防ぐ）。
   */
  outputSize?: { width: number; height: number };
  /** 場面ごとの描画フォントを返す（場面→動画全体で解決済み・fontCatalog.fontFamilyForId の戻り値）。未指定は既定フォント。 */
  fontFamilyFor?: (scene: Scene) => string;
  /** 常時クレジット文言（選択話者のキャラ＝creditForSpeaker）。未指定は既定（NARRATOR_CREDIT＝ずんだもん・#177）。 */
  credit?: string;
}

/**
 * 各場面をプレビューと同一のSVGで実寸PNG化し、ナレーション音声を添える。テンプレ未解決の場面はスキップ。
 * 動画スロットがある場面は下/上2枚PNG＋クリップ情報（ADR-0006）。onProgress(done, total) で進捗通知。
 */
export async function buildExportScenes(
  scenes: Scene[],
  templateById: Map<string, Template>,
  resolveAssetSrc: (assetId: string) => Promise<string | undefined>,
  narrationFor?: NarrationFor,
  videoSlotsFor?: VideoSlotsFor,
  onProgress?: (done: number, total: number) => void,
  opts: ExportOptions = {},
  animationsFor?: AnimationsFor,
  stageAnimationFrame?: StageAnimationFrame,
): Promise<ExportSceneData[]> {
  // 字幕OFF時は subtitle レイヤー由来の text を描かない（静止画・動画の上レイヤー両方に適用）。
  const itemFilter: ((item: LayoutItem) => boolean) | undefined =
    opts.withSubtitle === false ? (it) => !(it.kind === 'text' && it.isSubtitle) : undefined;
  // 常時クレジット文言（選択話者のキャラ＝creditForSpeaker）。export 全体で一定（#177）。
  const credit = opts.credit ?? NARRATOR_CREDIT;
  const out: ExportSceneData[] = [];
  // out と 1:1 で対応する「書き出し対象になった場面」。トランジションの境界計算（後処理）に使う。
  const included: Scene[] = [];
  for (let i = 0; i < scenes.length; i += 1) {
    const scene = scenes[i];
    const template = templateById.get(scene.templateId);
    if (template) {
      included.push(scene);
      const layout = layoutScene(scene, template);
      // この場面で使う画像だけをディスクから data URL 化（場面ごとに解決→描画後に破棄＝全画像の一括ロードによる
      // 瞬間メモリ spike を避ける・#143）。動画スロットは clipRelPath 経路（ADR-0006）なので対象外。
      // トレードオフ：同一画像が複数場面に出ると場面ごとに読み直す（I/O は増えうる）。data URL を常駐させない
      // ＝メモリ最小化を優先する判断（全件キャッシュ保持は spike を再導入するため採らない）。場面内の重複は Set で排除。
      const sceneSrc = new Map<string, string>();
      const usedImageIds = [
        ...new Set(
          layout.items.flatMap((it) => (it.kind === "image" && it.assetId ? [it.assetId] : [])),
        ),
      ];
      await Promise.all(
        usedImageIds.map(async (id) => {
          const url = await resolveAssetSrc(id);
          if (url) sceneSrc.set(id, url);
        }),
      );
      const assetSrc = (id: string | null): string | undefined => (id ? sceneSrc.get(id) : undefined);
      const videoSlots = videoSlotsFor?.(scene) ?? [];
      const sceneFontFamily = opts.fontFamilyFor?.(scene); // 場面→動画全体で解決済みの font-family
      const slotIds = videoSlots.map((v) => v.slotLayerId);
      const splitM =
        videoSlots.length > 0
          ? splitVideoSceneSvgMulti(layout, slotIds, assetSrc, itemFilter, sceneFontFamily, credit)
          : null;
      // 出力解像度（未指定はキャンバス＝フルHD）。全場面を同一サイズで焼く（後段 concat -c copy の前提）。
      const cw = template.canvas.width;
      const ch = template.canvas.height;
      const width = opts.outputSize?.width ?? cw;
      const height = opts.outputSize?.height ?? ch;
      const rx = width / cw;
      const ry = height / ch;
      if (videoSlots.length > 0 && splitM) {
        // 各動画レイヤーの矩形（出力解像度へスケール）＋クリップ設定を zIndex 順（下→上）に組む（#431）。
        const slotById = new Map(videoSlots.map((v) => [v.slotLayerId, v] as const));
        const layers = splitM.slots.map((s) => {
          const info = slotById.get(s.layerId)!; // slots は videoSlots の id から解決＝必ず存在
          return {
            slotX: Math.round(s.rect.x * rx),
            slotY: Math.round(s.rect.y * ry),
            slotW: Math.round(s.rect.w * rx),
            slotH: Math.round(s.rect.h * ry),
            clipRelPath: info.clipRelPath,
            fit: info.fit,
            clipStartSec: info.clipStartSec,
            clipEndSec: info.clipEndSec,
            useOriginalAudio: info.useOriginalAudio,
            originalVolume: info.originalVolume,
            speed: info.speed,
          };
        });
        const primary = layers[0]; // 先頭（最下）動画＝従来フィールド（1動画は従来と同一）
        const videoLayers = layers.slice(1); // 2本目以降（#431）
        const belowPngBase64 = await svgToPngDataUrl(splitM.belowSvg, width, height);
        // 動画間の静止層PNG（透過・枚数＝動画本数−1）。1動画では空。
        const midLayers = await Promise.all(
          splitM.midSvgs.map((svg) => svgToPngDataUrl(svg, width, height)),
        );
        const lines = scene.lines ?? [];
        let pushed = false;
        if (lines.length > 0) {
          // 掛け合い×動画：クリップは連続1本のまま、最上層PNG（字幕/クレジット）を行区間で差し替え、
          // 行ナレーションを開始秒（adelay）に配置する＝プレビューの行進行と一致（ADR-0001 パリティ）。
          // 下/中間層と動画レイヤーは行に依らず一定（字幕は最上層のみ＝#431 でも同じ）。
          const lineDurations: Record<string, number> = {};
          for (const l of lines) {
            const a = narrationFor?.(scene, l.lineId)?.audioBase64;
            lineDurations[l.lineId] = a ? wavDurationSec(a) : 0;
          }
          const specs = sceneSegmentSpecs(scene, lineDurations);
          const aboveSegments: { pngBase64: string; startSec: number; endSec: number }[] = [];
          const narrationSegments: { audioBase64: string; delaySec: number; windowSec: number }[] = [];
          let narrationVolume: number | undefined;
          for (let k = 0; k < specs.length; k += 1) {
            const spec = specs[k];
            // クレジットは話者連動（静止画の掛け合いと同じ規則・#243 の併記は行ごと表示で置き換え）。
            const segLine = spec.lineId ? lines.find((l) => l.lineId === spec.lineId) : undefined;
            const segCredit = segLine ? creditForLine(segLine, credit) : credit;
            const segLayout =
              spec.subtitleText !== undefined
                ? layoutScene(scene, template, { subtitleText: spec.subtitleText })
                : layout;
            const segSplit = splitVideoSceneSvgMulti(
              segLayout,
              slotIds,
              assetSrc,
              itemFilter,
              sceneFontFamily,
              segCredit,
            );
            if (!segSplit) continue; // 基準 layout で分割成功済みのため通常来ない（防御）
            aboveSegments.push({
              pngBase64: await svgToPngDataUrl(segSplit.aboveSvg, width, height),
              // 各区間の表示窓＝そのまま [startSec, startSec+durationSec)。先頭行の開始前の「間」は
              // sceneSegmentSpecs が字幕なしの isGap 区間 [0, 先頭start) として先頭に出す（#386・A案＝間を尊重）。
              startSec: spec.startSec,
              endSec: spec.startSec + spec.durationSec,
            });
            const segNarration = spec.lineId ? narrationFor?.(scene, spec.lineId) : undefined;
            if (segNarration?.audioBase64) {
              // windowSec=行の窓（次の行の開始まで＝表示尺）で音声を切る＝前の行が次の行に重ならない（#385）。
              narrationSegments.push({
                audioBase64: segNarration.audioBase64,
                delaySec: spec.startSec,
                windowSec: spec.durationSec,
              });
              narrationVolume = segNarration.narrationVolume;
            }
          }
          if (aboveSegments.length > 0) {
            out.push({
              durationSec: scene.durationSec,
              narrationVolume,
              video: { belowPngBase64, midLayers, videoLayers, aboveSegments, narrationSegments, ...primary },
            });
            pushed = true;
          }
        }
        if (!pushed) {
          // 動画ありシーン（単一 narration・非掛け合い）：静止層PNG＋クリップ情報（ADR-0006／#431 複数動画）。
          const narration = narrationFor?.(scene);
          const sceneAnims = animationsFor?.(scene) ?? [];
          // 動画×アニメ（#435）：下/中/上の静止層すべてを per-frame でステージングして動画へ overlay する
          // ＝背景/動画間/グループ要素もプレビューと一致して動く（#435 P1）。動画スロット自身の位置アニメのみ
          // 未対応（動画は基準位置固定）。適用可否は preview（ScenePreview）と共有の sceneAnimationActive
          // （掛け合い×動画は false＝静止）。ステージング不可（テスト等）は静止 above にフォールバック。
          const animateVideo = sceneAnimationActive(scene, sceneAnims, true);
          if (animateVideo && stageAnimationFrame) {
            const fps = FPS;
            // 変化する区間 [0, min(尺, animEnd)] だけ焼き、残りは Rust の tpad/eof_action=repeat が最終フレームを保持（#376同方針）。
            const renderDurSec = Math.max(0, Math.min(scene.durationSec, animationsEndSec(sceneAnims)));
            const frameCount = Math.max(1, Math.ceil(renderDurSec * fps) + 1);
            const belowDir = `scene_vbelow_${i}`;
            const aboveDir = `scene_vabove_${i}`;
            const midDirs = splitM.midSvgs.map((_, m) => `scene_vmid_${i}_${m}`);
            for (let f = 0; f < frameCount; f += 1) {
              // 場面内絶対時刻でアニメ補間（プレビューと同一 layoutScene(t)＝パリティ）。下/中/上層に切り出して焼く。
              const frameLayout = layoutScene(scene, template, { timeSec: f / fps, animations: sceneAnims });
              const fSplit = splitVideoSceneSvgMulti(frameLayout, slotIds, assetSrc, itemFilter, sceneFontFamily, credit);
              if (!fSplit) {
                // 通常来ない（基準 layout で分割成功済み・アニメは要素プロパティのみ変える）。静かに静止へ落とさず追跡ログ（#434 の精神）。
                console.warn('[buildExportScenes] 動画×アニメの層分割に失敗したフレームがあります（静止層で代替）。frame:', f);
              }
              const s = fSplit ?? splitM;
              await stageAnimationFrame(belowDir, f, await svgToPngDataUrl(s.belowSvg, width, height));
              for (let m = 0; m < midDirs.length; m += 1) {
                await stageAnimationFrame(midDirs[m], f, await svgToPngDataUrl(s.midSvgs[m], width, height));
              }
              await stageAnimationFrame(aboveDir, f, await svgToPngDataUrl(s.aboveSvg, width, height));
            }
            out.push({
              durationSec: scene.durationSec,
              audioBase64: narration?.audioBase64,
              narrationVolume: narration?.narrationVolume,
              // 静止 below/mid/above は送らず frames dir のみ（Rust が image2 で焼く）。
              video: { videoLayers, belowFramesDir: belowDir, midFramesDirs: midDirs, aboveFramesDir: aboveDir, aboveFramesFps: fps, ...primary },
            });
          } else {
            const abovePngBase64 = await svgToPngDataUrl(splitM.aboveSvg, width, height);
            out.push({
              durationSec: scene.durationSec,
              audioBase64: narration?.audioBase64,
              narrationVolume: narration?.narrationVolume,
              video: { belowPngBase64, midLayers, videoLayers, abovePngBase64, ...primary },
            });
          }
        }
      } else {
        if (videoSlots.length > 0 && !splitM) {
          // slotLayerId がレイアウトに見つからない等で分割失敗 → 静止画として書き出す（原因追跡のため開発ログ）。
          console.warn(
            '[buildExportScenes] 動画スロットの分割に失敗したため静止画で書き出します。slotLayerIds:',
            slotIds,
          );
        }
        // 掛け合い（明示 lines・静止画）は行ごとのセグメントに展開（追加A/B・ADR-0015 PR-E）。
        // 動画スロットありの掛け合いは上の video 経路（1セグメントのまま最上層PNG差し替え＋adelay）で処理済み。
        const useSegments = !!(scene.lines && scene.lines.length > 0) && videoSlots.length === 0;
        // アニメ場面（④・ADR-0019 per-frame）：animations があり動画スロットを伴わない場面はフレーム列に焼く。
        // 掛け合いは**行セグメントごと**に、単一 narration は1区間として毎フレーム描画する（③）。適用可否は
        // preview（ScenePreview 経由）と共有の sceneAnimationActive で判定＝両者一致（ADR-0001 パリティ）。
        // 動画スロット併用のアニメは引き続き後続段（映像合成との両立が要る）＝静止/セグメント経路。
        const sceneAnims = animationsFor?.(scene) ?? [];
        const animate = sceneAnimationActive(scene, sceneAnims, videoSlots.length > 0);
        const lineDurations: Record<string, number> = {};
        if (useSegments) {
          for (const l of scene.lines ?? []) {
            const a = narrationFor?.(scene, l.lineId)?.audioBase64;
            lineDurations[l.lineId] = a ? wavDurationSec(a) : 0;
          }
        }
        const specs = useSegments
          ? sceneSegmentSpecs(scene, lineDurations)
          : [{ startSec: 0, durationSec: scene.durationSec, isFirst: true }];
        let segIndex = 0;
        for (const spec of specs) {
          const segLineId = 'lineId' in spec ? spec.lineId : undefined;
          // クレジットは話者連動：行に話者があればそのキャラ、無ければ既定（場面/動画の話者＝credit）（#243・規約適合）。
          const segLine = segLineId ? scene.lines?.find((l) => l.lineId === segLineId) : undefined;
          const segCredit = segLine ? creditForLine(segLine, credit) : credit;
          // 字幕上書き（掛け合い）：string=表示／null=非表示／undefined=従来（scene.texts）。
          const segSubtitle = 'subtitleText' in spec ? spec.subtitleText : undefined;
          // 「間」（頭空白＝isGap）は音声なし（#386・A案）。単一 narration（lineId キー無し）は場面音声を継続。
          const isGap = 'isGap' in spec && spec.isGap === true;
          const segNarration = isGap ? undefined : narrationFor?.(scene, segLineId);
          if (animate) {
            // アニメ区間：この区間 [startSec, +durationSec] を毎フレーム描画（掛け合いは行ごと・単一は1区間）。
            const fps = FPS;
            // 高速化（#376）：アニメは最終キーフレーム(animEnd)以降レイアウトが一定＝以降のフレームは
            // 全て同一（静止）。よって「変化する終端＝min(区間末, animEnd)」までだけ焼き、残りは Rust 側の
            // tpad=stop_mode=clone が最終フレームを尺まで保持する。長い場面や掛け合い（アニメが頭だけの行）で
            // per-frame ラスタライズを激減させる。
            // ceil＋1：最終フレームの時刻は startSec + (frameCount-1)/fps。ceil により必ず
            // ≥ min(区間末, animEnd) となり、interpolateKeyframes のクランプ条件（timeSec ≥ 最終KF）を満たす＝
            // 保持されるフレームが必ず settled（＝プレビューの静止と一致・パリティ）。round だと格子に乗らない
            // animEnd（例 0.816s→24.48）で切り捨てて未収束フレームを保持してしまう（#376 レビュー）。
            const animEndSec = animationsEndSec(sceneAnims); // 場面ローカル秒
            const segEnd = spec.startSec + spec.durationSec;
            const renderDurSec = Math.max(0, Math.min(segEnd, animEndSec) - spec.startSec);
            const frameCount = Math.max(1, Math.ceil(renderDurSec * fps) + 1);
            // ステージング可能なら各フレームを逐次ディスクへ（数百フレームの base64 を配列/IPC に溜めない・#書き出しRangeError）。
            const framesDir = stageAnimationFrame ? `scene_frames_${i}_${segIndex}` : undefined;
            const framesBase64: string[] = [];
            for (let f = 0; f < frameCount; f += 1) {
              // 場面内の絶対時刻でアニメを補間（プレビューと同一 layoutScene(t)＝パリティ）。行字幕も同フレームに焼き込む。
              const frameLayout = layoutScene(scene, template, {
                timeSec: spec.startSec + f / fps,
                animations: sceneAnims,
                ...(segSubtitle !== undefined ? { subtitleText: segSubtitle } : {}),
              });
              const dataUrl = await svgToPngDataUrl(
                layoutToSvg(frameLayout, { assetSrc, itemFilter, credit: segCredit, fontFamily: sceneFontFamily }),
                width,
                height,
              );
              if (framesDir && stageAnimationFrame) await stageAnimationFrame(framesDir, f, dataUrl);
              else framesBase64.push(dataUrl);
            }
            out.push({
              // framesDir（ステージング）優先。無ければ従来どおり framesBase64 を載せる。
              ...(framesDir ? { framesDir } : { framesBase64 }),
              fps,
              durationSec: spec.durationSec,
              audioBase64: segNarration?.audioBase64,
              narrationVolume: segNarration?.narrationVolume,
            });
          } else {
            // 静止区間（従来）：字幕上書きがあれば行字幕で焼き直し、無ければ共有 layout を再利用。
            const segLayout =
              segSubtitle !== undefined
                ? layoutScene(scene, template, { subtitleText: segSubtitle })
                : layout;
            const pngBase64 = await svgToPngDataUrl(
              layoutToSvg(segLayout, { assetSrc, itemFilter, credit: segCredit, fontFamily: sceneFontFamily }),
              width,
              height,
            );
            out.push({
              pngBase64,
              durationSec: spec.durationSec,
              audioBase64: segNarration?.audioBase64,
              narrationVolume: segNarration?.narrationVolume,
            });
          }
          // included は out と 1:1。先頭セグメントは上の included.push(scene) ＝ 2つ目以降のみ push（場面内はハードカット）。
          if (!spec.isFirst) included.push({ ...scene, transition: undefined });
          segIndex += 1;
        }
      }
    }
    onProgress?.(i + 1, scenes.length);
  }

  // 場面間トランジション（ADR-0009 T2）を**論理的な場面クリップ単位**で解決する（#430・ADR-0026）。
  // 掛け合いは1場面が複数セグメント（間/行）に展開されるため、per-segment で clamp すると入場遷移が
  // 先頭の「間」の短さに縮む。ここでは場面（included の sceneId が変わる位置＝境界）ごとに尺を合算し、
  // transitionTimeline を per-scene で回す。Rust は sceneStart で同一場面のセグメントを連結してから
  // 場面クリップ間で xfade する（間を跨いで先頭行に重なる＝設定した切り替え尺を尊重）。
  // 各場面の先頭 out index と、境界フラグ（sceneStart）を求める。
  const sceneFirst: number[] = [];
  for (let i = 0; i < out.length; i += 1) {
    const isStart = i === 0 || included[i].sceneId !== included[i - 1].sceneId;
    out[i].sceneStart = isStart;
    if (isStart) sceneFirst.push(i);
  }
  // 場面ごとの尺（内部セグメントの合計）と、入場遷移（先頭セグメントの included が持つ）。
  const sceneDurations = sceneFirst.map((first, k) => {
    const end = k + 1 < sceneFirst.length ? sceneFirst[k + 1] : out.length;
    let d = 0;
    for (let j = first; j < end; j += 1) d += out[j].durationSec;
    return d;
  });
  const sceneResolved = sceneFirst.map((first) => resolveTransition(included[first].transition));
  const sceneBoundaryDs = sceneResolved.map((r, k) =>
    k === 0 || r.type === TRANSITION_TYPE.none ? 0 : r.durationSec,
  );
  const { steps } = transitionTimeline(sceneDurations, sceneBoundaryDs);
  for (let k = 1; k < sceneFirst.length; k += 1) {
    if (sceneResolved[k].type === TRANSITION_TYPE.none) continue;
    out[sceneFirst[k]].transition = {
      name: xfadeName(sceneResolved[k]),
      durationSec: steps[k - 1].durationSec,
      offsetSec: steps[k - 1].offsetSec,
    };
  }
  return out;
}
