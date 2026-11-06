import { create } from "zustand";
import type { BriefingCatalog } from "../../domain/briefing/catalog";

/**
 * あなた向け会社説明の**学生の画面**（全画面の専用モード・ADR-0061 決定3）に入っているか。
 *
 * ⚠️ **覚えるのは起動している間だけ**（`localStorage` に入れない）＝アプリを閉じれば抜けられる
 *（利用者判断 2026-11-05＝番号を忘れたときの抜け道）。開き直すと通常の画面から始まる。
 * ⚠️ 登録は入った時点の写しを持つ（学生の画面の途中で登録が変わっても、その回は同じ登録で組む）。
 */
export type BriefingStudentState = {
  catalog: BriefingCatalog | null;
  enter: (catalog: BriefingCatalog) => void;
  exit: () => void;
};

export const useBriefingStudentStore = create<BriefingStudentState>((set) => ({
  catalog: null,
  enter: (catalog) => set({ catalog }),
  exit: () => set({ catalog: null }),
}));
