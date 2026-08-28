// @vitest-environment jsdom
//
// 声の表記の出し方（ADR-0025・#359）。
//
// ⚠️ **About 画面の表記は必須で不変**（`13 §4`）＝ここで変わるのは**動画に焼く側**だけ。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { useProjectStore } from "../store/projectStore";
import { CreditDisplayField } from "./CreditDisplayField";
import { CREDIT_MODE } from "../../domain/voice/creditDisplay";

describe("声の表記の出し方（#359）", () => {
  const setCreditDisplay = vi.fn();

  beforeEach(() => {
    setCreditDisplay.mockClear();
    useProjectStore.setState((st) => ({
      scenes: [], setCreditDisplay,
      meta: { ...st.meta, videoSettings: { ...st.meta.videoSettings, creditDisplay: undefined } },
    }));
  });
  afterEach(() => { vi.restoreAllMocks(); });

  const select = () => screen.getByLabelText("声の表記の出し方") as HTMLSelectElement;

  // ⚠️ **既定は「最初と最後」**（ADR-0025 の利用者決定）＝設定していない動画の見え方が変わらない。
  it("既定は「最初と最後に出す」", () => {
    render(<CreditDisplayField />);
    expect(select().value).toBe(CREDIT_MODE.both);
  });

  it("選ぶと保存する", () => {
    render(<CreditDisplayField />);
    fireEvent.change(select(), { target: { value: CREDIT_MODE.always } });
    expect(setCreditDisplay).toHaveBeenCalledWith({ mode: CREDIT_MODE.always });
  });

  // ⚠️ **秒は「数秒」のときだけ聞く**＝ずっと出す／出さないときに秒を聞いても意味が無い。
  it("ずっと出す・出さないでは秒を聞かない", () => {
    const { rerender } = render(<CreditDisplayField />);
    expect(screen.getByLabelText(/何秒/)).toBeInTheDocument();

    for (const mode of [CREDIT_MODE.always, CREDIT_MODE.hidden]) {
      useProjectStore.setState((st) => ({
        meta: { ...st.meta, videoSettings: { ...st.meta.videoSettings, creditDisplay: { mode } } },
      }));
      rerender(<CreditDisplayField />);
      expect(screen.queryByLabelText(/何秒/)).toBeNull();
    }
  });

  /**
   * ⚠️ **場面の途中では切り替えられないことを先に言う**（§2-5）＝静止の場面は1枚の絵なので、
   * 指定より長く出ることがある。後から「思ったより長い」と驚かないように、押す前に出す。
   */
  it("秒を指定するときは、長く出ることがあると先に言う", () => {
    render(<CreditDisplayField />);
    expect(screen.getByText(/指定より長く出ることがあります/)).toBeInTheDocument();
    expect(screen.getByText(/短くはなりません/)).toBeInTheDocument();
  });

  /**
   * ⚠️ **出さないときは「代わりにどうするか」を必ず出す**（`13 §4`＝規約は守る必要がある）。
   * 案内だけでなく**貼り付けられる文**まで出す（それが無いと守れない）。
   */
  it("出さないときは、概要欄用の表記とコピーを出す", () => {
    useProjectStore.setState((st) => ({
      meta: { ...st.meta, videoSettings: { ...st.meta.videoSettings, creditDisplay: { mode: CREDIT_MODE.hidden } } },
    }));
    render(<CreditDisplayField />);
    const notice = screen.getByRole("alert");
    expect(notice).toHaveTextContent("概要欄などに次の表記を入れてください");
    expect(notice.textContent).toContain("VOICEVOX:");
    expect(screen.getByRole("button", { name: "この表記をコピー" })).toBeInTheDocument();
  });

  it("出す設定のときは案内を出さない（成功に警告を出さない）", () => {
    render(<CreditDisplayField />);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  // ⚠️ **コピーできなくても文は見えている**＝行き止まりにしない（手で写せる）。
  it("コピーできない環境でも落ちない", async () => {
    useProjectStore.setState((st) => ({
      meta: { ...st.meta, videoSettings: { ...st.meta.videoSettings, creditDisplay: { mode: CREDIT_MODE.hidden } } },
    }));
    Object.assign(navigator, { clipboard: { writeText: () => Promise.reject(new Error("no")) } });
    render(<CreditDisplayField />);
    fireEvent.click(screen.getByRole("button", { name: "この表記をコピー" }));
    await vi.waitFor(() => expect(screen.getByRole("button", { name: "この表記をコピー" })).toBeInTheDocument());
    expect(screen.getByRole("alert").textContent).toContain("VOICEVOX:");
  });

  it("書き出し中は触れない", () => {
    render(<CreditDisplayField disabled />);
    expect(select()).toBeDisabled();
  });
});
