import { useMemo, useState } from "react";
import type { ScreenId } from "../data/mockData";
import { isExportBusy, useProjectStore } from "../store/projectStore";
import { assembleProject } from "../../domain/project/persistence";
import { activeTelopsAt, compileTimeline, sceneLocalTelops } from "../../domain/project/compileTimeline";
import type { Timeline, TimelineClip, TimelineTrackKind } from "../../domain/project/compileTimeline";
import { activeLineIndexAt, lineSegments, segmentAt } from "../../domain/project/lineTimeline";
import { clampPlayheadSec, playheadFrameAt } from "../../domain/project/playhead";
import { formatDuration } from "../../domain/format/duration";
import { ScenePreview } from "../components/ScenePreview";
import { lineDurationsFromAudio } from "../../domain/project/narrationLines";
import type { OverlayClip } from "../../domain/project/types";
import { TimelineView } from "../components/TimelineView";
import { UndoRedoButtons } from "../components/UndoRedoButtons";
import { NumberField } from "../components/NumberField";
import { DeleteConfirm } from "../components/DeleteConfirm";
import { applyClipEdge, type ClipDragMode } from "../../domain/project/overlayClipEdit";
import { SEC_STEP, TIMELINE_MIN_CLIP_SEC } from "../../domain/constants";
import { PageHead } from "../components/ui";
import { ExportLock } from "../components/ExportLockBanner";
import { ArrowLeftIcon } from "../components/icons";
import { useHistoryGroup } from "../hooks/useHistoryGroup";

/** 射影クリップを探すレーン（BGM は場面に紐づかないので対象外）。 */
const TIMELINE_LANES: TimelineTrackKind[] = ["video", "telop", "audio"];

/**
 * 選んだ id が**場面から射影されたクリップ**（場面・セリフ・字幕）なら、それと場面の表示名を返す（ADR-0023 (3)）。
 * 音声レーンと字幕レーンの同じ行は id を共有する（`sceneId/lineId`）＝**同じセリフ**なので、先に見つかったほうでよい。
 */
function findSceneClip(timeline: Timeline, clipId: string | null): { clip: TimelineClip; sceneLabel: string } | null {
  if (clipId == null) return null;
  for (const kind of TIMELINE_LANES) {
    const clip = timeline.tracks[kind].find((c) => c.id === clipId && c.sceneId != null);
    if (clip) {
      const order = timeline.scenes.find((s) => s.sceneId === clip.sceneId)?.order ?? 0;
      return { clip, sceneLabel: `場面 ${order + 1}` };
    }
  }
  return null;
}

interface TimelineEditScreenProps {
  onNavigate: (screen: ScreenId) => void;
}

/**
 * タイムライン編集（ADR-0018 ③(4)・専用エディタ）。テロップ overlay クリップの追加・選択・文言/位置編集・削除。
 * 保存は共通トップバーの「保存」（store.timelineOverlay に反映済＝#324 で round-trip・Undo は meta スナップショットで自動）。
 * タイムライン上のドラッグ移動は ③(4b) で追加予定（本PRは選択＋数値/文言編集まで）。
 */
