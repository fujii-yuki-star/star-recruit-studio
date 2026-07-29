// タイムライン編集プロジェクト（ADR-0032・#629）の編集状態。**場面形式とは別の文書**なので store も分ける
// （projectStore に相乗りすると、片方にしか無い概念〔場面・パート〕が混ざって両形式の不変条件が曖昧になる）。
import { create } from "zustand";
import { assetDisplayUrl, readAssetDataUrl } from "../../infrastructure/assetFs";
import { readVoiceDataUrl } from "../../infrastructure/voiceFs";
import { readBundledBgmDataUrl } from "../../infrastructure/bundledBgm";
import { audioSourceKey, audioSourcesOf } from "../../domain/timeline/audio";
import { loadProjectDoc, saveProjectDoc } from "../../infrastructure/projectFs";
import { validateTimelineProject } from "../../domain/validation/generated/validators.js";
import { ASSET_TYPE } from "../../domain/enums";
import { parseTimelineProjectDoc, TimelineLoadError, timelineDurationSec, withUpdatedAt } from "../../domain/timeline/persistence";
import { clampTimelinePlayheadSec, playbackStartSec } from "../../domain/timeline/playback";
import type { TimelineProject } from "../../domain/timeline/types";
import type { TextKey, TrackKind } from "../../domain/enums";
import {
  addLinkedSubtitleClip, addTemplateClip, addTrack, addVoiceClip, duplicateClip, moveClip, moveTrackOrder,
  removeClips, removeTrack, setClipAssetRef, setClipText, setSubtitleText, setSubtitleVoiceLink,
  setTrackFlag, setVoiceSpeaker, setVoiceText, trimClip,
} from "../../domain/timeline/edit";
import { EDIT_BLOCKED } from "../../domain/timeline/edit";
import type { EditBlockedReason, EditResult } from "../../domain/timeline/edit";
import { emptyHistory, recordSnapshot, redoSnapshot, undoSnapshot } from "../../domain/project/history";
import { resolveNarrationVoice, sameSynthInput } from "../../domain/voice/voiceProvider";
import { characterForSpeaker } from "../../domain/voice/voiceCatalog";
import type { VoiceProvider } from "../../domain/voice/voiceProvider";
import { MockVoiceProvider } from "../../infrastructure/voiceProviders/mockVoiceProvider";
import { VoicevoxProvider } from "../../infrastructure/voiceProviders/voicevoxProvider";
import { importVoiceFile } from "../../infrastructure/voiceFs";
import { NARRATION_STATUS, TIMELINE_CLIP_KIND } from "../../domain/enums";
import type { NarrationStatus } from "../../domain/enums";
import type { TimelineVoice } from "../../domain/timeline/types";
import type { VoiceSettings } from "../../domain/project/types";
import { explodeTemplateClip } from "../../domain/timeline/explode";
import { timelineAudioRuns, timelineExportBlockers } from "../../domain/timeline/export";
import { buildTimelineFrames } from "../../renderer/export/buildTimelineFrames";
import { loadExportFonts } from "../../renderer/export/loadExportFonts";
import { fontFamilyForId } from "../../domain/font/fontCatalog";
import { ExportCancelledError } from "../../renderer/export/buildExportScenes";
import { EXPORT_RUN_PHASE, exportOverallPercent } from "../../domain/export/exportProgress";
import type { ExportRunPhase } from "../../domain/export/exportProgress";
import { creditForSpeaker } from "../../domain/voice/narratorCredit";
import { getVoicevoxSpeaker } from "../../infrastructure/appSettings";
import { showSaveVideoDialog } from "../../infrastructure/dialog";
import {
  beginExport, canExport, cancelExport, clearExportFramesStage, exportVideo, listenExportProgress, stageExportFrame,
} from "../../infrastructure/ffmpegExport";
import type { BgmRunInput } from "../../infrastructure/ffmpegExport";
import type { Template } from "../../domain/template/types";
import { exportBlockedMessage } from "../uiLabels";
import { OTHER_EXPORT_RUNNING_MESSAGE, isOtherExportRunning, useExportLockStore } from "./exportLock";
import type { HistoryStacks } from "../../domain/project/history";

/** 読み込めなかったときの文言（§2-5：原因でなく次の行動）。想定外も生のエラーを見せない。 */
const LOAD_FAILED_MESSAGE = "この動画を開けませんでした。一覧から選び直してください。";

// 声を作れなかったときの文言（§2-5＝次の行動／§2-3＝技術用語を出さない）。
const VOICE_FAILED_MESSAGE = "声を作れませんでした。しばらくしてから、もう一度お試しください。";
const VOICE_SAVE_FAILED_MESSAGE = "作った声を保存できませんでした。もう一度お試しください。";
const VOICE_EXPORTING_MESSAGE = "いま動画を書き出しています。終わってから声を作ってください。";
const VOICE_DURATION_UNKNOWN_MESSAGE = "声の長さを測れませんでした。部品の長さは手で合わせてください。";

