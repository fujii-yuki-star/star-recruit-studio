import { useEffect, useMemo, useRef, useState } from "react";
import type { ScreenId } from "../data/mockData";
import { isTimelineExportBusy, useTimelineStore } from "../store/timelineStore";
import { useProjectStore } from "../store/projectStore";
import { frameTimeSec, timelineDurationSec } from "../../domain/timeline/persistence";
import { TIMELINE_CLIP_KIND, TRACK_KIND } from "../../domain/enums";
import { clipCountOnTrack } from "../../domain/timeline/edit";
import { audioSourceKeyOfClip } from "../../domain/timeline/audio";
import { useUndoRedoShortcuts } from "../hooks/useUndoRedoShortcuts";
import { useTimelinePlayback } from "../hooks/useTimelinePlayback";
import { useTimelineAudio } from "../hooks/useTimelineAudio";
import type { TrackKind } from "../../domain/enums";
import "../components/timeline.css";
import { clipEndSec, validateTimelineDoc } from "../../domain/timeline/validateTimelineDoc";
import { layoutTimelineAt } from "../../renderer/timelineLayout";
import { timelineExportBlockers } from "../../domain/timeline/export";
import { EXPORT_RUN_PHASE } from "../../domain/export/exportProgress";
import { creditSpeakerAt } from "../../domain/timeline/credit";
import { creditForLine, creditForSpeaker } from "../../domain/voice/narratorCredit";
import { fontFamilyForId } from "../../domain/font/fontCatalog";
import { getVoicevoxSpeaker } from "../../infrastructure/appSettings";
import { layoutToSvg } from "../../renderer/sceneSvg";
import { PageHead } from "../components/ui";
import { DeleteConfirm } from "../components/DeleteConfirm";
import { ArrowLeftIcon } from "../components/icons";
import { clipLabel, editBlockedMessage, exportBlockedMessage, trackLabel } from "../uiLabels";

interface TimelineProjectScreenProps {
  onNavigate: (screen: ScreenId) => void;
}

/** 編集してから自動保存するまでの待ち（ms）。連続操作のたびに書かないための間。 */
const AUTOSAVE_DELAY_MS = 800;

/** 「前へ／後ろへ」1回で動かす秒。細かすぎず粗すぎない刻み（再生位置へ寄せる操作と併用する前提）。 */
const NUDGE_SEC = 0.5;

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
 * 見て確かめる（その瞬間の仕上がり・列と部品の並び）と、置く・動かす・重ねる・消すができる。
 * 描画は `layoutTimelineAt`（場面形式と核を共有）を通すので、ここで見えているものが書き出しの土台と
 * 同じ（ADR-0001）。編集は少し待って自動保存する（閉じても消えない）。
 */
