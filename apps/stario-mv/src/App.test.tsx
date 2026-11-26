// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

// Rust への命令は差し替える（画面は命令を送るだけ＝MV-0007 決定2）
const handlers: Record<string, (p: unknown) => void> = {};
const calls: { cmd: string; args?: unknown }[] = [];
const summary = {
  dir: "C:/v",
  name: "見本",
  mainCompositionId: "cmp_A",
  compositions: [
    { id: "cmp_A", name: "本編", width: 1920, height: 1080, fps: { num: 30, den: 1 }, durationFrames: 90 },
    { id: "cmp_B", name: "縦", width: 1080, height: 1920, fps: { num: 24, den: 1 }, durationFrames: 48 },
  ],
  issues: [],
};
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string, args?: unknown) => {
    calls.push({ cmd, args });
    if (cmd === "initial_project") return "C:/v";
    if (cmd === "open_project") return summary;
    if (cmd === "pick_project_folder") return null;
    return undefined;
  }),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (name: string, f: (e: { payload: unknown }) => void) => {
    handlers[name] = (p) => f({ payload: p });
    return () => undefined;
  }),
}));

const { App, APP_TITLE } = await import("./App");

async function mount(): Promise<void> {
  render(<App />);
  await screen.findByText("見本");
}

describe("プレビュー画面", () => {
  beforeEach(() => {
    calls.length = 0;
  });
  afterEach(cleanup);

  it("起動の引数の動画を開き、欄の矩形を物理の画素で送る", async () => {
    await mount();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(APP_TITLE);
    expect(calls.find((c) => c.cmd === "open_project")?.args).toEqual({ dir: "C:/v" });
    const rect = calls.find((c) => c.cmd === "preview_set_rect");
    expect(rect?.args).toEqual({ x: 0, y: 0, w: 0, h: 0 });
  });

  it("状態を受けてタイムコードと落としたコマを出す", async () => {
    await mount();
    act(() =>
      handlers["preview-status"]({ compositionId: "cmp_A", frame: 45, playing: true, fps: 29.5, dropped: 3 }),
    );
    expect(screen.getByTestId("timecode").textContent).toBe("00:00:01:15");
    expect(screen.getByTestId("speed").textContent).toBe("描画 29.5fps・落としたコマ 3");
    expect(screen.getByTitle("止める（Space）")).toBeTruthy();
  });

  it("キーで再生・コマ送り・最初と最後", async () => {
    await mount();
    for (const key of [" ", "ArrowRight", "PageUp", "ArrowLeft", "PageDown", "Home", "End"]) {
      fireEvent.keyDown(window, { key });
    }
    expect(calls.filter((c) => c.cmd.startsWith("preview_") && c.cmd !== "preview_set_rect")).toEqual([
      { cmd: "preview_play", args: undefined },
      { cmd: "preview_step", args: { delta: 1 } },
      { cmd: "preview_step", args: { delta: -1 } },
      { cmd: "preview_step", args: { delta: -1 } },
      { cmd: "preview_step", args: { delta: 1 } },
      { cmd: "preview_seek", args: { frame: 0 } },
      { cmd: "preview_seek", args: { frame: 89 } },
    ]);
  });

  it("コンポジションを切り替えると Rust へ伝え、外の変更で一覧が変わる", async () => {
    await mount();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "cmp_B" } });
    expect(calls.at(-1)).toEqual({ cmd: "preview_set_composition", args: { id: "cmp_B" } });
    act(() =>
      handlers["project-changed"]({ ...summary, name: "外で直した", compositions: [summary.compositions[0]] }),
    );
    expect(screen.getByText("外で直した")).toBeTruthy();
    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("cmp_A");
    // 消えたコンポジションを選んだままにしない（選択欄は勝手に先頭を見せるので、時刻の表示で確かめる）
    expect(screen.getByTestId("timecode").textContent).toBe("00:00:00:00");
  });

  it("音を消す／鳴らすを Rust へ伝え、音の時計と知らせを出す", async () => {
    await mount();
    const btn = screen.getByTitle("音を消す");
    fireEvent.click(btn);
    expect(calls.at(-1)).toEqual({ cmd: "preview_set_muted", args: { muted: true } });
    expect(screen.getByTitle("音を鳴らす").getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByTitle("音を鳴らす"));
    expect(calls.at(-1)).toEqual({ cmd: "preview_set_muted", args: { muted: false } });
    act(() =>
      handlers["preview-status"]({ compositionId: "cmp_A", frame: 3, playing: true, fps: 30, dropped: 0, audio: true }),
    );
    expect(screen.getByTestId("speed").textContent).toBe("描画 30.0fps・落としたコマ 0・音の時計");
    act(() => handlers["preview-notice"]("音を出せる機器が見つかりません（絵だけ再生します）。"));
    expect(screen.getByRole("status").textContent).toContain("絵だけ再生します");
    act(() => handlers["preview-notice"](null));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("描けないときは理由を欄の上に出す", async () => {
    await mount();
    act(() => handlers["preview-error"]("コマ 3 を描けませんでした：素材が見つかりません"));
    expect(screen.getByRole("alert").textContent).toContain("素材が見つかりません");
    act(() => handlers["preview-error"](null));
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