// 書き出しの結果の文言（§2-5＝次の行動／§2-3＝技術用語を出さない）。
const EXPORT_BUSY_OPEN_MESSAGE = "いま動画を書き出しています。終わってから、別の動画を開いてください。";
const EXPORT_DONE_MESSAGE = "動画を保存しました。";
const EXPORT_FAILED_MESSAGE = "動画を書き出せませんでした。しばらくしてから、もう一度お試しください。";
const EXPORT_CANCELLED_MESSAGE = "書き出しを中止しました。もう一度書き出せます。";
const EXPORT_UNSUPPORTED_MESSAGE = "この環境では動画を書き出せません。アプリから起動し直してお試しください。";

export interface TimelineState {
  /** 開いている文書（未オープンは null）。 */
  doc: TimelineProject | null;
  /** 開けなかった理由（利用者向け文言）。 */
  loadError: string | null;
  /** 読み込み中（二重に開かない）。 */
  isLoading: boolean;
  /** 再生ヘッドの位置（秒）。 */
  playheadSec: number;
  /** 選んでいるクリップ（複数選択・#629）。 */
  selectedClipIds: string[];
  /** 素材の表示用 src（assetId → URL）。場面形式の `assetSrcById` と同じ役割。 */
  assetSrcById: Record<string, string>;
  /**
   * 音源（**音源キー** → 再生できる URL）。**開いたときにまとめて用意する**＝鳴らす瞬間に読みに行くと
   * 頭が欠ける。キーはクリップ id ではなく**音源の中身**（`audioSourceKey`）なので、同じ曲を使う複数の
   * クリップで使い回せ、セッション中に増えたクリップ（複製）も読み直さずに鳴る。
   * 読めなかったものは入らない（その部品は鳴らない）。
   */
  audioSrcByKey: Record<string, string>;
  /** 取り消し/やり直し（ADR-0020 と同じスナップショット方式・積むのは文書そのもの）。 */
  history: HistoryStacks<TimelineProject>;
  /** 直前の操作が置けなかった理由（`15 §6` の `TIMELINE_EDIT_*`）。次の操作で消す。 */
  editBlocked: EditBlockedReason | null;
  /** 声を作れなかったときの案内（§2-5）。次に作り始めたら消す。 */
  voiceError: string | null;
  /**
   * いま声を作っている部品（`null`＝作っていない）。**文書には持たない**＝自動保存で「作成中」が
   * 残ると、開き直しても作り直せない状態が固定される（履歴にも積まない）。
   */
  generatingVoiceClipId: string | null;
  /** 保存の状態（場面形式の `saveStatus` と同じ語彙＝同じ概念を同じ言葉で扱う）。 */
  saveStatus: "idle" | "saving" | "saved" | "error";
  /** 再生中か。時計は画面側（`useTimelinePlayback`）が回し、位置は `setPlayhead` で入る。 */
  isPlaying: boolean;
  /** 書き出しの進み具合（`06 §12.1`）。**この画面の中だけ**で持つ＝場面形式の書き出しと状態を混ぜない。 */
  exportRun: TimelineExportRun;
  /**
   * 位置を外から動かした回数。**再生中のシークを時計へ伝える**ための世代番号で、
   * `playheadSec` を effect の依存にすると effect 自身が更新して回り続けるため、これを依存にする。
   */
  seekNonce: number;

  openTimelineProject: (projectId: string) => Promise<void>;
  closeTimelineProject: () => void;
  setPlayhead: (sec: number) => void;
  selectClip: (clipId: string, additive?: boolean) => void;
  clearSelection: () => void;

  /** 選んでいるクリップを動かす（列を替える／時間をずらす）。置けなければ何も変えず理由を持つ。 */
  moveSelectedClip: (to: { trackId?: string; startSec?: number }) => void;
  /** 選んでいるクリップの端を動かす（トリム）。 */
  trimSelectedClip: (edge: "start" | "end", sec: number) => void;
  /** 選んでいるクリップを複製する（同じ列の直後）。 */
  duplicateSelectedClip: () => void;
  /** 選んでいるクリップを消す。 */
  removeSelectedClips: () => void;
  /** 選んでいる見た目パターンの差し込み口に素材を入れる／外す（#632）。 */
  setSelectedClipAssetRef: (layerId: string, assetId: string | null) => void;
  /** 選んでいる字幕自身の文を書き換える（空にすると連動先の読み上げ文に戻る・#633）。 */
  setSelectedSubtitleText: (text: string) => void;
  /** 選んでいる字幕の連動先（読み上げ）を決める／やめる（#633）。 */
  setSelectedSubtitleVoiceLink: (voiceClipId: string | null) => void;
  /** 選んでいる見た目パターンの文字を書き換える（#632）。 */
  setSelectedClipText: (textKey: TextKey, text: string) => void;
  /** 見た目パターンの部品をバラす（中身ぶんの部品へ展開・#632）。**戻せない**（取り消しでだけ戻る）。 */
  explodeClip: (clipId: string, template: Template) => void;
  /** 読み上げを置く（#633＝タイムライン側でも声を作れる）。 */
  addVoiceClip: (input: { text: string; trackId: string; startSec: number }) => void;
  /** 選んでいる読み上げの文を書き換える（作成済みの音声は外れる・#633）。 */
  setSelectedVoiceText: (text: string) => void;
  /** 選んでいる読み上げの話者を変える（`null`＝動画全体に合わせる・#633）。 */
  setSelectedVoiceSpeaker: (speaker: number | null) => void;
  /** 選んでいる読み上げの声を作る（VOICEVOX）。作れたら**長さを実際の尺へ合わせる**（#633）。 */
  generateSelectedVoice: () => Promise<void>;
  /** 選んでいる読み上げに連動する字幕を置く（#633）。 */
  addLinkedSubtitleClip: () => void;
  /** 見た目パターンを素材として置く（#632）。 */
  addTemplateClip: (input: { template: Template; trackId: string; startSec: number }) => void;
  addTrack: (kind: TrackKind) => void;
  removeTrack: (trackId: string) => void;
  moveTrackOrder: (trackId: string, direction: "front" | "back") => void;
  setTrackFlag: (trackId: string, flag: "hidden" | "locked", value: boolean) => void;
  undo: () => void;
  redo: () => void;
  /** 編集内容をディスクへ書く（編集のたびに自動で走る＝閉じても消えない）。 */
  saveTimelineProject: () => Promise<void>;
  /** 再生を始める（終端にいるときは先頭から）。何も置いていない動画では始めない。 */
  play: () => void;
  /** 再生を止める（位置はそのまま＝続きから再生できる）。 */
  pause: () => void;
  /**
   * 時計が進めた位置を入れる（内部・`useTimelinePlayback` からのみ）。**`setPlayhead` と違い世代番号を
   * 上げない**＝時計自身の更新で「外から動かされた」と誤認して測り直しループに入るのを防ぐ。
   */
  _advancePlayhead: (sec: number) => void;

