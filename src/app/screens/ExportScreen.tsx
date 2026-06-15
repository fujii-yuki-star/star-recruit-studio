import { useState } from "react";
import type { ChangeEvent } from "react";
import type { ScreenId } from "../data/mockData";
import { PageHead, Switch } from "../components/ui";
import { ArrowLeftIcon, FilmIcon } from "../components/icons";
import { useProjectStore } from "../store/projectStore";
import { buildExportScenes } from "../../renderer/export/buildExportScenes";
import { findVideoSlot } from "../../renderer/export/findVideoSlot";
import { save } from "@tauri-apps/plugin-dialog";
import { canExport, exportVideo } from "../../infrastructure/ffmpegExport";
import type { BgmInput } from "../../infrastructure/ffmpegExport";
import { BGM_VOLUME, HD_HEIGHT, HD_WIDTH, HEIGHT, NARRATION_VOLUME, VOLUME_MAX, VOLUME_MIN, WIDTH } from "../../domain/constants";
import { resolveBgmVolume, resolveNarrationVolume } from "../../domain/voice/audioMix";

interface ExportProps {
  onNavigate: (screen: ScreenId) => void;
}

type ExportPhase = "idle" | "rendering" | "encoding" | "done" | "error" | "unsupported";

export function ExportScreen({ onNavigate }: ExportProps) {
  const scenes = useProjectStore((s) => s.scenes);
  const templates = useProjectStore((s) => s.templates);
  const assetSrcById = useProjectStore((s) => s.assetSrcById);
  const narrationAudioById = useProjectStore((s) => s.narrationAudioById);
  const voiceSettings = useProjectStore((s) => s.meta.voiceSettings);
  const saveProject = useProjectStore((s) => s.saveProject);
  const saveStatus = useProjectStore((s) => s.saveStatus);
  const assets = useProjectStore((s) => s.assets);
  const bgmSettings = useProjectStore((s) => s.meta.bgmSettings);
  const setBgm = useProjectStore((s) => s.setBgm);
  const updateVoiceSettings = useProjectStore((s) => s.updateVoiceSettings);
  const updateBgmSettings = useProjectStore((s) => s.updateBgmSettings);

  const [fileName, setFileName] = useState("会社紹介動画_2026春");
  const [size, setSize] = useState("fullhd");
  const [withSubtitle, setWithSubtitle] = useState(true);
  // BGM の入/切は bgmSettings.enabled を単一の真実とする（トグルで更新・保存で永続化）。未設定なら入。
  const withBgm = bgmSettings?.enabled ?? true;
  // 出力解像度（フルHD＝キャンバス / HD＝縮小）。書き出し時に PNG をこの解像度で焼く。
  const outputSize =
    size === "hd" ? { width: HD_WIDTH, height: HD_HEIGHT } : { width: WIDTH, height: HEIGHT };

  const [phase, setPhase] = useState<ExportPhase>("idle");
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [resultPath, setResultPath] = useState("");
  const [message, setMessage] = useState("");

  const busy = phase === "rendering" || phase === "encoding";

  // assetId が未設定(null/undefined)なら一致せず undefined（assetId は非空文字）。
  const bgmAsset = assets.find((a) => a.assetId === bgmSettings?.assetId);

  function onPickBgm(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        void setBgm({ name: file.name, dataUrl: reader.result });
      }
    };
    reader.readAsDataURL(file);
  }

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
    // 先に保存先を選んでもらう（キャンセルしたら何もせず元の画面のまま）。
    let outputPath: string;
    try {
      const picked = await save({
        defaultPath: `${fileName.trim() || "export"}.mp4`,
        filters: [{ name: "動画", extensions: ["mp4"] }],
      });
      if (!picked) return; // キャンセル
      outputPath = picked;
    } catch (e) {
      setMessage("保存先を選べませんでした。もう一度お試しください。");
      setPhase("error");
      console.error("[export] save dialog failed:", e);
      return;
    }
    setMessage("");
    setResultPath("");
    setProgress({ done: 0, total: scenes.length });
    setPhase("rendering");
    try {
      // 出力時はプロジェクト（場面・素材）も保存する。
      await saveProject();
      // saveProject 後の projectId（新規時はここで採番済み）。動画クリップのパス解決に使う。
      const pid = useProjectStore.getState().meta.projectId;
      const templateById = new Map(templates.map((t) => [t.templateId, t] as const));
      const built = await buildExportScenes(
        scenes,
        templateById,
        (id) => (id ? assetSrcById[id] : undefined),
        (scene) => ({
          audioBase64: narrationAudioById[scene.sceneId],
          narrationVolume: resolveNarrationVolume(scene.audioMix, voiceSettings),
        }),
        (scene) => {
          const t = templateById.get(scene.templateId);
          return t
            ? findVideoSlot(scene, t, (id) => assets.find((a) => a.assetId === id))
            : undefined;
        },
        (done, total) => setProgress({ done, total }),
        { withSubtitle, outputSize },
      );
      setPhase("encoding");
      let bgm: BgmInput | undefined;
      if (withBgm && bgmSettings?.enabled && bgmAsset && assetSrcById[bgmAsset.assetId]) {
        const fileExt = (bgmAsset.filePath.split(".").pop() || "mp3").toLowerCase();
        bgm = {
          audioBase64: assetSrcById[bgmAsset.assetId],
          volume: resolveBgmVolume(undefined, bgmSettings),
          fadeInSec: bgmSettings.fadeInSec ?? 0,
          fadeOutSec: bgmSettings.fadeOutSec ?? 0,
          fileExt,
        };
      }
      const report = await exportVideo(built, fileName.trim() || "export", bgm, pid || undefined, outputPath);
      setResultPath(report.outputPath);
      setPhase("done");
    } catch (e) {
      // Tauriコマンドの失敗は文字列で reject される（Errorインスタンスではない）。
      // Rust側でユーザー向けに整えた文言（技術詳細は stderr へ記録済み）なので、そのまま表示する。
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
            <p className="field-hint">「動画を出力」を押すと、保存先を選べます（初期のファイル名：{fileName || "export"}.mp4）。</p>
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
          <p className="field-hint">書き出した動画に反映されます（仕上がり確認では常に字幕ありで表示します）。</p>
          <hr className="divider" />
          <div className="toggle-row">
            <span className="field-label" style={{ margin: 0 }}>
              BGMを入れる
            </span>
            <Switch on={withBgm} onChange={(v) => updateBgmSettings({ enabled: v })} label="BGMを入れる" />
          </div>
          {withBgm && (
            <div className="field" style={{ marginTop: 8 }}>
              <input id="bgmFile" type="file" accept="audio/*" hidden onChange={onPickBgm} />
              <div className="row-between">
                <span className="text-sm text-muted">
                  {bgmAsset ? `BGM：${bgmAsset.displayName}` : "BGMファイルが未選択です"}
                </span>
                <label
                  htmlFor="bgmFile"
                  className="btn btn-ghost btn-icon text-sm"
                  style={{ cursor: "pointer" }}
                >
                  {bgmAsset ? "BGMを変更する" : "BGMを選ぶ"}
                </label>
              </div>
            </div>
          )}

          <hr className="divider" />
          <div className="field">
            <label className="field-label" htmlFor="narrationVolume">
              ナレーション音量
            </label>
            <input
              id="narrationVolume"
              type="range"
              min={VOLUME_MIN}
              max={VOLUME_MAX}
              step={0.05}
              value={voiceSettings.volume ?? NARRATION_VOLUME}
              onChange={(e) => updateVoiceSettings({ volume: Number(e.target.value) })}
              style={{ width: "100%", accentColor: "var(--color-primary)" }}
            />
            <div className="row-between text-faint text-sm">
              <span>小さい</span>
              <span>{Math.round((voiceSettings.volume ?? NARRATION_VOLUME) * 100)}%（標準100%）</span>
              <span>大きい</span>
            </div>
          </div>
          {withBgm && bgmAsset && (
            <div className="field">
              <label className="field-label" htmlFor="bgmVolume">
                BGM音量
              </label>
              <input
                id="bgmVolume"
                type="range"
                min={VOLUME_MIN}
                max={VOLUME_MAX}
                step={0.05}
                value={bgmSettings?.volume ?? BGM_VOLUME}
                onChange={(e) => updateBgmSettings({ volume: Number(e.target.value) })}
                style={{ width: "100%", accentColor: "var(--color-primary)" }}
              />
              <div className="row-between text-faint text-sm">
                <span>小さい</span>
                <span>{Math.round((bgmSettings?.volume ?? BGM_VOLUME) * 100)}%（標準25%）</span>
                <span>大きい</span>
              </div>
            </div>
          )}

          <div className="notice notice-info mt">
            <span>声を作成済みの場面には、その音声が入ります。BGMを選ぶと動画全体に流れます。</span>
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
                      ? "保存に失敗（もう一度押す）"
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
