// 「いまどちらの形式が動画を書き出しているか」（#631 レビュー）。
//
// 場面形式（`projectStore` の `exportRun`）とタイムライン形式（`timelineStore` の `exportRun`）は別の状態
// だが、**FFmpeg と一時ファイルの置き場はアプリで1つ**（`clear_export_frames_stage` は置き場を丸ごと消す）。
// 片方が走っている最中にもう片方を始めると、相手のフレームを消して**壊れた/短い動画**が出る。
// どちらのボタンからも同じものを見るために、走行中の持ち主をここに1つだけ置く（§2-7）。
import { create } from "zustand";

/** どちらの形式が書き出しているか（`null`＝走っていない）。 */
export type ExportOwner = "scene" | "timeline";

interface ExportLockState {
  owner: ExportOwner | null;
  /** 取れたら true（すでに誰かが走っていたら false＝始めない）。 */
  acquire: (owner: ExportOwner) => boolean;
  /** 自分が持っているときだけ返す（他人のものを外さない）。 */
  release: (owner: ExportOwner) => void;
}

export const useExportLockStore = create<ExportLockState>((set, get) => ({
  owner: null,
  acquire: (owner) => {
    if (get().owner != null) return false;
    set({ owner });
    return true;
  },
  release: (owner) => {
    if (get().owner === owner) set({ owner: null });
  },
}));

/** 別の形式が書き出し中か（自分は数えない＝自分の走行は各 store の `exportRun` が持つ）。 */
export function isOtherExportRunning(self: ExportOwner): boolean {
  const owner = useExportLockStore.getState().owner;
  return owner != null && owner !== self;
}

/** 別の形式が書き出しているときの案内（§2-5＝次の行動）。どちらの画面でも同じ言い方にする。 */
export const OTHER_EXPORT_RUNNING_MESSAGE =
  "ほかの動画を書き出しています。終わってから、もう一度お試しください。";