  /**
   * 動画（MP4）を書き出す。保存先を選ぶところから、描く→仕上げるまで。
   * **描くのに要るもの（見た目パターン・素材の src）は画面から受け取る**＝プレビューと同じ入力で描く
   * ＝見えているものがそのまま出る（ADR-0001）。
   */
  exportTimelineVideo: (deps: TimelineDrawDeps) => Promise<void>;
  /** 書き出しを止める（押した時点までの一時ファイルは片づける）。 */
  cancelTimelineExport: () => void;
  /** 完了・失敗の知らせを閉じる。 */
  dismissTimelineExport: () => void;
}

/** 描くのに要る入力（プレビューと共有＝別々に解決して食い違わせない）。 */
export interface TimelineDrawDeps {
  /** 置いてある見た目パターン（グローバル＝場面形式と同じ一覧）。 */
  templates: Template[];
  /** 見た目パターンが持つ既定素材の src（ADR-0021）。 */
  templateAssetSrcById: Record<string, string>;
}

/** 書き出しの進み具合（画面が読む）。 */
export interface TimelineExportRun {
  phase: TimelineExportPhase;
  /** 0〜100。描く段が 0〜80、仕上げが 80〜100（場面形式のバーと同じ配分＝同じ見え方）。 */
  percent: number;
  /** 結果や断りの案内（§2-5＝次の行動）。走行中は null。 */
  message: string | null;
  /** 中止を押したか（描くループが次のフレームで気づく）。 */
  cancelling: boolean;
}

/**
 * 書き出しの段。**場面形式と同じ値**（`EXPORT_RUN_PHASE`＝単一の参照元・§2-7）を使う＝
 * 同じ概念を形式ごとに別の言葉で持たない（ADR-0026②）。
 */
export type TimelineExportPhase = ExportRunPhase;

/** 走行中（押せない・二重に始めない）か。画面と store で同じ判定を使う（§6）。 */
export function isTimelineExportBusy(phase: TimelineExportPhase): boolean {
  return phase === P.preparing || phase === P.rendering || phase === P.encoding;
}

/** 声の合成（アプリ内は VOICEVOX・それ以外は Mock）。判定は場面形式（`projectStore`）と**同じ式**にする。 */
const hasTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
const voiceProvider: VoiceProvider = hasTauri ? new VoicevoxProvider() : new MockVoiceProvider();

const IDLE_EXPORT: TimelineExportRun = { phase: EXPORT_RUN_PHASE.idle, percent: 0, message: null, cancelling: false };

/** 段の値の短い別名（この file 内で何度も使う＝直書きしない・§2-7）。 */
const P = EXPORT_RUN_PHASE;

/** 書き出しの持ち主（`exportLock`）。場面形式と一時ファイルの置き場を取り合わないために使う。 */
const EXPORT_OWNER = "timeline" as const;

/**
 * 開いていない状態（閉じる・開き直しの初期値）。**毎回新しい実体を返す**＝配列/オブジェクトを使い回すと、
 * 将来その場書き換えが入ったときに別の文書へ選択が漏れる（構造で防ぐ）。
 */
function emptyState() {
  return {
    doc: null,
    loadError: null,
    isLoading: false,
    playheadSec: 0,
    selectedClipIds: [] as string[],
    assetSrcById: {} as Record<string, string>,
    audioSrcByKey: {} as Record<string, string>,
    history: emptyHistory<TimelineProject>(),
    editBlocked: null as EditBlockedReason | null,
    voiceError: null as string | null,
    generatingVoiceClipId: null as string | null,
    saveStatus: "saved" as TimelineState["saveStatus"],
    isPlaying: false,
    seekNonce: 0,
    exportRun: IDLE_EXPORT,
  };
}

