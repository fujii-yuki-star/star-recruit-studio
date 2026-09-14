// ウィザードの段と、戻るの文言（`06 §2` 規約3・#1026）。
//
// ⚠️ **画面の file から出す**＝画面に部品以外を置くと、直したときに画面全体が
// 作り直されて入力中の状態が飛ぶ（`react-refresh/only-export-components`）。
// 3つの画面が既にこの警告を抱えているので、新しく増やさない。
import { BACK_TO_HOME_LABEL } from "../uiLabels";
import { VIDEO_KIND, type VideoKind } from "../../domain/enums";

/**
 * ウィザードの段（名札と、**戻り先としての呼び名**）。
 *
 * ⚠️ **2つの配列に割らない**（#1026）＝名札だけ足して呼び名を忘れると、
 * 戻るが「undefined へ戻る」になるか、黙って行き先名を落とす。1つの並びで持つ。
 * ⚠️ **名札をそのまま行き先名にしない**＝「会社情報を入力へ戻る」は読めない。
 * 名札は**これからすること**（動詞）、呼び名は**その場所**（名詞）。
 * ⚠️ **呼び名は名札から採る**（#1141 レビュー由来 🟡）＝画面に出ていない言い換えを足さない
 *（§2-3＝同じものを2つの言葉で呼ばない）。最後の段だけ「動画案づくり」という**この画面の
 * どこにも出ていない語**にしていた。検査は「名札に含まれること」と「動詞になっていないこと」
 * （`を` を含まない）の2つで見る＝次に段を足したときも同じ型で捕まる。
 */
export interface WizardStep {
  readonly label: string;
  readonly backName: string;
}

export function stepsFor(videoKind: VideoKind): readonly WizardStep[] {
  const second: WizardStep =
    videoKind === VIDEO_KIND.general
      ? { label: "発表の内容を入力", backName: "発表の内容" }
      : { label: "会社情報を入力", backName: "会社情報" };
  return [
    { label: "動画の種類と目的", backName: "動画の種類と目的" },
    second,
    { label: "写真・動画を追加", backName: "写真・動画" },
    { label: "読み上げの声を設定", backName: "読み上げの声" },
    { label: "ゆうこに動画案を作ってもらう", backName: "動画案" },
  ];
}

/**
 * 戻るの文言（`06 §2` 規約3＝**ghost＋←＋「◯◯へ戻る」**）。
 *
 * ⚠️ **行き先名を言わない「戻る」だった**（#1026）＝この画面の戻るは
 * **段によって行き先が変わる**（1つ前の段／いちばん最初は一覧）ので、
 * 名前が無いと**どこへ出るのか押すまで分からない**。
 */
export function wizardBackLabel(step: number, steps: readonly WizardStep[]): string {
  // ⚠️ **前の段が無ければ一覧へ**＝行き止まりにしない（範囲の外もここへ倒れる）。
  // ⚠️ **最後の段の呼び名は、いまの段数では読まれない**（#1141 レビュー由来 ℹ️）＝
  // 見るのは `step - 1` なので、いちばん後ろの段が「1つ前」になることがない。
  // 消さずに持たせているのは、**段が増えたときに呼び名だけ忘れる**のを防ぐため
  //（呼び名の規則は `WizardScreen.test.tsx` が全段に当てている）。
  const prev = steps[step - 1];
  return prev ? `${prev.backName}へ戻る` : BACK_TO_HOME_LABEL;
}
