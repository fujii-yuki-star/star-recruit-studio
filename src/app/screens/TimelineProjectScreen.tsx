import { useMemo } from "react";
import type { ScreenId } from "../data/mockData";
import { useTimelineStore } from "../store/timelineStore";
import { useProjectStore } from "../store/projectStore";
import { frameTimeSec, timelineDurationSec } from "../../domain/timeline/persistence";
import { TIMELINE_CLIP_KIND, TRACK_KIND } from "../../domain/enums";
import type { TrackKind } from "../../domain/enums";
import "../components/timeline.css";
import { clipEndSec, validateTimelineDoc } from "../../domain/timeline/validateTimelineDoc";
import { layoutTimelineAt } from "../../renderer/timelineLayout";
import { layoutToSvg } from "../../renderer/sceneSvg";
import { PageHead } from "../components/ui";
import { ArrowLeftIcon } from "../components/icons";
import { clipLabel, trackLabel } from "../uiLabels";

interface TimelineProjectScreenProps {
  onNavigate: (screen: ScreenId) => void;
}

/** 1秒あたりの表示幅（px）と、レーンの最小幅。読み取り専用タイムラインと同じ見え方に寄せる。 */
const PX_PER_SEC = 40;
const MIN_LANE_WIDTH_PX = 640;

/** 列の種別ごとの色分け（読み取り専用タイムラインの既存クラスを使い回す＝見え方を揃える）。 */
function trackClipClass(kind: TrackKind): string {
  return kind === TRACK_KIND.audio ? "timeline-clip--audio" : "timeline-clip--video";
}

/** 目盛りの間隔（秒）。短い動画で目盛りが潰れないよう、尺に応じて粗くする。 */
function tickStepSec(totalSec: number): number {
  if (totalSec <= 10) return 1;
  if (totalSec <= 60) return 5;
  return 30;
}

/**
 * タイムライン編集プロジェクトの画面（ADR-0032・#629 骨格）。
 *
 * いまは**見て確かめるところまで**＝トラックとクリップの並び、再生ヘッドの位置、その瞬間の仕上がり。
 * 置く・動かす・重ねる・消すは後続。描画は `layoutTimelineAt`（場面形式と核を共有）を通すので、
 * ここで見えているものが書き出しの土台と同じ（ADR-0001）。
 */
