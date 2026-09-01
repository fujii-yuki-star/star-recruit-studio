import { useEffect, useMemo, useRef, useState } from "react";
import { exportFailedMessage, EXPORT_BLOCKED_IMPORTING_MESSAGE, VOICE_BUSY_EXPORT_MESSAGE, DUCK_MERGED_MESSAGE } from "../uiLabels";
import type { ScreenId } from "../data/mockData";
import { PageHead, Switch } from "../components/ui";
import { NoScenesState } from "../components/NoScenesState";
import { CreditDisplayField } from "../components/CreditDisplayField";
import { ArrowLeftIcon, FilmIcon } from "../components/icons";
import { NarrationVolumeControl } from "../components/NarrationVolumeControl";
import { isExportBusy, useProjectStore } from "../store/projectStore";
import { exportBlockedMessage, exportBlockingItems } from "../adapters";
import { useExportCapability } from "../hooks/useExportCapability";
import { EXPORT_CAPABILITY_NOTICE, blocksExport } from "../../domain/export/exportCapability";
import type { ExportPhase } from "../store/projectStore";
import { buildExportScenes, ExportCancelledError } from "../../renderer/export/buildExportScenes";
import { findVideoSlots } from "../../renderer/export/findVideoSlot";
import { assembleProject } from "../../domain/project/persistence";
import { applyDuckingToMix, planBgmMix, resolveBgmExportRuns, resolveSpeechSpans } from "../../domain/project/bgmExport";
import { wavDurationSec } from "../../domain/voice/wavDuration";
import { resolveAudioAuto } from "../../domain/voice/audioAuto";
import { AudioAutoField } from "../components/AudioAutoField";
import { showSaveVideoDialog } from "../../infrastructure/dialog";
import { beginExport, canExport, cancelExport, clearExportFramesStage, exportVideo, listenExportProgress, readExportFrame, stageClipFrames, stageExportFrame } from "../../infrastructure/ffmpegExport";
import { exportHeadingLabel, exportOverallPercent, exportProgressLabel, isExportFinished, pastExportNotice } from "../../domain/export/exportProgress";
import type { BgmRunInput } from "../../infrastructure/ffmpegExport";
import { BGM_CROSSFADE_SEC, exportDimsForOrientation } from "../../domain/constants";
import { hasSceneNarrationOverride, resolveNarrationVolume } from "../../domain/voice/audioMix";
import { isNarrationGenerating } from "../../domain/voice/narrationProgress";
import { narrationAudioKey } from "../../domain/project/narrationLines";
import { creditForSpeaker } from "../../domain/voice/narratorCredit";
import { readAssetDataUrl } from "../../infrastructure/assetFs";
import { createExportSrcResolver } from "../store/assetExportSrc";
import { openSavedFile, revealSavedFile } from "../../infrastructure/opener";
import { getVoicevoxSpeaker } from "../../infrastructure/appSettings";
import { fontFamilyForId, resolveFontId } from "../../domain/font/fontCatalog";
import { loadExportFonts } from "../../renderer/export/loadExportFonts";
import { EXPORT_CLEANUP_PENDING_MESSAGE, OTHER_EXPORT_RUNNING_MESSAGE, exportLockBlockedMessage, useExportLockStore } from "../store/exportLock";
import { bgmById } from "../../domain/bgm/bgmCatalog";
import { readBundledBgmDataUrl } from "../../infrastructure/bundledBgm";

// 画面タイトルは1か所（空状態と通常の両分岐で共有＝片方だけ直して drift しない・§6）。
const EXPORT_TITLE = "動画を書き出す";
// 説明は**設定フォームを出す分岐だけ**に付ける。場面ゼロの空状態で「設定を確認して」と促すと、
// 直下の空状態と次の行動が食い違う（§2-5）。空状態の次の行動は NoScenesState が状態に応じて示す。
const EXPORT_DESC = "設定を確認して、動画をMP4ファイルとして保存します。";

interface ExportProps {
  onNavigate: (screen: ScreenId) => void;
}

