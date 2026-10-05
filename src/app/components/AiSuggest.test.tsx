// @vitest-environment jsdom
// 編集の途中の AI 補助（ADR-0053）＝候補を出し、「使う」を押すまで書き換えない。同梱されていなければボタンを出さない。
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import { ASSIST_KIND } from "../../domain/ai/assist";
import { AI_ASSIST_CANCEL_LABEL, AI_ASSIST_FAILED_MESSAGE, AI_ASSIST_NARRATION_KINDS, AI_ASSIST_NEED_SOURCE_HINT, AI_ASSIST_NOT_NEEDED_MESSAGE, AI_ASSIST_STALE_MESSAGE, AI_ASSIST_THINKING, AI_ASSIST_UNAVAILABLE_MESSAGE, AI_ASSIST_USE_LABEL } from "../uiLabels";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** 表（`15 §6`）の文＝Rust が返す文そのもの（書き写さない）。 */
const errorTable = readFileSync(join(process.cwd(), "docs", "yuko_recruit_docs", "errors", "error-state-table.tsv"), "utf8");
const tableText = (code: string): string => errorTable.split("\n").find((l) => l.startsWith(`\`${code}\`\t`))!.split("\t")[3];
const LOCAL_AI_BROKEN_TEXT = tableText("LOCAL_AI_BROKEN");