export function TimelineProjectScreen({ onNavigate }: TimelineProjectScreenProps) {
  const { doc, loadError, isLoading, playheadSec, selectedClipIds, assetSrcById, setPlayhead, selectClip } = useTimelineStore();
  const templates = useProjectStore((s) => s.templates);
  // テンプレが持つ既定素材（ADR-0021）は全プロジェクト共通の置き場にある＝場面形式のプレビュー・書き出しと
  // 同じフォールバック（素材 → テンプレ既定素材）を通す。無いと同じ見た目が場面形式と違う絵になる（ADR-0026②）。
  const templateAssetSrcById = useProjectStore((s) => s.templateAssetSrcById);

  const totalSec = doc ? timelineDurationSec(doc) : 0;
  const layout = useMemo(() => {
    if (!doc) return null;
    const byId = new Map(templates.map((t) => [t.templateId, t]));
    // 末尾ちょうどは1フレーム手前へ寄せる（半開区間で画面が真っ白になるのを防ぐ・`frameTimeSec`）。
    return layoutTimelineAt(doc, frameTimeSec(doc, playheadSec), { templateOf: (id) => byId.get(id) });
  }, [doc, playheadSec, templates]);
  // 見た目が見つからないクリップは**描かれない**（`layoutTimelineAt`）。黙って絵だけ消さずに知らせる（§2-5・#547 と同じ筋）。
  const missingTemplateCount = useMemo(() => {
    if (!doc) return 0;
    const known = new Set(templates.map((t) => t.templateId));
    return doc.clips.filter((c) => c.kind === TIMELINE_CLIP_KIND.template && !known.has(c.templateId ?? "")).length;
  }, [doc, templates]);
  // 置き場所や音の出どころの取り違え（11 §8 V22–V28）。描画から外れるものもあるので必ず見せる。
  const warnings = useMemo(() => (doc ? validateTimelineDoc(doc) : []), [doc]);

  if (isLoading) {
    return (
      <div className="main-scroll">
        <PageHead title="タイムライン編集" desc="動画を開いています…" />
      </div>
    );
  }

  if (!doc) {
    return (
      <div className="main-scroll">
        <PageHead title="タイムライン編集" desc="時間の流れを自由に組み替えて動画を作ります。" />
        <p className="notice notice-warn" role="alert">
          {loadError ?? "開いている動画がありません。一覧から選んでください。"}
        </p>
        <button className="btn btn-ghost btn-icon" onClick={() => onNavigate("home")}>
          <ArrowLeftIcon size={16} />
          動画の一覧へ
        </button>
      </div>
    );
  }

  const svg = layout
    ? layoutToSvg(layout, { assetSrc: (id) => (id ? assetSrcById[id] ?? templateAssetSrcById[id] : undefined), responsive: true })
    : "";
  const step = tickStepSec(totalSec);
  const ticks = Array.from({ length: Math.floor(totalSec / step) + 1 }, (_, i) => i * step);
  // 時間 → 画面上の長さ。短い動画でも列が潰れないよう下限を置く（横スクロールは既存 CSS が持つ）。
  const pxPerSec = totalSec > 0 ? Math.max(MIN_LANE_WIDTH_PX / totalSec, PX_PER_SEC) : PX_PER_SEC;
  const laneWidthPx = Math.max(totalSec * pxPerSec, MIN_LANE_WIDTH_PX);

  return (
    <div className="main-scroll">
      <PageHead title={doc.projectName} desc="時間の流れを自由に組み替えて動画を作ります。" />

      {missingTemplateCount > 0 && (
        <p className="notice notice-warn" role="alert">
          見た目パターンが見つからない部品が{missingTemplateCount}個あります。その部品は動画に出ません。見た目パターンを読み込み直すか、置き直してください。
        </p>
      )}
      {warnings.length > 0 && (
        <ul className="notice notice-warn" role="alert">
          {warnings.map((w) => (
            <li key={`${w.code}/${w.field}`}>{w.message}</li>
          ))}
        </ul>
      )}

      <div className="card">
        <div className="preview-stage" dangerouslySetInnerHTML={{ __html: svg }} />
        <label className="field">
          <span>再生位置</span>
          <input
            type="range"
            min={0}
            max={Math.max(totalSec, 0.1)}
            step={0.1}
            value={playheadSec}
            onChange={(e) => setPlayhead(Number(e.target.value))}
          />
        </label>
        <p className="text-muted">
          {playheadSec.toFixed(1)} 秒 / 全体 {totalSec.toFixed(1)} 秒
        </p>
      </div>

      <div className="card">
        <h3>並び</h3>
        {doc.clips.length === 0 ? (
          <p className="text-muted">まだ何も置かれていません。</p>
        ) : (
          // 見た目は読み取り専用タイムライン（ADR-0018 ③(2)）と同じ CSS を使う＝2つの一覧で見え方が割れない（§6）。
          <div className="timeline">
            <div className="timeline-scroll">
              <div className="timeline-inner">
                <div className="timeline-row">
                  <div className="timeline-row-label" />
                  <div className="timeline-track timeline-ruler" style={{ width: laneWidthPx }}>
                    {ticks.map((t) => (
                      <span key={t} className="timeline-tick" style={{ left: `${pxPerSec * t}px` }}>
                        {t}秒
                      </span>
                    ))}
                  </div>
                </div>
                {/* 表示は**手前が上**（配列は後ろほど手前なので逆順に並べる）＝重なりの見え方と一致させる。 */}
                {[...doc.tracks].reverse().map((track) => (
                  <div className="timeline-row" key={track.id}>
                    <div className="timeline-row-label">
                      <span>{trackLabel(doc.tracks, track.id)}</span>
                      {track.hidden && <span className="sub">出さない</span>}
                    </div>
                    <div className="timeline-track timeline-lane" style={{ width: laneWidthPx }}>
                      {doc.clips
                        .filter((c) => c.trackId === track.id)
                        .map((c) => (
                          <button
                            key={c.id}
                            type="button"
                            className={`timeline-clip ${trackClipClass(track.kind)}${selectedClipIds.includes(c.id) ? " timeline-clip--selected" : ""}`}
                            style={{ left: `${pxPerSec * c.startSec}px`, width: `${pxPerSec * (clipEndSec(c) - c.startSec)}px` }}
                            onClick={(e) => selectClip(c.id, e.shiftKey)}
                          >
                            {clipLabel(c)}
                          </button>
                        ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="row gap-sm mt-lg">
        <button className="btn btn-ghost btn-icon" onClick={() => onNavigate("home")}>
          <ArrowLeftIcon size={16} />
          動画の一覧へ
        </button>
      </div>
    </div>
  );
}