export const useTimelineStore = create<TimelineState>((set, get) => ({
  ...emptyState(),

  openTimelineProject: async (projectId) => {
    // 書き出し中に別の動画を開くと、描いている途中の素材・音が入れ替わる（＝混ざった MP4 が出る）。
    // 開かずに理由を出す（§2-5）。画面側も一覧へ戻る導線を押せなくしているが、規則はここに置く。
    if (isTimelineExportBusy(get().exportRun.phase)) {
      set({ exportRun: { ...get().exportRun, message: EXPORT_BUSY_OPEN_MESSAGE } });
      return;
    }
    if (get().isLoading) return;
    set({ ...emptyState(), isLoading: true });
    try {
      const doc = parseTimelineProjectDoc(await loadProjectDoc(projectId));
      // 素材の表示用 src を解決する（動画は本体でなく代表フレーム＝場面形式の読込と同じ方針）。
      const entries = await Promise.all(
        doc.assets.map(async (a): Promise<[string, string] | null> => {
          const path = a.assetType === ASSET_TYPE.video ? a.thumbnailPath : a.filePath;
          if (!path) return null;
          const url = await assetDisplayUrl(doc.projectId, path);
          return url ? [a.assetId, url] : null;
        }),
      );
      const assetSrcById: Record<string, string> = {};
      for (const e of entries) if (e) assetSrcById[e[0]] = e[1];
      // 音源も**先に**用意する（鳴らす瞬間に読みに行くと頭が欠ける）。読めないものは黙って飛ばし、
      // その部品は鳴らない（読み込み失敗で動画全体を開けなくしない）。
      const audioEntries = await Promise.all(
        audioSourcesOf(doc).map(async (src): Promise<[string, string] | null> => {
          const url = src.voicePath
            ? await readVoiceDataUrl(doc.projectId, src.voicePath)
            : src.bundledBgmId
              ? (await readBundledBgmDataUrl(src.bundledBgmId)) ?? null
              : src.assetId
                ? await readAssetDataUrl(doc.projectId, assetPathOf(doc, src.assetId) ?? "")
                : null;
          return url ? [audioSourceKey(src), url] : null;
        }),
      );
      const audioSrcByKey: Record<string, string> = {};
      for (const e of audioEntries) if (e) audioSrcByKey[e[0]] = e[1];
      set({ doc, assetSrcById, audioSrcByKey, isLoading: false });
    } catch (e) {
      // 読込の失敗理由は文書側（TimelineLoadError）が「次の行動」つきで持っている。それ以外は既定文言。
      set({ ...emptyState(), loadError: e instanceof TimelineLoadError ? e.message : LOAD_FAILED_MESSAGE });
    }
  },

  closeTimelineProject: () => {
    // 開くときと同じ理由で、走行中は閉じない（`exportRun` ごと初期化されると書き出し中の締めが外れる）。
    if (isTimelineExportBusy(get().exportRun.phase)) return;
    set({ ...emptyState() });
  },

  // 再生ヘッドは [0, 尺] に収める＝ドラッグやキー操作で動画の外へ出ない（何も無い時刻を指さない）。
  setPlayhead: (sec) => {
    const doc = get().doc;
    if (!doc || !Number.isFinite(sec)) return; // 壊れた入力で位置を失わない
    // 再生中に位置を動かされたら、時計を測り直させる（そうしないと次のフレームで元へ戻る）。
    set({ playheadSec: clampTimelinePlayheadSec(doc, sec), seekNonce: get().seekNonce + 1 });
  },

  selectClip: (clipId, additive = false) =>
    set((s) => {
      if (!additive) return { selectedClipIds: [clipId] };
      // 追加選択は「入っていれば外す」＝同じ操作で付け外しできる（複数選択の通例）。
      return {
        selectedClipIds: s.selectedClipIds.includes(clipId)
          ? s.selectedClipIds.filter((id) => id !== clipId)
          : [...s.selectedClipIds, clipId],
      };
    }),

  clearSelection: () => set({ selectedClipIds: [] }),

  moveSelectedClip: (to) => applyEdit(set, get, (doc, id) => moveClip(doc, id, to)),
  trimSelectedClip: (edge, sec) => applyEdit(set, get, (doc, id) => trimClip(doc, id, edge, sec)),
  duplicateSelectedClip: () => applyEdit(set, get, (doc, id) => duplicateClip(doc, id)),

  removeSelectedClips: () => {
    const { doc, selectedClipIds } = get();
    if (!doc || selectedClipIds.length === 0) return;
    // 消した後は選択を空にする（消えたものを選んだままにしない）。
    commit(set, get, removeClips(doc, selectedClipIds), { selectedClipIds: [] });
  },

  setSelectedClipAssetRef: (layerId, assetId) => applyEdit(set, get, (d, id) => setClipAssetRef(d, id, layerId, assetId)),
  setSelectedClipText: (textKey, text) => applyEdit(set, get, (d, id) => setClipText(d, id, textKey, text)),
  setSelectedSubtitleText: (text) => applyEdit(set, get, (d, id) => setSubtitleText(d, id, text)),
  setSelectedSubtitleVoiceLink: (voiceClipId) =>
    applyEdit(set, get, (d, id) => setSubtitleVoiceLink(d, id, voiceClipId)),

  explodeClip: (clipId, template) => {
    const doc = get().doc;
    if (!doc) return;
    // **対象は確認したその部品**（選択ではなく id で受ける）＝確認を出したまま別の部品を選んでも、
    // 戻せない操作が別の部品に効かない。
    const r = explodeTemplateClip(doc, clipId, template);
    if (!r.ok) {
      set({ editBlocked: r.reason });
      return;
    }
    // バラした部品をまとめて選ぶ＝続けて動かせる（元の部品はもう無い）。
    const before = new Set(doc.clips.map((c) => c.id));
    commit(set, get, r.doc, { selectedClipIds: r.doc.clips.filter((c) => !before.has(c.id)).map((c) => c.id) });
  },

  addVoiceClip: (input) => {
    const doc = get().doc;
    if (!doc) return;
    const r = addVoiceClip(doc, input);
    if (!r.ok) {
      set({ editBlocked: r.reason });
      return;
    }
    const before = new Set(doc.clips.map((c) => c.id));
    const added = r.doc.clips.find((c) => !before.has(c.id));
    commit(set, get, r.doc, added ? { selectedClipIds: [added.id] } : {});
  },

  setSelectedVoiceText: (text) => applyEdit(set, get, (d, id) => setVoiceText(d, id, text)),
  setSelectedVoiceSpeaker: (speaker) => applyEdit(set, get, (d, id) => setVoiceSpeaker(d, id, speaker)),

  addLinkedSubtitleClip: () => {
    const { doc, selectedClipIds } = get();
    if (!doc || selectedClipIds.length !== 1) return;
    const r = addLinkedSubtitleClip(doc, selectedClipIds[0]);
    if (!r.ok) {
      set({ editBlocked: r.reason });
      return;
    }
    const before = new Set(doc.clips.map((c) => c.id));
    const added = r.doc.clips.find((c) => !before.has(c.id));
    commit(set, get, r.doc, added ? { selectedClipIds: [added.id] } : {});
  },

  generateSelectedVoice: async () => {
    const { doc, selectedClipIds } = get();
    if (!doc || selectedClipIds.length !== 1) return;
    const clipId = selectedClipIds[0];
    const clip = doc.clips.find((c) => c.id === clipId);
    if (!clip || clip.kind !== TIMELINE_CLIP_KIND.voice || !clip.voice) return;
    if (clip.voice.text.trim().length === 0) return; // 空の文では鳴らない（V28 が案内済み）
    if (get().generatingVoiceClipId != null) return; // 連打・再入で二重に作らない
    // 書き出し中は始めない＝作れても文書へ入れられず（`commit` が断る）、作った声を捨てることになる。
    if (isTimelineExportBusy(get().exportRun.phase)) {
      set({ voiceError: VOICE_EXPORTING_MESSAGE });
      return;
    }
    set({ voiceError: null, generatingVoiceClipId: clipId });
    // 合成に渡した設定。**完了時にこれと今の設定を比べる**＝作っている間に文・声・話し方を変えたら
    // その結果は使わない（鳴っている声と表示が食い違う状態を作らない）。
    const input = { text: clip.voice.text, ...resolveTimelineVoice(clip.voice, doc.voiceSettings) };
    try {
      const result = await voiceProvider.synthesize(input);
      const voicePath = await importVoiceFile(doc.projectId, clipId, result.audioDataUrl);
      // 作っている間に文書が入れ替わった／この部品が消えた／設定を変えた＝結果は捨てる。
      const now = get().doc;
      const current = now?.clips.find((c) => c.id === clipId);
      if (
        !now ||
        now.projectId !== doc.projectId ||
        !current?.voice ||
        !sameSynthInput(input, { text: current.voice.text, ...resolveTimelineVoice(current.voice, now.voiceSettings) })
      ) {
        set({ generatingVoiceClipId: null });
        return;
      }
      if (!voicePath) {
        setVoiceStatus(set, get, clipId, NARRATION_STATUS.failed);
        set({ voiceError: VOICE_SAVE_FAILED_MESSAGE, generatingVoiceClipId: null });
        return;
      }
      // **長さを実際の尺へ合わせる**（`trimClip` を通す＝連動している字幕も一緒に動く・ADR-0032 決定24）。
      const withVoice = {
        ...now,
        clips: now.clips.map((c) =>
          c.id === clipId && c.voice
            ? { ...c, voice: { ...c.voice, voicePath, status: NARRATION_STATUS.generated } }
            : c,
        ),
      };
      const sized =
        result.durationSec > 0 ? trimClip(withVoice, clipId, 'end', current.startSec + result.durationSec) : null;
      // 長さを合わせられない（置けない）ときは、**声はそのまま置いて**理由を出す＝作った声を捨てない。
      // 理由は `commit` の中で消えるので、まとめて渡す（`commit` は毎回 `editBlocked` を空にする）。
      commit(set, get, sized?.ok ? sized.doc : withVoice, {
        audioSrcByKey: { ...get().audioSrcByKey, [`voice:${voicePath}`]: result.audioDataUrl },
        ...(sized && !sized.ok ? { editBlocked: sized.reason } : {}),
      });
      set({
        generatingVoiceClipId: null,
        // 尺を測れなかったときは黙って仮の長さのままにしない（区間から出た声は鳴らない）。
        ...(result.durationSec > 0 ? {} : { voiceError: VOICE_DURATION_UNKNOWN_MESSAGE }),
      });
    } catch {
      // 失敗も成功と同じく**別の文書の部品を巻き込まない**（id は文書ごとに採番＝同じ id が別文書にもある）。
      const now = get().doc;
      if (now && now.projectId === doc.projectId && now.clips.some((c) => c.id === clipId)) {
        setVoiceStatus(set, get, clipId, NARRATION_STATUS.failed);
        set({ voiceError: VOICE_FAILED_MESSAGE });
      }
      set({ generatingVoiceClipId: null });
    }
  },

  addTemplateClip: (input) => {
    const doc = get().doc;
    if (!doc) return;
    const r = addTemplateClip(doc, input);
    if (!r.ok) {
      set({ editBlocked: r.reason });
      return;
    }
    // 置いた部品をそのまま選ぶ（続けて中身を入れられる）。**id は増えたものを引き当てる**＝
    // 「末尾に足す」という実装の都合に画面が寄りかからない。
    const before = new Set(doc.clips.map((c) => c.id));
    const added = r.doc.clips.find((c) => !before.has(c.id));
    commit(set, get, r.doc, added ? { selectedClipIds: [added.id] } : {});
  },

  addTrack: (kind) => {
    const doc = get().doc;
    if (doc) commit(set, get, addTrack(doc, kind));
  },
  removeTrack: (trackId) => {
    const doc = get().doc;
    if (!doc) return;
    const r = removeTrack(doc, trackId);
    if (!r.ok) {
      set({ editBlocked: r.reason });
      return;
    }
    // 列と一緒に消えるクリップは選択からも外す（消えたものを選んだままにしない）。
    const gone = new Set(doc.clips.filter((c) => c.trackId === trackId).map((c) => c.id));
    commit(set, get, r.doc, { selectedClipIds: get().selectedClipIds.filter((id) => !gone.has(id)) });
  },
  moveTrackOrder: (trackId, direction) => {
    const doc = get().doc;
    if (doc) commit(set, get, moveTrackOrder(doc, trackId, direction));
  },
  setTrackFlag: (trackId, flag, value) => {
    const doc = get().doc;
    if (doc) commit(set, get, setTrackFlag(doc, trackId, flag, value));
  },

  undo: () => {
    const { doc, history } = get();
    if (!doc || blockedByExport(set, get)) return;
    const r = undoSnapshot(history, doc);
    if (r) restore(set, get, r.restored, r.history);
  },
  redo: () => {
    const { doc, history } = get();
    if (!doc || blockedByExport(set, get)) return;
    const r = redoSnapshot(history, doc);
    if (r) restore(set, get, r.restored, r.history);
  },

  play: () => {
    const doc = get().doc;
    if (!doc) return;
    const total = timelineDurationSec(doc);
    if (total <= 0) return; // 何も置いていない動画では始めない（押しても動かない状態を作らない）
    set({ isPlaying: true, playheadSec: playbackStartSec(get().playheadSec, total), seekNonce: get().seekNonce + 1 });
  },
  pause: () => set({ isPlaying: false }),
  _advancePlayhead: (sec) => {
    const doc = get().doc;
    if (doc) set({ playheadSec: clampTimelinePlayheadSec(doc, sec) });
  },

  saveTimelineProject: async () => {
    const doc = get().doc;
    if (!doc) return;
    set({ saveStatus: "saving" });
    const next = withUpdatedAt(doc, new Date().toISOString());
    // **適合しないものは書かない**＝一覧に出るのに開けない動画を作らない（焼き出しと同じ判断・読込側は適合を要求する）。
    if (!validateTimelineProject(next)) {
      console.warn("[timeline] 保存内容がスキーマに未適合:", validateTimelineProject.errors);
      set({ saveStatus: "error" });
      return;
    }
    try {
      await saveProjectDoc(next.projectId, JSON.stringify(next, null, 2));
      // 保存中に更に編集されていたら「保存しました」にしない（未保存を保存済みに見せない）。
      set(get().doc === doc ? { doc: next, saveStatus: "saved" } : { saveStatus: "idle" });
    } catch {
      set({ saveStatus: "error" });
    }
  },

  exportTimelineVideo: async (deps) => {
    const doc = get().doc;
    if (!doc || isTimelineExportBusy(get().exportRun.phase)) return;
    // 場面形式の書き出しが走っていたら始めない（一時ファイルの置き場を取り合って壊れた動画が出る）。
    if (isOtherExportRunning(EXPORT_OWNER)) {
      set({ exportRun: { ...IDLE_EXPORT, phase: P.error, message: OTHER_EXPORT_RUNNING_MESSAGE } });
      return;
    }
    // 書き出せない理由があれば**作る前に**断る（静止画＋無音の動画を成功として出さない・ADR-0026④）。
    // 判定材料（読み込めている見た目）は描くときと**同じもの**を渡す＝断る条件と描く条件がずれない。
    const blockers = timelineExportBlockers(doc, {
      knownTemplateIds: new Set(deps.templates.map((t) => t.templateId)),
    });
    if (blockers.length > 0) {
      set({ exportRun: { ...IDLE_EXPORT, phase: P.error, message: exportBlockedMessage[blockers[0].code] } });
      return;
    }
    if (!canExport()) {
      // 「この端末では書き出せない」は失敗と別（場面形式と同じ扱い＝`11 §3.5` の `unsupported`）。
      set({ exportRun: { ...IDLE_EXPORT, phase: P.unsupported, message: EXPORT_UNSUPPORTED_MESSAGE } });
      return;
    }
    // 保存先を先に決める（重い処理をしてから「やっぱりやめる」を選ばせない）。ここから走行中に数える
    // ＝ダイアログを開いている間に続けて押しても、書き出しが二重に走らない。
    set({ exportRun: { ...IDLE_EXPORT, phase: P.preparing } });
    useExportLockStore.getState().acquire(EXPORT_OWNER);
    let unlisten: (() => void) | undefined;
    try {
      // 保存先を聞くのも try の中（失敗しても `preparing` のまま固まらない＝画面が戻らなくなる）。
      const outputPath = await showSaveVideoDialog(doc.projectName || "movie");
      if (!outputPath) {
        set({ exportRun: IDLE_EXPORT });
        return;
      }
      // ダイアログの間に中止を押していたら始めない（押した中止を黙って無かったことにしない）。
      if (get().exportRun.cancelling) throw new ExportCancelledError();
      // 再生したまま書き出すと、鳴っている音と作業が重なる。止めてから始める（ADR-0032 追補と同じ流儀）。
      get().pause();
      // **描くのに使うものは、始めた時点のものを取っておく**（数分かかる処理の途中で別の動画を開かれても、
      // 別プロジェクトの絵や音が混ざらない＝場面形式が #379/#570 で潰したのと同じ事故）。
      const { assetSrcById, audioSrcByKey } = get();
      set({ exportRun: { phase: P.rendering, percent: 0, message: null, cancelling: false } });
      await beginExport();
      unlisten = await listenExportProgress((ev) => {
        set({
          exportRun: {
            ...get().exportRun,
            phase: P.encoding,
            percent: exportOverallPercent({ phase: P.encoding, progress: { done: 0, total: 0 }, encode: ev }),
          },
        });
      });
      await clearExportFramesStage();
      // 同梱フォントを先にそろえる（読み込み済みの字体しか焼けない＝プレビューと違う字にしない）。
      await loadExportFonts();
      const templateById = new Map(deps.templates.map((t) => [t.templateId, t]));
      const frames = await buildTimelineFrames(doc, {
        templateOf: (id) => templateById.get(id),
        // プレビュー（`TimelineProjectScreen`）と**同じ引き方**＝同じ絵になる。
        assetSrc: (id) => (id ? assetSrcById[id] ?? deps.templateAssetSrcById[id] : undefined),
        // 動画全体のフォント（`videoSettings.fontId`）は、部品ごとの指定が無いときの受け皿（11 §6 継承）。
        fontFamily: fontFamilyForId(doc.videoSettings.fontId),
        fallbackCredit: creditForSpeaker(getVoicevoxSpeaker()),
        stageFrame: stageExportFrame,
        onProgress: (done, total) =>
          set({
            exportRun: {
              ...get().exportRun,
              percent: exportOverallPercent({ phase: P.rendering, progress: { done, total } }),
            },
          }),
        shouldCancel: () => get().exportRun.cancelling,
      });
      if (get().exportRun.cancelling) throw new ExportCancelledError();
      set({ exportRun: { ...get().exportRun, phase: P.encoding } });
      const bgmRuns = timelineBgmRunInputs(doc, audioSrcByKey);
      await exportVideo([frames], doc.projectName || "movie", bgmRuns, doc.projectId, outputPath);
      set({ exportRun: { phase: P.done, percent: 100, message: EXPORT_DONE_MESSAGE, cancelling: false } });
    } catch (e) {
      const cancelled = e instanceof ExportCancelledError || get().exportRun.cancelling;
      set({
        exportRun: {
          ...IDLE_EXPORT,
          phase: cancelled ? P.cancelled : P.error,
          message: cancelled ? EXPORT_CANCELLED_MESSAGE : EXPORT_FAILED_MESSAGE,
        },
      });
    } finally {
      unlisten?.();
      useExportLockStore.getState().release(EXPORT_OWNER);
      // 一時ファイルは成功でも失敗でも片づける（次の書き出しに古いフレームを混ぜない）。
      await clearExportFramesStage();
    }
  },

  cancelTimelineExport: () => {
    const run = get().exportRun;
    if (!isTimelineExportBusy(run.phase)) return;
    set({ exportRun: { ...run, cancelling: true } });
    void cancelExport();
  },

  dismissTimelineExport: () => {
    // 走行中に出る知らせ（別の動画を開こうとした等）を閉じても、**走行中は解除しない**
    // ＝閉じるボタンが「書き出し中の締め」を外す抜け道にならない（一覧へ戻る・二重起動が開く）。
    const run = get().exportRun;
    set({ exportRun: isTimelineExportBusy(run.phase) ? { ...run, message: null } : IDLE_EXPORT });
  },
}));

