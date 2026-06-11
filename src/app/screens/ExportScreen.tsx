import { useState } from "react";
import type { ScreenId } from "../data/mockData";
import { PageHead, Switch } from "../components/ui";
import { ArrowLeftIcon, FilmIcon, FolderIcon } from "../components/icons";

interface ExportProps {
  onNavigate: (screen: ScreenId) => void;
}

export function ExportScreen({ onNavigate }: ExportProps) {
  const [fileName, setFileName] = useState("会社紹介動画_2026春");
  const [size, setSize] = useState("fullhd");
  const [withSubtitle, setWithSubtitle] = useState(true);
  const [withBgm, setWithBgm] = useState(true);
  const [running, setRunning] = useState(false);

  return (
    <div className="main-scroll">
      <PageHead
        title="動画を書き出す"
        desc="設定を確認して、動画をMP4ファイルとして保存します。"
      />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 360px",
          gap: "var(--gap-lg)",
          alignItems: "start",
        }}
      >
        {/* 左: 保存設定 */}
        <div className="card">
          <h2 className="section-title">保存設定</h2>

          <div className="field">
            <label className="field-label">保存先</label>
            <div className="row gap-sm">
              <div className="input row gap-sm" style={{ alignItems: "center" }}>
                <FolderIcon size={16} className="text-faint" />
                <span className="text-sm grow">C:\Users\採用担当\動画</span>
              </div>
              <button className="btn btn-secondary">変更する</button>
            </div>
          </div>

          <div className="field">
            <label className="field-label" htmlFor="fileName">
              ファイル名
            </label>
            <input
              id="fileName"
              className="input"
              value={fileName}
              onChange={(e) => setFileName(e.target.value)}
            />
            <p className="field-hint">保存されるファイル：{fileName}.mp4</p>
          </div>

          <div className="field">
            <label className="field-label" htmlFor="size">
              動画サイズ
            </label>
            <select
              id="size"
              className="select"
              value={size}
              onChange={(e) => setSize(e.target.value)}
            >
              <option value="fullhd">フルHD（1920×1080・きれい）</option>
              <option value="hd">HD（1280×720・軽い）</option>
            </select>
          </div>

          <div className="toggle-row">
            <span className="field-label" style={{ margin: 0 }}>
              字幕を入れる
            </span>
            <Switch on={withSubtitle} onChange={setWithSubtitle} label="字幕を入れる" />
          </div>
          <hr className="divider" />
          <div className="toggle-row">
            <span className="field-label" style={{ margin: 0 }}>
              BGMを入れる
            </span>
            <Switch on={withBgm} onChange={setWithBgm} label="BGMを入れる" />
          </div>

          <div className="notice notice-info mt">
            <span>動画の準備中も、ほかの作業を続けられます。</span>
          </div>

          <div className="row-between mt-lg">
            <button className="btn btn-ghost" onClick={() => onNavigate("preview")}>
              <ArrowLeftIcon size={18} />
              戻る
            </button>
            <button
              className="btn btn-primary btn-lg"
              onClick={() => setRunning(true)}
            >
              <FilmIcon size={20} />
              保存を開始
            </button>
          </div>
        </div>

        {/* 右: 進行状況 */}
        <div className="card">
          <h2 className="section-title">進行状況</h2>

          {running ? (
            <>
              <div className="text-center mb">
                <div className="page-title" style={{ fontSize: 32, color: "var(--color-primary)" }}>
                  25%
                </div>
                <div className="text-muted">動画を準備しています</div>
              </div>
              <div className="progress mb">
                <div className="progress-fill" style={{ width: "25%" }} />
              </div>
              <div className="text-center text-sm text-muted">
                場面 3 / 12 を処理中
              </div>
            </>
          ) : (
            <div className="text-center text-muted" style={{ padding: "var(--gap-lg) 0" }}>
              <FilmIcon size={32} className="text-faint" />
              <p className="mt text-sm">
                「保存を開始」を押すと、ここに進行状況が表示されます。
              </p>
            </div>
          )}

          <hr className="divider" />

          <h3 className="field-label">前回の保存</h3>
          <div className="list-item" style={{ cursor: "default" }}>
            <div className="thumb thumb-video" style={{ width: 72 }}>
              <FilmIcon size={18} />
            </div>
            <div className="grow">
              <div className="text-sm">
                <strong>新卒採用_エンジニア.mp4</strong>
              </div>
              <div className="text-faint text-sm">2026/06/05 に保存</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
