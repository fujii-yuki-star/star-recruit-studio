import { create } from "zustand";

/**
 * 起動のときに頼まれた仕事の、いまの状態（ADR-0042・#1184）。
 *
 * ⚠️ **ここに置く理由**＝頼まれごとを受け取るのは起動直後（`App`）だが、実際に走るのは
 * **書き出しの画面**なので、画面をまたいで持ち回る必要がある。
 * ⚠️ **`project.schema` には入れない**＝動画の中身ではなく、**この起動だけの事情**（ADR-0033 と同じ考え方）。
 */
export type StartupJobState = {
  /**
   * 起動のときに**何か頼まれているか**が分かったか（PR #1197 レビュー 🔴）。
   *
   * ⚠️ **これが要る理由**＝`App` は起動時に「最後に開いていた動画」を自動で開く。
   * 頼まれごとの読み取りは IPC の往復なので、**自動で開く方が後から勝つ**ことがある＝
   * AI が `--export <B>` で起こしたのに**直前の A が書き出される**（しかも成功として返る）。
   * ⚠️ **待たせるのは「分かるまで」だけ**＝頼まれていないと分かれば、すぐ自動で開く。
   */
  requestKnown: "unknown" | "none" | "job";
  setRequestKnown: (v: "none" | "job") => void;
  /**
   * 書き出し先（指定されていれば、**保存先を聞かずに**ここへ書く）。
   * ⚠️ **1回きり**＝走り始めたら消す。残すと、次に人が押した書き出しまで同じ所へ書く。
   */
  pendingExportOut: string | null;
  /** その仕事が**後から渡されたもの**か（真なら終わっても閉じない＝仕事の持ち主が違う）。 */
  forwarded: boolean;
  /** 画面に出す知らせ（うまくいった／断った）。 */
  notice: string | null;
  setPendingExport: (out: string, forwarded: boolean) => void;
  takePendingExport: () => { out: string; forwarded: boolean } | null;
  setNotice: (notice: string | null) => void;
};

export const useStartupJobStore = create<StartupJobState>((set, get) => ({
  requestKnown: "unknown",
  setRequestKnown: (v) => set({ requestKnown: v }),
  pendingExportOut: null,
  forwarded: false,
  notice: null,
  setPendingExport: (out, forwarded) => set({ pendingExportOut: out, forwarded }),
  // ⚠️ **取り出したら消す**＝「1回きり」を呼ぶ側の作法に頼らない（忘れると次の書き出しが化ける）。
  takePendingExport: () => {
    const out = get().pendingExportOut;
    if (out == null) return null;
    const forwarded = get().forwarded;
    set({ pendingExportOut: null });
    return { out, forwarded };
  },
  setNotice: (notice) => set({ notice }),
}));