/**
 * 音の並べ方（domain）を、混ぜる側の入力へ写す。**音源は再生と同じもの**（`audioSrcByKey`）＝
 * 聞いた音と書き出した音が一致する。読めなかった音源は置かない（その部品は鳴らない）。
 */
export function timelineBgmRunInputs(doc: TimelineProject, audioSrcByKey: Record<string, string>): BgmRunInput[] {
  const runs: BgmRunInput[] = [];
  for (const run of timelineAudioRuns(doc)) {
    const audioBase64 = audioSrcByKey[run.sourceKey];
    if (!audioBase64) continue;
    runs.push({
      audioBase64,
      fileExt: run.fileExt,
      volume: run.volume,
      delaySec: run.delaySec,
      playSec: run.playSec,
      fadeInSec: run.fadeInSec,
      fadeOutSec: run.fadeOutSec,
      loopSource: run.loop,
      sourceStartSec: run.sourceStartSec,
      speed: run.speed,
    });
  }
  return runs;
}


/** 素材 id → プロジェクト相対のファイルパス（音の素材を読むのに使う）。 */
function assetPathOf(doc: TimelineProject, assetId: string): string | undefined {
  return doc.assets.find((a) => a.assetId === assetId)?.filePath;
}

type SetState = (partial: Partial<TimelineState>) => void;
type GetState = () => TimelineState;

