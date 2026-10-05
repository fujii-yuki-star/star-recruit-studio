// @vitest-environment jsdom
// 編集の途中の AI 補助（ADR-0053）＝候補を出し、「使う」を押すまで書き換えない。同梱されていなければボタンを出さない。
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import { ASSIST_KIND } from "../../domain/ai/assist";
import { AI_ASSIST_FAILED_MESSAGE, AI_ASSIST_NARRATION_KINDS, AI_ASSIST_NOT_NEEDED_MESSAGE, AI_ASSIST_USE_LABEL } from "../uiLabels";

const ai = vi.hoisted(() => ({
  available: true,
  reply: "" as string | Error,
  calls: [] as { system: string; user: string; schema: string }[],
}));
vi.mock("../../infrastructure/aiClient", () => ({
  localAiAvailable: () => Promise.resolve(ai.available),
  localAiAssist: (system: string, user: string, schema: string) => {
    ai.calls.push({ system, user, schema });
    return ai.reply instanceof Error ? Promise.reject(ai.reply) : Promise.resolve(ai.reply);
  },
}));

import { AiSuggest, resetAiSuggestAvailabilityForTest } from "./AiSuggest";

const LONG = "私たちは地域の暮らしを支える配送の仕事をしています。毎日たくさんの荷物を届けています。";
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

beforeEach(() => {
  resetAiSuggestAvailabilityForTest();
  ai.available = true;
  ai.reply = "";
  ai.calls = [];
});

