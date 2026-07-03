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
 * 行のタイムライン（追加A）。各行の開始秒は明示 startSec、無ければ直前までの音声長の積み上げ（自動逐次）。
 * 各行は次の行の開始まで表示（行間の「間」は直前フレームを保持）、最終行は場面末まで。すべて [0, durationSec] にクランプ。
 * lineDurations＝行ごとの音声長（秒・lineId→秒）。未測定の行は 0（startSec 明示なら不要）。
 */
export function lineSegments(scene: Scene, lineDurations: Record<string, number> = {}): LineSegment[] {
  const lines = sceneLines(scene);
  const dur = scene.durationSec;
  const clamp = (v: number): number => Math.min(Math.max(0, v), dur);
  const starts: number[] = [];
  let cursor = 0;
  for (const line of lines) {
    const start = line.startSec ?? cursor;
    starts.push(start);
    cursor = start + (lineDurations[line.lineId] ?? 0);
  }
  return lines.map((line, i) => {
    const startSec = clamp(starts[i]);
    const rawEnd = i + 1 < lines.length ? starts[i + 1] : dur;
    const endSec = Math.max(startSec, clamp(rawEnd));
    return { lineId: line.lineId, startSec, endSec, subtitle: resolveLineSubtitle(line, scene) };
  });
}

export interface SceneSegmentSpec {
  /** 掛け合いのとき行 id（音声参照に使う）。単一 narration では undefined。 */
  lineId?: string;
  /** subtitle レイヤーの上書き文言（追加A/B）。string＝表示／null＝非表示／undefined＝従来（scene.texts）。 */
  subtitleText?: string | null;
  /** 場面内の開始秒。アニメ場面のフレーム描画で layoutScene(t) の t 起点に使う（③・掛け合い×アニメ）。 */
  startSec: number;
  /** このセグメントの尺（秒）。 */
  durationSec: number;
  /** 場面の先頭セグメントか（書き出しのトランジションは先頭のみ）。 */
  isFirst: boolean;
}

/**
 * 場面の書き出しセグメント（追加A・PR-E）。明示 lines は行ごと（字幕上書き＋区間尺）、
 * 単一 narration は1セグメント（字幕は従来 scene.texts・尺は場面尺）＝後方互換。
 */
export function sceneSegmentSpecs(scene: Scene, lineDurations: Record<string, number> = {}): SceneSegmentSpec[] {
  if (!scene.lines || scene.lines.length === 0) {
    return [{ startSec: 0, durationSec: scene.durationSec, isFirst: true }];
  }
  // 0秒（開始がクランプ/音声未測定で endSec===startSec）のセグメントは出さない（書き出し/再生の不正を防ぐ）。
  const nonEmpty = lineSegments(scene, lineDurations)
    .filter((s) => s.endSec > s.startSec)
    .map((s) => ({
      lineId: s.lineId,
      subtitleText: s.subtitle.enabled ? s.subtitle.text : null,
      startSec: s.startSec,
      durationSec: s.endSec - s.startSec,
    }));
  // すべて0秒（degenerate）なら場面全体を1セグメントに（場面が書き出しから消えないように）。
  if (nonEmpty.length === 0) return [{ startSec: 0, durationSec: scene.durationSec, isFirst: true }];
  return nonEmpty.map((s, i) => ({ ...s, isFirst: i === 0 }));
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