/**
 * 変更を確定して履歴へ積む（ADR-0020 と同じ＝**適用前**の文書を past へ）。
 * 文書が変わっていないとき（端で何も起きない操作など）は履歴を汚さない＝取り消しが空振りしない
 * （各操作は「変わらないなら同一参照」を返すので、参照比較で足りる）。
 */
function commit(set: SetState, get: GetState, next: TimelineProject, extra: Partial<TimelineState> = {}): void {
  // 書き出しは**始めた時点の文書**を焼く。途中の編集は動画に入らないので、黙って受け付けない（§2-5）。
  if (isTimelineExportBusy(get().exportRun.phase)) {
    set({ editBlocked: EDIT_BLOCKED.exporting });
    return;
  }
  const current = get().doc;
  if (!current || next === current) {
    set({ editBlocked: null, ...extra });
    return;
  }
  set({
    doc: next,
    history: recordSnapshot(get().history, current),
    editBlocked: null,
    saveStatus: "idle",
    // 編集したら再生を止める＝「再生位置へ」のような操作が**動いている的**を狙うのを防ぐ（結果が毎回変わる）。
    isPlaying: false,
    // 尺が縮んだら位置を収める（消した部品より後ろに取り残さない）。
    playheadSec: clampTimelinePlayheadSec(next, get().playheadSec),
    ...extra,
  });
}

