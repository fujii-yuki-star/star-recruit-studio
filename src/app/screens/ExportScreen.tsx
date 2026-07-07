import { useState } from "react";
import type { ScreenId } from "../data/mockData";
import { PageHead, Switch } from "../components/ui";
import { ArrowLeftIcon, FilmIcon } from "../components/icons";
import { isExportBusy, useProjectStore } from "../store/projectStore";
import type { ExportPhase } from "../store/projectStore";
import { buildExportScenes } from "../../renderer/export/buildExportScenes";
import { buildTelopOverlays } from "../../renderer/export/telopOverlays";
import { findVideoSlots } from "../../renderer/export/findVideoSlot";
import { assembleProject } from "../../domain/project/persistence";
import { planBgmMix, resolveBgmExportRuns } from "../../domain/project/bgmExport";
import { showSaveVideoDialog } from "../../infrastructure/dialog";
import { canExport, clearExportFramesStage, exportVideo, readExportFrame, stageClipFrames, stageExportFrame } from "../../infrastructure/ffmpegExport";
import type { BgmRunInput } from "../../infrastructure/ffmpegExport";
import { BGM_CROSSFADE_SEC, NARRATION_VOLUME, VOLUME_MAX, VOLUME_MIN, VOLUME_STEP, exportDimsForOrientation } from "../../domain/constants";
import { resolveNarrationVolume } from "../../domain/voice/audioMix";
import { lineAudioKey } from "../../domain/project/narrationLines";
import { creditForSpeaker } from "../../domain/voice/narratorCredit";
import { readAssetDataUrl } from "../../infrastructure/assetFs";
import { getVoicevoxSpeaker } from "../../infrastructure/appSettings";
import { ASSET_TYPE } from "../../domain/enums";
import { isTemplateAsset } from "../../domain/template/templateAsset";
import { fontFamilyForId, resolveFontId, FONT_CATALOG } from "../../domain/font/fontCatalog";
import { bgmById } from "../../domain/bgm/bgmCatalog";
import { readBundledBgmDataUrl } from "../../infrastructure/bundledBgm";

interface ExportProps {
  onNavigate: (screen: ScreenId) => void;
}

