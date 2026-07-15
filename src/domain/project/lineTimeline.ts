// 掛け合い：描画時の「行の字幕」と「場面内タイムライン」（ADR-0015・追加A/追加B）。純粋関数（副作用なし）。
// 追加B＝行ごとの字幕（subtitleText ?? text・ON/OFF）。追加A＝経過秒で有効行が変わり画面の文言が切り替わる。
// 単一 narration の場面は sceneLines が1行に解決＝従来（場面=1行）と同値。
import { sceneLines } from './narrationLines';
import type { NarrationLine, Scene } from './types';

export interface LineSubtitle {
  /** 表示する字幕文（subtitleText ?? line.text）。 */
  text: string;
  /** この行の字幕を出すか（行 subtitleEnabled → 場面 subtitleEnabledDefault → 既定 true）。 */
  enabled: boolean;
}

/** 行の字幕を解決（追加B）。subtitleText 未指定は text を流用、enabled は 行→場面既定→true。 */
export function resolveLineSubtitle(line: NarrationLine, scene: Scene): LineSubtitle {
  return {
    // subtitleText は null/未指定とも text を流用（null=継承・11 §2.2）。text は必須 string。
    text: line.subtitleText ?? line.text,
    enabled: line.subtitleEnabled ?? scene.subtitleEnabledDefault ?? true,
  };
}

export interface LineSegment {
  lineId: string;
  /** 場面内の開始秒（[0, durationSec]）。 */
  startSec: number;
  /** 場面内の終了秒（次の行の開始＝この行の表示終わり。最終行は場面末 durationSec）。 */
  endSec: number;
  subtitle: LineSubtitle;
}

/**
 * 掛け合いの「同時開始グループ」を index で束ねる（ADR-0031）。各行は「アンカー（先頭 or `startWithPrevious` でない）」で
 * 新しいグループを始め、続く `startWithPrevious` の行は同じグループへ join＝同時開始（並行）。`true` の連続で N 人同時。
 * フラグ無し（従来の逐次）は各行が単独グループ＝後方互換。純粋関数。
 */
export function groupIndices(lines: NarrationLine[]): number[][] {
  const groups: number[][] = [];
  lines.forEach((line, i) => {
    if (i > 0 && line.startWithPrevious === true) groups[groups.length - 1].push(i);
    else groups.push([i]);
  });
  return groups;
}

/**
 * 行のタイムライン（追加A・同時開始＝ADR-0031）。各グループ（同時開始の束）の開始秒は明示 startSec、無ければ直前
 * グループまでの音声長の積み上げ（自動逐次）。グループ長＝メンバー音声長の最大。**同時グループのメンバーは同じ窓
 * [グループ開始, 次グループ開始) を共有**（並行して重ねて流す）。各グループは次グループの開始まで表示（行間の「間」は
 * 直前フレームを保持）、最終グループは場面末まで。すべて [0, durationSec] にクランプ。単独行（フラグ無し）は従来と同値。
 * lineDurations＝行ごとの音声長（秒・lineId→秒）。未測定の行は 0（startSec 明示なら不要）。
 */
export function lineSegments(scene: Scene, lineDurations: Record<string, number> = {}): LineSegment[] {
  const lines = sceneLines(scene);
  const dur = scene.durationSec;
  const clamp = (v: number): number => Math.min(Math.max(0, v), dur);
  const groups = groupIndices(lines);
  // 各グループの開始秒（アンカーの明示 startSec、無ければ直前グループ末＝自動逐次）。グループ長＝メンバー音声長の最大。
  const groupStart: number[] = [];
  let cursor = 0;
  for (const g of groups) {
    const anchor = lines[g[0]];
    const s = anchor.startSec ?? cursor;
    groupStart.push(s);
    const groupDur = g.reduce((m, idx) => Math.max(m, lineDurations[lines[idx].lineId] ?? 0), 0);
    cursor = s + groupDur;
  }
  // 行ごとの窓＝所属グループの [開始, 次グループ開始)（最終グループは場面末）。同時グループのメンバーは同一窓を共有。
  const startOf: number[] = new Array<number>(lines.length).fill(0);
  const endOf: number[] = new Array<number>(lines.length).fill(dur);
  groups.forEach((g, gi) => {
    const s = groupStart[gi];
    const displayEnd = gi + 1 < groups.length ? groupStart[gi + 1] : dur;
    for (const idx of g) {
      startOf[idx] = s;
      endOf[idx] = displayEnd;
    }
  });
  return lines.map((line, i) => {
    const startSec = clamp(startOf[i]);
    const endSec = Math.max(startSec, clamp(endOf[i]));
    return { lineId: line.lineId, startSec, endSec, subtitle: resolveLineSubtitle(line, scene) };
  });
}