export function TimelineProjectScreen({ onNavigate }: TimelineProjectScreenProps) {
  const {
    doc, loadError, isLoading, playheadSec, selectedClipIds, assetSrcById, audioSrcByKey, editBlocked, history, exportRun,
    setPlayhead, selectClip, moveSelectedClip, trimSelectedClip, duplicateSelectedClip, removeSelectedClips,
    addTrack, removeTrack, moveTrackOrder, setTrackFlag, undo, redo, saveTimelineProject, saveStatus,
    isPlaying, play, pause, exportTimelineVideo, cancelTimelineExport, dismissTimelineExport,
  } = useTimelineStore();

  // 連続再生の時計（再生中だけ回る）。見せる時刻の決め方は domain（`playbackTick`）に委ねる。
  useTimelinePlayback();
  // 音は「その瞬間に鳴っているもの」を時刻から決めて鳴らす（絵と同じ時刻を見る＝ずれない）。
  useTimelineAudio();

  // 取り消し/やり直しのキー操作は**この画面の store** へ繋ぐ（既定は場面形式を巻き戻すので渡さない＝
  // 見えていない文書を戻して自動保存が永続化する事故を作らない・#547 P1-1 と同じ筋）。
  useUndoRedoShortcuts(true, { undo, redo });

  // 編集したら少し待って自動保存する（場面形式と同じ「閉じても消えない」＝ADR-0026②）。
  // 連続操作のたびに書かないよう間を置く。保存中の再編集は `saveTimelineProject` 側で見る。
  const saveTimer = useRef<number | null>(null);
  useEffect(() => {
    if (saveStatus !== "idle") return;
    if (saveTimer.current != null) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => void saveTimelineProject(), AUTOSAVE_DELAY_MS);
    return () => {
      if (saveTimer.current != null) window.clearTimeout(saveTimer.current);
    };
  }, [saveStatus, saveTimelineProject]);
  const templates = useProjectStore((s) => s.templates);
  // テンプレが持つ既定素材（ADR-0021）は全プロジェクト共通の置き場にある＝場面形式のプレビュー・書き出しと
  // 同じフォールバック（素材 → テンプレ既定素材）を通す。無いと同じ見た目が場面形式と違う絵になる（ADR-0026②）。
  const templateAssetSrcById = useProjectStore((s) => s.templateAssetSrcById);

  const [removingTrackId, setRemovingTrackId] = useState<string | null>(null);
  const totalSec = doc ? timelineDurationSec(doc) : 0;
  // 1つだけ選んでいるときが「動かせる」状態（複数選択はまとめて消すだけ＝対象が決まらない）。
  const selected = doc && selectedClipIds.length === 1 ? doc.clips.find((c) => c.id === selectedClipIds[0]) : undefined;
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
  // 書き出せない理由（`timelineExportBlockers`）は**押す前に**見せる＝押しても断られるだけ、を作らない（§2-5）。
  const exportBlockers = useMemo(
    // 見た目の未解決も理由になる（描かれないものを黙って落とした動画を成功にしない・ADR-0026④）。
    () => (doc ? timelineExportBlockers(doc, { knownTemplateIds: new Set(templates.map((t) => t.templateId)) }) : []),
    [doc, templates],
  );
  const exporting = isTimelineExportBusy(exportRun.phase);
  // 音が見つからない部品は**鳴らない**（読み上げ未作成・音源の読み込み失敗）。黙って無音にしない（§2-5）。
  const missingAudioCount = useMemo(() => {
    if (!doc) return 0;
    return doc.clips.filter((c) => {
      if (c.kind !== TIMELINE_CLIP_KIND.voice && c.kind !== TIMELINE_CLIP_KIND.audio) return false;
      const key = audioSourceKeyOfClip(c);
      return !key || !audioSrcByKey[key];
    }).length;
  }, [doc, audioSrcByKey]);

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

  // 再生中に押せない操作の理由（§2-5：押せない理由を無言にしない）。
  const playingHint = isPlaying ? "再生を止めてから使えます" : undefined;
  const svg = layout
    ? layoutToSvg(layout, {
        assetSrc: (id) => (id ? assetSrcById[id] ?? templateAssetSrcById[id] : undefined),
        // クレジット（ADR-0003）は書き出しで**焼き込まれる**ので、プレビューにも同じものを出す
        // ＝見えていたものと違う動画が出てこない（ADR-0001）。その時刻にしゃべっている声のキャラ。
        // 動画全体のフォント（`videoSettings.fontId`）＝部品ごとの指定が無いときの受け皿。書き出しにも
        // 同じものを渡している（渡さないとプレビューだけ既定の字体になり、焼いた動画と字が変わる）。
        fontFamily: fontFamilyForId(doc.videoSettings.fontId),
        credit: creditForLine(
          { speaker: creditSpeakerAt(doc, frameTimeSec(doc, playheadSec)) },
          creditForSpeaker(getVoicevoxSpeaker()),
        ),
        responsive: true,
      })
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
      {missingAudioCount > 0 && (
        <p className="notice notice-warn" role="alert">
          音が見つからない部品が{missingAudioCount}個あります。その部品は鳴りません。読み上げを作り直すか、音を選び直してください。
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
        <div className="row gap-sm">
          <button
            className="btn btn-primary"
            onClick={isPlaying ? pause : play}
            disabled={totalSec <= 0}
            title={totalSec <= 0 ? "まだ部品を置いていないので再生できません" : undefined}
          >
            {isPlaying ? "停止" : "再生"}
          </button>
          <button className="btn btn-ghost" onClick={() => setPlayhead(0)} disabled={playheadSec === 0}>
            先頭へ
          </button>
          {exporting ? (
            <button className="btn btn-ghost" onClick={cancelTimelineExport} disabled={exportRun.cancelling}>
              {exportRun.cancelling ? "中止しています…" : "書き出しを中止"}
            </button>
          ) : (
            <button
              className="btn btn-primary"
              onClick={() => void exportTimelineVideo({ templates, templateAssetSrcById })}
              disabled={exportBlockers.length > 0 || isPlaying}
              title={exportBlockers.length > 0 ? exportBlockedMessage[exportBlockers[0].code] : playingHint}
            >
              動画を書き出す
            </button>
          )}
        </div>
        {exportBlockers.length > 0 && !exporting && (
          <ul className="notice notice-warn" role="alert">
            {exportBlockers.map((b) => (
              <li key={b.code}>{exportBlockedMessage[b.code]}</li>
            ))}
          </ul>
        )}
        {exporting && exportRun.phase !== EXPORT_RUN_PHASE.preparing && (
          <div className="field" aria-live="polite">
            <progress value={exportRun.percent} max={100} />
            <span>動画を書き出しています（{exportRun.percent}%）。そのままお待ちください。</span>
          </div>
        )}
        {exportRun.message && (
          <p className={exportRun.phase === EXPORT_RUN_PHASE.done ? "notice" : "notice notice-warn"} role="status">
            {exportRun.message}
            <button className="btn btn-ghost" onClick={dismissTimelineExport}>
              閉じる
            </button>
          </p>
        )}
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

      {removingTrackId && doc.tracks.some((t) => t.id === removingTrackId) && (
        <DeleteConfirm
          message={`「${trackLabel(doc.tracks, removingTrackId)}」を消しますか？この列に置いてある${clipCountOnTrack(doc, removingTrackId)}個の部品も一緒に消えます。`}
          onCancel={() => setRemovingTrackId(null)}
          onConfirm={() => {
            removeTrack(removingTrackId);
            setRemovingTrackId(null);
          }}
        />
      )}

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
                      {track.locked && <span className="sub">固定中</span>}
                      <span className="row gap-sm">
                        <button className="btn btn-ghost btn-sm" title="手前へ" onClick={() => moveTrackOrder(track.id, "front")}>↑</button>
                        <button className="btn btn-ghost btn-sm" title="奥へ" onClick={() => moveTrackOrder(track.id, "back")}>↓</button>
                        <button
                          className="btn btn-ghost btn-sm"
                          title={track.hidden ? "動画に出す" : "動画に出さない"}
                          onClick={() => setTrackFlag(track.id, "hidden", !track.hidden)}
                        >
                          {track.hidden ? "出す" : "隠す"}
                        </button>
                        <button
                          className="btn btn-ghost btn-sm"
                          title={track.locked ? "固定を外す" : "動かせないように固定する"}
                          onClick={() => setTrackFlag(track.id, "locked", !track.locked)}
                        >
                          {track.locked ? "固定を外す" : "固定"}
                        </button>
                        <button className="btn btn-ghost btn-sm" title="この列を消す" onClick={() => setRemovingTrackId(track.id)}>消す</button>
                      </span>
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

      {editBlocked && (
        <p className="notice notice-warn" role="alert">{editBlockedMessage[editBlocked]}</p>
      )}

      <div className="card">
        <h3>選んだ部品</h3>
        {selected ? (
          <>
            <p className="text-muted">
              {clipLabel(selected)}（{selected.startSec.toFixed(1)}秒から{selected.durationSec.toFixed(1)}秒間）
            </p>
            <div className="row gap-sm">
              <button className="btn btn-secondary" onClick={() => moveSelectedClip({ startSec: selected.startSec - NUDGE_SEC })}>
                前へ
              </button>
              <button className="btn btn-secondary" onClick={() => moveSelectedClip({ startSec: selected.startSec + NUDGE_SEC })}>
                後ろへ
              </button>
              {/* 再生位置を使う操作は**再生中に押させない**＝走っている位置を掴むと結果が毎回変わる（§2-5）。 */}
              <button className="btn btn-secondary" onClick={() => moveSelectedClip({ startSec: playheadSec })} disabled={isPlaying} title={playingHint}>
                再生位置へ
              </button>
              <button className="btn btn-secondary" onClick={() => trimSelectedClip("start", playheadSec)} disabled={isPlaying} title={playingHint}>
                ここから始める
              </button>
              <button className="btn btn-secondary" onClick={() => trimSelectedClip("end", playheadSec)} disabled={isPlaying} title={playingHint}>
                ここで終わる
              </button>
              <button className="btn btn-secondary" onClick={duplicateSelectedClip}>同じものを足す</button>
              <button className="btn btn-danger" onClick={removeSelectedClips}>消す</button>
            </div>
            <label className="field">
              <span>置く列</span>
              <select value={selected.trackId} onChange={(e) => moveSelectedClip({ trackId: e.target.value })}>
                {doc.tracks.map((t) => (
                  <option key={t.id} value={t.id}>{trackLabel(doc.tracks, t.id)}</option>
                ))}
              </select>
            </label>
          </>
        ) : (
          <p className="text-muted">
            {selectedClipIds.length > 1
              ? "1つだけ選ぶと、位置や長さを変えられます（まとめて消すことはできます）。"
              : "下の並びから部品を選ぶと、位置や長さを変えられます。"}
          </p>
        )}
        {selectedClipIds.length > 1 && (
          <button className="btn btn-danger" onClick={removeSelectedClips}>選んだ{selectedClipIds.length}個を消す</button>
        )}
      </div>

      <div className="row gap-sm mt-lg">
        <button className="btn btn-ghost" onClick={undo} disabled={history.past.length === 0}>取り消す</button>
        <button className="btn btn-ghost" onClick={redo} disabled={history.future.length === 0}>やり直す</button>
        <button className="btn btn-secondary" onClick={() => addTrack(TRACK_KIND.visual)}>映像の列を足す</button>
        <button className="btn btn-secondary" onClick={() => addTrack(TRACK_KIND.audio)}>音の列を足す</button>
      </div>

      <div className="row gap-sm mt-lg">
        {/* 書き出し中に別の動画へ移ると、描いている途中の素材や音が入れ替わる（混ざった動画が出る）。 */}
        <button
          className="btn btn-ghost btn-icon"
          onClick={() => onNavigate("home")}
          disabled={exporting}
          title={exporting ? "書き出しが終わってから戻れます" : undefined}
        >
          <ArrowLeftIcon size={16} />
          動画の一覧へ
        </button>
      </div>
    </div>
  );
}
