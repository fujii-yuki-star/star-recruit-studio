import { useState } from "react";
import { TRANSITION_TYPE } from "../../domain/enums";
import type { TransitionType } from "../../domain/enums";
import type { Timeline, TimelineClip, TimelineTrackKind } from "../../domain/project/compileTimeline";
import "./timeline.css";

interface TimelineViewProps {
  timeline: Timeline;
  /** 編集モード（overlay クリップを選択可能に）。TimelineEditScreen から渡す。読み取りは未指定。 */
  editable?: boolean;
  /** 選択中の overlay クリップ id（ハイライト）。 */
  selectedClipId?: string;
  /** overlay クリップの選択（空領域クリックで null）。editable のとき有効。 */
  onSelectClip?: (id: string | null) => void;
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

export function TimelineView({ timeline, editable, selectedClipId, onSelectClip }: TimelineViewProps) {
  const [zoomIndex, setZoomIndex] = useState(DEFAULT_ZOOM_INDEX);
  const pxPerSec = ZOOM_LEVELS[zoomIndex];

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
            <div className="timeline-track timeline-ruler" style={{ width: trackWidth }}>
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
                  // overlay 由来クリップ（ovclip_）だけ編集モードで選択可能。場面射影クリップ（sceneId/lineId）は対象外。
                  const selectable = !!editable && clip.id.startsWith("ovclip_");
                  const selected = selectable && clip.id === selectedClipId;
                  return (
                    <div
                      key={clip.id}
                      className={`timeline-clip timeline-clip--${lane.kind}${selected ? " timeline-clip--selected" : ""}${selectable ? " timeline-clip--editable" : ""}`}
                      style={{ left: clip.startSec * pxPerSec, width: Math.max(2, (clip.endSec - clip.startSec) * pxPerSec) }}
                      title={clipTitle(clip)}
                      onClick={selectable ? (e) => { e.stopPropagation(); onSelectClip?.(clip.id); } : undefined}
                    >
                      {clip.label}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