export interface SceneSegmentSpec {
  /** 掛け合いのとき行 id（音声参照に使う）。単一 narration・頭空白（間）では undefined。同時グループでは primary（アンカー）。 */
  lineId?: string;
  /**
   * この区間で `lineId` と**同時に**流す他の行 id（ADR-0031・同時開始グループの2人目以降）。
   * 音声は `[lineId, ...parallelLineIds]` を並行ミックス（amix）・字幕は各行を重ならないよう段積み（stage 3）。
   * 未指定＝同時行なし（従来＝逐次）。取得は `segmentLineIds(spec)`。
   */
  parallelLineIds?: string[];
  /** subtitle レイヤーの上書き文言（追加A/B）。string＝表示／null＝非表示／undefined＝従来（scene.texts）。 */
  subtitleText?: string | null;
  /** 場面内の開始秒。アニメ場面のフレーム描画で layoutScene(t) の t 起点に使う（③・掛け合い×アニメ）。 */
  startSec: number;
  /** このセグメントの尺（秒）。 */
  durationSec: number;
  /** 場面の先頭セグメントか（書き出しのトランジションは先頭のみ）。 */
  isFirst: boolean;
  /**
   * 掛け合いの先頭「間」（頭空白＝先頭行 startSec までの無言区間）か（#386・A案＝間を尊重）。
   * true のとき字幕なし（subtitleText=null）・音声なし（narration を載せない）で映像だけ流す。
   * これで静止画/動画/プレビュー/正準(compileTimeline)の4者が同じ区間列（＝場面尺）で駆動される。
   */
  isGap?: boolean;
}

/**
 * 場面の書き出しセグメント（追加A・PR-E）。明示 lines は行ごと（字幕上書き＋区間尺）、
 * 単一 narration は1セグメント（字幕は従来 scene.texts・尺は場面尺）＝後方互換。
 * 先頭行が startSec>0 なら先頭に「間」区間（isGap）を足し、場面尺を保つ（#386・A案＝間を尊重）。
 */
export function sceneSegmentSpecs(scene: Scene, lineDurations: Record<string, number> = {}): SceneSegmentSpec[] {
  if (!scene.lines || scene.lines.length === 0) {
    return [{ startSec: 0, durationSec: scene.durationSec, isFirst: true }];
  }
  const groups = groupIndices(sceneLines(scene));
  const segs = lineSegments(scene, lineDurations);
  // 1グループ＝1セグメント（primary＝アンカー＝先頭メンバー・parallelLineIds＝同時の残り・ADR-0031）。窓は primary の
  // [start, end]（同時メンバーは同一窓を共有）。0秒（開始クランプ/音声未測定で endSec===startSec）のグループは出さない。
  const nonEmpty = groups
    .map((g) => ({ primary: segs[g[0]], parallel: g.slice(1).map((idx) => segs[idx]) }))
    .filter(({ primary }) => primary.endSec > primary.startSec)
    .map(({ primary, parallel }) => ({
      // subtitleText は primary（先頭話者）の字幕のみ（enabled のとき text・OFF は null）。同時行の字幕は
      // parallelLineIds から各消費者が解決する（通常字幕＝話者ごとに帯を積む・FREE allLines＝改行結合・ADR-0031）。
      lineId: primary.lineId,
      parallelLineIds: parallel.length > 0 ? parallel.map((s) => s.lineId) : undefined,
      subtitleText: primary.subtitle.enabled ? primary.subtitle.text : null,
      startSec: primary.startSec,
      durationSec: primary.endSec - primary.startSec,
    }));
  // すべて0秒（degenerate）なら場面全体を1セグメントに（場面が書き出しから消えないように）。
  if (nonEmpty.length === 0) return [{ startSec: 0, durationSec: scene.durationSec, isFirst: true }];
  // 先頭グループの開始が 0 より後なら「間（頭空白）」区間 [0, 先頭start) を先頭に足す（#386・A案）。
  // 間は字幕なし・音声なし。これで区間尺の合計＝場面尺（＝正準/動画経路）になり、静止画/プレビューが場面を短縮しない。
  const headGap = nonEmpty[0].startSec;
  const segs2: Array<Omit<SceneSegmentSpec, "isFirst">> =
    headGap > 0
      ? [{ subtitleText: null, startSec: 0, durationSec: headGap, isGap: true }, ...nonEmpty]
      : nonEmpty;
  return segs2.map((s, i) => ({ ...s, isFirst: i === 0 }));
}

