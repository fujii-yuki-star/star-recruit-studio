import { useMemo } from "react";
import type { ScreenId } from "../data/mockData";
import { useProjectStore } from "../store/projectStore";
import { assembleProject } from "../../domain/project/persistence";
import { compileTimeline } from "../../domain/project/compileTimeline";
import { TimelineView } from "../components/TimelineView";
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
  const { scenes, parts, assets, meta } = useProjectStore();
  // 場面ベース project → 時間軸射影。動画スロットの有無・行音声長は読み取り可視化では既定のまま（③(1) の説明どおり）。
  const timeline = useMemo(
    () => compileTimeline(assembleProject(meta, assets, parts, scenes)),
    [meta, assets, parts, scenes],
  );

  return (
    <div className="main-scroll">
      <PageHead
        title="タイムライン"
        desc="動画全体の時間の流れを、場面・テロップ・音声・BGM のトラックで見渡せます。"
      />
      <div className="card">
        <TimelineView timeline={timeline} />
      </div>
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