/**
 * 取り消し/やり直しで文書を差し替える。**消えたクリップを選んだままにしない**（戻した文書に無い
 * 選択が残ると、次の操作が「変化ゼロ」の履歴を積む）。
 */
/** 書き出し中は取り消し・やり直しも止める（`commit` と同じ理由＝焼く文書は始めた時点のもの）。 */
function blockedByExport(set: SetState, get: GetState): boolean {
  if (!isTimelineExportBusy(get().exportRun.phase)) return false;
  set({ editBlocked: EDIT_BLOCKED.exporting });
  return true;
}

function restore(set: SetState, get: GetState, doc: TimelineProject, history: HistoryStacks<TimelineProject>): void {
  const ids = new Set(doc.clips.map((c) => c.id));
  set({
    doc,
    history,
    editBlocked: null,
    saveStatus: "idle",
    isPlaying: false, // 取り消し/やり直しも編集と同じ扱い（動いている的を狙わせない）
    playheadSec: clampTimelinePlayheadSec(doc, get().playheadSec),
    selectedClipIds: get().selectedClipIds.filter((id) => ids.has(id)),
  });
}

/**
 * 「選んでいる1つのクリップ」に対する編集を流す。**置けなかったら文書を変えず理由だけ持つ**
 * （§2-5＝画面が「その場所には置けません」を出す）。複数選択中は対象が決まらないので何もしない。
 */
