import { useMemo, useState } from "react";
import type { ScreenId } from "../data/mockData";
import { isExportBusy, useProjectStore } from "../store/projectStore";
import { assembleProject } from "../../domain/project/persistence";
import { compileTimeline } from "../../domain/project/compileTimeline";
import { lineDurationsFromAudio } from "../../domain/project/narrationLines";
import type { OverlayClip } from "../../domain/project/types";
import { TimelineView } from "../components/TimelineView";
import { UndoRedoButtons } from "../components/UndoRedoButtons";
import { NumberField } from "../components/NumberField";
import { DeleteConfirm } from "../components/DeleteConfirm";
import type { ClipDragMode } from "../components/TimelineView";
import { TIMELINE_MIN_CLIP_SEC } from "../../domain/constants";
import { PageHead } from "../components/ui";
import { ExportLock } from "../components/ExportLockBanner";
import { ArrowLeftIcon } from "../components/icons";
import { useHistoryGroup } from "../hooks/useHistoryGroup";

interface TimelineEditScreenProps {
  onNavigate: (screen: ScreenId) => void;
}

/**
 * タイムライン編集（ADR-0018 ③(4)・専用エディタ）。テロップ overlay クリップの追加・選択・文言/位置編集・削除。
 * 保存は共通トップバーの「保存」（store.timelineOverlay に反映済＝#324 で round-trip・Undo は meta スナップショットで自動）。
 * タイムライン上のドラッグ移動は ③(4b) で追加予定（本PRは選択＋数値/文言編集まで）。
 */
export function TimelineEditScreen({ onNavigate }: TimelineEditScreenProps) {
  const { scenes, parts, assets, meta, narrationAudioById, addOverlayClip, updateOverlayClip, removeOverlayClip, undo, redo } = useProjectStore();
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
  // タイムライン上のドラッグ確定（1ドロップ=1操作）。move=移動（startSec）／trim-end=右端（durationSec）／
  // trim-start=左端（右端 end を固定して startSec と durationSec）。いずれもクランプ後に実効差分が無ければ更新しない（no-op な履歴を作らない）。
  const editClip = (id: string, mode: ClipDragMode, deltaSec: number): void => {
    const clip = overlayClips.find((c) => c.id === id);
    if (!clip) return;
    if (mode === "move") {
      const startSec = Math.max(0, clip.startSec + deltaSec);
      if (startSec !== clip.startSec) updateOverlayClip(id, { startSec });
    } else if (mode === "trim-end") {
      const durationSec = Math.max(TIMELINE_MIN_CLIP_SEC, clip.durationSec + deltaSec);
      if (durationSec !== clip.durationSec) updateOverlayClip(id, { durationSec });
    } else {
      // trim-start：右端(end)を固定して左端を動かす。startSec∈[0, end−最小長]、durationSec=end−startSec。
      const end = clip.startSec + clip.durationSec;
      const startSec = Math.min(Math.max(0, clip.startSec + deltaSec), end - TIMELINE_MIN_CLIP_SEC);
      if (startSec !== clip.startSec) updateOverlayClip(id, { startSec, durationSec: end - startSec });
    }
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
        />
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
              <NumberField label="開始（秒）" value={selectedClip.startSec} min={0} step={0.5}
                onChange={(v) => updateOverlayClip(selectedClip.id, { startSec: v })} />
              <NumberField label="長さ（秒）" value={selectedClip.durationSec} min={TIMELINE_MIN_CLIP_SEC} step={0.5}
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
        ) : (
          <p className="text-muted" style={{ margin: 0 }}>
            「＋ テロップを追加」で字幕を足し、タイムライン上のテロップをクリックすると、ここで文言や位置を調整できます。
          </p>
        )}
      </div>
      </ExportLock>
    </div>
  );
}