const ai = vi.hoisted(() => ({
  available: true,
  reply: "" as string | Error | Promise<string>,
  calls: [] as { system: string; user: string; schema: string }[],
}));
vi.mock("../../infrastructure/aiClient", () => ({
  localAiAvailable: () => Promise.resolve(ai.available),
  localAiAssist: (system: string, user: string, schema: string) => {
    ai.calls.push({ system, user, schema });
    if (ai.reply instanceof Promise) return ai.reply;
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
    fireEvent.click(screen.getAllByRole("button", { name: new RegExp(`」を${AI_ASSIST_USE_LABEL}$`) })[1]);
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
    expect(screen.queryByRole("button", { name: new RegExp(`」を${AI_ASSIST_USE_LABEL}$`) })).toBeNull();
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

  // ── UI/UX 監査 2026-10-02 ──
  it("部品が無い・壊れていると返ったら「もう一度押す」と言わず、入れ直しを案内してボタンを押せなくする", async () => {
    ai.reply = new Error(LOCAL_AI_BROKEN_TEXT);
    render(<AiSuggest kinds={AI_ASSIST_NARRATION_KINDS} source={LONG} limits={{}} onPick={vi.fn()} />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "短く" }));
    await flush();
    expect(screen.getByText(AI_ASSIST_UNAVAILABLE_MESSAGE)).toBeTruthy();
    expect(screen.queryByText(AI_ASSIST_FAILED_MESSAGE)).toBeNull();
    expect((screen.getByRole("button", { name: "丁寧に" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("ほかの失敗は、これまでどおり「もう一度押す」で、ボタンは押せるまま", async () => {
    ai.reply = new Error("通信に失敗しました。");
    render(<AiSuggest kinds={AI_ASSIST_NARRATION_KINDS} source={LONG} limits={{}} onPick={vi.fn()} />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "短く" }));
    await flush();
    expect(screen.getByText(AI_ASSIST_FAILED_MESSAGE)).toBeTruthy();
    expect((screen.getByRole("button", { name: "丁寧に" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("考えている間は「やめる」で止められ、後から届いた返事は出さない", async () => {
    let resolve!: (s: string) => void;
    ai.reply = new Promise<string>((r) => { resolve = r; });
    render(<AiSuggest kinds={AI_ASSIST_NARRATION_KINDS} source={LONG} limits={{}} onPick={vi.fn()} />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "短く" }));
    await flush();
    fireEvent.click(screen.getByRole("button", { name: AI_ASSIST_CANCEL_LABEL }));
    expect((screen.getByRole("button", { name: "短く" }) as HTMLButtonElement).disabled).toBe(false);
    resolve(JSON.stringify({ candidates: ["地域の配送を担っています。"] }));
    await flush();
    expect(screen.queryByText("地域の配送を担っています。")).toBeNull();
  });

  it("考えている間に文が変わったら、黙って捨てずに一言出す", async () => {
    let resolve!: (s: string) => void;
    ai.reply = new Promise<string>((r) => { resolve = r; });
    const { rerender } = render(<AiSuggest kinds={AI_ASSIST_NARRATION_KINDS} source={LONG} limits={{}} onPick={vi.fn()} />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "短く" }));
    await flush();
    rerender(<AiSuggest kinds={AI_ASSIST_NARRATION_KINDS} source={`${LONG}手で直しました。`} limits={{}} onPick={vi.fn()} />);
    resolve(JSON.stringify({ candidates: ["地域の配送を担っています。"] }));
    await flush();
    expect(screen.getByText(AI_ASSIST_STALE_MESSAGE)).toBeTruthy();
    expect(screen.queryByText("地域の配送を担っています。")).toBeNull();
  });

  it("元の文が空で押せないときは、理由を添える（見える文でも＝押せないボタンには焦点が来ない）", async () => {
    render(<AiSuggest kinds={AI_ASSIST_NARRATION_KINDS} source="" limits={{}} onPick={vi.fn()} />);
    await flush();
    const b = screen.getByRole("button", { name: "短く" }) as HTMLButtonElement;
    expect(b.disabled).toBe(true);
    expect(b.title).toBe(AI_ASSIST_NEED_SOURCE_HINT);
    expect(screen.getByRole("status").textContent).toBe(AI_ASSIST_NEED_SOURCE_HINT);
  });

  // ── PR3 レビュー（検査していなかった振る舞い） ──
  it("考えている間は、知らせの置き場でそう言う（読み上げに届く）", async () => {
    ai.reply = new Promise<string>(() => {});
    render(<AiSuggest kinds={AI_ASSIST_NARRATION_KINDS} source={LONG} limits={{}} onPick={vi.fn()} />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "短く" }));
    await flush();
    expect(screen.getByRole("status").textContent).toBe(AI_ASSIST_THINKING);
  });

  it("やめてすぐ頼み直したら、前の頼みの返事（成功でも失敗でも）は今の頼みを終わらせない", async () => {
    let resolve1!: (s: string) => void;
    let reject1!: (e: Error) => void;
    const p1 = new Promise<string>((r, j) => { resolve1 = r; reject1 = j; });
    void p1.catch(() => {});
    let resolve2!: (s: string) => void;
    const p2 = new Promise<string>((r) => { resolve2 = r; });
    render(<AiSuggest kinds={AI_ASSIST_NARRATION_KINDS} source={LONG} limits={{}} onPick={vi.fn()} />);
    await flush();
    ai.reply = p1;
    fireEvent.click(screen.getByRole("button", { name: "短く" }));
    await flush();
    fireEvent.click(screen.getByRole("button", { name: AI_ASSIST_CANCEL_LABEL }));
    ai.reply = p2;
    fireEvent.click(screen.getByRole("button", { name: "丁寧に" }));
    await flush();
    // 前の頼みが失敗で返っても、今の頼みは考え中のまま・失敗の文も出さない。
    reject1(new Error("通信に失敗しました。"));
    await flush();
    expect(screen.getByRole("button", { name: AI_ASSIST_CANCEL_LABEL })).toBeTruthy();
    expect(screen.queryByText(AI_ASSIST_FAILED_MESSAGE)).toBeNull();
    resolve1(JSON.stringify({ candidates: ["前の頼みの候補です。"] }));
    await flush();
    expect(screen.queryByText("前の頼みの候補です。")).toBeNull();
    resolve2(JSON.stringify({ candidates: ["今の頼みの候補です。"] }));
    await flush();
    expect(screen.getByText("今の頼みの候補です。")).toBeTruthy();
    // 前の頼みの失敗が、今の頼みの結果に紛れ込まない（候補が出たのに「作れませんでした」と言わない）。
    expect(screen.queryByText(AI_ASSIST_FAILED_MESSAGE)).toBeNull();
  });

  it("やめてすぐ頼み直したら、前の頼みが成功で返っても考え中は終わらない", async () => {
    let resolve1!: (s: string) => void;
    const p1 = new Promise<string>((r) => { resolve1 = r; });
    render(<AiSuggest kinds={AI_ASSIST_NARRATION_KINDS} source={LONG} limits={{}} onPick={vi.fn()} />);
    await flush();
    ai.reply = p1;
    fireEvent.click(screen.getByRole("button", { name: "短く" }));
    await flush();
    fireEvent.click(screen.getByRole("button", { name: AI_ASSIST_CANCEL_LABEL }));
    ai.reply = new Promise<string>(() => {});
    fireEvent.click(screen.getByRole("button", { name: "丁寧に" }));
    await flush();
    resolve1(JSON.stringify({ candidates: ["前の頼みの候補です。"] }));
    await flush();
    expect(screen.getByRole("status").textContent).toBe(AI_ASSIST_THINKING);
  });

  it("考えている間に上限（見た目パターン）が変わっても、黙って捨てずに一言出す", async () => {
    let resolve!: (s: string) => void;
    ai.reply = new Promise<string>((r) => { resolve = r; });
    const { rerender } = render(<AiSuggest kinds={AI_ASSIST_NARRATION_KINDS} source={LONG} limits={{}} onPick={vi.fn()} />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "短く" }));
    await flush();
    rerender(<AiSuggest kinds={AI_ASSIST_NARRATION_KINDS} source={LONG} limits={{ maxNarrationLength: 40 }} onPick={vi.fn()} />);
    resolve(JSON.stringify({ candidates: ["地域の配送を担っています。"] }));
    await flush();
    expect(screen.getByText(AI_ASSIST_STALE_MESSAGE)).toBeTruthy();
  });

  it("考えている間に欄の文（見出し）が変わっても、黙って捨てずに一言出す・次に頼むと消える", async () => {
    let resolve!: (s: string) => void;
    ai.reply = new Promise<string>((r) => { resolve = r; });
    const kinds = [{ kind: ASSIST_KIND.title, label: "候補を出す" }] as const;
    const { rerender } = render(<AiSuggest kinds={kinds} source={LONG} current="" limits={{}} onPick={vi.fn()} />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "候補を出す" }));
    await flush();
    rerender(<AiSuggest kinds={kinds} source={LONG} current="自分で書いた見出し" limits={{}} onPick={vi.fn()} />);
    resolve(JSON.stringify({ candidates: ["配送で地域を支える"] }));
    await flush();
    expect(screen.getByText(AI_ASSIST_STALE_MESSAGE)).toBeTruthy();
    ai.reply = new Promise<string>(() => {});
    fireEvent.click(screen.getByRole("button", { name: "候補を出す" }));
    await flush();
    expect(screen.queryByText(AI_ASSIST_STALE_MESSAGE)).toBeNull();
  });

  it.each(["AI_KEY_REJECTED", "LOCAL_AI_TIMEOUT", "LOCAL_AI_START_FAILED"])(
    "入れ直しでは直らない失敗（%s）は「入れ直して」と言わず、ボタンは押せるまま",
    async (code) => {
      ai.reply = new Error(tableText(code));
      render(<AiSuggest kinds={AI_ASSIST_NARRATION_KINDS} source={LONG} limits={{}} onPick={vi.fn()} />);
      await flush();
      fireEvent.click(screen.getByRole("button", { name: "短く" }));
      await flush();
      expect(screen.getByText(AI_ASSIST_FAILED_MESSAGE)).toBeTruthy();
      expect(screen.queryByText(AI_ASSIST_UNAVAILABLE_MESSAGE)).toBeNull();
      expect((screen.getByRole("button", { name: "丁寧に" }) as HTMLButtonElement).disabled).toBe(false);
    },
  );

  it("会社名は印にして渡し、候補では会社名に戻す", async () => {
    ai.reply = JSON.stringify({ candidates: ["{会社名}の配送の仕事です。"] });
    const onPick = vi.fn();
    render(<AiSuggest kinds={AI_ASSIST_NARRATION_KINDS} source={`株式会社サンプル物流は${LONG}`} limits={{}} companyName="株式会社サンプル物流" onPick={onPick} />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "やわらかく" }));
    await flush();
    expect(ai.calls[0].user).not.toContain("株式会社サンプル物流");
    fireEvent.click(screen.getByRole("button", { name: new RegExp(`」を${AI_ASSIST_USE_LABEL}$`) }));
    expect(onPick).toHaveBeenCalledWith("株式会社サンプル物流の配送の仕事です。");
  });
});
