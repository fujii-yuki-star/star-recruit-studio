import { invoke } from "@tauri-apps/api/core";
import type { EditDoc, Op } from "./types";

/** 反映の結果（`applyTransaction` の結果＋当て直したか＝Rust の `edit::apply`）。 */
export interface ApplyResult {
  applied: boolean;
  revision: string;
  /** その間に AI が書いていたので、最新の中身に同じ操作を当て直した（MV-0008 決定2）。 */
  reapplied: boolean;
  created: { opIndex: number; kind: string; id: string }[];
}

/**
 * 画面の編集の口（MV-0008 決定1）。⚠️ 書くのは Rust の取引だけ（外部 AI と同じ検査と保存の道）。
 * 1か所に集める＝検査で差し替えられるようにする。
 */
export const editApi = {
  read: (dir: string): Promise<EditDoc> => invoke("edit_read", { dir }),
  /** 断られたら（検査に問題が残る・錠が外れない）理由の文で失敗する＝何も変えていない。 */
  apply: (dir: string, ops: Op[], baseRevision: string | null): Promise<ApplyResult> =>
    invoke("edit_apply", { dir, ops, baseRevision }),
  /** 掴んで動かしている途中の見え方（保存しない）。`null` でやめる。 */
  trial: (ops: Op[] | null): Promise<void> => invoke("edit_trial", { ops }),
};
