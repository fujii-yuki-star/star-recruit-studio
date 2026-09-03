import { useMemo } from "react";
import type { ScreenId } from "../data/mockData";
import { useProjectStore } from "../store/projectStore";
import { assembleProject } from "../../domain/project/persistence";
import { compileTimeline } from "../../domain/project/compileTimeline";
import { lineDurationsFromAudio } from "../../domain/project/narrationLines";
import { TimelineView } from "../components/TimelineView";
import { BakeToTimelinePanel } from "../components/BakeToTimelinePanel";
import { PageHead } from "../components/ui";
import { ArrowLeftIcon } from "../components/icons";

interface TimelineScreenProps {
  onNavigate: (screen: ScreenId) => void;
}

/**
 * 読み取り専用タイムライン（ADR-0018 ③(2)・#253）。compileTimeline の射影を場面/テロップ/音声/BGM のトラックで見渡す。
 * 編集はまだ無し（オーバーレイ編集は ③(3) 以降）。データは store の分解状態から assembleProject で組み立てて渡す。
 */
export function TimelineScreen({ onNavigate }: TimelineScreenProps) {
  const hasRetiredTimelineEdits = useProjectStore((s) => s.hasRetiredTimelineEdits);
  const dismissRetiredTimelineNotice = useProjectStore((s) => s.dismissRetiredTimelineNotice);
  const { scenes, parts, assets, meta, narrationAudioById } = useProjectStore();
  // 場面ベース project → 時間軸射影。掛け合いの行区間は実音声長で表示する（未指定だと最終行だけ全幅・#392）。
  const timeline = useMemo(
    () =>
      compileTimeline(assembleProject(meta, assets, parts, scenes), {
        lineDurationsFor: (scene) => lineDurationsFromAudio(scene, narrationAudioById),
      }),
    [meta, assets, parts, scenes, narrationAudioById],
  );

  return (
    <div className="main-scroll">
      <PageHead
        title="タイムライン"
        desc="動画全体の時間の流れを、場面・テロップ・音声・BGM のトラックで見渡せます。ここでは見るだけで、時間の流れを直すときはタイムライン編集用の動画を作ります。"
      />
      {/* 旧・場面横断タイムラインの手編集（#635）。**消していない**ことと、次の行動を伝える（§2-5）。 */}
      {hasRetiredTimelineEdits && (
        <div className="notice notice-info" role="status">
          <p>
            この動画には、以前この画面で直した時間の流れ（テロップの位置など）が残っていますが、
            <strong>動画には反映されなくなりました</strong>。内容は消していません。
            時間の流れを細かく作るときは、下の「タイムラインで編集する形にする」から作り直してください。
          </p>
          <button className="btn btn-ghost btn-sm" onClick={dismissRetiredTimelineNotice}>
            閉じる
          </button>
        </div>
      )}
      <div className="card">
        <TimelineView timeline={timeline} />
      </div>
      <BakeToTimelinePanel onNavigate={onNavigate} />
      <div className="row gap-sm mt-lg">
        <button className="btn btn-ghost btn-icon" onClick={() => onNavigate("preview")}>
          <ArrowLeftIcon size={16} />
          仕上がり確認へ戻る
        </button>
        <button className="btn btn-secondary" onClick={() => onNavigate("scene-edit")}>
          場面を直す
        </button>
      </div>
    </div>
  );
}
