// @vitest-environment jsdom
// **上限を超えた動画案を断ったときの次の行動**（#1222・PR #1223 レビュー 🟡）。
//
// ⚠️ **文とボタンが逆を向いていた**＝断りの文は「もう一度お試しください」を**避けて**いる
//（同じ内容で頼み直すとまた超えるので＝§2-5）のに、画面の主操作は「もう一度試す」＝
// `reset(); generate()` で**同じ入力をそのまま送り直す**形だった。
// ⚠️ **見出しも違っていた**＝「動画案の作成に失敗しました」だが、AI は最後まで作れている。
// **こちらが取り込みを断った**だけなので、失敗と言うと AI や通信のせいに読める。
// ⚠️ **2つの画面が同じ2択を共有している**（`GeneratingScreen`／`NoScenesState`＝#590・ADR-0026②）
// ので、**両方**を見る。片方だけ直すのはこのリポジトリが繰り返している型。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { GeneratingScreen } from "./GeneratingScreen";
import { NoScenesState } from "../components/NoScenesState";
import { useProjectStore } from "../store/projectStore";
import { aiSceneLimitMessage } from "../../domain/project/sceneLimit";
import {
  EDIT_WIZARD_INPUT_LABEL, GENERATE_FAILED_TITLE, GENERATE_TOO_LONG_TITLE, RETRY_GENERATE_LABEL, START_MANUAL_LABEL,
} from "../uiLabels";

/**
 * 断りの種類だけを変えて、同じ「作れなかった」状態にする。
 *
 * ⚠️ **`generate` を止める**＝作成中の画面は**開いた瞬間に生成を始める**ので、
 * 止めないと `status` が上書きされて**断りの画面が一度も描かれない**（検査が空振りする）。
 */
const 断られた状態 = (aiError: string) =>
  useProjectStore.setState({ status: "error", scenes: [], aiError, generate: vi.fn() } as never);

const 別の断り = "接続キーが設定されていません。設定画面で登録してください。";

describe("上限を超えた動画案を断ったときの次の行動（#1222）", () => {
  beforeEach(() => useProjectStore.setState({ scenes: [], warnings: [] } as never));
  afterEach(() => {
    vi.restoreAllMocks();
    useProjectStore.setState({ status: "idle", aiError: null } as never);
  });

  describe("作成中の画面", () => {
    it("見出しは「作成に失敗」ではない（AI は作れている）", () => {
      断られた状態(aiSceneLimitMessage(93));
      render(<GeneratingScreen onNavigate={vi.fn()} />);
      expect(screen.getByText(GENERATE_TOO_LONG_TITLE)).toBeInTheDocument();
      expect(screen.queryByText(GENERATE_FAILED_TITLE), "作成は失敗していない").toBeNull();
    });

    // ⚠️ **ここが本題**＝同じ入力の再送を出すと、押した人は**また同じ断り**に着く。
    it("同じ入力での再送を出さず、入力を見直す道を出す", () => {
      断られた状態(aiSceneLimitMessage(93));
      const onNavigate = vi.fn();
      render(<GeneratingScreen onNavigate={onNavigate} />);
      expect(screen.queryByText(RETRY_GENERATE_LABEL), "同じ入力で送り直させている").toBeNull();
      fireEvent.click(screen.getByText(EDIT_WIZARD_INPUT_LABEL));
      expect(onNavigate).toHaveBeenCalledWith("wizard");
    });

    // ⚠️ **手で作る道は残す**＝行き止まりにしない（#393 P1）。
    it("手で場面を作る道は残る", () => {
      断られた状態(aiSceneLimitMessage(93));
      render(<GeneratingScreen onNavigate={vi.fn()} />);
      expect(screen.getByText(START_MANUAL_LABEL)).toBeInTheDocument();
    });

    // ⚠️ **ほかの断りまで変えない**＝接続や応答の失敗は、同じ入力で**もう一度試すのが正しい**。
    it("ほかの断りでは、これまでどおり「もう一度試す」を出す", () => {
      断られた状態(別の断り);
      render(<GeneratingScreen onNavigate={vi.fn()} />);
      expect(screen.getByText(GENERATE_FAILED_TITLE)).toBeInTheDocument();
      expect(screen.getByText(RETRY_GENERATE_LABEL)).toBeInTheDocument();
      expect(screen.queryByText(EDIT_WIZARD_INPUT_LABEL), "関係ない断りで行き先を変えている").toBeNull();
    });
  });

  // ⚠️ **同じ状況なら、どの画面から見ても同じ行動**（ADR-0026②・#590）。
  describe("場面が0のときの空状態", () => {
    it("上限で断ったときは、入力を見直す道を出す", () => {
      断られた状態(aiSceneLimitMessage(93));
      const onNavigate = vi.fn();
      render(<NoScenesState purpose="ここで場面を直せます" onNavigate={onNavigate} />);
      expect(screen.queryByText(RETRY_GENERATE_LABEL), "同じ入力で送り直させている").toBeNull();
      fireEvent.click(screen.getByText(EDIT_WIZARD_INPUT_LABEL));
      expect(onNavigate).toHaveBeenCalledWith("wizard");
    });

    it("ほかの断りでは、これまでどおり「もう一度試す」を出す", () => {
      断られた状態(別の断り);
      render(<NoScenesState purpose="ここで場面を直せます" onNavigate={vi.fn()} />);
      expect(screen.getByText(RETRY_GENERATE_LABEL)).toBeInTheDocument();
    });
  });
});