/**
 * セグメントで実際に流す行 id の一覧＝ [lineId, ...parallelLineIds]（ADR-0031）。primary＋同時行。
 * 音声ミックス（stage 2）・字幕段積み（stage 3）が「この区間の全話者」を得る共通入口。間/単一 narration では空。
 */
export function segmentLineIds(spec: SceneSegmentSpec): string[] {
  return spec.lineId ? [spec.lineId, ...(spec.parallelLineIds ?? [])] : [];
}

/**
 * 時刻 t（秒）に有効な書き出しセグメント（`sceneSegmentSpecs` の1つ）を返す（ADR-0029・字幕解決の正準入力）。
 * 区間は [startSec, startSec+durationSec)（最終セグメントは端 t=尺 を含む）。どの区間にも入らない（t が先頭より前等）ときは先頭へ。
 * **プレビューと書き出しが同一の `sceneSegmentSpecs` 出力を消費する**ための共通関数＝間(isGap)・0秒行除外・自動逐次を一致させる。
 * `activeLineIndexAt` は「間」で先頭行を返し isGap を表せないため、字幕解決ではこちら（sceneSegmentSpecs 直結）を使う。
 */
export function segmentAt(scene: Scene, lineDurations: Record<string, number>, t: number): SceneSegmentSpec {
  const specs = sceneSegmentSpecs(scene, lineDurations);
  for (let i = 0; i < specs.length; i += 1) {
    const s = specs[i];
    const isLast = i === specs.length - 1;
    const end = s.startSec + s.durationSec;
    if (t >= s.startSec && (isLast ? t <= end : t < end)) return s;
  }
  return specs[0];
}

/**
 * プレビュー（仕上がり確認）の「今のセグメント」を返す（ADR-0029・字幕の対象解決に渡す・P1 停止時パリティ）。
 * - **停止中（!playing）＝初期＝t=0** ＝ 先頭の正準セグメント（頭空白があれば isGap＝間）。`activeLineIndex=0` が
 *   「停止＝初期」と「再生中の行0」で両義になり、頭空白ありの停止時に行0の字幕を出す不具合を防ぐ（書き出しの t=0 と一致）。
 * - **再生中** ＝ 有効行（`activeLineIndex`）に対応するセグメント。間（`activeLineIndex<0`）は isGap セグメント。
 * どのケースでも `sceneSegmentSpecs` 由来＝書き出しと同一経路（`activeLine` から lineId を再構成しない）。
 */
export function previewSubtitleSegment(
  scene: Scene,
  lineDurations: Record<string, number>,
  activeLineIndex: number,
  playing: boolean,
): SceneSegmentSpec {
  const specs = sceneSegmentSpecs(scene, lineDurations);
  if (!playing) return specs[0]; // 停止＝初期＝t=0（頭空白があれば間）
  const hasLines = (scene.lines?.length ?? 0) > 0;
  if (hasLines && activeLineIndex < 0) return specs.find((s) => s.isGap) ?? specs[0]; // 再生中の間
  const lineId = activeLineIndex >= 0 ? scene.lines?.[activeLineIndex]?.lineId : undefined;
  return specs.find((s) => s.lineId === lineId) ?? specs[0];
}

/**
 * 時刻 t（秒）に有効な行セグメントの index。区間は [startSec, endSec)（最終行は endSec を含む）。
 * どの区間にも入らない（t が先頭開始より前など）ときは先頭(0)へフォールバック。空なら -1。
 */
