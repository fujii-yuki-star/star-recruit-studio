// @vitest-environment jsdom
// #396：うまくいかないときの記録＝**場所を開く導線だけ**を出す。
//
// ⚠️ 配布版はコンソールを持たないので stderr がどこにも残らない。「失敗しました」と言われても
// 調べる材料が無かった。記録は残すが、**画面へ中身は出さない**（§2-3＝実装の言葉が入る）し、
// **外へも送らない**（§2-6）。
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("../../infrastructure/troubleLogFs", () => ({ troubleLogDir: vi.fn() }));
vi.mock("../../infrastructure/opener", () => ({ openSavedFile: vi.fn() }));

import { TroubleLogSection } from "./TroubleLogSection";
import { troubleLogDir } from "../../infrastructure/troubleLogFs";
import { openSavedFile } from "../../infrastructure/opener";

const DIR = "C:/Users/x/AppData/Roaming/jp.star-system.star-recruit-studio/logs";

describe("うまくいかないときの記録（#396）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(troubleLogDir).mockResolvedValue(DIR);
    vi.mocked(openSavedFile).mockResolvedValue(undefined);
  });

  it("置き場があるときは、開く導線を出す", async () => {
    render(<TroubleLogSection />);
    expect(await screen.findByRole("button", { name: "記録の場所を開く" })).toBeTruthy();
  });

  // ⚠️ **押せるのに何も起きない導線を作らない**（§2-5）＝置き場が無い環境（ブラウザ開発・
  // 書き込めない）では節ごと出さない。
  it("置き場が無いときは、節ごと出さない", async () => {
    vi.mocked(troubleLogDir).mockResolvedValue(null);
    const { container } = render(<TroubleLogSection />);
    await waitFor(() => expect(troubleLogDir).toHaveBeenCalled());
    expect(container.textContent).toBe("");
  });

  it("押すと、その場所を開く", async () => {
    render(<TroubleLogSection />);
    fireEvent.click(await screen.findByRole("button", { name: "記録の場所を開く" }));
    expect(openSavedFile).toHaveBeenCalledWith(DIR);
  });

  // ⚠️ **開けなかったことを黙らない**（§2-5）。
  it("開けなかったら、次の行動を出す", async () => {
    vi.mocked(openSavedFile).mockRejectedValue(new Error("x"));
    render(<TroubleLogSection />);
    fireEvent.click(await screen.findByRole("button", { name: "記録の場所を開く" }));
    expect(await screen.findByText(/記録の場所を開けませんでした/)).toBeTruthy();
  });

  // ⚠️ **中身を画面に出さない**＝入っているのは実装の言葉。導線は場所を開くまで。
  // ⚠️ **「ログ」と書かない**（§2-3・`06 §3` の置き換え）。
  it("画面に実装用語を出さない／外へ送らないと書いてある", async () => {
    const { container } = render(<TroubleLogSection />);
    await screen.findByRole("button", { name: "記録の場所を開く" });
    expect(container.textContent).not.toMatch(/ログ|log|stderr|FFmpeg/i);
    expect(container.textContent).toMatch(/外へは何も送りません/);
  });
});
