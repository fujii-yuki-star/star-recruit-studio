import { useEffect } from "react";
import { createProjectId, parseProjectDoc, ProjectLoadError } from "../../domain/project/persistence";
import { parseTimelineProjectDoc } from "../../domain/timeline/persistence";
import { isTimelineProjectDoc, resolveProjectFormat } from "../../domain/projectFormat";
import { STARTUP_NOT_READY, sceneUngeneratedVoices, startupExportNotReady, timelineUngeneratedVoices } from "../../domain/startup/startupReadiness";
import { engineWaitPlan } from "../../domain/startup/engineWait";
import { voicevoxReady } from "../../infrastructure/voiceFs";
import { PROJECT_FORMAT } from "../../domain/enums";
import { reserveProjectId } from "../store/assetImport";
import { deleteProjectDoc, saveProjectDoc } from "../../infrastructure/projectFs";
import { importDoneMessage, makeVoicesDoneMessage, startupArgErrorMessage } from "../../domain/startup/startupMessages";
import {
  finishStartupJob,
  importProjectFolder,
  onStartupRequestForwarded,
  readImportFolder,
  startupRequest,
  type StartupRequest,
} from "../../infrastructure/startupFs";
import { listProjectSummaries } from "../../infrastructure/projectFs";
import { userFacingMessage } from "../userFacingError";
import { useProjectStore } from "../store/projectStore";
import { useStartupJobStore } from "../store/startupJobStore";
import { useTimelineStore } from "../store/timelineStore";
import type { ScreenId } from "../data/mockData";

/** すでに動画を開いているときの断り（§2-5＝次の行動）。 */
export const STARTUP_BUSY_MESSAGE =
  "いま動画を開いています。閉じてから、もう一度お試しください。";

/** その動画を開けなかったときの断り（§2-5＝次の行動）。 */
export const STARTUP_OPEN_FAILED_MESSAGE =
  "その動画を開けませんでした。動画の番号を確かめて、もう一度お試しください。";

/**
 * 声がまだ作られていないときの断り（#1204・§2-5＝次の行動）。
 *
 * ⚠️ **止めないと、そのぶんが無音のまま焼き込まれて「成功」で返る**（実機で確認＝−91dB）。
 * ⚠️ **人が押した回では止めない**＝画面が「要対応」として見せている（そちらの流儀は変えない）。
 */
export const STARTUP_VOICE_NOT_READY_MESSAGE =
  "読み上げの声がまだ作られていません。声を作ってから、もう一度お試しください。";

/**
 * 使っている素材が見つからないときの断り（PR #1208 レビュー 🟡・§2-5＝次の行動）。
 *
 * ⚠️ **止めないと、その場面が黙って抜けた動画になる**（声の無音化と同じ「黙って別の結果」）。
 */
export const STARTUP_ASSET_MISSING_MESSAGE =
  "動画で使っている素材のファイルが見つかりません。素材を入れ直してから、もう一度お試しください。";

/**
 * 声を作る用意ができなかったときの断り（#1204・§2-5＝次の行動）。
 *
 * ⚠️ **同梱エンジンは起動に数十秒かかる**＝待っても来ないときに、頼んだ側が次にできることを出す。
 */
export const STARTUP_VOICE_ENGINE_MESSAGE =
  "声を作る用意が整いませんでした。しばらく待ってから、もう一度お試しください。";

/** 取り込む元が読めなかったときの断り。 */
export const STARTUP_IMPORT_UNREADABLE_MESSAGE =
  "そのフォルダの中身を読めませんでした。動画のフォルダごと指定してください。";

/**
 * いま「他人の作業中」か（ADR-0042 決定③）。
 *
 * ⚠️ **開いているかどうかで見る**＝このアプリに「直したけど保存していない」を表す印が無い
 * （自動保存があるので `saveStatus` は**直後でも `saved`** になりうる）。
 * 印が無いものを推測で作らず、**開いていたら断る**という**安全側**に倒す（§9-2）。
 * ⚠️ **断るのは渡された仕事だけ**＝自分で起こした回は、まだ何も開いていない。
 */
