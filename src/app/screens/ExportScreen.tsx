import { useState } from "react";
import type { ScreenId } from "../data/mockData";
import { PageHead, Switch } from "../components/ui";
import { ArrowLeftIcon, FilmIcon } from "../components/icons";
import { useProjectStore } from "../store/projectStore";
import { buildExportScenes } from "../../renderer/export/buildExportScenes";
import { canExport, exportVideo } from "../../infrastructure/ffmpegExport";

interface ExportProps {
  onNavigate: (screen: ScreenId) => void;
}

type ExportPhase = "idle" | "rendering" | "encoding" | "done" | "error" | "unsupported";

export function ExportScreen({ onNavigate }: ExportProps) {
  const scenes = useProjectStore((s) => s.scenes);
  const templates = useProjectStore((s) => s.templates);
  const assetSrcById = useProjectStore((s) => s.assetSrcById);
  const saveProject = useProjectStore((s) => s.saveProject);
  const saveStatus = useProjectStore((s) => s.saveStatus);

  const [fileName, setFileName] = useState("会社紹介動画_2026春");
  const [size, setSize] = useState("fullhd");
  const [withSubtitle, setWithSubtitle] = useState(true);
  const [withBgm, setWithBgm] = useState(true);

  const [phase, setPhase] = useState<ExportPhase>("idle");
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [resultPath, setResultPath] = useState("");
  const [message, setMessage] = useState("");

  const busy = phase === "rendering" || phase === "encoding";

  async function startExport() {
    if (!canExport()) {
      setPhase("unsupported");
      return;
    }
    if (scenes.length === 0) {
      setMessage("書き出す場面がありません。先に「新しい動画を作る」で動画案を作成してください。");
      setPhase("error");
      return;
    }
    setMessage("");
    setResultPath("");
    setProgress({ done: 0, total: scenes.length });
    setPhase("rendering");
    try {
      // 出力時はプロジェクト（場面・素材）も保存する。
      await saveProject();
      const templateById = new Map(templates.map((t) => [t.templateId, t] as const));
      const built = await buildExportScenes(
        scenes,
        templateById,
        (id) => (id ? assetSrcById[id] : undefined),
        (done, total) => setProgress({ done, total }),
      );
      setPhase("encoding");
      const report = await exportVideo(built, fileName.trim() || "export");
      setResultPath(report.outputPath);
      setPhase("done");
    } catch (e) {
      // Tauriコマンドの失敗は文字列で reject される（Errorインスタンスではない）。原因をそのまま表示する。
      const detail = e instanceof Error ? e.message : typeof e === "string" ? e : "";
      setMessage(detail || "動画の保存に失敗しました。もう一度お試しください。");
      setPhase("error");
      console.error("[export] failed:", e);
    }
  }

  const percent =
    phase === "done"
      ? 100
      : phase === "encoding"
        ? 90
        : phase === "rendering" && progress.total > 0
          ? Math.round((progress.done / progress.total) * 80)
          : 0;

  return (
    <div className="main-scroll">
      <PageHead title="動画を書き出す" desc="設定を確認して、動画をMP4ファイルとして保存します。" />

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
            <label className="field-label" htmlFor="fileName">
              ファイル名
            </label>
            <input
              id="fileName"
              className="input"
              value={fileName}
              onChange={(e) => setFileName(e.target.value)}
            />
            <p className="field-hint">保存されるファイル：{fileName || "export"}.mp4</p>
          </div>

          <div className="field">
            <label className="field-label" htmlFor="size">
              動画サイズ
            </label>
            <select id="size" className="select" value={size} onChange={(e) => setSize(e.target.value)}>
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
            <span>今回は映像（写真・文字・ゆうこ）を書き出します。声やBGMの組み込みは準備中です。</span>
          </div>

          <div className="row-between mt-lg">
            <button className="btn btn-ghost" onClick={() => onNavigate("preview")} disabled={busy}>
              <ArrowLeftIcon size={18} />
              戻る
            </button>
            <div className="row gap-sm">
              <button
                className="btn btn-secondary"
                onClick={() => void saveProject()}
                disabled={busy || saveStatus === "saving"}
              >
                {saveStatus === "saving"
                  ? "保存中…"
                  : saveStatus === "saved"
                    ? "保存しました"
                    : saveStatus === "error"
                      ? "保存に失敗"
                      : "プロジェクトを保存"}
              </button>
              <button className="btn btn-primary btn-lg" onClick={() => void startExport()} disabled={busy}>
                <FilmIcon size={20} />
                {busy ? "書き出し中…" : "動画を出力"}
              </button>
            </div>
          </div>
        </div>

        {/* 右: 進行状況 */}
        <div className="card">
          <h2 className="section-title">進行状況</h2>

          {phase === "idle" && (
            <div className="text-center text-muted" style={{ padding: "var(--gap-lg) 0" }}>
              <FilmIcon size={32} className="text-faint" />
              <p className="mt text-sm">「動画を出力」を押すと、ここに進行状況が表示されます。</p>
            </div>
          )}

          {(busy || phase === "done") && (
            <>
              <div className="text-center mb">
                <div className="page-title" style={{ fontSize: 32, color: "var(--color-primary)" }}>
                  {percent}%
                </div>
                <div className="text-muted">
                  {phase === "done" ? "保存しました" : phase === "encoding" ? "動画にまとめています" : "動画を準備しています"}
                </div>
              </div>
              <div className="progress mb">
                <div className="progress-fill" style={{ width: `${percent}%` }} />
              </div>
              {phase === "rendering" && (
                <div className="text-center text-sm text-muted">
                  場面 {progress.done} / {progress.total} を処理中
                </div>
              )}
              {phase === "done" && resultPath && (
                <div className="notice notice-info mt">
                  <span>保存先：{resultPath}</span>
                </div>
              )}
            </>
          )}

          {phase === "error" && (
            <div className="notice notice-warn" role="alert">
              <span>{message}</span>
            </div>
          )}

          {phase === "unsupported" && (
            <div className="notice notice-info">
              <span>動画の書き出しは、デスクトップアプリでご利用いただけます。</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
