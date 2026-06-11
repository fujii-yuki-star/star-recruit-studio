import { useState } from "react";
import type { ScreenId } from "../data/mockData";
import { materials, draftRows, lookPatterns } from "../data/mockData";
import { Switch, Seekbar } from "../components/ui";
import {
  SearchIcon,
  PhotoIcon,
  VideoIcon,
  MusicIcon,
  UploadIcon,
  PlayIcon,
  StopIcon,
  PlusIcon,
  SaveIcon,
  ChevronRightIcon,
} from "../components/icons";

interface SceneEditProps {
  onNavigate: (screen: ScreenId) => void;
}

type MaterialFilter = "all" | "photo" | "video" | "audio";

export function SceneEditScreen({ onNavigate }: SceneEditProps) {
  const [filter, setFilter] = useState<MaterialFilter>("all");
  const [search, setSearch] = useState("");
  const [selectedScene, setSelectedScene] = useState(draftRows[0].id);
  const [showYuko, setShowYuko] = useState(true);
  const [sceneName, setSceneName] = useState(draftRows[0].scene);
  const [line, setLine] = useState(draftRows[0].line);
  const [look, setLook] = useState(draftRows[0].look);
  const [subtitle, setSubtitle] = useState(draftRows[0].line);
  const [duration, setDuration] = useState("5");

  const filtered = materials.filter((m) => {
    const matchType = filter === "all" || m.type === filter;
    const matchSearch = m.name.includes(search);
    return matchType && matchSearch;
  });

  function pickScene(id: string) {
    const s = draftRows.find((r) => r.id === id);
    if (!s) return;
    setSelectedScene(id);
    setSceneName(s.scene);
    setLine(s.line);
    setLook(s.look);
    setSubtitle(s.line);
  }

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* ヘッダー帯 */}
      <div className="topbar" style={{ borderBottom: "1px solid var(--color-border)" }}>
        <div className="topbar-title">場面編集</div>
        <div className="topbar-actions">
          <button className="btn btn-secondary" onClick={() => onNavigate("draft")}>
            台本表に戻る
          </button>
          <button className="btn btn-primary" onClick={() => onNavigate("preview")}>
            仕上がり確認へ
            <ChevronRightIcon size={18} />
          </button>
        </div>
      </div>

      <div style={{ flex: 1, padding: "var(--gap)", overflow: "hidden" }}>
        <div className="editor-grid">
          {/* 左: 素材一覧 */}
          <div className="editor-col">
            <h2 className="field-label">素材一覧</h2>
            <div
              className="row gap-sm"
              style={{
                border: "1px solid var(--color-border-strong)",
                borderRadius: "var(--radius-sm)",
                padding: "6px 10px",
                marginBottom: 10,
              }}
            >
              <SearchIcon size={16} className="text-faint" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="素材を検索"
                style={{
                  border: "none",
                  outline: "none",
                  width: "100%",
                  fontSize: 13,
                  background: "transparent",
                }}
              />
            </div>

            <div className="segment mb" style={{ display: "flex" }}>
              {([
                ["all", "すべて"],
                ["photo", "写真"],
                ["video", "動画"],
                ["audio", "音"],
              ] as [MaterialFilter, string][]).map(([id, label]) => (
                <button
                  key={id}
                  className={filter === id ? "active" : ""}
                  onClick={() => setFilter(id)}
                  style={{ flex: 1, padding: "7px 4px" }}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="col" style={{ gap: 2 }}>
              {filtered.map((m) => (
                <div className="asset-tile" key={m.id}>
                  <div
                    className={`asset-tile-thumb thumb ${
                      m.type === "photo"
                        ? "thumb-photo"
                        : m.type === "video"
                          ? "thumb-video"
                          : "thumb-audio"
                    }`}
                    style={{ aspectRatio: "auto" }}
                  >
                    {m.type === "photo" && <PhotoIcon size={16} />}
                    {m.type === "video" && <VideoIcon size={16} />}
                    {m.type === "audio" && <MusicIcon size={16} />}
                  </div>
                  <span className="text-sm">{m.name}</span>
                </div>
              ))}
            </div>

            <button className="btn btn-secondary btn-block mt">
              <UploadIcon size={16} />
              素材をアップロード
            </button>
          </div>

          {/* 中央: 仕上がり確認 + 場面カード */}
          <div className="col gap" style={{ overflow: "hidden" }}>
            <div className="editor-col grow" style={{ overflow: "auto" }}>
              <h2 className="field-label">仕上がり確認</h2>
              <div className="preview-stage">
                <PlayIcon size={40} />
                <span className="preview-stage-label">
                  選択中の場面「{sceneName}」の仕上がり確認
                </span>
              </div>
              <div className="preview-controls">
                <button className="btn btn-icon btn-secondary" aria-label="再生">
                  <PlayIcon size={18} />
                </button>
                <button className="btn btn-icon btn-secondary" aria-label="停止">
                  <StopIcon size={18} />
                </button>
                <Seekbar value={30} />
                <span className="text-sm text-muted">0:02 / 0:05</span>
              </div>
            </div>

            {/* 下: 場面カード一覧 */}
            <div className="editor-col" style={{ flexShrink: 0 }}>
              <div className="row-between mb">
                <h2 className="field-label" style={{ margin: 0 }}>
                  場面の並び
                </h2>
                <button className="btn btn-ghost btn-icon">
                  <PlusIcon size={16} />
                  場面を追加
                </button>
              </div>
              <div className="scene-strip">
                {draftRows.map((s) => (
                  <button
                    key={s.id}
                    className={`scene-card${selectedScene === s.id ? " selected" : ""}`}
                    onClick={() => pickScene(s.id)}
                  >
                    <div
                      className={`scene-card-thumb thumb ${
                        s.materialType === "video" ? "thumb-video" : "thumb-photo"
                      }`}
                    >
                      {s.materialType === "video" ? (
                        <VideoIcon size={18} />
                      ) : (
                        <PhotoIcon size={18} />
                      )}
                    </div>
                    <div className="text-sm">
                      <strong>
                        {s.order}. {s.scene}
                      </strong>
                    </div>
                    <div className="text-faint" style={{ fontSize: 11 }}>
                      {s.look}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* 右: 選択中の場面を編集 */}
          <div className="editor-col">
            <h2 className="field-label">選択中の場面を編集</h2>

            <div className="field">
              <label className="field-label" htmlFor="sceneName">
                場面名
              </label>
              <input
                id="sceneName"
                className="input"
                value={sceneName}
                onChange={(e) => setSceneName(e.target.value)}
              />
            </div>

            <div className="field">
              <label className="field-label" htmlFor="look">
                見た目パターン
              </label>
              <select
                id="look"
                className="select"
                value={look}
                onChange={(e) => setLook(e.target.value)}
              >
                {lookPatterns.map((l) => (
                  <option key={l.id} value={l.name}>
                    {l.name}
                  </option>
                ))}
                <option value="映像＋字幕">映像＋字幕</option>
                <option value="エンディング">エンディング</option>
              </select>
            </div>

            <div className="field">
              <label className="field-label">使用素材</label>
              <div className="list-item" style={{ cursor: "default", padding: 10 }}>
                <div
                  className="asset-tile-thumb thumb thumb-photo"
                  style={{ aspectRatio: "auto" }}
                >
                  <PhotoIcon size={16} />
                </div>
                <span className="text-sm grow">会社外観</span>
                <button className="btn btn-ghost btn-icon text-sm">変更</button>
              </div>
            </div>

            <div className="field">
              <label className="field-label" htmlFor="line">
                ゆうこのセリフ
              </label>
              <textarea
                id="line"
                className="textarea"
                value={line}
                onChange={(e) => setLine(e.target.value)}
              />
            </div>

            <div className="field">
              <label className="field-label" htmlFor="subtitle">
                字幕
              </label>
              <textarea
                id="subtitle"
                className="textarea"
                value={subtitle}
                onChange={(e) => setSubtitle(e.target.value)}
                style={{ minHeight: 60 }}
              />
            </div>

            <div className="field">
              <label className="field-label" htmlFor="duration">
                表示時間（秒）
              </label>
              <input
                id="duration"
                className="input"
                type="number"
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
              />
            </div>

            <div className="toggle-row">
              <span className="field-label" style={{ margin: 0 }}>
                ゆうこを表示する
              </span>
              <Switch on={showYuko} onChange={setShowYuko} label="ゆうこを表示する" />
            </div>

            <button className="btn btn-primary btn-block mt">
              <SaveIcon size={18} />
              ここまで保存
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
