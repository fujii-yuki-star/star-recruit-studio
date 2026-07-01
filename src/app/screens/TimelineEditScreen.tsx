import { useMemo, useState } from "react";
import type { ScreenId } from "../data/mockData";
import { useProjectStore } from "../store/projectStore";
import { assembleProject } from "../../domain/project/persistence";
import { compileTimeline } from "../../domain/project/compileTimeline";
import { TimelineView } from "../components/TimelineView";
import { PageHead } from "../components/ui";
import { ArrowLeftIcon } from "../components/icons";

interface TimelineEditScreenProps {
  onNavigate: (screen: ScreenId) => void;
}

/**
 * タイムライン編集（ADR-0018 ③(4)・専用エディタ）。テロップ overlay クリップの追加・選択・文言/位置編集・削除。
 * 保存は共通トップバーの「保存」（store.timelineOverlay に反映済＝#324 で round-trip・Undo は meta スナップショットで自動）。
 * タイムライン上のドラッグ移動は ③(4b) で追加予定（本PRは選択＋数値/文言編集まで）。
 */
export function TimelineEditScreen({ onNavigate }: TimelineEditScreenProps) {
  const { scenes, parts, assets, meta, addOverlayClip, updateOverlayClip, removeOverlayClip } = useProjectStore();
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);

  const timeline = useMemo(
    () => compileTimeline(assembleProject(meta, assets, parts, scenes)),
    [meta, assets, parts, scenes],
  );
  const overlayClips = meta.timelineOverlay?.clips ?? [];
  const selectedClip = overlayClips.find((c) => c.id === selectedClipId) ?? null;

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

      <div className="row gap-sm" style={{ margin: "0 0 var(--gap)" }}>
        <button className="btn btn-ghost btn-icon" onClick={() => onNavigate("timeline")}>
          <ArrowLeftIcon size={16} />
          タイムラインへ戻る
        </button>
        <button className="btn btn-primary" onClick={addTelop} disabled={scenes.length === 0}>
          ＋ テロップを追加
        </button>
      </div>

      <div className="card">
        <TimelineView
          timeline={timeline}
          editable
          selectedClipId={selectedClipId ?? undefined}
          onSelectClip={setSelectedClipId}
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
                onChange={(e) => updateOverlayClip(selectedClip.id, { text: e.target.value })}
              />
            </div>
            <div>
              <label className="field-label text-sm" style={{ margin: "0 0 2px" }}>時間の合わせ方</label>
              <select
                className="select"
                value={selectedClip.anchorSceneId ?? ""}
                onChange={(e) => updateOverlayClip(selectedClip.id, { anchorSceneId: e.target.value || undefined })}
              >
                <option value="">動画全体で位置を決める</option>
                {scenes.map((s, i) => (
                  <option key={s.sceneId} value={s.sceneId}>場面 {i + 1} を基準にする</option>
                ))}
              </select>
            </div>
            <div className="row gap-sm">
              <div className="col" style={{ flex: 1 }}>
                <label className="field-label text-sm" style={{ margin: "0 0 2px" }}>開始（秒）</label>
                <input
                  className="input"
                  type="number"
                  min={0}
                  step={0.5}
                  value={selectedClip.startSec}
                  onChange={(e) => updateOverlayClip(selectedClip.id, { startSec: Math.max(0, Number(e.target.value) || 0) })}
                />
              </div>
              <div className="col" style={{ flex: 1 }}>
                <label className="field-label text-sm" style={{ margin: "0 0 2px" }}>長さ（秒）</label>
                <input
                  className="input"
                  type="number"
                  min={0.1}
                  step={0.5}
                  value={selectedClip.durationSec}
                  onChange={(e) => updateOverlayClip(selectedClip.id, { durationSec: Math.max(0.1, Number(e.target.value) || 0.1) })}
                />
              </div>
            </div>
            <div>
              <button
                className="btn btn-danger btn-icon"
                onClick={() => {
                  removeOverlayClip(selectedClip.id);
                  setSelectedClipId(null);
                }}
              >
                このテロップを削除
              </button>
            </div>
          </div>
        ) : (
          <p className="text-muted" style={{ margin: 0 }}>
            「＋ テロップを追加」で字幕を足し、タイムライン上のテロップをクリックすると、ここで文言や位置を調整できます。
          </p>
        )}
      </div>
    </div>
  );
}