export function ExportScreen({ onNavigate }: ExportProps) {
  const scenes = useProjectStore((s) => s.scenes);
  const templates = useProjectStore((s) => s.templates);
  const narrationAudioById = useProjectStore((s) => s.narrationAudioById);
  const voiceSettings = useProjectStore((s) => s.meta.voiceSettings);
  const saveProject = useProjectStore((s) => s.saveProject);
  const saveStatus = useProjectStore((s) => s.saveStatus);
  const assets = useProjectStore((s) => s.assets);
  const templateAssetSrcById = useProjectStore((s) => s.templateAssetSrcById);
  const bgmSettings = useProjectStore((s) => s.meta.bgmSettings);
  const aspectRatio = useProjectStore((s) => s.meta.videoSettings.aspectRatio);
  const fontId = useProjectStore((s) => s.meta.videoSettings.fontId);
  const projectName = useProjectStore((s) => s.meta.projectName);
  // キーフレームアニメ（④・ADR-0019）：場面ごとの要素アニメーション（timelineOverlay.animations）を書き出しへ渡す。
  const timelineOverlay = useProjectStore((s) => s.meta.timelineOverlay);
  const updateVoiceSettings = useProjectStore((s) => s.updateVoiceSettings);

  const [fileName, setFileName] = useState(projectName.trim() || "動画");
  const [size, setSize] = useState("fullhd");
  const [withSubtitle, setWithSubtitle] = useState(true);
  // BGM の入/切は bgmSettings.enabled を単一の真実とする（トグルで更新・保存で永続化）。未設定なら入。
  const withBgm = bgmSettings?.enabled ?? true;
  // 出力解像度（向き＋画質）。書き出し時に PNG をこの解像度で焼く。向きは videoSettings.aspectRatio から導出（ADR-0012）。
  const fullDims = exportDimsForOrientation(aspectRatio, false);
  const hdDims = exportDimsForOrientation(aspectRatio, true);
  const outputSize = size === "hd" ? hdDims : fullDims;

  // 書き出しの進行状態は store に持つ（#379）。他画面へ遷移して戻っても進捗が見え、書き出し中の
  // 再実行・プロジェクト破壊操作を全画面でブロックできる。ローカル setter は store 更新へ委譲（本体は不変）。
  const exportRun = useProjectStore((s) => s.exportRun);
  const setExportRun = useProjectStore((s) => s.setExportRun);
  const { phase, progress, resultPath, message, bgmWarning } = exportRun;
  const setPhase = (phase: ExportPhase) => setExportRun({ phase });
  const setProgress = (progress: { done: number; total: number }) => setExportRun({ progress });
  const setResultPath = (resultPath: string) => setExportRun({ resultPath });
  const setMessage = (message: string) => setExportRun({ message });
  // 選択済みBGMが読み込めなかったとき、完了画面で知らせる（§2-5・BGMなしで続行）。
  const setBgmWarning = (bgmWarning: "" | "partial" | "all") => setExportRun({ bgmWarning });

  const busy = isExportBusy(phase);

  // assetId が未設定(null/undefined)なら一致せず undefined（assetId は非空文字）。
  const bgmAsset = assets.find((a) => a.assetId === bgmSettings?.assetId);
  // 標準BGM（同梱）が選ばれていれば、それを最優先で使う（assetId より優先）。
  const bundledBgm = bgmById(bgmSettings?.bundledBgmId);

  async function startExport() {
    // 二重書き出しの入口ガード（#379）：ボタンは busy 中 disabled だが、他画面から戻って進捗表示が
    // 消えて見える等での再トリガを store の実状態で弾く（Rust 側にも実行中ガードあり＝多層防御）。
    if (busy) return;
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
      const picked = await showSaveVideoDialog(fileName.trim() || "export");
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
    setBgmWarning("");
    setProgress({ done: 0, total: scenes.length });
    setPhase("rendering");
    try {
      // 出力時はプロジェクト（場面・素材）も保存する。
      await saveProject();
      // saveProject 後の projectId（新規時はここで採番済み）。動画クリップのパス解決に使う。
      const pid = useProjectStore.getState().meta.projectId;
      // 表示用 assetSrcById（asset://）ではなく、書き出し時に各場面の画像をディスクから data URL 化する。
      // buildExportScenes が場面ごとに解決→破棄するので、ここでは id→data URL のリゾルバを渡すだけ（#143・ADR-0004）。
      const assetById = new Map(assets.map((a) => [a.assetId, a] as const));
      const resolveExportSrc = async (id: string): Promise<string | undefined> => {
        // テンプレ既定素材（tmpl_asset_*）は既に data URL（templateAssetSrcById）＝そのまま返す（ADR-0021・書き出しも data URL でプレビューと一致）。
        if (isTemplateAsset(id)) return templateAssetSrcById[id];
        const a = assetById.get(id);
        if (!pid || !a) return undefined;
        // 動画本体（大容量）は clipRelPath 経路で合成（ADR-0006）＝インライン不要。ただし動画スロット本体アニメの
        // 窓フレーム（#442）はプレビュー同様スロットを代表フレーム（サムネ）で焼くため、thumbnailPath を data URL で返す
        //（通常の下/上分割ではスロットは穴として除外されるため描かれない＝既存経路に影響なし）。
        if (a.assetType === ASSET_TYPE.video) {
          return a.thumbnailPath ? ((await readAssetDataUrl(pid, a.thumbnailPath)) ?? undefined) : undefined;
        }
        // 画像のみ本体を data URL 化。
        if (!a.filePath) return undefined;
        return (await readAssetDataUrl(pid, a.filePath)) ?? undefined;
      };
      // アニメ場面のフレームはステージング（逐次ディスク書き出し）に載せる＝巨大な base64 を1回の IPC に
      // まとめず、JSON.stringify の文字列上限超過（RangeError）を避ける（#書き出しRangeError）。前回の残りを掃除。
      await clearExportFramesStage();
      const templateById = new Map(templates.map((t) => [t.templateId, t] as const));
      // 書き出し前に同梱フォントを確実に読み込む（場面ごとに別フォントを使い得るため全フォント。
      // Canvas ラスタライズはロード済みフォントしか使えない・ADR-0004）。
      if (typeof document !== "undefined" && document.fonts) {
        try {
          await Promise.all(
            FONT_CATALOG.flatMap((f) => [
              document.fonts.load(`400 1em "${f.cssFamily}"`),
              document.fonts.load(`700 1em "${f.cssFamily}"`),
            ]),
          );
        } catch { /* 読込失敗時は描画側のフォールバックに任せる */ }
      }
      const built = await buildExportScenes(
        scenes,
        templateById,
        resolveExportSrc,
        (scene, lineId) => ({
          // 掛け合いは行ごとの音声キー（lineAudioKey）、単一 narration は従来の sceneId（ADR-0015 PR-E）。
          audioBase64: narrationAudioById[lineId ? lineAudioKey(scene.sceneId, lineId) : scene.sceneId],
          narrationVolume: resolveNarrationVolume(scene.audioMix, voiceSettings),
        }),
        (scene) => {
          const t = templateById.get(scene.templateId);
          return t
            ? findVideoSlots(scene, t, (id) => assets.find((a) => a.assetId === id))
            : [];
        },
        (done, total) => setProgress({ done, total }),
        { withSubtitle, outputSize, fontFamilyFor: (scene) => fontFamilyForId(resolveFontId(scene.fontId, fontId)), credit: creditForSpeaker(getVoicevoxSpeaker()) },
        // キーフレームアニメ（④・ADR-0019）：現在場面の animations（timelineOverlay・sceneId 一致）。アニメ場面はフレーム列に焼かれる。
        (scene) => (timelineOverlay?.animations ?? []).filter((a) => a.sceneId === scene.sceneId),
        // アニメ場面のフレームを1枚ずつステージングへ（framesBase64 を IPC に載せない・巨大場面の RangeError 回避）。
        (framesDir, frameIndex, dataUrl) => stageExportFrame(framesDir, frameIndex, dataUrl),
        // 動画スロット本体アニメ（#442）：クリップの区間フレームを抽出（pid でプロジェクト解決）。窓は実フレームで焼く＝動きながら再生。
        pid
          ? (dirName, clipRelPath, clipStartSec, durSec, speed, fpsArg, widthArg) =>
              stageClipFrames(pid, clipRelPath, clipStartSec, durSec, speed, fpsArg, widthArg, dirName)
          : undefined,
        (dirName, frameIndex) => readExportFrame(dirName, frameIndex),
      );
      // タイムラインのテロップ（ADR-0018 テロップ実描画）。帯PNG＋グローバル区間へ焼き、Rust が結合後に overlay 合成。
      // テロップは場面横断のため動画全体フォントで焼く。
      const st = useProjectStore.getState();
      const proj = assembleProject(st.meta, st.assets, st.parts, st.scenes);
      const telops = await buildTelopOverlays(proj, {
        outputSize,
        fontFamily: fontFamilyForId(fontId),
        fontId: resolveFontId(null, fontId),
      });
      setPhase("encoding");
      // 場面ごとBGM（ADR-0018 ③(7)）：区間を解決→配置＋クロスフェード計画→各区間のソースを data URL 化して Rust へ。
      // 表示用 src ではなく実体を data URL 化する（asset:// は FFmpeg へ渡せない）。同梱は public/bgm、自分のBGM はプロジェクトから。
      const mixClips = planBgmMix(resolveBgmExportRuns(proj), BGM_CROSSFADE_SEC);
      const bgmRuns: BgmRunInput[] = [];
      let bgmLoadFailed = false; // 1区間でも読込失敗したか（一部失敗と全失敗を完了時に出し分ける）。
      for (const clip of mixClips) {
        let audioBase64: string | undefined;
        let fileExt = "mp3";
        if (clip.bundledBgmId) {
          audioBase64 = await readBundledBgmDataUrl(clip.bundledBgmId);
          fileExt = bgmById(clip.bundledBgmId)?.fileName.split(".").pop()?.toLowerCase() || "mp3";
        } else if (clip.assetId && pid) {
          const a = st.assets.find((x) => x.assetId === clip.assetId);
          if (a) {
            audioBase64 = (await readAssetDataUrl(pid, a.filePath)) ?? undefined;
            fileExt = (a.filePath.split(".").pop() || "mp3").toLowerCase();
          }
        }
        if (audioBase64) {
          bgmRuns.push({ audioBase64, fileExt, volume: clip.volume, delaySec: clip.delaySec, playSec: clip.playSec, fadeInSec: clip.fadeInSec, fadeOutSec: clip.fadeOutSec });
        } else {
          // 選択済みだが読み込めなかった（同梱欠損・読込失敗）。その区間は無音で続行し、完了時に知らせる（§2-5）。
          bgmLoadFailed = true;
        }
      }
      // 一部の区間だけ失敗（他は鳴る）と、全区間失敗（＝BGMなし）を区別して案内する（§2-5）。
      if (bgmLoadFailed) setBgmWarning(bgmRuns.length > 0 ? "partial" : "all");
      const report = await exportVideo(built, fileName.trim() || "export", bgmRuns, pid || undefined, outputPath, telops);
      setResultPath(report.outputPath);
      setPhase("done");
    } catch (e) {
      // Tauriコマンドの失敗は文字列で reject される（Errorインスタンスではない）。
      // Rust側でユーザー向けに整えた文言（技術詳細は stderr へ記録済み）なので、そのまま表示する。
      const detail = e instanceof Error ? e.message : typeof e === "string" ? e : "";
      setMessage(detail || "動画の保存に失敗しました。もう一度お試しください。");
      setPhase("error");
      console.error("[export] failed:", e);
    } finally {
      // ステージングしたアニメフレームを掃除（成功/失敗いずれも）＝次回書き出しに残さない（#書き出しRangeError）。
      await clearExportFramesStage().catch(() => {});
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
            <p className="field-hint">「動画を保存」を押すと、保存先を選べます（初期のファイル名：{fileName || "export"}.mp4）。</p>
          </div>

          <div className="field">
            <label className="field-label" htmlFor="size">
              動画サイズ
            </label>
            <select id="size" className="select" value={size} onChange={(e) => setSize(e.target.value)}>
              <option value="fullhd">きれい（{fullDims.width}×{fullDims.height}）</option>
              <option value="hd">軽い（{hdDims.width}×{hdDims.height}）</option>
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
              BGM
            </span>
            <span className="text-sm">
              {withBgm ? bundledBgm?.label ?? bgmAsset?.displayName ?? "未選択" : "なし"}
            </span>
          </div>
          <p className="field-hint">BGM は「仕上がり確認」で選べます。</p>

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
              step={VOLUME_STEP}
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
          <div className="notice notice-info mt">
            <span>声を作成済みの場面には、その音声が入ります。BGM は「仕上がり確認」で選べます。</span>
          </div>

          <div className="row-between mt-lg">
            <button className="btn btn-ghost" onClick={() => onNavigate("precheck")} disabled={busy}>
              <ArrowLeftIcon size={18} />
              公開前チェックへ戻る
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
                {busy ? "書き出し中…" : "動画を保存"}
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
              <p className="mt text-sm">「動画を保存」を押すと、ここに進行状況が表示されます。</p>
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
              {phase === "done" && bgmWarning && (
                <div className="notice notice-warn mt">
                  <span>
                    {bgmWarning === "partial"
                      ? "一部の場面のBGMを読み込めなかったため、その場面は音楽なしで保存しました。仕上がり確認でBGMを選び直すと改善する場合があります。"
                      : "BGMを読み込めなかったため、BGMなしで保存しました。仕上がり確認でBGMを選び直すと改善する場合があります。"}
                  </span>
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