export function ExportScreen({ onNavigate }: ExportProps) {
  const scenes = useProjectStore((s) => s.scenes);
  const voiceSettings = useProjectStore((s) => s.meta.voiceSettings);
  const saveProject = useProjectStore((s) => s.saveProject);
  const setPreviewReturnTo = useProjectStore((s) => s.setPreviewReturnTo);
  const assets = useProjectStore((s) => s.assets);
  const templates = useProjectStore((s) => s.templates);
  const overlayAnimations = useProjectStore((s) => s.meta.timelineOverlay?.animations);
  const bgmSettings = useProjectStore((s) => s.meta.bgmSettings);
  const aspectRatio = useProjectStore((s) => s.meta.videoSettings.aspectRatio);
  const projectName = useProjectStore((s) => s.meta.projectName);
  // 書き出しの入力（場面・素材・見た目・音声・フォント・アニメ）は startExport 冒頭で store から1回スナップショットする（#381）。
  // ＝書き出し中の編集で映像/テロップ/BGM が食い違わない。ここで個別購読しないことで、それらの変更での不要な再描画も避ける。
  const updateVoiceSettings = useProjectStore((s) => s.updateVoiceSettings);

  // 書き出し入力は store で保持（#410 sub3 レビュー）＝仕上がり確認（BGM選び）への往復で再マウントされても失わない。
  // fileName 未設定（null）はプロジェクト名から既定を出す（名前変更に追従。編集すると固定される）。
  const exportForm = useProjectStore((s) => s.exportForm);
  const setExportForm = useProjectStore((s) => s.setExportForm);
  const fileName = exportForm.fileName ?? (projectName.trim() || "動画");
  const size = exportForm.size;
  const withSubtitle = exportForm.withSubtitle;
  // 完了後の導線に失敗したとき、押した操作に応じた文言を出す（§2-5・#404）。""＝正常／"reveal"＝保存先を開く失敗／"open"＝再生失敗。
  const [openError, setOpenError] = useState<"" | "reveal" | "open">("");
  // BGM の入/切は bgmSettings.enabled を単一の真実とする（トグルで更新・保存で永続化）。未設定なら入。
  const withBgm = bgmSettings?.enabled ?? true;
  // 出力解像度（向き＋画質）。書き出し時に PNG をこの解像度で焼く。向きは videoSettings.aspectRatio から導出（ADR-0012）。
  const fullDims = exportDimsForOrientation(aspectRatio, false);
  const hdDims = exportDimsForOrientation(aspectRatio, true);
  const outputSize = size === "hd" ? hdDims : fullDims;

  // 書き出しの進行状態は store に持つ（#379）。他画面へ遷移して戻っても進捗が見え、書き出し中の
  // 再実行・プロジェクト破壊操作を全画面でブロックできる。ローカル setter は store 更新へ委譲（本体は不変）。
  // 持ち込みフォント（#261）＝**開くたびに調べ直す**（アプリの外で消されうる・公開前チェックと同じ流儀）。
  const userFontIds = useProjectStore((s) => s.userFontIds);
  // ⚠️ **「読めなかった」は「まだ調べていない」とは別**（🟡19 のレビュー）＝待っても埋まらないので、
  // 黙って別の字体で書き出さないよう、公開前チェックが**そう言って**止める。
  const userFontsUnreadable = useProjectStore((s) => s.userFontsUnreadable);
  const refreshUserFonts = useProjectStore((s) => s.refreshUserFonts);
  useEffect(() => { void refreshUserFonts(); }, [refreshUserFonts]);
  const projectFontId = useProjectStore((s) => s.meta.videoSettings.fontId);
  const fontsForBlocking = useMemo(
    // ⚠️ `userFontIds` が `null`（まだ調べていない）なら渡さない＝嘘の「問題なし」を出さない（#347 と同じ流儀）。
    // ⚠️ **読めなかったときは一覧を渡さない**（差分再監査）＝古い一覧が残っていると
    // 「調べられません」と「N つ見つかりません」が同時に出る（矛盾する2つの断り）。
    () => ({ projectFontId, userFontsUnreadable, ...(userFontIds && !userFontsUnreadable ? { availableUserFontIds: userFontIds } : {}) }),
    [projectFontId, userFontIds, userFontsUnreadable],
  );
  // 書き出しが必ず失敗する項目（#547 P2-5）。公開前チェックの主ボタンと同じ述語を共有する。
  // useMemo：書き出し中は進捗更新のたびに再描画されるので、毎回 全場面のレイアウト計算をやり直さない（#376 の待ち時間に効く）。
  // ⚠️ **フォントの材料もここへ通す**（#261・PR #886 レビュー 🔴）＝通さないと、サイドバーから
  // この画面へ直行したときに「見つからない文字の形」が**項目そのものとして作られず**、
  // 別の字体に化けた動画がそのまま書き出せてしまう（§2-5・ADR-0026②）。
  const blockingItems = useMemo(
    () => exportBlockingItems(scenes, assets, templates, overlayAnimations, fontsForBlocking),
    [scenes, assets, templates, overlayAnimations, fontsForBlocking],
  );
  const blockedMessage = blockingItems.length > 0 ? exportBlockedMessage(blockingItems, "export") : null;
  // この端末で書き出せない（h264 不可）ときも公開前チェックと同じく止める＝直行経路だけ押せてしまうのを防ぐ（ADR-0026②）。
  const capability = useExportCapability();
  const capabilityBlocked = capability != null && blocksExport(capability);
  const exportRun = useProjectStore((s) => s.exportRun);
  const setExportRun = useProjectStore((s) => s.setExportRun);
  const { phase, progress, encode, resultPath, message, bgmWarning, duckMerged, cancelling } = exportRun;
  // この画面に**入った時点で既に終わっていた**結果を見ているか（#547 P3-11）。実行状態は画面横断で保持する
  //（#379＝書き出し中に他画面へ移っても進捗が見える）ため、離れて戻ると前回の「保存しました（100%）」
  //「失敗しました」が**いま起きたこと**のように残り続ける。マウント時の phase を初期値にし、以後は
  // `setPhase`（この画面で結果が変わる唯一の入口）で下ろす＝この訪問で起きた結果を「前回の…」と言わない。
  const [enteredFinished, setEnteredFinished] = useState(() => isExportFinished(phase));
  const setPhase = (phase: ExportPhase) => {
    setEnteredFinished(false); // 何かが起きた＝ここから先の表示はこの訪問の結果（保存先の選択を取り消した等、phase が動かない経路では下ろさない）
    setExportRun({ phase });
  };
  const setProgress = (progress: { done: number; total: number; frameFraction?: number }) => setExportRun({ progress });
  const setResultPath = (resultPath: string) => setExportRun({ resultPath });
  const setMessage = (message: string) => setExportRun({ message });
  // 選択済みBGMが読み込めなかったとき、完了画面で知らせる（§2-5・BGMなしで続行）。
  const setBgmWarning = (bgmWarning: "" | "partial" | "all") => setExportRun({ bgmWarning });
  const setDuckMergedNotice = (duckMerged: boolean) => setExportRun({ duckMerged });

  // 書き出しの持ち主（`exportLock`）。タイムライン形式と一時ファイルの置き場を取り合わないために使う。
  const EXPORT_OWNER = "scene" as const;

  const busy = isExportBusy(phase);
  /**
   * **名乗ってから走行中の表示になるまでの間**（#843 レビュー 🟡）。
   *
   * ⚠️ これが無いと、**書き出しを正当に始めた直後に「後片づけ中」と誤表示**する＝この画面は
   * 名乗り（`acquire`）の**後**に `beginExport()` の往復を挟んでから `rendering` にするので、
   * その間は「締めは自分・走行中ではない」＝`isOwnCleanupPending` の条件をそのまま満たしてしまう
   *（タイムライン形式は名乗る**前**に `preparing` を立てるので起きない＝非対称だった）。
   * 走行中の語彙（`isExportBusy`）は画面横断で編集の可否も決めるので広げず、**この画面の中だけ**で持つ。
   */
  const [starting, setStarting] = useState(false);
  /** 押した瞬間に**いまの値**で見るための控え（描画時のクロージャでは1回ぶん古い）。 */
  const startingRef = useRef(false);
  const markStarting = (on: boolean): void => { startingRef.current = on; setStarting(on); };
  // ⚠️ **直前の回の後片づけ待ちも押させない**（#843）＝終わりの合図は片づけより先に立つので、この窓では
  // ボタンが戻っているのに `acquire` が失敗する（＝押しても断られるだけ・`06 §12.1`）。
  // 押す前に無効化して出す理由と、押したときに断る理由は**同じ述語**から採る（`isOwnCleanupPending`）。
  // ⚠️ **締めが理由で始められないときは押させない**（#843 レビュー 🟡）＝以前は「相手が走っている」も
  // 「自分の後片づけ待ち」も**押した後**でしか見ておらず、**押せるボタンを押すと断られるだけ**だった。
  // どちらも到達する（相手の書き出しが終わると走行中の判定が落ちるので、その直後にこの画面へ来ると
  // 締めだけが残っている）。押す前の表示と押した瞬間の判定は**同じ述語**から採る（`06 §12.1`）。
  const lockBlockedMessage = exportLockBlockedMessage(useExportLockStore((st) => st.owner), EXPORT_OWNER, busy || starting);
  // 「前回の結果」表示中か＝入った時点で終わっていて、かついま見えているのも終わった結果（走行中・未実行には出さない）。
  const showsPastResult = enteredFinished && isExportFinished(phase);
  // この画面には結果そのものが出ているので、他画面向けの終了通知（#589）は**既読**にする。
  // ここで落とさないと、書き出し画面で結果を見たあとに他画面へ移ってまた通知が出る＝#547 P3-11 の「古い通知が残る」の再発。
  const resultUnseen = useProjectStore((s) => s.exportRun.resultUnseen);
  useEffect(() => {
    if (resultUnseen) setExportRun({ resultUnseen: false });
  }, [resultUnseen, setExportRun]);
  // 全体の音量スライダーが効かない場面（個別の声量あり）が1つでもあるか（#547 P3-13）。あれば案内を添える
  // ＝仕上がり確認（いまの場面）と同じ意味の注意を、書き出し（全場面のいずれか）でも出す（ADR-0026②）。判定は §6 の共有述語。
  const someSceneHasVolumeOverride = scenes.some((s) => hasSceneNarrationOverride(s.audioMix));

  // assetId が未設定(null/undefined)なら一致せず undefined（assetId は非空文字）。
  const bgmAsset = assets.find((a) => a.assetId === bgmSettings?.assetId);
  // 標準BGM（同梱）が選ばれていれば、それを最優先で使う（assetId より優先）。
  const bundledBgm = bgmById(bgmSettings?.bundledBgmId);

  async function startExport() {
    // 二重書き出しの入口ガード（#379）：ボタンは busy 中 disabled だが、他画面から戻って進捗表示が
    // 消えて見える等での再トリガを store の実状態で弾く（Rust 側にも実行中ガードあり＝多層防御）。
    // ⚠️ **いまの値で見る**（差分再監査 ℹ️）＝描画時のクロージャだと、`beginExport` の往復中
    // （走行中の表示になる前）に押し直された回を素通りし、**始まっている回の表示を潰す**。
    if (busy || startingRef.current) return;
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
    setDuckMergedNotice(false);
    setOpenError(""); // 前回の「開けなかった/再生できなかった」表示を持ち越さない（新しい書き出しの成功に残らないように・#404 P2）
    setExportRun({ cancelling: false }); // 前回の中止要求を持ち越さない（#380）
    // 取り込み・生成中は書き出しを始めない（#570 P1・相互排他＝§2-5/ADR-0026④）。進行中の素材取り込みは同一パス上書きで
    // 「壊れたMP4」に、進行中の音声/動画案生成は開始時 snap の外で完了して「保存/画面は新・MP4 は旧（無音MP4が成功扱い）」に
    // なる（#547 P2-6）。取り込みは最初の await 前に isImporting を、生成は pending 行/フラグを立てるので、ここで見れば排他になる。
    const startBlockedMessage = (): string | null => {
      const st = useProjectStore.getState();
      if (st.isImporting) return EXPORT_BLOCKED_IMPORTING_MESSAGE;
      if (st.isTemplateMutating) return "見た目パターンの変更中です。変更が終わってから書き出してください。";
      if (st.status === "generating") return "動画案を作成中です。作成が終わってから書き出してください。";
      if (st.isGeneratingNarration || isNarrationGenerating(st.scenes)) return VOICE_BUSY_EXPORT_MESSAGE;
      // 残っていると書き出しが必ず失敗する項目（#547 P2-5）。公開前チェックの主ボタンと**同じ述語**で、
      // サイドバーからこの画面へ直行した経路も止める＝保存先を選ばせた後に落とさない（ADR-0026④）。
      if (capabilityBlocked && capability) return EXPORT_CAPABILITY_NOTICE[capability].detail;
      const blocking = exportBlockingItems(
        st.scenes, st.assets, st.templates, st.meta.timelineOverlay?.animations,
        // ⚠️ 押した瞬間の再確認でも同じ材料を見る（`null`＝まだ調べていない＝項目を出さない）。
        { projectFontId: st.meta.videoSettings.fontId, userFontsUnreadable: st.userFontsUnreadable, ...(st.userFontIds && !st.userFontsUnreadable ? { availableUserFontIds: st.userFontIds } : {}) },
      );
      if (blocking.length > 0) return exportBlockedMessage(blocking, "export");
      return null;
    };
    const blockedBefore = startBlockedMessage();
    if (blockedBefore) { setMessage(blockedBefore); setPhase("error"); return; }
    // ⚠️ **自分の後片づけ待ちは押させない**（#843）＝書き出しの終わり（成功・中止・失敗）は片づけより
    // **先**に立つので、この窓ではボタンが戻っているのに `acquire` が失敗する。走っている「ほかの動画」は
    // 無いので、断り文も別のものにする（主語が実態と違う案内を出さない）。
    // ⚠️ **`startBlockedMessage` の中には置かない**＝あの関数は `beginExport` の**後**の再確認にも使われ、
    // そこでは自分が**正当に**締めを持っている（走行中の判定は phase を見るので窓と区別できない）。
    // 名乗る前のここ1回だけで見る。
    // ⚠️ **その時点の持ち主で見る**＝描いた後に相手が取ることがあるので、閉じ込めた値では遅い。
    const lockedNow = exportLockBlockedMessage(useExportLockStore.getState().owner, EXPORT_OWNER, busy || startingRef.current);
    if (lockedNow) { setMessage(lockedNow); setPhase("error"); return; }
    // 準備（クリップ抽出）と本体を同一のキャンセルスコープにする（#380）。中止ボタンが出る前（busy 前）に宣言＝競合なし。
    // ⚠️ **名乗れたかを見る**（レビュー ℹ️）＝取れないまま進むと、共有の一時置き場を片づける後始末が
    // **相手のフレームを消す**（`11 §7.6.5`）。
    // ⚠️ **いまは通常この分岐に入らない**（差分再監査 🟡）＝保存先を選ぶダイアログの待ちは**上の
    // `lockedNow` より前**にあり、`lockedNow` と `acquire` の間に `await` は無い（以前は判定が
    // ダイアログより前だったので本物のレースがあった＝#843 で判定を後ろへ移して閉じた）。
    // **将来ここへ待ちを挟む形にしたときの備え**として残す（消すと、そのとき黙って穴が開く）。
    // ⚠️ **名乗る前に立てる**＝名乗った瞬間に再描画が走るので、後で立てると「後片づけ中」が一瞬出る。
    markStarting(true);
    if (!useExportLockStore.getState().acquire(EXPORT_OWNER)) {
      markStarting(false);
      // ⚠️ **誰が持っているかで理由を分ける**（#843）＝自分の後片づけ待ちなら「ほかの動画」は嘘になる。
      const mine = useExportLockStore.getState().owner === EXPORT_OWNER;
      setMessage(mine ? EXPORT_CLEANUP_PENDING_MESSAGE : OTHER_EXPORT_RUNNING_MESSAGE);
      setPhase("error");
      return;
    }
    // end-to-end 計測（#376 レビュー P2）：利用者の待ち時間全体は「レンダリング段（フレーム焼き/準備＝TS）＋
    // encoding 段（結合/字幕/BGM＝Rust）」。Rust の eprintln は後段のみなので、全体は開始〜完了を TS で測る。
    const startedAt = performance.now();
    // encoding 段（結合/字幕/BGM）の実進捗を Rust から受け取りバーを 80→100% で描く（#376）。Tauri 非検出時は no-op。
    let unlistenProgress: (() => void) | undefined;
    // ⚠️ **名乗ったら、どの出口でも必ず返す**（#817-2）＝`try` は以前**名乗りより後**から始まっており、
    // その間で抜けると `finally` の返却を通らなかった。すぐ下の「取り込みが始まっていないか」の再確認は
    // **意図して作られた早期 return**（テストもある）＝必ず通る道で、抜けたあとは `owner="scene"` が残り
    // **タイムライン形式の書き出しが「ほかの動画を書き出しています」で永久に押せなくなる**
    //（走っていないので終わりようがない＝§2-5）。**名乗りの直後から囲む**ことで、出口を数え直さなくても
    // 返る（`beginExport` の失敗も下の `catch` が理由つきで受ける）。
    // ⚠️ タイムライン側（`timelineStore`）も名乗るのは `try` の**直前**＝間に行を足すと同じ穴が開く。
    // 「名乗ったら囲む」を両方の入口で守ること（ADR-0026②）。
    try {
      await beginExport();
      // beginExport の IPC 往復中に取り込み/生成が起動していないか再確認する（#570 P1 レビュー）。相手は最初の await の前に
      // isImporting/pending を立てるので、beginExport 窓で始まったものもこの時点で真＝確実に捕捉できる。setPhase("rendering")
      //（busy 化）の前に弾く＝#380 のキャンセルスコープ不変条件を保ったまま、上の一度きりチェックが取りこぼす窓を閉じる。
      const blockedAfter = startBlockedMessage();
      if (blockedAfter) { setMessage(blockedAfter); setPhase("error"); return; }
      setProgress({ done: 0, total: scenes.length });
      setExportRun({ encode: undefined }); // 前回の encoding 進捗を持ち越さない（#376）
      setPhase("rendering");
      unlistenProgress = await listenExportProgress((e) => setExportRun({ encode: e }));
      // 開始時点の完全スナップショット（#381）：映像・テロップ・BGM をすべてこの1つの内容から供給し、書き出し中の編集（#377）で
      // 「映像は旧・テロップ/BGMは新」の不整合MP4になるのを防ぐ。saveProject の前＝従来 closure と同一瞬間に確定し、projectId のみ保存後の採番値を使う。
      const snap = useProjectStore.getState();
      const snapScenes = snap.scenes;
      const snapAssets = snap.assets;
      const snapTemplates = snap.templates;
      const snapNarration = snap.narrationAudioById;
      const snapMeta = snap.meta;
      const snapFontId = snapMeta.videoSettings.fontId;
      // 焼き込むクレジットのナレーター（appSettings・#381 P2）も開始時点で確定＝書き出し中に設定でナレーターを変えても、
      // 映像/テロップ/BGM と食い違わない（store 外の設定なので snap と別に取る）。
      const snapVoicevoxSpeaker = getVoicevoxSpeaker();
      // 出力時はプロジェクト（場面・素材）も保存する。
      await saveProject();
      // saveProject 後の projectId（新規時はここで採番済み）。動画クリップのパス解決に使う。
      const pid = useProjectStore.getState().meta.projectId;
      // 表示用 assetSrcById（asset://）ではなく、書き出し時に画像をディスクから data URL 化する。
      // buildExportScenes が場面ごとに解決→破棄するので、ここでは id→data URL のリゾルバを渡すだけ（#143・ADR-0004）。
      // **解き方はタイムライン形式と共有**（`createExportSrcResolver`・#716）＝形式によって焼ける絵が割れない。
      const resolveExportSrc = createExportSrcResolver({
        projectId: pid,
        assets: snapAssets,
        templateAssetSrcById: snap.templateAssetSrcById,
      });
      // アニメ場面のフレームはステージング（逐次ディスク書き出し）に載せる＝巨大な base64 を1回の IPC に
      // まとめず、JSON.stringify の文字列上限超過（RangeError）を避ける（#書き出しRangeError）。前回の残りを掃除。
      await clearExportFramesStage();
      const templateById = new Map(snapTemplates.map((t) => [t.templateId, t] as const));
      // 書き出し前に同梱フォントを確実に読み込む（場面ごとに別フォントを使い得るため全フォント）。
      // タイムライン形式と**同じ関数**を通す＝形式によって焼ける字体が割れない（§6・ADR-0026②）。
      await loadExportFonts();
      const built = await buildExportScenes(
        snapScenes,
        templateById,
        resolveExportSrc,
        (scene, lineId) => ({
          // 掛け合いは行ごとの音声キー、単一 narration は場面 id（ADR-0015 PR-E）。規則は domain に1つ。
          // ⚠️ ここは**単独場面で `lineId` を渡さない**呼び出し規約だが、`narrationAudioKey` は
          // 場面が明示の行を持つかで決めるので、どちらの渡し方でも同じ答えになる。
          audioBase64: snapNarration[narrationAudioKey(scene, lineId ?? "")],
          narrationVolume: resolveNarrationVolume(scene.audioMix, snapMeta.voiceSettings),
        }),
        (scene) => {
          const t = templateById.get(scene.templateId);
          return t
            ? findVideoSlots(scene, t, (id) => snapAssets.find((a) => a.assetId === id))
            : [];
        },
        (done, total, frameFraction) => setProgress({ done, total, frameFraction }),
        { withSubtitle, outputSize, fontFamilyFor: (scene) => fontFamilyForId(resolveFontId(scene.fontId, snapFontId)), credit: creditForSpeaker(snapVoicevoxSpeaker), creditDisplay: snapMeta.videoSettings.creditDisplay, shouldCancel: () => useProjectStore.getState().exportRun.cancelling },
        // キーフレームアニメ（④・ADR-0019）：現在場面の animations（timelineOverlay・sceneId 一致）。アニメ場面はフレーム列に焼かれる。
        (scene) => (snapMeta.timelineOverlay?.animations ?? []).filter((a) => a.sceneId === scene.sceneId),
        // アニメ場面のフレームを1枚ずつステージングへ（framesBase64 を IPC に載せない・巨大場面の RangeError 回避）。
        (framesDir, frameIndex, dataUrl) => stageExportFrame(framesDir, frameIndex, dataUrl),
        // 動画スロット本体アニメ（#442）：クリップの区間フレームを抽出（pid でプロジェクト解決）。窓は実フレームで焼く＝動きながら再生。
        pid
          ? (dirName, clipRelPath, clipStartSec, durSec, speed, fpsArg, widthArg) =>
              stageClipFrames(pid, clipRelPath, clipStartSec, durSec, speed, fpsArg, widthArg, dirName)
          : undefined,
        (dirName, frameIndex) => readExportFrame(dirName, frameIndex),
      );
      // 旧・場面横断タイムラインのテロップは**焼かない**（ADR-0032 決定11/12・#635）＝時間軸の編集は
      // タイムライン形式へ移った。保存データは残すが、この形式の書き出しには出さない（開いたとき断る）。
      const proj = assembleProject({ ...snapMeta, projectId: pid }, snapAssets, snap.parts, snapScenes);
      // レンダリング段（フレーム焼き＋テロップ/BGM準備）の所要。encoding 段の内訳は Rust eprintln 側（#376 計測）。
      console.info(`[export] rendering (frames+prep): ${Math.round(performance.now() - startedAt)} ms / ${scenes.length} scenes`);
      setPhase("encoding");
      // 場面ごとBGM（ADR-0018 ③(7)）：区間を解決→配置＋クロスフェード計画→各区間のソースを data URL 化して Rust へ。
      // 表示用 src ではなく実体を data URL 化する（asset:// は FFmpeg へ渡せない）。同梱は public/bgm、自分のBGM はプロジェクトから。
      // ⚠️ **声が鳴っている区間だけ BGM を下げる**（#257・ADR-0032 追補4＝書き出し時の処理）。
      // 声の長さは**作成済みの音声（WAV）から測る**＝表示の窓（次の行まで）で下げると、
      // 声が終わったあとも下げっぱなしになる。まだ作っていない行は下げない（鳴らない声のために下げない）。
      // ⚠️ **キーの規則は domain に1つ**（`narrationAudioKey`）＝掛け合いは行ごと・単独は場面 id。
      // ここで分岐を書くと、単独読み上げだけ引けず**ダッキングが効かない**（PR #896 レビュー）。
      const speech = resolveSpeechSpans(proj, (scene, lineId) => {
        const a = snapNarration[narrationAudioKey(scene, lineId)];
        return a ? wavDurationSec(a) : 0;
      });
      const ducked = applyDuckingToMix(planBgmMix(resolveBgmExportRuns(proj), BGM_CROSSFADE_SEC), speech, snapMeta.videoSettings.audioAuto);
      if (ducked.merged) setDuckMergedNotice(true);
      const mixClips = ducked.clips;
      const bgmRuns: BgmRunInput[] = [];
      let bgmLoadFailed = false; // 1区間でも読込失敗したか（一部失敗と全失敗を完了時に出し分ける）。
      for (const clip of mixClips) {
        if (useProjectStore.getState().exportRun.cancelling) throw new ExportCancelledError(); // BGM準備中の中止も即反映（#380）
        let audioBase64: string | undefined;
        let fileExt = "mp3";
        if (clip.bundledBgmId) {
          audioBase64 = await readBundledBgmDataUrl(clip.bundledBgmId);
          fileExt = bgmById(clip.bundledBgmId)?.fileName.split(".").pop()?.toLowerCase() || "mp3";
        } else if (clip.assetId && pid) {
          const a = snapAssets.find((x) => x.assetId === clip.assetId);
          if (a) {
            audioBase64 = (await readAssetDataUrl(pid, a.filePath)) ?? undefined;
            fileExt = (a.filePath.split(".").pop() || "mp3").toLowerCase();
          }
        }
        if (audioBase64) {
          bgmRuns.push({ audioBase64, fileExt, volume: clip.volume, ...(clip.volumeExpr ? { volumeExpr: clip.volumeExpr } : {}), delaySec: clip.delaySec, playSec: clip.playSec, fadeInSec: clip.fadeInSec, fadeOutSec: clip.fadeOutSec });
        } else {
          // 選択済みだが読み込めなかった（同梱欠損・読込失敗）。その区間は無音で続行し、完了時に知らせる（§2-5）。
          bgmLoadFailed = true;
        }
      }
      // 一部の区間だけ失敗（他は鳴る）と、全区間失敗（＝BGMなし）を区別して案内する（§2-5）。
      if (bgmLoadFailed) setBgmWarning(bgmRuns.length > 0 ? "partial" : "all");
      // 準備（レンダリング）中に中止された場合は、エンコードを始めずに終える（#380）。
      if (useProjectStore.getState().exportRun.cancelling) {
        setPhase("cancelled");
        return;
      }
      // 全体の音量を整える（#259）。**整えないときは渡さない**＝従来どおりの音（出力不変）。
      const auto = resolveAudioAuto(snapMeta.videoSettings.audioAuto);
      const report = await exportVideo(
        built,
        fileName.trim() || "export",
        bgmRuns,
        pid || undefined,
        outputPath,
        auto.normalize ? auto.targetLufs : undefined,
      );
      setResultPath(report.outputPath);
      // end-to-end 総待ち時間＝レンダリング（上の rendering ログ）＋書き出し（encode/join/bgm＝Rust eprintln 内訳）。
      // 代表ケースの Before/After はこの total と上の rendering 行で記録できる（#376 レビュー P2）。
      console.info(`[export] end-to-end (render→save): ${Math.round(performance.now() - startedAt)} ms / ${scenes.length} scenes`);
      setPhase("done");
    } catch (e) {
      // ユーザーが中止した場合は、エラーではなく「中止しました」で終える（走行中 ffmpeg は kill 済み・§2-5・#380）。
      // 準備ループが投げる ExportCancelledError も同様に中止扱い（cancelling が読めない稀な競合への保険）。
      if (useProjectStore.getState().exportRun.cancelling || e instanceof ExportCancelledError) {
        setPhase("cancelled");
      } else {
        // Tauriコマンドの失敗は文字列で reject される（Errorインスタンスではない）。
        // Rust側でユーザー向けに整えた文言（技術詳細は stderr へ記録済み）なので、そのまま表示する。
        const detail = e instanceof Error ? e.message : typeof e === "string" ? e : "";
        setMessage(detail || exportFailedMessage.EXPORT_FAILED_SCENE);
        setPhase("error");
        console.error("[export] failed:", e);
      }
    } finally {
      // ⚠️ **片づけに入る前に降ろす**＝ここから先は本当に「後片づけ中」なので、断りが出るのが正しい。
      markStarting(false);
      unlistenProgress?.(); // 進捗購読を解除（#376）
      setExportRun({ cancelling: false }); // 中止フラグは1回の書き出しで完結（次回に持ち越さない・#380）
      // ステージングしたアニメフレームを掃除（成功/失敗いずれも）＝次回書き出しに残さない（#書き出しRangeError）。
      // ⚠️ **掃除してから締めを返す**（#834-3・タイムライン側と同じ順）＝一時ファイルの置き場は
      // **アプリで1つ**（ADR-0032 決定22）。先に返すと、次の書き出しが**この掃除の最中に**フレームを
      // 書き始め、掃除が**相手のフレームを消す**（締めはまさにそれを防ぐために在る）。
      await clearExportFramesStage().catch(() => {});
      useExportLockStore.getState().release(EXPORT_OWNER); // 走行中の締めを返す（#631）
    }
  }

  // バーの % と1行の説明は共有の純粋関数（他画面の「書き出し中」バナーと同じ数字・説明を出す＝§2-7/ADR-0026②）。
  const percent = exportOverallPercent({ phase, progress, encode });
  const progressLabel = exportProgressLabel({ phase, progress, encode });

  // 場面ゼロは**押しても必ず失敗**する（startExport が「書き出す場面がありません」で止める）。設定フォームを出すと
  // 入力させたうえで断る形になるので、上流へ促す空状態で止める（#547 P3-10・ADR-0026④）。
  // 仕上がり確認・公開前チェック・たたき台と同じ表示・同じ次の行動にする（#403/#590）＝共有の NoScenesState。
  // `!busy` も条件に入れる：走行中の書き出しを空状態で覆い隠すと、進捗と「書き出しを中止」＝編集ロックの
  // **唯一の抜け道**（15 §4・ExportLockBanner の案内）が消える。場面ゼロで書き出しが走らない担保は store 側
  // （#379 の newProject/loadProject 等のガード）に依存するので、この画面でも明示して他ファイル依存にしない。
  if (scenes.length === 0 && !busy) {
    return (
      <div className="main-scroll">
        <PageHead title={EXPORT_TITLE} />
        {/* 書き出し中バナーは出さない：この画面は自前の進捗表示を持ち、かつ場面ゼロでは書き出しが走らない。 */}
        <NoScenesState purpose="ここで動画を書き出せます" onNavigate={onNavigate} />
      </div>
    );
  }

  return (
    <div className="main-scroll">
      <PageHead title={EXPORT_TITLE} desc={EXPORT_DESC} />

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
              disabled={busy}
              onChange={(e) => setExportForm({ fileName: e.target.value })}
            />
            <p className="field-hint">「動画を保存」を押すと、保存先を選べます（初期のファイル名：{fileName || "export"}.mp4）。</p>
          </div>

          <div className="field">
            <label className="field-label" htmlFor="size">
              動画サイズ
            </label>
            <select id="size" className="select" value={size} disabled={busy} onChange={(e) => setExportForm({ size: e.target.value })}>
              <option value="fullhd">きれい（{fullDims.width}×{fullDims.height}）</option>
              <option value="hd">軽い（{hdDims.width}×{hdDims.height}）</option>
            </select>
          </div>

          <div className="toggle-row">
            <span className="field-label" style={{ margin: 0 }}>
              字幕を入れる
            </span>
            <Switch on={withSubtitle} onChange={(v) => setExportForm({ withSubtitle: v })} label="字幕を入れる" disabled={busy} />
          </div>
          <p className="field-hint">書き出した動画に反映されます。仕上がり確認でも同じ設定で表示されます。</p>
          <hr className="divider" />
          {/* 声の表記の出し方（ADR-0025・#359）。⚠️ **About 画面の表記は必須で不変**（`13 §4`）。 */}
          <CreditDisplayField disabled={busy} />
          <hr className="divider" />
          <div className="toggle-row">
            <span className="field-label" style={{ margin: 0 }}>
              BGM
            </span>
            <span className="text-sm">
              {withBgm ? bundledBgm?.label ?? bgmAsset?.displayName ?? "未選択" : "なし"}
            </span>
          </div>
          {/* BGM の選択は仕上がり確認（聞きながら選べる）。ここからは表示のみだが、その場で選びに行けるよう導線を置く（#407）。 */}
          <div className="row-between" style={{ alignItems: "center", gap: "var(--gap-sm)" }}>
            <p className="field-hint" style={{ margin: 0 }}>BGM は「仕上がり確認」で、聞きながら選べます。</p>
            <button className="btn btn-secondary text-sm" onClick={() => { setPreviewReturnTo("export"); onNavigate("preview"); }} disabled={busy}>
              仕上がり確認で選ぶ
            </button>
          </div>

          <hr className="divider" />
          {/* 音の自動処理（#257/#259・ADR-0032 追補4＝書き出し時の処理なのでここに置く）。
              **プロジェクト単位**＝場面ごとには持たない。両形式（場面/タイムライン）に効く。 */}
          <AudioAutoField disabled={busy} />

          <hr className="divider" />
          {/* ナレーション音量は仕上がり確認と共用の部品（#407・DRY）。仕上がり確認では聞きながら調整できる。
              このスライダーは**動画全体の既定**（voiceSettings.volume・11 §6）。場面ごとに個別の声量を設定した場面は
              その設定が優先されて変わらない（設定できるのに一部に効かない誤認を避ける・仕上がり確認は「いまの場面」で
              同じ案内を出す＝ADR-0026②・#547 P3-13）。全体スライダー自体は他の場面に効くのでここでは無効化しない。 */}
          <NarrationVolumeControl
            volume={voiceSettings.volume}
            onChange={(v) => updateVoiceSettings({ volume: v })}
            disabled={busy}
            hint={someSceneHasVolumeOverride
              ? "一部の場面は個別の声量を設定しています。その場面は、この全体の設定より個別の設定が優先されます（場面編集で変えられます）。"
              : undefined}
          />
          <div className="notice notice-info mt">
            <span>声を作成済みの場面には、その音声が入ります。</span>
          </div>

          <div className="row-between mt-lg">
            <button className="btn btn-ghost btn-icon" onClick={() => onNavigate("precheck")} disabled={busy}>
              <ArrowLeftIcon size={16} />
              公開前チェックへ戻る
            </button>
            {/* プロジェクト保存は共通トップバーの「保存」に一本化（#410 sub5・同一画面に保存2つを解消）。
                「動画を保存」は startExport が内部で saveProject 済み（自動保存＝#256 もあり取りこぼさない）。 */}
            <div className="col gap-xs" style={{ alignItems: "flex-end" }}>
              <button className="btn btn-primary btn-lg" onClick={() => void startExport()} disabled={busy || starting || lockBlockedMessage != null || blockingItems.length > 0 || capabilityBlocked}>
                <FilmIcon size={20} />
                {busy ? "書き出し中…" : "動画を保存"}
              </button>
              {/* 押した後に落とすのでなく、押す前に理由と次の行動を出す（§2-5・ADR-0026④）。左の「公開前チェックへ戻る」が直す導線。
                  抑止は「**同じ文**が失敗表示に出ているとき」だけ＝二重に並べない。phase だけで抑止すると、無関係な失敗が
                  残っている間に blocker ができたとき「押せないのに理由が出ない」になる（レビュー指摘）。 */}
              {capabilityBlocked && capability ? (
                <span className="text-sm" style={{ color: "var(--color-danger)" }}>{EXPORT_CAPABILITY_NOTICE[capability].detail}</span>
              ) : blockedMessage && !(phase === "error" && message === blockedMessage) ? (
                <span className="text-sm" style={{ color: "var(--color-danger)" }}>{blockedMessage}</span>
              ) : lockBlockedMessage ? (
                /* ⚠️ **押せなくしたら、理由も出す**（#843 レビュー 🟡）＝押せないボタンは `onClick` が走らないので、
                   断り文を `startExport` の中だけに置くと**画面に一度も出ない**（`06 §12.1`＝押す前に見せて
                   押せなくする、の「見せて」が抜ける）。タイムライン形式は `exportBlocked.message` を
                   同じように出しているので、ここでも出して揃える（ADR-0026②）。 */
                <span className="text-sm" style={{ color: "var(--color-danger)" }}>{lockBlockedMessage}</span>
              ) : null}
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

          {/* 前回の書き出しの結果（#547 P3-11）＝この画面に入った時点で既に終わっていた結果。
              「100%・保存しました」を出したままにすると、そのあとの編集も書き出し済みに見える（ADR-0026④）。 */}
          {showsPastResult && (
            <div className={`notice ${phase === "error" ? "notice-warn" : "notice-info"} mb`} role="status">
              <span>{pastExportNotice(phase)}</span>
            </div>
          )}

          {/* 進捗（%・バー・いま何をしているか・中止）は**いま走っている書き出し**のもの。前回の完了を
              100% のバーで再現しない＝今回のことのように見せない。保存先と導線は下で別に出す。 */}
          {(busy || (phase === "done" && !showsPastResult)) && (
            <>
              <div className="text-center mb">
                <div className="page-title" style={{ fontSize: 32, color: "var(--color-primary)" }}>
                  {percent}%
                </div>
                <div className="text-muted">{exportHeadingLabel({ phase, progress, encode })}</div>
              </div>
              <div className="progress mb">
                {/* エンコード段：Rust の実進捗イベントがあれば幅で表す（#376）。無ければ従来どおり不定バー（左右に流れる）で
                    「動いている」ことだけ伝える（#391）。レンダリング段/完了は常に幅で表す。 */}
                {phase === "encoding" && !encode ? (
                  <div className="progress-fill progress-fill--indeterminate" />
                ) : (
                  <div className="progress-fill" style={{ width: `${percent}%` }} />
                )}
              </div>
              {/* いま何をしているか（場面 n/N ／ 映像・結合・字幕・BGM）。バナーと同じ説明を出す（ADR-0026②）。 */}
              {progressLabel && <div className="text-center text-sm text-muted">{progressLabel}</div>}
              {/* 書き出しの中止（#380）：走行中の変換を止めて、すぐやり直せる。 */}
              {busy && (
                <div className="row mt" style={{ justifyContent: "center" }}>
                  <button
                    className="btn btn-ghost"
                    onClick={() => { setExportRun({ cancelling: true }); void cancelExport(); }}
                    disabled={cancelling}
                  >
                    {cancelling ? "中止しています…" : "書き出しを中止"}
                  </button>
                </div>
              )}
            </>
          )}

          {/* 保存した動画そのものの情報（保存先・開く導線・BGMの欠け）は、進捗パネルとは別に出す。
              前回の結果として見ているときも**保存したファイルへ辿れる**必要がある（#404 の導線を消さない）。 */}
          {phase === "done" && (
            <>
              {resultPath && (
                <>
                  <div className="notice notice-info mt">
                    <span>保存先：{resultPath}</span>
                  </div>
                  {/* 完了後の導線（06_UI_SPEC §13 完了時・#404）：長いパスを自力で辿らずワンクリックで開ける。 */}
                  <div className="row gap-sm mt" style={{ justifyContent: "center", flexWrap: "wrap" }}>
                    <button
                      className="btn btn-secondary"
                      onClick={() => { setOpenError(""); void revealSavedFile(resultPath).catch(() => setOpenError("reveal")); }}
                    >
                      保存した場所を開く
                    </button>
                    <button
                      className="btn btn-ghost"
                      onClick={() => { setOpenError(""); void openSavedFile(resultPath).catch(() => setOpenError("open")); }}
                    >
                      動画を再生
                    </button>
                    <button className="btn btn-ghost btn-icon" onClick={() => onNavigate("home")}>
                      <ArrowLeftIcon size={16} />
                      プロジェクト一覧へ戻る
                    </button>
                  </div>
                  {openError && (
                    <div className="notice notice-warn mt" role="alert">
                      <span>
                        {openError === "open"
                          ? `動画を再生できませんでした。ファイルが移動・削除されていないか、再生できるアプリがあるかご確認ください（保存先：${resultPath}）。`
                          : `保存した場所を開けませんでした。ファイルが移動・削除されていないかご確認ください（保存先：${resultPath}）。`}
                      </span>
                    </div>
                  )}
                </>
              )}
              {duckMerged && (
                <div className="notice notice-warn mt">
                  {/* ⚠️ **黙ってやらない**（§2-5）＝下げる区間をつないだので、声と声の間でも BGM が下がったままになる。
                      ⚠️ **文言は1か所から**（α-6 出口監査 🟡）＝タイムライン形式でも同じことを言う。 */}
                  <span>{DUCK_MERGED_MESSAGE}</span>
                </div>
              )}
              {bgmWarning && (
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

          {/* 失敗の中身（原因と次の行動）。前回の結果として見ているときは読み上げの割り込み（alert）にしない
              ＝画面に入るたび「たったいま失敗した」と再通知しない。いつのことかは上の1行が示す。 */}
          {phase === "error" && (
            <div className="notice notice-warn" role={showsPastResult ? "status" : "alert"}>
              <span>{message}</span>
            </div>
          )}

          {/* 中止は上の「前回の…」が同じ内容（中止した・やり直せる）を出すので、そのときは重ねない。 */}
          {phase === "cancelled" && !showsPastResult && (
            <div className="notice notice-info" role="status">
              <span>書き出しを中止しました。もう一度「動画を保存」を押すと、やり直せます。</span>
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
