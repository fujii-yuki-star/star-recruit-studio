// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { FITS } from "../../domain/enums";
import { fitLabel } from "../uiLabels";
import { FitSelect } from "./FitSelect";

// #547 P2-10：収め方の文言は共有 fitLabel 1か所（uiLabels）。FitSelect と LooksEditScreen が同じ語を出す。
describe("FitSelect（収め方セレクト・#547 P2-10）", () => {
  it("全ての Fit 値を共有 fitLabel の文言で出す（インライン直書きに戻ると落ちる）", () => {
    render(<FitSelect value="cover" onChange={vi.fn()} />);
    for (const f of FITS) {
      expect(screen.getByRole("option", { name: fitLabel[f] })).toBeTruthy();
    }
  });

  it("inheritLabel を渡すと先頭に継承の選択肢を出す（選ぶと undefined）", () => {
    render(<FitSelect value={undefined} onChange={vi.fn()} inheritLabel="テンプレの既定に合わせる" />);
    const opt = screen.getByRole("option", { name: "テンプレの既定に合わせる" }) as HTMLOptionElement;
    expect(opt.value).toBe("");
  });
});
