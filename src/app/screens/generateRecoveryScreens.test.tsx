// @vitest-environment jsdom
// **動画案づくりの失敗で、ボタンが文の名指しする行き先に従う**（UI/UX 監査 2026-10-02・§2-5）。
//
// ⚠️ 以前は、部品が無い・壊れている・接続キーが無いときも、いちばん目立つボタンが「もう一度試す」だった
//（文は「アプリを入れ直す／設定で選ぶ」と言っているのに、押すと同じ失敗を繰り返す）。
// 時間切れは文が「入力を短く」と言うのに、入力へ戻るボタンが無かった。
// ⚠️ **2つの画面が同じ見分けを使う**（`GeneratingScreen`／`NoScenesState`＝#590）ので両方を見る。
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { GeneratingScreen } from "./GeneratingScreen";
import { NoScenesState } from "../components/NoScenesState";
import { useProjectStore } from "../store/projectStore";
import { EDIT_WIZARD_INPUT_LABEL, OPEN_AI_SETTINGS_LABEL, RETRY_GENERATE_LABEL, START_MANUAL_LABEL } from "../uiLabels";

const table = readFileSync(join(process.cwd(), "docs", "yuko_recruit_docs", "errors", "error-state-table.tsv"), "utf8");
const msg = (code: string): string => table.split("\n").find((l) => l.startsWith(`\`${code}\`\t`))!.split("\t")[3];

/** ⚠️ `generate` を止める＝作成中の画面は開いた瞬間に作り始めるので、止めないと断りの画面が描かれない。 */
const 断られた状態 = (aiError: string) =>
  useProjectStore.setState({ status: "error", scenes: [], aiError, generate: vi.fn() } as never);

const screens = [
  ["作成中の画面", (nav: (s: string) => void) => <GeneratingScreen onNavigate={nav as never} />],
  ["空状態", (nav: (s: string) => void) => <NoScenesState purpose="ここで場面を直せます" onNavigate={nav as never} />],
] as const;

describe.each(screens)("%s", (_name, view) => {
  beforeEach(() => useProjectStore.setState({ scenes: [], warnings: [] } as never));
  afterEach(() => {
    vi.restoreAllMocks();
    useProjectStore.setState({ status: "idle", aiError: null } as never);
  });

  it.each(["LOCAL_AI_MISSING", "LOCAL_AI_BROKEN", "AI_GEMINI_KEY_MISSING", "AI_KEY_REJECTED"])(
    "%s：もう一度試すを出さず、設定を開く",
    (code) => {
      断られた状態(msg(code));
      const nav = vi.fn();
      render(view(nav));
      expect(screen.queryByText(RETRY_GENERATE_LABEL), "送り直しても直らない失敗で再試行させている").toBeNull();
      fireEvent.click(screen.getByText(OPEN_AI_SETTINGS_LABEL));
      expect(nav).toHaveBeenCalledWith("settings");
      expect(screen.getByText(START_MANUAL_LABEL)).toBeInTheDocument();
    },
  );

  it.each(["LOCAL_AI_TIMEOUT", "LOCAL_AI_TOO_LONG"])("%s：入力を直す道を出し、もう一度試すも残す", (code) => {
    断られた状態(msg(code));
    const nav = vi.fn();
    render(view(nav));
    expect(screen.getByText(RETRY_GENERATE_LABEL)).toBeInTheDocument();
    fireEvent.click(screen.getByText(EDIT_WIZARD_INPUT_LABEL));
    expect(nav).toHaveBeenCalledWith("wizard");
    expect(screen.queryByText(OPEN_AI_SETTINGS_LABEL)).toBeNull();
  });

  it("起動できなかった（ほかのアプリを閉じて再試行）は、もう一度試すだけ", () => {
    断られた状態(msg("LOCAL_AI_START_FAILED"));
    render(view(vi.fn()));
    expect(screen.getByText(RETRY_GENERATE_LABEL)).toBeInTheDocument();
    expect(screen.queryByText(OPEN_AI_SETTINGS_LABEL)).toBeNull();
    expect(screen.queryByText(EDIT_WIZARD_INPUT_LABEL)).toBeNull();
  });
});
