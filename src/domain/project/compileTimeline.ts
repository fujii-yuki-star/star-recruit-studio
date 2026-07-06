// 場面ベース project を「時間軸＋トラック」へ機械射影する純粋関数（ADR-0018・2モデル方式／§7 テスト対象）。
// 正準は場面（project.scenes 配列順＝再生順・sceneOps）。本関数は読み取り専用の射影で、専用タイムライン編集UI（別画面・
// α-4 ③(2)）と、将来の書き出し配線が共有する土台。副作用なし。AI/簡易編集は本射影を無視する（ADR-0007 M-A）。
//
// 忠実性：totalSec と場面境界は buildExportScenes と一致する（掛け合いセグメントは場面尺内に収まるため、場面粒度の
//   合計＝セグメント粒度の合計）。**先頭行の「間」（頭空白）も場面尺に含まれる**＝本関数は行音声/テロップを
//   base+seg.startSec（＝先頭 startSec）に置き、書き出し（静止画/動画）も #386・A案で頭空白を isGap 区間として
//   場面尺どおりに保つため、頭空白があっても両者は秒単位で一致する（旧：静止画/プレビューだけ間を捨てて短縮＝ズレ）。
//   なお本関数の telop/audio の先頭行クリップは firstStart 始まり＝A案「間は字幕なし」と同義（間には字幕を出さない）。
//   遷移尺の上限 clamp も #430（per-scene xfade）で両者 per-scene に揃った：書き出し(buildExportScenes)は同一場面の
//   セグメント（間/行）を連結してから場面クリップ単位で clamp / xfade し、本関数も per-scene 尺（場面尺）で締める。
//   よって頭空白のある掛け合い場面に入場遷移を付けても、遷移が「間」の短さで縮まず設定尺どおり（両者一致）。
import { TRANSITION_TYPE } from '../enums';
import type { TransitionDirection, TransitionType } from '../enums';
import { resolveTransition, transitionTimeline } from './sceneTransitions';
import { lineSegments } from './lineTimeline';
import { sceneLines } from './narrationLines';
import { bgmById } from '../bgm/bgmCatalog';
import type { BgmSettings, Project, Scene } from './types';

/** タイムラインのトラック種別（ADR-0018：映像／テロップ／音声／BGM）。 */
export type TimelineTrackKind = 'video' | 'telop' | 'audio' | 'bgm';

/** グローバル時間軸上の1クリップ（読み取り射影）。単位は effectiveTotalSec 系の秒。 */
export interface TimelineClip {
  /** UI キー用の安定 id（例 sceneId・`${sceneId}/${lineId}`・'bgm'）。 */
  id: string;
  /** 所属場面（BGM など全体クリップは undefined）。 */
  sceneId?: string;
  /** 掛け合い行（テロップ/音声の行クリップ）。 */
  lineId?: string;
  startSec: number;
  endSec: number;
  /** 表示ラベル（§2-3 の言い換え前の素の文言。UI 側で技術用語を出さないよう整える）。 */
  label: string;
  /** timelineOverlay 由来＝タイムライン編集の対象クリップ。場面射影クリップは未設定（UI は id 形式を知らずにこれで判別）。 */
  origin?: "overlay";
}

/** 場面ストリップ用の場面スパン（グローバル時間軸）。 */
export interface TimelineSceneSpan {
  sceneId: string;
  startSec: number;
  endSec: number;
  /** 再生順の index（project.scenes 配列順）。 */
  order: number;
}

/** 2場面の境界に挟まる遷移（xfade の重なり）。FFmpeg 名ではなく解決済みの意味値を持つ（言い換えは UI 側＝§2-3）。 */
export interface TimelineTransition {
  fromSceneId: string;
  toSceneId: string;
  type: TransitionType;
  direction: TransitionDirection;
  /** 重なりが始まるグローバル秒。 */
  atSec: number;
  durationSec: number;
}

/** compileTimeline の結果（時間軸＋トラック）。 */
export interface Timeline {
  totalSec: number;
  scenes: TimelineSceneSpan[];
  tracks: Record<TimelineTrackKind, TimelineClip[]>;
  transitions: TimelineTransition[];
}

