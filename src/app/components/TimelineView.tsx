import { useEffect, useRef, useState } from "react";
import { TRANSITION_TYPE } from "../../domain/enums";
import type { TransitionType } from "../../domain/enums";
import type { Timeline, TimelineClip, TimelineTrackKind } from "../../domain/project/compileTimeline";
import { TIMELINE_MIN_CLIP_SEC } from "../../domain/constants";
import { snapTimeSec } from "../../domain/project/timelineSnap";
import { applyClipEdge, type ClipDragMode } from "../../domain/project/overlayClipEdit";
import { clampPlayheadSec } from "../../domain/project/playhead";
import "./timeline.css";

/** overlay クリップのドラッグ種別。move＝本体移動、trim-start／trim-end＝左右端のトリミング。
 *  編集の意味論（クランプ）は domain（`applyClipEdge`）が持つので、種別も domain 側の定義を使う（#561）。 */
export type { ClipDragMode };

interface TimelineViewProps {
  timeline: Timeline;
  /** 編集モード（overlay クリップを選択可能に）。TimelineEditScreen から渡す。読み取りは未指定。 */
  editable?: boolean;
  /** 選択中の overlay クリップ id（ハイライト）。 */
  selectedClipId?: string;
  /** overlay クリップの選択（空領域クリックで null）。editable のとき有効。 */
  onSelectClip?: (id: string | null) => void;
  /**
   * overlay クリップのドラッグ確定。`edgeSec` は**動かした端のグローバル秒**（吸着済み・**クランプは受け手**）。
   * move/trim-start は開始、trim-end は終了。差分でなく端そのものを渡す＝足し戻しの誤差とクランプの二重化を避ける（#561）。
   */
  onClipDrag?: (id: string, mode: ClipDragMode, edgeSec: number) => void;
  /** 再生ヘッドの位置（グローバル秒・ADR-0023 段階(1)）。未指定＝ヘッドを出さない（読み取り専用の表示はそのまま）。 */
  playheadSec?: number;
  /** ルーラーのクリックでヘッドを動かす。渡したときだけルーラーが押せるようになる。 */
  onSeek?: (sec: number) => void;
}

// レーン表示の並びとラベル（§2-3：技術用語を避けた言い換え）。video＝場面の映像。
const LANES: { kind: TimelineTrackKind; label: string; sub: string }[] = [
  { kind: "video", label: "場面", sub: "映像" },
  { kind: "telop", label: "テロップ", sub: "字幕" },
  { kind: "audio", label: "音声", sub: "ナレーション" },
  { kind: "bgm", label: "BGM", sub: "音楽" },
];

const ZOOM_LEVELS = [16, 24, 36, 54, 80, 120] as const;
const DEFAULT_ZOOM_INDEX = 2; // 36 px/秒
const SNAP_THRESHOLD_PX = 8; // ドラッグ/トリミングの吸着しきい値（px）。px→秒は pxPerSec で換算。

/** 遷移種別を画面用の言い換えへ（§2-3。FFmpeg 名や enum 値は出さない）。 */
function transitionLabel(type: TransitionType): string {
  return type === TRANSITION_TYPE.fade ? "フェード" : "スライド";
}

