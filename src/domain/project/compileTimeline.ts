// 場面ベース project を「時間軸＋トラック」へ機械射影する純粋関数（ADR-0018・2モデル方式／§7 テスト対象）。
// 正準は場面（project.scenes 配列順＝再生順・sceneOps）。本関数は読み取り専用の射影で、専用タイムライン編集UI（別画面・
// α-4 ③(2)）と、将来の書き出し配線が共有する土台。副作用なし。AI/簡易編集は本射影を無視する（ADR-0007 M-A）。
//
// 忠実性：totalSec と場面境界は buildExportScenes と一致する（掛け合いセグメントは場面尺内に収まるため、場面粒度の
//   合計＝セグメント粒度の合計）。遷移尺の上限 clamp のみ、書き出しは per-segment 尺（遷移を持つ後場面の「最初の
//   セグメント」）で締めるのに対し本関数は per-scene 尺（後場面の「場面尺」）で締める＝掛け合い（非動画スロット）が
//   遷移を持ちかつ最初の行区間が短い稀ケースでのみ本関数の重なりが長めに出る（左側の累積 acc は両者同一）。
//   読み取り可視化には影響せず、書き出しの実適用は従来どおり buildExportScenes（本関数は ③(1) 時点では書き出しへ配線しない）。
import { TRANSITION_TYPE } from '../enums';
import type { TransitionDirection, TransitionType } from '../enums';
import { resolveTransition, transitionTimeline } from './sceneTransitions';
import { lineSegments, resolveLineSubtitle } from './lineTimeline';
import { sceneLines } from './narrationLines';
import type { Project, Scene } from './types';

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
  /**
   * 動画スロットを持つ場面か。buildExportScenes(:180 `useSegments = hasLines && !videoSlot`) と同じく、
   * 動画スロットのある掛け合いは行分割せず単一クリップにする。未指定＝全掛け合いを行分割（動画スロットの有無は不問）。
   */
  isVideoSlotScene?: (scene: Scene) => boolean;
  /** 射影対象の場面か（未指定＝全場面）。将来の書き出し配線でテンプレ未解決の除外に使える。 */
  includeScene?: (scene: Scene) => boolean;
  /** 場面の表示名（未指定＝「場面 N」）。 */
  sceneLabelFor?: (scene: Scene, order: number) => string;
}

function emptyTimeline(): Timeline {
  return { totalSec: 0, scenes: [], tracks: { video: [], telop: [], audio: [], bgm: [] }, transitions: [] };
}

/** BGM を全体1本のクリップとして出すか（有効かつ音源が選ばれているとき）。 */
function bgmClips(project: Project, totalSec: number): TimelineClip[] {
  const b = project.bgmSettings;
  const hasSource = b?.bundledBgmId != null || (b?.assetId != null && b.assetId !== '');
  if (!b?.enabled || !hasSource || totalSec <= 0) return [];
  return [{ id: 'bgm', startSec: 0, endSec: totalSec, label: 'BGM' }];
}

/**
 * 場面ベース project を時間軸＋トラックへ射影する（ADR-0018）。純粋関数。
 * - 再生順＝project.scenes 配列順（sceneOps）。遷移の重なりは transitionTimeline で解決（ADR-0009）。
 * - tracks.video＝場面ごと1クリップ。tracks.audio/telop＝行ごと（sceneLines→lineSegments・0秒区間は除外）。
 *   動画スロットのある掛け合いは書き出しに合わせ単一クリップへ collapse（isVideoSlotScene）。tracks.bgm＝全体1本（有効時）。
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
    const hasLines = !!(s.lines && s.lines.length > 0);
    // 動画スロットのある掛け合いは書き出し(buildExportScenes:180 の `!videoSlot` ゲート)が行分割しない＝射影も単一クリップへ。
    // 音声は1本（場面尺）、字幕は scene.texts ベース（未取得ゆえ行テキストを素ラベルに用いる近似）。
    if (hasLines && (opts.isVideoSlotScene?.(s) ?? false)) {
      const lines = sceneLines(s);
      const label = lines.map((l) => l.text).join(' ');
      const endSec = base + s.durationSec;
      audio.push({ id: `${s.sceneId}/audio`, sceneId: s.sceneId, startSec: base, endSec, label });
      if (lines.some((l) => resolveLineSubtitle(l, s).enabled)) {
        telop.push({ id: `${s.sceneId}/telop`, sceneId: s.sceneId, startSec: base, endSec, label });
      }
      continue;
    }
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
    tracks: { video, telop, audio, bgm: bgmClips(project, effectiveTotalSec) },
    transitions,
  };
}
