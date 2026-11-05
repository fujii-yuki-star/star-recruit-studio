// タイムライン編集プロジェクトの画面の検査で共有する下ごしらえ（負荷・耐久の点検 2026-10-22）。
//
// ⚠️ **もとは1つのファイル（1万行・約670件）だった**＝単独で約10分かかり、ほかと一緒に走ると時間切れでたまに落ちた。
//   `TimelineProjectScreen.*.test.tsx` に分けたので、文書・開き方・テスト間の後片づけはここに1つ置く
//   （分けたファイルごとに写すと、後片づけの1行が片方だけ直る）。
import { beforeEach, vi } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import { useTimelineStore } from "../app/store/timelineStore";
import { useProjectStore } from "../app/store/projectStore";
import { useExportLockStore } from "../app/store/exportLock";
import { PROJECT_FORMAT, TIMELINE_CLIP_KIND, TRACK_KIND } from "../domain/enums";
import { TIMELINE_SCHEMA_VERSION } from "../domain/timeline/types";
import type { TimelineProject } from "../domain/timeline/types";
import * as ffmpegMod from "../infrastructure/ffmpegExport";

export function doc(over: Partial<TimelineProject> = {}): TimelineProject {
  return {
    schemaVersion: TIMELINE_SCHEMA_VERSION,
    format: PROJECT_FORMAT.timeline,
    projectId: "proj_20260728_001",
    projectName: "焼いた動画",
    createdAt: "2026-07-28T00:00:00.000Z",
    updatedAt: "2026-07-28T00:00:00.000Z",
    videoSettings: { aspectRatio: "16:9", fps: 30, targetDurationSec: 60, maxDurationSec: 600 },
    voiceSettings: { defaultVoiceId: "voicevox_zundamon" },
    assets: [],
    tracks: [
      { id: "track_001", kind: TRACK_KIND.visual },
      { id: "track_002", kind: TRACK_KIND.audio },
    ],
    clips: [
      { id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 5, x: 0, y: 0, w: 100, h: 50, text: "こんにちは" },
      { id: "clip_002", kind: TIMELINE_CLIP_KIND.voice, trackId: "track_002", startSec: 0, durationSec: 5, voice: { text: "よろしく", status: "none" } },
    ],
    ...over,
  };
}

/**
 * 「置く」欄のタブを開く（#1031＝4つの欄を1つの欄にタブでまとめた）。
 *
 * ⚠️ **既定は「素材・文字・図形」**なので、それ以外を触るテストはここを通す。
 * ⚠️ **タブの群の中から引く**＝「音」「読み上げ」は画面のほかの場所にも出るので、
 *    画面全体から名前で引くと別のものに当たる。
 */
export const openPlaceTab = (label: string): void => {
  fireEvent.click(within(screen.getByRole("group", { name: "置くもの" })).getByRole("button", { name: label }));
};

export const open = (over: Partial<TimelineProject> = {}) =>
  useTimelineStore.setState({ doc: doc(over), loadError: null, isLoading: false, playheadSec: 0, selectedClipIds: [], assetSrcById: {} });

/**
 * テスト間の後片づけを張る（ファイルの頭で1回呼ぶ）。⚠️ **分けたファイルのすべてで同じ**＝1つでも違うと、
 * 前のテストの状態（書き出し中・声を作っている回・欄の配置）を持ち越して、別の理由で落ちる。
 */
export function resetTimelineScreenBetweenTests(): void {
  beforeEach(() => {
    vi.restoreAllMocks();
    // 書き出せる端末として振る舞わせる（ブラウザでは `canExport()` が false ＝ボタンが正しく無効になる）。
    // ⚠️ `restoreAllMocks` の**後**に張る（前に張ると、その場で外される）。
    vi.spyOn(ffmpegMod, "canExport").mockReturnValue(true);
    // 書き出しの締めはテスト間で持ち越さない（漏れると次のテストが別の理由で落ちて切り分けにくい）。
    useExportLockStore.setState({ owner: null });
    // **書き出しの状態を先に戻す**＝`closeTimelineProject` は書き出し中だと何もしない（走行中に文書を
    // 差し替えないため）。戻さないと、書き出し中にしたテストの状態が以降のテスト全部に残る。
    useTimelineStore.setState({ exportRun: { phase: "idle", percent: 0, message: null, cancelling: false } });
    // ⚠️ **走っている「声を作る」回もテスト間で持ち越さない**（#755）。この印は文書を閉じても
    // 消えない（合成はアプリの中で走り続けるため）＝戻さないと、以降のテスト全部で書き出しが塞がる。
    useTimelineStore.setState({ _voiceRun: null, generatingVoiceClipId: null });
    useTimelineStore.getState().closeTimelineProject();
    useProjectStore.setState({ templates: [] });
    // 欄の配置は**アプリの設定に残る**（ADR-0033）＝テスト間で持ち越さない（前のテストの配置で描かない）。
    localStorage.clear();
  });
}

/** 欄の出し入れは**見出しの行のメニュー**の中（#1032）＝欄の下に並べると視界の外だった。 */
export const openPanelMenu = (): void => { fireEvent.click(screen.getByRole("button", { name: /^欄/ })); };

/** 最後に置いた部品（`.at(-1)` は lib の対象外なので添字で取る）。 */
export const lastClip = () => {
  const cs = useTimelineStore.getState().doc!.clips;
  return cs[cs.length - 1];
};

/**
 * 列の行の見出しを引く。⚠️ **名前だけでは引けない**＝「置く列」の選択肢にも同じ名前が出る（#771(b)）。
 * 行の見出しは並べ替えのために掴める要素（`timeline-row-label`）の中にある。
 */
export const trackRowLabel = (name: string): HTMLElement => {
  const found = screen.getAllByText(name).find((el) => el.closest(".timeline-row-label"));
  return found!;
};