/** 秒を「m:ss」表記へ（ルーラー用・短い動画は "0:05" のように読める）。 */
function clockLabel(sec: number): string {
  const whole = Math.round(sec);
  const m = Math.floor(whole / 60);
  const s = whole % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** ズームに応じた目盛り間隔（秒）。px/秒が小さいほど粗く。 */
function tickStepSec(pxPerSec: number): number {
  if (pxPerSec >= 80) return 1;
  if (pxPerSec >= 36) return 2;
  if (pxPerSec >= 24) return 5;
  return 10;
}

function clipTitle(clip: TimelineClip): string {
  return `${clip.label}（${clockLabel(clip.startSec)}〜${clockLabel(clip.endSec)}）`;
}

const OVERLAY_TRACK_KINDS: TimelineTrackKind[] = ["video", "telop", "audio", "bgm"];

/** ドラッグ中の吸着先（グローバル秒）：0・各場面の開始/終了・自分以外の overlay クリップの端。 */
function snapTargetsFor(timeline: Timeline, excludeId: string): number[] {
  const set = new Set<number>([0]);
  for (const s of timeline.scenes) {
    set.add(s.startSec);
    set.add(s.endSec);
  }
  for (const kind of OVERLAY_TRACK_KINDS) {
    for (const c of timeline.tracks[kind]) {
      if (c.origin === "overlay" && c.id !== excludeId) {
        set.add(c.startSec);
        set.add(c.endSec);
      }
    }
  }
  return [...set];
}

function findClip(timeline: Timeline, id: string): TimelineClip | undefined {
  for (const kind of OVERLAY_TRACK_KINDS) {
    const c = timeline.tracks[kind].find((x) => x.id === id);
    if (c) return c;
  }
  return undefined;
}

/** ドラッグ対象クリップのアンカー場面のグローバル開始秒（絶対時間クリップは0）。到達可能範囲の下限に使う。 */
function anchorGlobalStartOf(timeline: Timeline, clip: TimelineClip): number {
  return clip.sceneId ? timeline.scenes.find((s) => s.sceneId === clip.sceneId)?.startSec ?? 0 : 0;
}

/**
 * 動かした端の**グローバル秒**（吸着まで）を出す。**クランプはしない**＝それは `applyClipEdge` の役目で、
 * ここで先にクランプすると受け手と二重になり、境界での辻褄合わせが浮動小数に依存する（#561）。
 */
function snappedEdge(clip: TimelineClip, mode: ClipDragMode, rawDeltaSec: number, targets: number[], thresholdSec: number): number {
  const baseEdge = mode === "trim-end" ? clip.endSec : clip.startSec;
  return snapTimeSec(baseEdge + rawDeltaSec, targets, thresholdSec);
}

/** ドラッグ結果のクリップ（グローバル秒）。ドロップ後の確定（`editClip`）と**同じ関数**で出す＝スナップバックしない。 */
function draggedSpan(timeline: Timeline, clip: TimelineClip, mode: ClipDragMode, edgeSec: number): { startSec: number; durationSec: number } {
  const anchorStart = anchorGlobalStartOf(timeline, clip);
  const span = { startSec: clip.startSec, durationSec: clip.endSec - clip.startSec };
  return applyClipEdge(span, mode, edgeSec, anchorStart, TIMELINE_MIN_CLIP_SEC);
}

export function TimelineView({ timeline, editable, selectedClipId, onSelectClip, onClipDrag, playheadSec, onSeek }: TimelineViewProps) {
  const [zoomIndex, setZoomIndex] = useState(DEFAULT_ZOOM_INDEX);
  const pxPerSec = ZOOM_LEVELS[zoomIndex];

  // overlay クリップのドラッグ（1D・水平＝時間）。mode＝move/trim-start/trim-end。確定は drop 時に onClipDrag(mode, deltaSec)。
  // 確定用に開始位置(startX)と mode を ref に持ち（タイミング非依存）、pointerup の clientX から直接 delta を出す。preview は offsetPx。
  const [drag, setDrag] = useState<{ id: string; mode: ClipDragMode; offsetPx: number } | null>(null);
  const dragMetaRef = useRef<{ id: string; startX: number; mode: ClipDragMode } | null>(null);
  // 最新の timeline を ref で参照（onUp の吸着計算に使う）。deps に timeline を入れず、effect の再登録を避ける（配列長も一定に保つ）。
  const timelineRef = useRef(timeline);
  useEffect(() => {
    timelineRef.current = timeline;
  }, [timeline]);
  const dragging = drag !== null;
  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: PointerEvent) => {
      const m = dragMetaRef.current;
      if (m) setDrag({ id: m.id, mode: m.mode, offsetPx: e.clientX - m.startX });
    };
    const onUp = (e: PointerEvent) => {
      const m = dragMetaRef.current;
      if (m) {
        const rawDeltaSec = (e.clientX - m.startX) / pxPerSec;
        if (rawDeltaSec !== 0) {
          // 吸着させてから確定（プレビューと同じ計算・場面境界/他クリップ端/0秒へ）。クランプは受け手（#561）。
          const tl = timelineRef.current;
          const clip = findClip(tl, m.id);
          if (clip) {
            onClipDrag?.(m.id, m.mode, snappedEdge(clip, m.mode, rawDeltaSec, snapTargetsFor(tl, m.id), SNAP_THRESHOLD_PX / pxPerSec));
          }
        }
      }
      dragMetaRef.current = null;
      setDrag(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [dragging, pxPerSec, onClipDrag]);

  // クリップ本体/ハンドルからドラッグ開始（選択＋開始位置と mode を記録）。
  const beginDrag = (e: { clientX: number; stopPropagation(): void }, id: string, mode: ClipDragMode): void => {
    e.stopPropagation();
    onSelectClip?.(id);
    dragMetaRef.current = { id, startX: e.clientX, mode };
    setDrag({ id, mode, offsetPx: 0 });
  };

  if (timeline.scenes.length === 0) {
    return (
      <div className="timeline-empty" data-testid="timeline-empty">
        まだ場面がありません。動画案を作るか、場面を追加すると、ここに時間の流れが表示されます。
      </div>
    );
  }

  const trackWidth = Math.max(1, timeline.totalSec) * pxPerSec;
  const step = tickStepSec(pxPerSec);
  const ticks: number[] = [];
  for (let t = 0; t <= timeline.totalSec + 0.001; t += step) ticks.push(t);

  const canZoomOut = zoomIndex > 0;
  const canZoomIn = zoomIndex < ZOOM_LEVELS.length - 1;

  return (
    <div className="timeline" data-testid="timeline-view">
      <div className="timeline-toolbar">
        <span className="text-sm text-muted">
          合計 {clockLabel(timeline.totalSec)}・場面 {timeline.scenes.length}個
        </span>
        <span style={{ marginLeft: "auto" }} className="text-sm text-muted">表示倍率</span>
        <button
          className="btn btn-ghost btn-icon"
          onClick={() => setZoomIndex((i) => Math.max(0, i - 1))}
          disabled={!canZoomOut}
          aria-label="表示を縮める"
        >
          −
        </button>
        <button
          className="btn btn-ghost btn-icon"
          onClick={() => setZoomIndex((i) => Math.min(ZOOM_LEVELS.length - 1, i + 1))}
          disabled={!canZoomIn}
          aria-label="表示を広げる"
        >
          ＋
        </button>
      </div>

      <div className="timeline-scroll" onClick={editable ? () => onSelectClip?.(null) : undefined}>
        <div className="timeline-inner">
          {/* 時間ルーラー */}
          <div className="timeline-row">
            <div className="timeline-row-label">
              <span>時間</span>
            </div>
            {/* シークはルーラーが受ける（ADR-0023 段階(1)）。レーン側で受けるとクリップの選択・ドラッグと取り合いになる。 */}
            <div
              className={`timeline-track timeline-ruler${onSeek ? " timeline-ruler--seekable" : ""}`}
              style={{ width: trackWidth }}
              role={onSeek ? "button" : undefined}
              aria-label={onSeek ? "時間を選ぶ" : undefined}
              onClick={onSeek ? (e) => {
                // トラック左端からの px を秒へ。ヘッドの位置計算（left = 秒×倍率）の逆＝押した所に線が来る。
                const x = e.clientX - e.currentTarget.getBoundingClientRect().left;
                onSeek(clampPlayheadSec(timeline, x / pxPerSec));
              } : undefined}
            >
              {ticks.map((t) => (
                <div key={t} className="timeline-tick" style={{ left: t * pxPerSec }}>
                  {clockLabel(t)}
                </div>
              ))}
            </div>
          </div>

          {/* レーン */}
          {LANES.map((lane) => (
            <div className="timeline-row" key={lane.kind}>
              <div className="timeline-row-label">
                <span>{lane.label}</span>
                <span className="sub">{lane.sub}</span>
              </div>
              <div className="timeline-track timeline-lane" style={{ width: trackWidth }}>
                {/* 場面レーンには遷移（重なり）マーカーを重ねる。 */}
                {lane.kind === "video" &&
                  timeline.transitions.map((tr) => (
                    <div
                      key={`${tr.fromSceneId}-${tr.toSceneId}`}
                      className="timeline-transition"
                      style={{ left: tr.atSec * pxPerSec, width: Math.max(2, tr.durationSec * pxPerSec) }}
                      title={`${transitionLabel(tr.type)}（${tr.durationSec}秒）`}
                    />
                  ))}
                {timeline.tracks[lane.kind].map((clip) => {
                  // overlay 由来クリップだけ編集モードで選択・ドラッグ可能。判別は domain の origin（UI は id 形式を知らない・§2-7）。
                  const selectable = !!editable && clip.origin === "overlay";
                  const selected = selectable && clip.id === selectedClipId;
                  const isDragging = drag?.id === clip.id;
                  const baseLeft = clip.startSec * pxPerSec;
                  const baseWidth = (clip.endSec - clip.startSec) * pxPerSec;
                  // ドラッグ中のプレビューは確定（editClip）と同じクランプ式で座標を出す（drop 時のスナップバックを防ぐ）。
                  let left = baseLeft;
                  let width = baseWidth;
                  if (isDragging) {
                    // 確定（editClip）と**同じ関数**で結果を出す＝ドロップでスナップバックしない（#561・ADR-0026③）。
                    const edge = snappedEdge(clip, drag.mode, drag.offsetPx / pxPerSec, snapTargetsFor(timeline, clip.id), SNAP_THRESHOLD_PX / pxPerSec);
                    const span = draggedSpan(timeline, clip, drag.mode, edge);
                    left = span.startSec * pxPerSec;
                    width = span.durationSec * pxPerSec;
                  }
                  return (
                    <div
                      key={clip.id}
                      className={`timeline-clip timeline-clip--${lane.kind}${selected ? " timeline-clip--selected" : ""}${selectable ? " timeline-clip--editable" : ""}${isDragging ? " timeline-clip--dragging" : ""}`}
                      style={{ left: Math.max(0, left), width: Math.max(4, width) }}
                      title={clipTitle(clip)}
                      onClick={selectable ? (e) => e.stopPropagation() : undefined}
                      onPointerDown={selectable ? (e) => beginDrag(e, clip.id, "move") : undefined}
                    >
                      {clip.label}
                      {selectable && (
                        <>
                          <span
                            className="timeline-clip-handle timeline-clip-handle--left"
                            onPointerDown={(e) => beginDrag(e, clip.id, "trim-start")}
                          />
                          <span
                            className="timeline-clip-handle timeline-clip-handle--right"
                            onPointerDown={(e) => beginDrag(e, clip.id, "trim-end")}
                          />
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          {/* 再生ヘッド（ADR-0023 段階(1)）。全レーンを縦に貫く＝どの行を見ていても同じ時刻を指す。
              左位置はラベル幅（CSS の --timeline-label-w が単一の参照元）＋ 時刻×表示倍率。 */}
          {playheadSec != null && (
            <div
              className="timeline-playhead"
              data-testid="timeline-playhead"
              // 受け取った時刻をそのまま描く（**クランプはしない**）。範囲へ収めるのは `onSeek` を出す側＝
              // 入口1か所に寄せる。ここでも収めると二重になり、入口の取りこぼしが表示で隠れる（#561 と同じ轍）。
              style={{ left: `calc(var(--timeline-label-w) + ${playheadSec * pxPerSec}px)` }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