export function startupJobBlocked(input: {
  forwarded: boolean;
  sceneProjectId: string;
  timelineOpen: boolean;
}): boolean {
  if (!input.forwarded) return false;
  return input.sceneProjectId !== "" || input.timelineOpen;
}

/**
 * 起動のときに頼まれた仕事を進める（ADR-0042・#1184）。
 *
 * ⚠️ **聞きに行く**（投げつけられるのを待たない）＝窓ができる順番は保証されないので、
 * 待つ形にすると**画面が受け取れる前に投げられて取りこぼす**。
 * ⚠️ **後から渡された回は `listen` で受ける**（単一インスタンス＝決定③）。
 */
export function useStartupJob(navigate: (next: ScreenId) => void): void {
  useEffect(() => {
    let cancelled = false;
    const setNotice = useStartupJobStore.getState().setNotice;

    const refuse = (message: string, req: StartupRequest): void => {
      setNotice(message);
      void finishStartupJob(false, req.forwarded);
    };

    const run = async (req: StartupRequest): Promise<void> => {
      if (cancelled) return;
      if (req.argError) {
        refuse(startupArgErrorMessage(req.argError), req);
        return;
      }
      if (req.kind === "none") return;
      if (
        startupJobBlocked({
          forwarded: req.forwarded,
          sceneProjectId: useProjectStore.getState().meta.projectId,
          timelineOpen: useTimelineStore.getState().doc != null,
        })
      ) {
        refuse(STARTUP_BUSY_MESSAGE, req);
        return;
      }
      if (req.kind === "import" && req.folder) {
        await runImport(req, req.folder, navigate, setNotice);
        return;
      }
      if (req.kind === "export" && req.projectId && req.out) {
        await runExport(req, req.projectId, req.out, navigate, setNotice);
        return;
      }
      if (req.kind === "makeVoices" && req.projectId) {
        await runMakeVoices(req, req.projectId, navigate, setNotice);
      }
    };

    void (async () => {
      const req = await startupRequest().catch(() => null);
      // ⚠️ **何か頼まれているかを、先に知らせる**（PR #1197 レビュー 🔴）＝`App` の
      // 「最後に開いていた動画を自動で開く」と**どちらが勝つか**が往復の速さで決まっていた。
      // 負けると、AI が指した動画ではなく**直前の動画が書き出される**（しかも成功として返る）。
      useStartupJobStore.getState().setRequestKnown(
        req && req.kind !== "none" ? "job" : "none",
      );
      if (req) await run(req);
    })();
    // ⚠️ **受け口を作れなかったときも投げっぱなしにしない**＝アプリの外（Tauri）が居ない所では
    // ここが失敗する。握りつぶすと**未処理の拒否**になり、関係ない検査が赤くなる（実際に3件出た）。
    // ⚠️ **受け口が無くても起動は続く**＝渡された仕事を受けられないだけで、自分で起こした回は動く。
    const un = onStartupRequestForwarded((req) => void run(req)).catch((e): (() => void) => {
      console.error("[startup] 渡された頼まれごとを受け取れない:", e);
      return () => {};
    });
    return () => {
      cancelled = true;
      void un.then((off) => off()).catch(() => {});
    };
    // ⚠️ **1回だけ**＝頼まれごとは起動の事情なので、画面の作り直しで繰り返さない。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

/**
 * フォルダから取り込んで開く。
 *
 * ⚠️ **番号はここで決める**（採番の規則は `11.2`＝ドメイン）＝Rust で決めると規則の写しになる。
 * ⚠️ **検証もここ**（ADR-0041 条件1）＝正典の検証はドメインにある。読めた＝正しい、ではない。
 */
async function runImport(
  req: StartupRequest,
  folder: string,
  navigate: (next: ScreenId) => void,
  setNotice: (m: string | null) => void,
): Promise<void> {
  try {
    const text = await readImportFolder(folder);
    // ⚠️ **写す前に検証する**（PR レビュー 🟡・ADR-0041 条件1）＝最初は「写してから開いて失敗」だった。
    // それだと**開けない動画のフォルダが置き場に残り**、しかも「取り込みました」と言ってから失敗する。
    // ⚠️ **正典の検証をそのまま使う**＝`parseProjectDoc` / `parseTimelineProjectDoc`（写しを作らない）。
    let doc: unknown;
    try {
      doc = JSON.parse(text);
    } catch {
      setNotice(STARTUP_IMPORT_UNREADABLE_MESSAGE);
      await finishStartupJob(false, req.forwarded);
      return;
    }
    const isTimeline = typeof doc === "object" && doc !== null && isTimelineProjectDoc(doc);
    try {
      if (isTimeline) parseTimelineProjectDoc(text);
      else parseProjectDoc(text);
    } catch (e) {
      // ⚠️ **理由を保つ**（PR レビュー 🟡）＝「新しい版で作られているため開けません」等が
      // 「読めませんでした」に化けると、**従っても直らない案内**になる（§2-5）。
      setNotice(loadErrorMessage(e, "startup-import-validate", STARTUP_IMPORT_UNREADABLE_MESSAGE));
      await finishStartupJob(false, req.forwarded);
      return;
    }
    // ⚠️ **予約を通す**（PR レビュー 🟡・#992 ③）＝一覧は「まだ `project.json` を書いていない作りかけ」を
    // 数えられないので、複製や焼き出しと同じ `reserveProjectId` に揃える（同じ番号を2回出さない）。
    const existing = (await listProjectSummaries()).map((p) => p.projectId);
    const projectId = reserveProjectId(existing, (ids) => createProjectId(new Date(), ids));
    const { copied, skipped } = await importProjectFolder(folder, projectId);
    // ⚠️ **中の番号も書き換える**（PR レビュー 🔴）＝保存先も素材の解決も**文書側の番号**で決まる
    // （`save_project` は `project_json` の `projectId` から保存先を決める）。書き換えないと、
    // **置いたのは新しい番号のフォルダなのに、読み書きは元の番号のフォルダ**になり、
    // 次の自動保存が**元の動画を黙って上書きする**（ADR-0026④）。
    try {
      await saveProjectDoc(projectId, JSON.stringify({ ...(doc as object), projectId }));
    } catch (e) {
      // ⚠️ **書けなかったら、写したフォルダも片づける**（PR #1197 レビュー）＝
      // このとき `projects/<新しい番号>/project.json` の中はまだ**元の番号**なので、残すと
      // **フォルダ名と中の番号が食い違う幽霊**が一覧に出る（一覧は中の番号で作る）。
      // ⚠️ **片づけに失敗しても、断りは出す**＝利用者に必要なのは「取り込めなかった」こと。
      await deleteProjectDoc(projectId).catch(() => {});
      throw e;
    }
    if (isTimeline) {
      await useTimelineStore.getState().openTimelineProject(projectId);
      navigate("timeline-project");
    } else {
      await useProjectStore.getState().loadProject(projectId);
      navigate("scene-edit");
    }
    // ⚠️ **開けてから言う**＝「取り込みました」を先に出すと、開けなかった回に嘘が残る。
    setNotice(importDoneMessage(copied, skipped));
    await finishStartupJob(true, req.forwarded);
  } catch (e) {
    setNotice(loadErrorMessage(e, "startup-import", STARTUP_IMPORT_UNREADABLE_MESSAGE));
    await finishStartupJob(false, req.forwarded);
  }
}

/**
 * その動画の**読み上げの声を作る**（ADR-0042 追補2・#1204）。
 *
 * ⚠️ **人が押したときと同じ道を通す**（ADR-0007）＝画面の「まとめて作る」と同じ `generateAllVoices` /
 * `generateAllNarrations` を呼ぶ。別の経路を作ると、**声の設定の解決（11 §6 継承）が二重になる**。
 * ⚠️ **画面へ進んでから走らせる**＝走っている間の進み具合は画面が出す（ADR-0042 決定②＝窓は出す）。
 * ⚠️ **終わったかどうかは「残りが 0 か」で見る**＝途中で失敗した回を「できた」で返さない。
 */
async function runMakeVoices(
  req: StartupRequest,
  projectId: string,
  navigate: (next: ScreenId) => void,
  setNotice: (m: string | null) => void,
): Promise<void> {
  try {
    const summary = (await listProjectSummaries()).find((p) => p.projectId === projectId);
    const isTimeline = resolveProjectFormat({ format: summary?.format }) === PROJECT_FORMAT.timeline;
    if (isTimeline) {
      await useTimelineStore.getState().openTimelineProject(projectId);
      navigate("timeline-project");
      if (!(await waitForVoiceEngine())) {
        setNotice(STARTUP_VOICE_ENGINE_MESSAGE);
        await finishStartupJob(false, req.forwarded);
        return;
      }
      await useTimelineStore.getState().generateAllVoices();
      // ⚠️ **書き切ってから終わる**（実機で踏んだ）＝自動保存は画面の都合で少し待つ形なので、
      // 仕事が終わってすぐ閉じる回では**一度も走らない**。音のファイルは出来ているのに、
      // 文書は「まだ作っていない」のままになり、**次の書き出しが断られる**。
      await useTimelineStore.getState().saveTimelineProject();
      const left = timelineUngeneratedVoices(useTimelineStore.getState().doc?.clips ?? []);
      setNotice(makeVoicesDoneMessage(left));
      await finishStartupJob(left === 0, req.forwarded);
      return;
    }
    await useProjectStore.getState().loadProject(projectId);
    navigate("scene-edit");
    if (!(await waitForVoiceEngine())) {
      setNotice(STARTUP_VOICE_ENGINE_MESSAGE);
      await finishStartupJob(false, req.forwarded);
      return;
    }
    await useProjectStore.getState().generateAllNarrations();
    // ⚠️ **書き切ってから終わる**（上と同じ）。
    await useProjectStore.getState().saveProject();
    const left = sceneUngeneratedVoices(useProjectStore.getState().scenes);
    setNotice(makeVoicesDoneMessage(left));
    await finishStartupJob(left === 0, req.forwarded);
  } catch (e) {
    setNotice(loadErrorMessage(e, "startup-make-voices", STARTUP_OPEN_FAILED_MESSAGE));
    await finishStartupJob(false, req.forwarded);
  }
}

/**
 * 声を作る用意ができるまで待つ（#1204）。**できたら `true`**。
 *
 * ⚠️ **実機で踏んだ**＝同梱エンジンは起動に数十秒かかるので、開いた直後に声を作ろうとすると落ちる
 *（`--make-voices` が 5.7 秒で終了コード 1・声は1つも出来ていなかった）。
 * ⚠️ **あきらめる形を持つ**＝持たないと、エンジンが来ないとき**頼んだ側が永久に待つ**。
 */
async function waitForVoiceEngine(): Promise<boolean> {
  for (let attempt = 0; ; attempt += 1) {
    if (await voicevoxReady()) return true;
    const plan = engineWaitPlan(attempt);
    if (plan.giveUp) return false;
    await new Promise((resolve) => setTimeout(resolve, plan.waitMs));
  }
}

/**
 * 断りの文を決める。
 *
 * ⚠️ **生の断りをそのまま出さない**（#1123）＝関門（`userFacingMessage`）を通す。
 * ⚠️ **理由のある断りは保つ**（PR レビュー 🟡）＝`ProjectLoadError` は「次の行動」を持っているので、
 * 既定の文へ落とすと**従っても直らない案内**になる。
 */
function loadErrorMessage(e: unknown, where: string, fallback: string): string {
  if (e instanceof ProjectLoadError) return e.message;
  return userFacingMessage(e, where) ?? fallback;
}

/**
 * その動画を開いて、書き出しの画面へ渡す。
 *
 * ⚠️ **ここでは書き出さない**＝書き出すのは `ExportScreen`（人が押したときと**同じ道**＝ADR-0007）。
 * 渡すのは「保存先」だけ。
 */
async function runExport(
  req: StartupRequest,
  projectId: string,
  out: string,
  navigate: (next: ScreenId) => void,
  setNotice: (m: string | null) => void,
): Promise<void> {
  try {
    // ⚠️ **どちらの形式かで開く先が変わる**（実機で発覚・2026-09-17）＝
    // 場面形式の道しか無かったので、**タイムライン形式の動画は3秒で何もせず終わって「成功」を返していた**。
    // ⚠️ **ここが塞がっていると ADR-0041 の枠②が成立しない**＝外の AI にタイムラインを書かせると決めたのに、
    // 書いたものを書き出す口が無い。判定は一覧の `format`（`resolveProjectFormat` を通した値）を使う
    // ＝開いてから「形式が違う」と断らない（取り込みと同じ流儀）。
    const summary = (await listProjectSummaries()).find((p) => p.projectId === projectId);
    const isTimeline = resolveProjectFormat({ format: summary?.format }) === PROJECT_FORMAT.timeline;
    useStartupJobStore.getState().setPendingExport(out, req.forwarded);
    if (isTimeline) {
      await useTimelineStore.getState().openTimelineProject(projectId);
      // ⚠️ **開いてから見る**＝文書の中身（声が作られているか）は、開かないと分からない。
      const opened = useTimelineStore.getState().doc;
      const notReady = startupExportNotReady({
        ungeneratedVoices: timelineUngeneratedVoices(opened?.clips ?? []),
        // ⚠️ **タイムライン形式は、見つからない素材で既に止まる**
        //（`TIMELINE_EXPORT_ASSET_UNREADABLE`／`TIMELINE_EXPORT_VIDEO_FILE_MISSING`）＝
        // ここで二重に数えると、**同じ状態に2つの断りが並ぶ**（どちらに従えばよいか分からなくなる）。
        missingUsedAssets: 0,
      });
      if (notReady) {
        setNotice(STARTUP_VOICE_NOT_READY_MESSAGE);
        useStartupJobStore.getState().takePendingExport();
        await finishStartupJob(false, req.forwarded);
        return;
      }
      navigate("timeline-project");
      return;
    }
    await useProjectStore.getState().loadProject(projectId);
    // ⚠️ **素材が実在するかは、開いたあとに調べる**（PR #1208 レビュー 🟡・#1068）＝
    // 調べておかないと、書き出しの画面の関門（`exportBlockingItems`）が**項目そのものを作れない**。
    // ⚠️ **ここでは数えない**＝**見つからない素材は書き出しの画面が断る**ようになったので（#1068）、
    // ここでも数えると**同じ状態に2つの断りが並ぶ**うえ、**数え方が画面と違う**
    //（画面は「テンプレの差し込み口に入っているか」＝`sceneActiveAssetIds` で数える）。
    await useProjectStore.getState().refreshMissingAssets();
    const sceneNotReady = startupExportNotReady({
      ungeneratedVoices: sceneUngeneratedVoices(useProjectStore.getState().scenes),
      missingUsedAssets: 0,
    });
    if (sceneNotReady) {
      setNotice(
        sceneNotReady === STARTUP_NOT_READY.assetMissing
          ? STARTUP_ASSET_MISSING_MESSAGE
          : STARTUP_VOICE_NOT_READY_MESSAGE,
      );
      useStartupJobStore.getState().takePendingExport();
      await finishStartupJob(false, req.forwarded);
      return;
    }
    navigate("export");
  } catch (e) {
    // ⚠️ **開けなかったら、頼まれた保存先も捨てる**＝残すと、**次に人が押した書き出し**が
    // 黙ってその保存先へ書く（`takePendingExport` は「1回きり」だが、取り出す前に失敗している）。
    useStartupJobStore.getState().takePendingExport();
    setNotice(loadErrorMessage(e, "startup-export", STARTUP_OPEN_FAILED_MESSAGE));
    await finishStartupJob(false, req.forwarded);
  }
}