export interface CompileTimelineOptions {
  /** 場面→行ごとの音声長（秒・lineId→秒）。掛け合いの区間尺に使う。未指定＝明示 startSec か自動逐次(0)。 */
  lineDurationsFor?: (scene: Scene) => Record<string, number>;
  /** 射影対象の場面か（未指定＝全場面）。将来の書き出し配線でテンプレ未解決の除外に使える。 */
  includeScene?: (scene: Scene) => boolean;
  /** 場面の表示名（未指定＝「場面 N」）。 */
  sceneLabelFor?: (scene: Scene, order: number) => string;
}

function emptyTimeline(): Timeline {
  return { totalSec: 0, scenes: [], tracks: { video: [], telop: [], audio: [], bgm: [] }, transitions: [] };
}

/** BGM を全体1本のクリップとして出すか（有効かつ音源が選ばれているとき）。 */
/** 場面の実効BGM設定（場面ごと ?? プロジェクト既定＝null=継承・§11.6・ADR-0018 ③(7)）。 */
export function resolveSceneBgm(scene: Scene, projectBgm: BgmSettings | undefined): BgmSettings | undefined {
  return scene.bgmSettings ?? projectBgm;
}

/** 実効BGMの識別キー（同一＝連続する場面を1区間にまとめる）。鳴らない（無効/ソース無し）は null。 */
function bgmSourceKey(bgm: BgmSettings | undefined): string | null {
  if (!bgm?.enabled) return null;
  if (bgm.bundledBgmId != null) return `bundled:${bgm.bundledBgmId}`;
  if (bgm.assetId != null && bgm.assetId !== '') return `asset:${bgm.assetId}`;
  return null;
}

/** BGM区間のラベル（同梱曲は日本語名・自分のBGMは総称）。 */
function bgmRunLabel(bgm: BgmSettings | undefined): string {
  return bgm?.bundledBgmId != null ? bgmById(bgm.bundledBgmId)?.label ?? 'BGM' : 'BGM';
}

/** BGM区間（実効BGM＋グローバル [startSec, endSec]）。タイムライン表示と書き出しミックスで共有（ADR-0018 ③(7)）。 */
export interface BgmRun {
  /** この区間の実効BGM（enabled かつソース有り＝bgmSourceKey が非 null のもの）。 */
  bgm: BgmSettings;
  startSec: number;
  endSec: number;
}

/**
 * 実効BGM（場面 ?? プロジェクト）が同じソースの連続場面を1区間にまとめる（ADR-0018 ③(7)）。
 * 全場面がプロジェクト既定を継承する従来ケースは1区間＝[0, 総尺]（後方互換）。鳴らない場面はスキップ・ゼロ幅は除外。
 */
export function groupBgmRuns(scenes: Scene[], starts: number[], ends: number[], projectBgm: BgmSettings | undefined): BgmRun[] {
  const runs: BgmRun[] = [];
  let i = 0;
  while (i < scenes.length) {
    const bgm = resolveSceneBgm(scenes[i], projectBgm);
    const key = bgmSourceKey(bgm);
    if (key === null) {
      i += 1;
      continue;
    }
    let j = i;
    while (j + 1 < scenes.length && bgmSourceKey(resolveSceneBgm(scenes[j + 1], projectBgm)) === key) j += 1;
    if (ends[j] > starts[i]) runs.push({ bgm: bgm as BgmSettings, startSec: starts[i], endSec: ends[j] });
    i = j + 1;
  }
  return runs;
}

function bgmRunClips(scenes: Scene[], starts: number[], ends: number[], projectBgm: BgmSettings | undefined): TimelineClip[] {
  return groupBgmRuns(scenes, starts, ends, projectBgm).map((r, i) => ({
    id: `bgm_${i}`,
    startSec: r.startSec,
    endSec: r.endSec,
    label: bgmRunLabel(r.bgm),
  }));
}

/**
 * 場面ベース project を時間軸＋トラックへ射影する（ADR-0018）。純粋関数。
 * - 再生順＝project.scenes 配列順（sceneOps）。遷移の重なりは transitionTimeline で解決（ADR-0009）。
 * - tracks.video＝場面ごと1クリップ。tracks.audio/telop＝行ごと（sceneLines→lineSegments・0秒区間は除外）。
 *   掛け合いは動画スロットの有無に依らず行ごとに射影（#385/#386 で書き出しも行構造へ統一＝#433 で旧 collapse 撤去）。
 *   tracks.bgm＝実効BGM（場面 ?? プロジェクト）が同じソースの連続場面ごとに1区間（曲が変わる/無音の場面で区間が分かれる・全場面継承は[0,総尺]の1区間＝③(7)）。
 * - project.timelineOverlay のクリップを合成（ADR-0018）：track のレーンへ追加。anchorSceneId 有＝場面相対／無＝絶対時間。
 */
