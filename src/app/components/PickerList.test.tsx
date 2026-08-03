// @vitest-environment jsdom
// 「置くものを選ぶ」一覧（ADR-0033）。**欄からはみ出さない**・**しまっても手が届く**を固定する。
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PickerList } from "./PickerList";

const items = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `id_${i}`, label: `見た目${i + 1}` }));

describe("PickerList", () => {
  it("少ないうちは絞り込みを出さない（数個の一覧に検索欄は邪魔）", () => {
    render(<PickerList items={items(3)} onPick={vi.fn()} />);
    expect(screen.queryByLabelText("絞り込み")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(3);
  });

  it("多いときは絞り込みを出し、全部は残す（スクロールで辿れる）", () => {
    render(<PickerList items={items(12)} onPick={vi.fn()} />);
    expect(screen.getByLabelText("絞り込み")).toBeInTheDocument();
    // **隠すのではなく収める**＝項目自体は全部あり、高さで区切ってスクロールさせる。
    expect(screen.getAllByRole("button", { name: /^見た目/ })).toHaveLength(12);
    expect(screen.getByText("全12件（この中をスクロールできます）")).toBeInTheDocument();
  });

  it("名前の一部で絞り込める（見えている数も出す）", () => {
    render(<PickerList items={items(12)} onPick={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("絞り込み"), { target: { value: "目1" } });
    // 見た目1・見た目10・見た目11・見た目12 の4件。
    expect(screen.getAllByRole("button", { name: /^見た目/ })).toHaveLength(4);
    expect(screen.getByText("12件中4件")).toBeInTheDocument();
  });

  it("見つからないときは次の行動を出す（§2-5）", () => {
    render(<PickerList items={items(12)} onPick={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("絞り込み"), { target: { value: "ない" } });
    expect(screen.getByText("見つかりませんでした。別の言葉でお試しください。")).toBeInTheDocument();
  });

  it("選ぶと id を返す", () => {
    const onPick = vi.fn();
    render(<PickerList items={items(3)} onPick={onPick} />);
    fireEvent.click(screen.getByRole("button", { name: "見た目2" }));
    expect(onPick).toHaveBeenCalledWith("id_1");
  });

  it("押せないときは理由を出す（押せるのに何も起きない、を作らない）", () => {
    render(<PickerList items={items(2)} onPick={vi.fn()} disabled disabledHint="再生を止めてから使えます" />);
    const btn = screen.getByRole("button", { name: "見た目1" });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("title", "再生を止めてから使えます");
  });
});
