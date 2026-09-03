import { TIMELINE_LABEL_W_PX, TIMELINE_ZOOM_LEVELS } from '../../domain/constants';
// 目盛りの粗さ・既定の段は**タイムライン編集と共有**（同名の規則を2つ持たない・#686 レビュー）。
import { DEFAULT_ZOOM_INDEX, tickStepSec } from '../../domain/timeline/zoom';
import { useState } from "react";
import { clipRangeTitle, clockLabel } from "../uiLabels";
import { TRANSITION_TYPE } from "../../domain/enums";
import type { TransitionType } from "../../domain/enums";
import type { Timeline, TimelineClip, TimelineTrackKind } from "../../domain/project/compileTimeline";
import "./timeline.css";

interface TimelineViewProps {
  timeline: Timeline;
  /** 再生ヘッドの位置（グローバル秒・ADR-0023 段階(1)）。未指定＝ヘッドを出さない（読み取り専用の表示はそのまま）。
   *  **動画の範囲へ収めるのは持ち主（渡す側）**＝ここでは収めない（表示側でも収めると入口の取りこぼしが隠れる・#561 の轍）。 */
  playheadSec?: number;
  /** ルーラーのクリック/矢印キーでヘッドを動かす。渡したときだけルーラーが操作できるようになる。
   *  渡ってくる秒は**素の値**（範囲外もあり得る）＝収めるのは持ち主の仕事。 */
  onSeek?: (sec: number) => void;
}

// レーン表示の並びとラベル（§2-3：技術用語を避けた言い換え）。video＝場面の映像。
const LANES: { kind: TimelineTrackKind; label: string; sub: string }[] = [
  { kind: "video", label: "場面", sub: "映像" },
  { kind: "telop", label: "テロップ", sub: "字幕" },
  // ⚠️ **「ナレーション」は画面に出さない**（§2-3・`16 §1`）＝この `sub` は列の見出しに描かれる。
  { kind: "audio", label: "音声", sub: "セリフ" },
  { kind: "bgm", label: "BGM", sub: "音楽" },
];

// 段は**共有**（`TIMELINE_ZOOM_LEVELS`・#686）＝タイムライン編集と同じ刻みにする（ADR-0034 決定13）。
const ZOOM_LEVELS = TIMELINE_ZOOM_LEVELS;
// 矢印キーでヘッドを動かす幅（秒）。**秒の入力刻み（SEC_STEP）とは用途が違う**＝あちらは尺を打ち込む刻み、
// こちらは「見たい瞬間を探す」操作の粒度（0.1秒だと十数秒の動画でも端まで百回以上かかる）。
const SEEK_KEY_STEP_SEC = 1;

/** 遷移種別を画面用の言い換えへ（§2-3。FFmpeg 名や enum 値は出さない）。 */
function transitionLabel(type: TransitionType): string {
  return type === TRANSITION_TYPE.fade ? "フェード" : "スライド";
}




function clipTitle(clip: TimelineClip): string {
  return clipRangeTitle(clip.label, clip.startSec, clip.endSec);
}


export function TimelineView({ timeline, playheadSec, onSeek }: TimelineViewProps) {
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
    // 列名の欄の幅は**タイムライン編集と同じ値**を流し込む（CSS の既定に頼ると片方だけ変わる・#742 レビュー）。
    <div className="timeline" data-testid="timeline-view" style={{ ["--timeline-label-w" as string]: `${TIMELINE_LABEL_W_PX}px` }}>
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

      <div className="timeline-scroll">
        <div className="timeline-inner">
          {/* 時間ルーラー */}
          <div className="timeline-row">
            <div className="timeline-row-label">
              <span>時間</span>
            </div>
            {/* シークはルーラーが受ける（ADR-0023 段階(1)）。レーン側で受けるとクリップの選択・ドラッグと取り合いになる。
                役割は button ではなく **slider**：位置を持つ操作なので、読み上げに現在位置が伝わり、矢印キーで動かせる
                （button だと Enter/Space に「どこへ動かすか」が無い）。 */}
            <div
              className={`timeline-track timeline-ruler${onSeek ? " timeline-ruler--seekable" : ""}`}
              style={{ width: trackWidth }}
              role={onSeek ? "slider" : undefined}
              tabIndex={onSeek ? 0 : undefined}
              aria-label={onSeek ? "再生位置" : undefined}
              aria-valuemin={onSeek ? 0 : undefined}
              aria-valuemax={onSeek ? timeline.totalSec : undefined}
              aria-valuenow={onSeek ? playheadSec ?? 0 : undefined}
              aria-valuetext={onSeek ? clockLabel(playheadSec ?? 0) : undefined}
              onClick={onSeek ? (e) => {
                // トラック左端からの px を秒へ。ヘッドの位置計算（left = 秒×倍率）の逆＝押した所に線が来る。
                const x = e.clientX - e.currentTarget.getBoundingClientRect().left;
                onSeek(x / pxPerSec); // 範囲へ収めるのは持ち主（TimelineEditScreen）＝ここで先に収めない
              } : undefined}
              onKeyDown={onSeek ? (e) => {
                // ←→ で1秒ずつ、Home/End で先頭/末尾へ。**秒の入力刻み（SEC_STEP=0.1）は使わない**
                // ＝あれは尺を打ち込むための刻みで、これは「見たい瞬間を探す」操作（0.1秒刻みだと端まで160回かかる）。
                const cur = playheadSec ?? 0; // 受け取った値は持ち主が収め済み
                const next =
                  e.key === "ArrowLeft" ? cur - SEEK_KEY_STEP_SEC
                  : e.key === "ArrowRight" ? cur + SEEK_KEY_STEP_SEC
                  : e.key === "Home" ? 0
                  : e.key === "End" ? timeline.totalSec
                  : null;
                if (next == null) return;
                e.preventDefault(); // 画面が横スクロールしてヘッドを見失わないように
                onSeek(next);
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
                  const left = clip.startSec * pxPerSec;
                  const width = (clip.endSec - clip.startSec) * pxPerSec;
                  return (
                    <div
                      key={clip.id}
                      className={`timeline-clip timeline-clip--${lane.kind}`}
                      style={{ left: Math.max(0, left), width: Math.max(4, width) }}
                      title={clipTitle(clip)}
                    >
                      {clip.label}
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
