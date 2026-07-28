// タイムライン編集プロジェクト（ADR-0032・#629）の編集状態。**場面形式とは別の文書**なので store も分ける
// （projectStore に相乗りすると、片方にしか無い概念〔場面・パート〕が混ざって両形式の不変条件が曖昧になる）。
import { create } from "zustand";
import { assetDisplayUrl } from "../../infrastructure/assetFs";
import { loadProjectDoc } from "../../infrastructure/projectFs";
import { ASSET_TYPE } from "../../domain/enums";
import { parseTimelineProjectDoc, TimelineLoadError, timelineDurationSec } from "../../domain/timeline/persistence";
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
    const max = doc ? timelineDurationSec(doc) : 0;
    if (!Number.isFinite(sec)) return; // 壊れた入力で位置を失わない
    set({ playheadSec: Math.min(Math.max(0, sec), max) });
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
    // 列と一緒に消えるクリップは選択からも外す（消えたものを選んだままにしない）。
    const gone = new Set(doc.clips.filter((c) => c.trackId === trackId).map((c) => c.id));
    commit(set, get, removeTrack(doc, trackId), {
      selectedClipIds: get().selectedClipIds.filter((id) => !gone.has(id)),
    });
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
    if (r) set({ doc: r.restored, history: r.history, editBlocked: null });
  },
  redo: () => {
    const { doc, history } = get();
    if (!doc) return;
    const r = redoSnapshot(history, doc);
    if (r) set({ doc: r.restored, history: r.history, editBlocked: null });
  },
}));

type SetState = (partial: Partial<TimelineState>) => void;
type GetState = () => TimelineState;

/**
 * 変更を確定して履歴へ積む（ADR-0020 と同じ＝**適用前**の文書を past へ）。
 * 文書が変わっていないとき（端で何も起きない操作など）は履歴を汚さない＝取り消しが空振りしない。
 */
function commit(set: SetState, get: GetState, next: TimelineProject, extra: Partial<TimelineState> = {}): void {
  const current = get().doc;
  if (!current || next === current) {
    set({ editBlocked: null, ...extra });
    return;
  }
  set({ doc: next, history: recordSnapshot(get().history, current), editBlocked: null, ...extra });
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
