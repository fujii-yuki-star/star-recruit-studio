import { useEffect, useState } from "react";
import type { ScreenId } from "../data/mockData";
import { useProjectStore } from "../store/projectStore";
import { ScenePreview } from "../components/ScenePreview";
import { PageHead } from "../components/ui";
import {
  PlayIcon,
  StopIcon,
  VolumeIcon,
  ChevronRightIcon,
  ArrowLeftIcon,
} from "../components/icons";

interface PreviewProps {
  onNavigate: (screen: ScreenId) => void;
}

type RangeMode = "scene" | "part" | "all";

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}分${s}秒` : `${s}秒`;
}

export function PreviewScreen({ onNavigate }: PreviewProps) {
  const { status, scenes, templates, generate } = useProjectStore();
  const [range, setRange] = useState<RangeMode>("all");
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    if (status === "idle") void generate();
  }, [status, generate]);

  const safeIdx = Math.min(idx, Math.max(0, scenes.length - 1));
  const current = scenes[safeIdx];
  const template = current ? templates.find((t) => t.templateId === current.templateId) : undefined;
  const totalSec = scenes.reduce((sum, s) => sum + s.durationSec, 0);

  return (
    <div className="main-scroll">
      <PageHead
        title="仕上がり確認"
        desc="動画の仕上がりを確認できます。気になるところは場面編集で直せます。"
      />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: "var(--gap-lg)", alignItems: "start" }}>
        {/* 左: 大きな確認エリア */}
        <div className="card">
          <ScenePreview scene={current} template={template} />

          {/* 場面送り */}
          <div className="row-between mt">
            <button
              className="btn btn-ghost btn-icon"
              onClick={() => setIdx((i) => Math.max(0, i - 1))}
              disabled={safeIdx <= 0}
            >
              <ArrowLeftIcon size={16} />
              前の場面
            </button>
            <span className="text-sm text-muted">
              場面 {scenes.length === 0 ? 0 : safeIdx + 1} / {scenes.length}
            </span>
            <button
              className="btn btn-ghost btn-icon"
              onClick={() => setIdx((i) => Math.min(scenes.length - 1, i + 1))}
              disabled={safeIdx >= scenes.length - 1}
            >
              次の場面
              <ChevronRightIcon size={16} />
            </button>
          </div>

          <div className="preview-controls">
            <button className="btn btn-icon btn-secondary" aria-label="再生">
              <PlayIcon size={20} />
            </button>
            <button className="btn btn-icon btn-secondary" aria-label="停止">
              <StopIcon size={20} />
            </button>
            <button className="btn btn-icon btn-ghost" aria-label="音量">
              <VolumeIcon size={20} />
            </button>
          </div>

          {/* 確認する範囲を選ぶ */}
          <div className="mt-lg">
            <label className="field-label">確認する範囲を選ぶ</label>
            <div className="segment">
              {([
                ["scene", "この場面だけ"],
                ["part", "このパートだけ"],
                ["all", "全体"],
              ] as [RangeMode, string][]).map(([id, label]) => (
                <button key={id} className={range === id ? "active" : ""} onClick={() => setRange(id)}>
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* 右: 動画の概要 */}
        <div className="card">
          <h2 className="section-title">動画の概要</h2>
          <div className="col gap-sm">
            <div className="row-between">
              <span className="text-muted">合計時間</span>
              <strong>{formatDuration(totalSec)}</strong>
            </div>
            <hr className="divider" style={{ margin: "4px 0" }} />
            <div className="row-between">
              <span className="text-muted">場面数</span>
              <strong>{scenes.length}個</strong>
            </div>
            <hr className="divider" style={{ margin: "4px 0" }} />
            <div className="row-between">
              <span className="text-muted">BGM</span>
              <strong>やさしいBGM</strong>
            </div>
            <hr className="divider" style={{ margin: "4px 0" }} />
            <div className="row-between">
              <span className="text-muted">字幕</span>
              <span className="badge badge-teal">あり</span>
            </div>
          </div>

          <div className="col gap-sm mt-lg">
            <button className="btn btn-secondary btn-block" onClick={() => onNavigate("scene-edit")}>
              場面を直す
            </button>
            <button className="btn btn-primary btn-block btn-lg" onClick={() => onNavigate("precheck")}>
              公開前チェックへ進む
              <ChevronRightIcon size={18} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
