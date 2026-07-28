// タイムライン編集プロジェクト（ADR-0032・#629）の編集状態。**場面形式とは別の文書**なので store も分ける
// （projectStore に相乗りすると、片方にしか無い概念〔場面・パート〕が混ざって両形式の不変条件が曖昧になる）。
import { create } from "zustand";
import { assetDisplayUrl } from "../../infrastructure/assetFs";
import { loadProjectDoc, saveProjectDoc } from "../../infrastructure/projectFs";
import { validateTimelineProject } from "../../domain/validation/generated/validators.js";
import { ASSET_TYPE } from "../../domain/enums";
import { parseTimelineProjectDoc, TimelineLoadError, timelineDurationSec, withUpdatedAt } from "../../domain/timeline/persistence";
import { clampTimelinePlayheadSec, playbackStartSec } from "../../domain/timeline/playback";
import type { TimelineProject } from "../../domain/timeline/types";
import type { TrackKind } from "../../domain/enums";
import {
  addTrack, duplicateClip, moveClip, moveTrackOrder, removeClips, removeTrack, setTrackFlag, trimClip,
} from "../../domain/timeline/edit";
import type { EditBlockedReason, EditResult } from "../../domain/timeline/edit";
import { emptyHistory, recordSnapshot, redoSnapshot, undoSnapshot } from "../../domain/project/history";
import type { HistoryStacks } from "../../domain/project/history";

/** 読み込めなかったときの文言（§2-5：原因でなく次の行動）。想定外も生のエラーを見せない。 */
const LOAD_FAILED_MESSAGE = "この動画を開けませんでした。一覧から選び直してください。";

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
  /** 取り消し/やり直し（ADR-0020 と同じスナップショット方式・積むのは文書そのもの）。 */
  history: HistoryStacks<TimelineProject>;
  /** 直前の操作が置けなかった理由（`15 §6` の `TIMELINE_EDIT_*`）。次の操作で消す。 */
  editBlocked: EditBlockedReason | null;
  /** 保存の状態（場面形式の `saveStatus` と同じ語彙＝同じ概念を同じ言葉で扱う）。 */
  saveStatus: "idle" | "saving" | "saved" | "error";
  /** 再生中か。時計は画面側（`useTimelinePlayback`）が回し、位置は `setPlayhead` で入る。 */
  isPlaying: boolean;
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
}

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
    history: emptyHistory<TimelineProject>(),
    editBlocked: null as EditBlockedReason | null,
    saveStatus: "saved" as TimelineState["saveStatus"],
    isPlaying: false,
    seekNonce: 0,
  };
}

export const useTimelineStore = create<TimelineState>((set, get) => ({
  ...emptyState(),

  openTimelineProject: async (projectId) => {
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
      set({ doc, assetSrcById, isLoading: false });
    } catch (e) {
      // 読込の失敗理由は文書側（TimelineLoadError）が「次の行動」つきで持っている。それ以外は既定文言。
      set({ ...emptyState(), loadError: e instanceof TimelineLoadError ? e.message : LOAD_FAILED_MESSAGE });
    }
  },

  closeTimelineProject: () => set({ ...emptyState() }),

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
    if (!doc) return;
    const r = undoSnapshot(history, doc);
    if (r) restore(set, get, r.restored, r.history);
  },
  redo: () => {
    const { doc, history } = get();
    if (!doc) return;
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
}));

type SetState = (partial: Partial<TimelineState>) => void;
type GetState = () => TimelineState;

/**
 * 変更を確定して履歴へ積む（ADR-0020 と同じ＝**適用前**の文書を past へ）。
 * 文書が変わっていないとき（端で何も起きない操作など）は履歴を汚さない＝取り消しが空振りしない
 * （各操作は「変わらないなら同一参照」を返すので、参照比較で足りる）。
 */
function commit(set: SetState, get: GetState, next: TimelineProject, extra: Partial<TimelineState> = {}): void {
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
