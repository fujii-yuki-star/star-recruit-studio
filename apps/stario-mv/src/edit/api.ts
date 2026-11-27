import { invoke } from "@tauri-apps/api/core";
import type { AnimValue, EditDoc, Layer, Op } from "./types";

/** 戻せる取引・やり直せる取引の名前（MV-0009）。 */
export interface HistoryStatus {
  undo: string | null;
  redo: string | null;
}

/** 反映の結果（`applyTransaction` の結果＋当て直したか＝Rust の `edit::apply`）。 */
export interface ApplyResult {
  applied: boolean;
  revision: string;
  /** その間に AI が書いていたので、最新の中身に同じ操作を当て直した（MV-0008 決定2）。 */
  reapplied: boolean;
  created: { opIndex: number; kind: string; id: string }[];
  /** 反映したが知らせたいこと（見た目を保てなかった など）。 */
  warnings?: string[];
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
  /** 元に戻す・やり直す（MV-0009）。戻せなければ理由の文で失敗する。 */
  undo: (dir: string): Promise<unknown> => invoke("edit_undo", { dir }),
  redo: (dir: string): Promise<unknown> => invoke("edit_redo", { dir }),
  /** 戻せる取引・やり直せる取引の名前（無ければ null）。 */
  history: (dir: string): Promise<HistoryStatus> => invoke("edit_history", { dir }),
  /** project.json が読めないとき、履歴の最後の中身から開き直す（MV-0009 決定5）。 */
  recover: (dir: string): Promise<string> => invoke("edit_recover", { dir }),
  /** 取り込む素材のファイルを選ぶ（利用者が選ぶ＝許したフォルダの外でも取り込める）。選ばなければ空。 */
  pickAssets: (): Promise<string[]> => invoke("pick_asset_files"),
  /** レイヤーの動かせる値の、そのフレームでの値（描画の核と同じ計算）。`{ "/transform/position": [x, y], … }`。 */
  eval: (layer: Layer, frame: number): Promise<Record<string, AnimValue>> => invoke("edit_eval", { layer, frame }),
};