describe("AiSuggest", () => {
  it("同梱されていなければ何も出さない", async () => {
    ai.available = false;
    const { container } = render(<AiSuggest kinds={AI_ASSIST_NARRATION_KINDS} source={LONG} limits={{}} onPick={vi.fn()} />);
    await flush();
    expect(container.textContent).toBe("");
  });

  it("候補を出し、「使う」を押すまで書き換えない・押したらその候補で書き換える", async () => {
    ai.reply = JSON.stringify({ candidates: ["地域の配送を担っています。", "暮らしを支える配送の仕事です。"] });
    const onPick = vi.fn();
    render(<AiSuggest kinds={AI_ASSIST_NARRATION_KINDS} source={LONG} limits={{}} onPick={onPick} />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "短く" }));
    await flush();
    expect(ai.calls).toHaveLength(1);
    expect(screen.getByText("地域の配送を担っています。")).toBeTruthy();
    expect(onPick).not.toHaveBeenCalled();
    fireEvent.click(screen.getAllByRole("button", { name: AI_ASSIST_USE_LABEL })[1]);
    expect(onPick).toHaveBeenCalledWith("暮らしを支える配送の仕事です。");
    expect(screen.queryByText("地域の配送を担っています。")).toBeNull();
  });

  it("候補がどれも通らない・呼び出しに失敗したら、次の行動を出し、書き換えない", async () => {
    const onPick = vi.fn();
    ai.reply = JSON.stringify({ candidates: [LONG] }); // 元と同じ（かつ長すぎる）＝落ちる
    render(<AiSuggest kinds={AI_ASSIST_NARRATION_KINDS} source={LONG} limits={{}} onPick={onPick} />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "丁寧に" }));
    await flush();
    expect(screen.getByText(AI_ASSIST_FAILED_MESSAGE)).toBeTruthy();
    ai.reply = new Error("x");
    fireEvent.click(screen.getByRole("button", { name: "やわらかく" }));
    await flush();
    expect(screen.getByText(AI_ASSIST_FAILED_MESSAGE)).toBeTruthy();
    expect(onPick).not.toHaveBeenCalled();
  });

  it("頼む必要が無ければ AI を呼ばずにそう伝える（もう尺に収まっている）", async () => {
    render(<AiSuggest kinds={AI_ASSIST_NARRATION_KINDS} source="短い文です。" limits={{ sceneDurationSec: 10 }} onPick={vi.fn()} />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "表示時間に収める" }));
    await flush();
    expect(ai.calls).toHaveLength(0);
    expect(screen.getByText(AI_ASSIST_NOT_NEEDED_MESSAGE)).toBeTruthy();
  });

  it("元の文が空ならボタンは押せない", async () => {
    render(<AiSuggest kinds={[{ kind: ASSIST_KIND.subtitle, label: "セリフから作る" }]} source="  " limits={{}} onPick={vi.fn()} />);
    await flush();
    expect((screen.getByRole("button", { name: "セリフから作る" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("頼んだ後に元の文が変わったら、古い文から作った候補は出さない（手直しを上書きしない）", async () => {
    ai.reply = JSON.stringify({ candidates: ["地域の配送を担っています。"] });
    const onPick = vi.fn();
    const { rerender } = render(<AiSuggest kinds={AI_ASSIST_NARRATION_KINDS} source={LONG} limits={{}} onPick={onPick} />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "短く" }));
    await flush();
    expect(screen.getByText("地域の配送を担っています。")).toBeTruthy();
    rerender(<AiSuggest kinds={AI_ASSIST_NARRATION_KINDS} source={`${LONG}手で直しました。`} limits={{}} onPick={onPick} />);
    expect(screen.queryByText("地域の配送を担っています。")).toBeNull();
    expect(screen.queryByRole("button", { name: AI_ASSIST_USE_LABEL })).toBeNull();
    // 見た目パターンが変わって上限が変わったときも同じ。
    rerender(<AiSuggest kinds={AI_ASSIST_NARRATION_KINDS} source={LONG} limits={{ maxNarrationLength: 40 }} onPick={onPick} />);
    expect(screen.queryByText("地域の配送を担っています。")).toBeNull();
    // 元に戻せば、同じ頼みの候補はまた見える（同じ文から作ったものなので）。
    rerender(<AiSuggest kinds={AI_ASSIST_NARRATION_KINDS} source={LONG} limits={{}} onPick={onPick} />);
    expect(screen.getByText("地域の配送を担っています。")).toBeTruthy();
  });

  it("候補は頼んだ時点の見出し・字幕と比べる（いまの欄の文が変わったら出さない）", async () => {
    ai.reply = JSON.stringify({ candidates: ["配送で地域を支える"] });
    const kinds = [{ kind: ASSIST_KIND.title, label: "候補を出す" }] as const;
    const { rerender } = render(<AiSuggest kinds={kinds} source={LONG} current="" limits={{}} onPick={vi.fn()} />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "候補を出す" }));
    await flush();
    expect(screen.getByText("配送で地域を支える")).toBeTruthy();
    rerender(<AiSuggest kinds={kinds} source={LONG} current="自分で書いた見出し" limits={{}} onPick={vi.fn()} />);
    expect(screen.queryByText("配送で地域を支える")).toBeNull();
    // 欄の文はそのままでも、元にした語りが変わったら出さない（古い語りから作った見出し）。
    rerender(<AiSuggest kinds={kinds} source={LONG} current="" limits={{}} onPick={vi.fn()} />);
    expect(screen.getByText("配送で地域を支える")).toBeTruthy();
    rerender(<AiSuggest kinds={kinds} source="語りを書き直しました。新しい内容です。" current="" limits={{}} onPick={vi.fn()} />);
    expect(screen.queryByText("配送で地域を支える")).toBeNull();
  });

  it("会社名は印にして渡し、候補では会社名に戻す", async () => {
    ai.reply = JSON.stringify({ candidates: ["{会社名}の配送の仕事です。"] });
    const onPick = vi.fn();
    render(<AiSuggest kinds={AI_ASSIST_NARRATION_KINDS} source={`株式会社サンプル物流は${LONG}`} limits={{}} companyName="株式会社サンプル物流" onPick={onPick} />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "やわらかく" }));
    await flush();
    expect(ai.calls[0].user).not.toContain("株式会社サンプル物流");
    fireEvent.click(screen.getByRole("button", { name: AI_ASSIST_USE_LABEL }));
    expect(onPick).toHaveBeenCalledWith("株式会社サンプル物流の配送の仕事です。");
  });
});
