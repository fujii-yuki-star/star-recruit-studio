import { useState } from "react";
import type { ScreenId } from "../data/mockData";
import { PageHead, Seekbar } from "../components/ui";
import {
  PlayIcon,
  StopIcon,
  VolumeIcon,
  FilmIcon,
  ChevronRightIcon,
} from "../components/icons";

interface PreviewProps {
  onNavigate: (screen: ScreenId) => void;
}

type RangeMode = "scene" | "part" | "all";

export function PreviewScreen({ onNavigate }: PreviewProps) {
  const [range, setRange] = useState<RangeMode>("all");

  return (
    <div className="main-scroll">
      <PageHead
        title="仕上がり確認"
        desc="動画の仕上がりを確認できます。気になるところは場面編集で直せます。"
      />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 320px",
          gap: "var(--gap-lg)",
          alignItems: "start",
        }}
      >
        {/* 左: 大きな確認エリア */}
        <div className="card">
          <div className="preview-stage" style={{ borderRadius: "var(--radius)" }}>
            <FilmIcon size={48} />
            <span className="preview-stage-label">仕上がり確認エリア</span>
          </div>

          <div className="preview-controls">
            <button className="btn btn-icon btn-secondary" aria-label="再生">
              <PlayIcon size={20} />
            </button>
            <button className="btn btn-icon btn-secondary" aria-label="停止">
              <StopIcon size={20} />
            </button>
            <Seekbar value={45} />
            <span className="text-sm text-muted">0:40 / 1:30</span>
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
                <button
                  key={id}
                  className={range === id ? "active" : ""}
                  onClick={() => setRange(id)}
                >
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
              <strong>1分30秒</strong>
            </div>
            <hr className="divider" style={{ margin: "4px 0" }} />
            <div className="row-between">
              <span className="text-muted">場面数</span>
              <strong>12個</strong>
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
            <button
              className="btn btn-secondary btn-block"
              onClick={() => onNavigate("scene-edit")}
            >
              場面を直す
            </button>
            <button
              className="btn btn-primary btn-block btn-lg"
              onClick={() => onNavigate("export")}
            >
              動画を書き出す
              <ChevronRightIcon size={18} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