export function activeLineIndexAt(segments: LineSegment[], t: number): number {
  for (let i = 0; i < segments.length; i += 1) {
    const seg = segments[i];
    const isLast = i === segments.length - 1;
    if (t >= seg.startSec && (isLast ? t <= seg.endSec : t < seg.endSec)) return i;
  }
  return segments.length > 0 ? 0 : -1;
}

/** 場面の端フレーム（先頭/末尾）で有効な「字幕・クレジット状態」（切替プレビュー＋停止後の下地 ScenePreview 用・#408 Part 2）。 */
export interface BoundaryFrame {
  /**
   * subtitle レイヤーの上書き（string=表示／null=非表示＝間や OFF 行／undefined=テンプレ既定＝scene.texts）。
   * sceneSegmentSpecs の端セグメントに一致＝0 秒行（startSec===durationSec 等）を除外した後の実効状態。
   */
  subtitleText: string | null | undefined;
  /** クレジット解決に使う実効行（掛け合いの行。頭の間・単一 narration・全 0 秒フォールバックでは undefined＝既定クレジット）。 */
  creditLine: NarrationLine | undefined;
}

/** sceneSegmentSpecs の1セグメント（端フレーム）から BoundaryFrame（字幕上書き＋クレジット行）へ落とす。 */
function boundaryFrameFromSpec(scene: Scene, spec: SceneSegmentSpec): BoundaryFrame {
  const creditLine = spec.lineId ? sceneLines(scene).find((l) => l.lineId === spec.lineId) : undefined;
  return { subtitleText: spec.subtitleText, creditLine };
}

/**
 * 場面の「先頭フレーム（t=0）」の実効状態（切替プレビュー B＝当該場面の頭・停止後の下地 ScenePreview 用・#408 Part 2 レビュー P1）。
 * **書き出しの sceneSegmentSpecs を起点**にするので、0 秒行の除外・頭の間（先頭行 startSec>0 の headGap＝字幕なし）・
 * 全 0 秒フォールバック（先頭行 startSec===durationSec 等＝テンプレ既定へ）を書き出しと同一に扱う＝プレビュー=書き出し（ADR-0001/0026）。
 * lineDurations は掛け合いの自動逐次（startSec 未指定）で区間を決めるのに使う（明示 startSec なら不要・端の判定は音声非依存）。
 */
export function firstFrameBoundary(scene: Scene, lineDurations: Record<string, number> = {}): BoundaryFrame {
  const specs = sceneSegmentSpecs(scene, lineDurations);
  return boundaryFrameFromSpec(scene, specs[0]);
}

/**
 * 場面の「最終フレーム」の実効状態（切替プレビュー A＝前場面の末尾フレーム用・#408 Part 2 レビュー P1）。
 * sceneSegmentSpecs の末尾セグメントに一致＝最終行が startSec===durationSec で 0 秒なら直前の生存行を採る（書き出しと同じ）。
 */
export function lastFrameBoundary(scene: Scene, lineDurations: Record<string, number> = {}): BoundaryFrame {
  const specs = sceneSegmentSpecs(scene, lineDurations);
  return boundaryFrameFromSpec(scene, specs[specs.length - 1]);
}

/**
 * 場面編集の「動き」再生で、現在時刻 t の字幕入力（通常テンプレ字幕＝boundary／FREE 字幕＝segment）をまとめて返す（#527 P1）。
 * t=0（停止中）は先頭セグメント＝従来の静止表示に一致。再生中は `segmentAt(t)` で掛け合いの現在行に追従し、
 * 通常字幕・FREE 字幕・クレジットの3者へ**同一セグメント**を渡す＝書き出し（`sceneSegmentSpecs` をフレーム時刻で駆動）と一致（ADR-0029/0001）。
 * 先頭を固定（`sceneSegmentSpecs[0]`／`firstFrameBoundary`）にすると、アニメ中に2行目へ切り替わる掛け合いでプレビューだけ頭のままになる（#527 P1）。
 */
export function motionSubtitleAt(
  scene: Scene,
  lineDurations: Record<string, number>,
  t: number,
): { segment: SceneSegmentSpec; boundary: BoundaryFrame } {
  const segment = segmentAt(scene, lineDurations, t);
  return { segment, boundary: boundaryFrameFromSpec(scene, segment) };
}