function applyEdit(set: SetState, get: GetState, run: (doc: TimelineProject, clipId: string) => EditResult): void {
  const { doc, selectedClipIds } = get();
  if (!doc || selectedClipIds.length !== 1) return;
  const r = run(doc, selectedClipIds[0]);
  if (r.ok) commit(set, get, r.doc);
  else set({ editBlocked: r.reason });
}

/** 読み上げクリップの状態だけを差し替える（履歴に積まない＝作成中/失敗は編集ではない）。 */
function setVoiceStatus(set: SetState, get: GetState, clipId: string, status: NarrationStatus): void {
  const doc = get().doc;
  if (!doc) return;
  set({
    doc: {
      ...doc,
      clips: doc.clips.map((c) => (c.id === clipId && c.voice ? { ...c, voice: { ...c.voice, status } } : c)),
    },
  });
}

/**
 * 読み上げクリップの声の設定を解く（`11 §6` null=継承）。場面形式の `resolveNarrationVoice` と同じ順序で、
 * **話者だけはクリップが持つ**（掛け合いの行と同じ扱い＝ADR-0015）。
 */
function resolveTimelineVoice(voice: TimelineVoice, settings: VoiceSettings) {
  const resolved = resolveNarrationVoice(
    { text: voice.text, status: voice.status, speed: voice.speed, pitch: voice.pitch, intonation: voice.intonation },
    settings,
  );
  // catalog に無い話者は既定の声へ落とす（場面形式の `resolveLineVoice`＝V19 と同じ扱い）。
  const speaker = voice.speaker != null && characterForSpeaker(voice.speaker) != null ? voice.speaker : null;
  return { ...resolved, speaker };
}