export function compileTimeline(project: Project, opts: CompileTimelineOptions = {}): Timeline {
  const scenes = opts.includeScene ? project.scenes.filter(opts.includeScene) : project.scenes;
  if (scenes.length === 0) return emptyTimeline();

  const durations = scenes.map((s) => s.durationSec);
  const resolved = scenes.map((s) => resolveTransition(s.transition));
  // 境界の希望 D（i≥1・none/先頭は0）。上限 clamp は transitionTimeline が場面尺を見て行う。
  const boundaryDs = resolved.map((r, i) => (i === 0 || r.type === TRANSITION_TYPE.none ? 0 : r.durationSec));
  const { effectiveTotalSec, steps } = transitionTimeline(durations, boundaryDs);

  // 各場面のグローバル開始/終了。i≥1 は steps[i-1].offsetSec が直前結合結果への重なり開始＝場面 i の開始。
  const starts = scenes.map((_s, i) => (i === 0 ? 0 : steps[i - 1].offsetSec));
  const ends = starts.map((start, i) => start + durations[i]);

  const sceneSpans: TimelineSceneSpan[] = scenes.map((s, i) => ({
    sceneId: s.sceneId,
    startSec: starts[i],
    endSec: ends[i],
    order: i,
  }));

  const video: TimelineClip[] = scenes.map((s, i) => ({
    id: s.sceneId,
    sceneId: s.sceneId,
    startSec: starts[i],
    endSec: ends[i],
    label: opts.sceneLabelFor?.(s, i) ?? `場面 ${i + 1}`,
  }));

  const telop: TimelineClip[] = [];
  const audio: TimelineClip[] = [];
  for (let i = 0; i < scenes.length; i += 1) {
    const s = scenes[i];
    const base = starts[i];
    // 掛け合いは動画スロットの有無に依らず行ごとに射影する（#385/#386 で書き出しも4経路統一＝
    // 動画スロット掛け合いも行構造を持つため。旧「単一クリップへ collapse（isVideoSlotScene）」分岐は撤去＝#433）。
    const lines = sceneLines(s);
    // lineSegments は sceneLines を map するので lines と segs は同順・同数（zip 可能）。
    const segs = lineSegments(s, opts.lineDurationsFor?.(s) ?? {});
    for (let j = 0; j < segs.length; j += 1) {
      const seg = segs[j];
      // 0秒区間（自動逐次で音声長未指定・クランプ等で endSec===startSec）は出さない＝sceneSegmentSpecs と同じ扱い（ゼロ幅クリップ防止）。
      if (seg.endSec <= seg.startSec) continue;
      const startSec = base + seg.startSec;
      const endSec = base + seg.endSec;
      // 音声（ナレーション）：行の区間。掛け合いは行ごと、単一 narration は1本（場面尺）。ラベル＝話すテキスト。
      audio.push({ id: `${s.sceneId}/${seg.lineId}`, sceneId: s.sceneId, lineId: seg.lineId, startSec, endSec, label: lines[j].text });
      // テロップ（字幕）：字幕 ON の区間のみ。単一 narration の実字幕はテンプレ字幕層＋scene.texts だが、
      // ここは行テキスト（subtitleText ?? text）を素ラベルに用いる（正確なテンプレ解決は将来・読み取り可視化には十分）。
      if (seg.subtitle.enabled) {
        telop.push({ id: `${s.sceneId}/${seg.lineId}`, sceneId: s.sceneId, lineId: seg.lineId, startSec, endSec, label: seg.subtitle.text });
      }
    }
  }

  // timelineOverlay のクリップを合成（ADR-0018）。anchorSceneId 有＝場面相対（場面のグローバル開始＋startSec）、無＝絶対時間。
  // AI/簡易編集は overlay を作らない（場面正準は不変）。存在しない/除外された場面アンカーは描画で無視（V_overlay）。
  const globalStartById = new Map(scenes.map((s, i) => [s.sceneId, starts[i]]));
  for (const clip of project.timelineOverlay?.clips ?? []) {
    let base: number;
    if (clip.anchorSceneId != null) {
      const anchor = globalStartById.get(clip.anchorSceneId);
      if (anchor === undefined) continue;
      base = anchor;
    } else {
      base = 0;
    }
    const startSec = base + clip.startSec;
    const endSec = startSec + clip.durationSec;
    if (endSec <= startSec) continue; // 0秒は出さない（ゼロ幅クリップ防止）
    if (clip.track === 'telop') {
      telop.push({ id: clip.id, sceneId: clip.anchorSceneId, startSec, endSec, label: clip.text ?? '', origin: 'overlay' });
    }
  }

  const transitions: TimelineTransition[] = [];
  for (let i = 1; i < scenes.length; i += 1) {
    if (resolved[i].type === TRANSITION_TYPE.none) continue;
    const step = steps[i - 1];
    if (step.durationSec <= 0) continue;
    transitions.push({
      fromSceneId: scenes[i - 1].sceneId,
      toSceneId: scenes[i].sceneId,
      type: resolved[i].type,
      direction: resolved[i].direction,
      atSec: step.offsetSec,
      durationSec: step.durationSec,
    });
  }

  return {
    totalSec: effectiveTotalSec,
    scenes: sceneSpans,
    tracks: { video, telop, audio, bgm: bgmRunClips(scenes, starts, ends, project.bgmSettings) },
    transitions,
  };
}

