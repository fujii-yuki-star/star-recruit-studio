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
    { label: "ゆうこに動画案を作ってもらう", backName: "動画案づくり" },
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
  const prev = steps[step - 1];
  return prev ? `${prev.backName}へ戻る` : BACK_TO_HOME_LABEL;
}