export function TimelineEditScreen({ onNavigate }: TimelineEditScreenProps) {
  const { scenes, parts, assets, templates, meta, narrationAudioById, addOverlayClip, updateOverlayClip, removeOverlayClip, setEditingSceneId, generateNarration, isGeneratingNarration, undo, redo } = useProjectStore();
  // Undo/Redo（#255・ADR-0020）：overlay 編集も履歴対象（docSnapshot が meta.timelineOverlay を含む＝自動）。
  const canUndo = useProjectStore((s) => s.past.length > 0);
  const canRedo = useProjectStore((s) => s.future.length > 0);
  // 書き出し中は store の undo/redo が無言 no-op（#379 ガード）。ボタンも disabled にして「押せるのに効かない」を無くす
  //（ExportLock の inert で操作は既に止まるが、見た目が活性のままだと誤認する・ADR-0026④/#547 P3-12・キー入口 isUndoRedoEnabledFor と同条件）。
  const isExporting = useProjectStore((s) => isExportBusy(s.exportRun.phase));
  // テロップ文言/数値の連続編集を1履歴にまとめる（#389）。
  const { textGroup } = useHistoryGroup();
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  // 削除は共通の確認へ寄せる（#410・やめる左/削除する danger右）。選ぶテロップが変わると自動で解除される（id 比較）。
  const [confirmDeleteClipId, setConfirmDeleteClipId] = useState<string | null>(null);

  const timeline = useMemo(
    () =>
      compileTimeline(assembleProject(meta, assets, parts, scenes), {
        lineDurationsFor: (scene) => lineDurationsFromAudio(scene, narrationAudioById),
      }),
    [meta, assets, parts, scenes, narrationAudioById],
  );
  const overlayClips = meta.timelineOverlay?.clips ?? [];
  const selectedClip = overlayClips.find((c) => c.id === selectedClipId) ?? null;

  // 場面から射影されたクリップ（場面・セリフ・字幕）を選んだとき（ADR-0023 (3)・#329）。overlay でない選択がこれ。
  // 音声レーンと字幕レーンの同じ行は id を共有する（`sceneId/lineId`）＝**同じセリフ**なので、両方光って良い。
  const selectedSceneClip = findSceneClip(timeline, selectedClip ? null : selectedClipId);

  // 再生ヘッド（ADR-0023 段階(1)）。時間軸で選んだ瞬間の**静止フレーム**を右の窓へ。
  // グローバル秒→場面ローカル秒の橋渡しだけ `playheadFrameAt` が担い、そこから先（字幕・有効行・テロップ）は
  // 場面編集/仕上がり確認/書き出しと**同じ共有関数**で解決する＝画面ごとに見え方がぶれない（ADR-0026②/③）。
  // 押された位置は素のまま持ち、**描画のたびに動画の範囲へ収める**（クランプの持ち主はここ1か所）。
  // 動画が短くなっても（この画面の「取り消す」は ADR-0020 の履歴＝meta/parts/**scenes** を丸ごと戻すので、
  // 別画面で伸ばした場面尺をここから取り消すと合計尺が縮む）、ヘッドと時計が**存在しない時刻**に残らない。
  // 素の値を残すのは、やり直しで動画が元の長さに戻ったときに元の位置へ帰れるようにするため。
  const [rawPlayheadSec, setPlayheadSec] = useState(0);
  const playheadSec = clampPlayheadSec(timeline, rawPlayheadSec);
  const playheadScene = useMemo(() => {
    const { sceneId, localSec } = playheadFrameAt(timeline, playheadSec);
    const scene = sceneId ? scenes.find((s) => s.sceneId === sceneId) : undefined;
    if (!scene) return null;
    const durations = lineDurationsFromAudio(scene, narrationAudioById);
    return {
      scene,
      template: templates.find((t) => t.templateId === scene.templateId),
      localSec,
      activeLineIndex: activeLineIndexAt(lineSegments(scene, durations), localSec),
      subtitleSegment: segmentAt(scene, durations, localSec),
      telops: activeTelopsAt(sceneLocalTelops(timeline, scene.sceneId), localSec),
    };
  }, [timeline, playheadSec, scenes, templates, narrationAudioById]);

  // 場面のグローバル開始秒（射影から引く）。アンカー切替時の startSec 再計算に使う。
  const sceneGlobalStart = (sceneId?: string): number =>
    sceneId ? timeline.scenes.find((s) => s.sceneId === sceneId)?.startSec ?? 0 : 0;
  // 「時間の合わせ方」切替：startSec の意味（相対⇔絶対）が変わるので、実効グローバル秒を保って再計算する（無警告ジャンプ防止）。
  const changeAnchor = (clip: OverlayClip, newAnchor?: string): void => {
    const effective = sceneGlobalStart(clip.anchorSceneId) + clip.startSec;
    updateOverlayClip(clip.id, {
      anchorSceneId: newAnchor,
      startSec: Math.max(0, effective - sceneGlobalStart(newAnchor)),
    });
  };
  /**
   * タイムライン上のドラッグ確定（1ドロップ=1操作）。`edgeSec` は**動かした端のグローバル秒**（吸着済み・未クランプ）。
   * store の `startSec` は**場面アンカー相対**なので、ここでアンカー開始を引いて座標系を合わせ、
   * クランプは共有の `applyClipEdge` に**1回だけ**通す（#561＝差分で受け取って足し戻すと下限へ厳密に戻らない）。
   * クランプ後に実効差分が無ければ更新しない（no-op な履歴を作らない）。
   */
  const editClip = (id: string, mode: ClipDragMode, edgeSec: number): void => {
    const clip = overlayClips.find((c) => c.id === id);
    if (!clip) return;
    const anchorStart = clip.anchorSceneId ? timeline.scenes.find((s) => s.sceneId === clip.anchorSceneId)?.startSec ?? 0 : 0;
    const next = applyClipEdge(clip, mode, edgeSec - anchorStart, 0, TIMELINE_MIN_CLIP_SEC);
    if (next.startSec !== clip.startSec || next.durationSec !== clip.durationSec) updateOverlayClip(id, next);
  };

  const addTelop = () => {
    // 既定で最初の場面を基準に置く（先頭に出る）。文言/位置は下のパネルで調整。
    const id = addOverlayClip({ track: "telop", anchorSceneId: scenes[0]?.sceneId, startSec: 0, durationSec: 3, text: "テロップ" });
    setSelectedClipId(id);
  };

  return (
    <div className="main-scroll">
      <PageHead
        title="タイムラインを編集"
        desc="テロップ（字幕）を足して、時間軸の位置や文言を調整できます。編集した内容は上の「保存」で保存されます。"
      />
      <ExportLock onNavigate={onNavigate}>

      <div className="row gap-sm" style={{ margin: "0 0 var(--gap)", alignItems: "center" }}>
        <button className="btn btn-ghost btn-icon" onClick={() => onNavigate("timeline")}>
          <ArrowLeftIcon size={16} />
          タイムラインへ戻る
        </button>
        <button className="btn btn-primary" onClick={addTelop} disabled={scenes.length === 0}>
          ＋ テロップを追加
        </button>
        {/* Undo/Redo（#255）。overlay の追加/移動/トリミング/文言も戻せる（履歴は meta スナップショット・場面編集と共通）。 */}
        <div className="row gap-sm" style={{ marginLeft: "auto" }}>
          <UndoRedoButtons canUndo={canUndo} canRedo={canRedo} onUndo={undo} onRedo={redo} disabled={isExporting} />
        </div>
      </div>

      <div className="card">
        <TimelineView
          timeline={timeline}
          editable
          selectedClipId={selectedClipId ?? undefined}
          onSelectClip={setSelectedClipId}
          onClipDrag={editClip}
          playheadSec={playheadSec}
          onSeek={setPlayheadSec}
        />
      </div>

      {/* 再生ヘッドの位置の仕上がり（ADR-0023 段階(1)）。時間軸で選んだ瞬間を、そのまま絵で確かめられるようにする。
          ここは**静止フレーム**（連続再生は段階(2)）。中身の解決は場面編集・書き出しと同じ共有関数を通す＝見え方がぶれない。 */}
      <div className="card mt">
        <div className="row-between" style={{ alignItems: "baseline", marginBottom: "var(--gap-sm)" }}>
          <h2 className="section-title" style={{ margin: 0 }}>この時間の仕上がり</h2>
          <span className="text-sm text-muted">{formatDuration(playheadSec)}</span>
        </div>
        {playheadScene ? (
          <ScenePreview
            scene={playheadScene.scene}
            template={playheadScene.template}
            activeLineIndex={playheadScene.activeLineIndex}
            subtitleSegment={playheadScene.subtitleSegment}
            telops={playheadScene.telops}
            timeSec={playheadScene.localSec}
            animations={meta.timelineOverlay?.animations}
          />
        ) : (
          <p className="text-sm text-muted">この時間には映る場面がありません。上の目盛りを押して時間を選んでください。</p>
        )}
      </div>

      <div className="card mt">
        {selectedClip ? (
          <div className="col gap-sm" data-testid="overlay-clip-editor">
            <h2 className="section-title">選んだテロップ</h2>
            <div>
              <label className="field-label text-sm" style={{ margin: "0 0 2px" }}>文言</label>
              <input
                className="input"
                value={selectedClip.text ?? ""}
                placeholder="画面に出す文字"
                {...textGroup}
                onChange={(e) => updateOverlayClip(selectedClip.id, { text: e.target.value })}
              />
            </div>
            <div>
              <label className="field-label text-sm" style={{ margin: "0 0 2px" }}>時間の合わせ方</label>
              <select
                className="select"
                value={selectedClip.anchorSceneId ?? ""}
                onChange={(e) => changeAnchor(selectedClip, e.target.value || undefined)}
              >
                <option value="">動画全体で位置を決める</option>
                {scenes.map((s, i) => (
                  <option key={s.sceneId} value={s.sceneId}>場面 {i + 1} を基準にする</option>
                ))}
              </select>
            </div>
            {/* 開始/長さは共有 NumberField（#459・blur 確定・空/NaN は元値へ・min クランプ）。commit が1回なので #389 の history グループは不要。 */}
            <div className="row gap-sm">
              <NumberField label="開始（秒）" value={selectedClip.startSec} min={0} step={SEC_STEP}
                onChange={(v) => updateOverlayClip(selectedClip.id, { startSec: v })} />
              <NumberField label="長さ（秒）" value={selectedClip.durationSec} min={TIMELINE_MIN_CLIP_SEC} step={SEC_STEP}
                onChange={(v) => updateOverlayClip(selectedClip.id, { durationSec: v })} />
            </div>
            {confirmDeleteClipId === selectedClip.id ? (
              <DeleteConfirm
                message="このテロップを削除しますか？"
                onCancel={() => setConfirmDeleteClipId(null)}
                onConfirm={() => {
                  removeOverlayClip(selectedClip.id);
                  setSelectedClipId(null);
                  setConfirmDeleteClipId(null);
                }}
              />
            ) : (
              <div>
                <button
                  className="btn btn-danger btn-icon"
                  onClick={() => setConfirmDeleteClipId(selectedClip.id)}
                >
                  このテロップを削除
                </button>
              </div>
            )}
          </div>
        ) : selectedSceneClip ? (
          /* 場面から射影されたクリップ（場面・セリフ・字幕）を選んだとき（ADR-0023 (3)）。
             ここでは直接いじらず、**編集元へ辿る**導線と、その場でできる「声を作り直す」だけを出す
             （正準は場面側＝タイムラインで書き換えない・ADR-0018 の2モデル方式）。 */
          <div className="col gap-sm" data-testid="scene-clip-editor">
            <h2 className="section-title">選んだ場面</h2>
            <p className="text-sm text-muted" style={{ margin: 0 }}>
              {selectedSceneClip.sceneLabel}（{formatDuration(selectedSceneClip.clip.startSec)}〜{formatDuration(selectedSceneClip.clip.endSec)}）
            </p>
            {selectedSceneClip.clip.lineId && (
              <p className="text-sm" style={{ margin: 0 }}>「{selectedSceneClip.clip.label}」</p>
            )}
            <div className="row gap-sm" style={{ flexWrap: "wrap" }}>
              <button
                className="btn btn-primary"
                onClick={() => {
                  setEditingSceneId(selectedSceneClip.clip.sceneId ?? null);
                  onNavigate("scene-edit");
                }}
              >
                この場面を編集する
              </button>
              {/* 声は場面まるごと作り直す（行だけの作り直しは store に無い＝場面編集と同じ粒度に揃える）。
                  作成中・書き出し中は押せない＝押せるのに何も起きない、を作らない（ADR-0026④）。 */}
              <button
                className="btn btn-secondary"
                disabled={isGeneratingNarration || isExporting}
                onClick={() => void generateNarration(selectedSceneClip.clip.sceneId ?? "")}
              >
                {isGeneratingNarration ? "声を作成中…" : "この場面の声を作り直す"}
              </button>
            </div>
          </div>
        ) : (
          <p className="text-muted" style={{ margin: 0 }}>
            「＋ テロップを追加」で字幕を足し、タイムライン上のテロップをクリックすると、ここで文言や位置を調整できます。
            場面・セリフ・字幕のクリップを選ぶと、その場面の編集へ移れます。
          </p>
        )}
      </div>
      </ExportLock>
    </div>
  );
}