/** 場面ローカル秒のテロップ区間（プレビューの表示切替に使う）。row＝段（0=最上段・③(8) 平行テロップ）。 */
export interface SceneTelopInterval {
  /** 場面開始からの相対秒（[0, 場面尺] にクリップ済み）。 */
  startSec: number;
  endSec: number;
  text: string;
  /** 段（0=最上段）。時間が重なるテロップは異なる段に積む（並行表示・③(8)）。 */
  row: number;
}

/**
 * overlay テロップに段（row）を割り当てる（③(8) 平行テロップ）。時間が重なるクリップは異なる段に、重ならなければ段を再利用する
 * （貪欲な区間分割＝最小段数）。開始秒→終了秒→id で決定的に並べるので、プレビューと書き出しで同じ段になる（パリティ）。
 */
export function assignTelopRows(clips: readonly { id: string; startSec: number; endSec: number }[]): Map<string, number> {
  const rows = new Map<string, number>();
  const sorted = [...clips].sort(
    (a, b) => a.startSec - b.startSec || a.endSec - b.endSec || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  const rowEnds: number[] = []; // 各段の「最後に置いたクリップの終了秒」
  for (const c of sorted) {
    // 終了が c の開始以下＝重ならない段を再利用（先頭から探す）。無ければ新しい段。
    let placed = rowEnds.findIndex((end) => end <= c.startSec);
    if (placed === -1) {
      placed = rowEnds.length;
      rowEnds.push(c.endSec);
    } else {
      rowEnds[placed] = c.endSec;
    }
    rows.set(c.id, placed);
  }
  return rows;
}

/**
 * overlay テロップ（tracks.telop の origin='overlay'）のうち指定場面と重なる区間を、場面ローカル秒＋段へ切り出す（ADR-0018・③(8)）。
 * 場面またぎのクリップは各場面が自分と重なる部分だけを持つ。文言が空のクリップは出さない。段は全体（全 overlay テロップ）で一貫割当。
 */
export function sceneLocalTelops(timeline: Timeline, sceneId: string): SceneTelopInterval[] {
  const span = timeline.scenes.find((s) => s.sceneId === sceneId);
  if (!span) return [];
  const overlayClips = timeline.tracks.telop.filter((c) => c.origin === 'overlay' && c.label);
  const rows = assignTelopRows(overlayClips); // 段は全体で割り当て（プレビュー＝書き出しのパリティ）
  const out: SceneTelopInterval[] = [];
  for (const c of overlayClips) {
    const start = Math.max(c.startSec, span.startSec);
    const end = Math.min(c.endSec, span.endSec);
    if (end <= start) continue;
    out.push({ startSec: start - span.startSec, endSec: end - span.startSec, text: c.label, row: rows.get(c.id) ?? 0 });
  }
  return out;
}

/**
 * 場面ローカル秒 t に表示する全テロップ（段付き）。区間は [startSec, endSec)。並行して複数を段違いで表示する（③(8)）。
 */
export function activeTelopsAt(intervals: readonly SceneTelopInterval[], t: number): { text: string; row: number }[] {
  return intervals.filter((iv) => t >= iv.startSec && t < iv.endSec).map((iv) => ({ text: iv.text, row: iv.row }));
}
