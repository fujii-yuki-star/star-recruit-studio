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

/**
 * **直前の回の後片づけがまだ終わっていない**ときの案内（#843・§2-5）。
 *
 * ⚠️ **`OTHER_EXPORT_RUNNING_MESSAGE` を流用しない**＝走っている「ほかの動画」は無く、
 * 片づけているのは**自分の直前の回**。主語が実態と違う案内は、次の行動は合っていても嘘になる。
 */
export const EXPORT_CLEANUP_PENDING_MESSAGE =
  "前の書き出しの後片づけをしています。少し待ってから、もう一度お試しください。";

/**
 * **自分の締めが残ったまま、走ってはいない**か（#843）＝直前の回の後片づけ（一時ファイルの削除）を
 * 待っている窓。書き出しの終わり（成功・中止・失敗）は片づけより**先**に立つので、この窓では
 * ボタンが押せる状態に戻っているのに `acquire` は失敗する＝**押す前に断る**ための材料。
 *
 * ⚠️ 純粋関数にしてあるのは、画面が購読している値（持ち主・走行中か）から**その場で**導けるようにするため
 *（`06 §12.1`＝押す前に無効化して出す理由と、押したときに断る理由が同じ述語から来る）。
 */
export function isOwnCleanupPending(owner: ExportOwner | null, self: ExportOwner, busy: boolean): boolean {
  return !busy && owner === self;
}

/**
 * **締めが理由で始められないときの断り**（`null`＝締めは空いている・#843）。
 *
 * 押す前の無効化と、押した瞬間の断りが**同じ述語**から来るようにするための1か所（`06 §12.1`）。
 *
 * ⚠️ **持ち主で場合分けする**（並べた条件の順番で決めない）＝2つの理由は**同時に真になり得ない**
 *（どちらも同じ `owner` から導くので、相手が持っているなら自分の後片づけ待ちではない）。
 * 順番で守る形に書くと、実際には作れない組み合わせを「順序で解決している」と読ませてしまう。
 */
export function exportLockBlockedMessage(owner: ExportOwner | null, self: ExportOwner, busy: boolean): string | null {
  if (owner == null) return null;                            // 締めは空いている
  if (owner !== self) return OTHER_EXPORT_RUNNING_MESSAGE;   // 相手が走っている
  return busy ? null : EXPORT_CLEANUP_PENDING_MESSAGE;       // 自分＝走行中なら理由なし／でなければ後片づけ待ち
}
