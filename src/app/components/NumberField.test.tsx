// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NumberField } from "./NumberField";

describe("NumberField（数値入力の共通挙動・#459 item4）", () => {
  const setup = (props: Partial<Parameters<typeof NumberField>[0]> = {}) => {
    const onChange = vi.fn();
    render(<NumberField label="幅" value={10} onChange={onChange} {...props} />);
    return { onChange, input: screen.getByRole("spinbutton") as HTMLInputElement };
  };

  it("入力中はクランプ/反映せず、blur で数値を反映（多桁入力を壊さない）", () => {
    const { onChange, input } = setup({ max: 100 });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "45" } });
    expect(onChange).not.toHaveBeenCalled(); // 入力中は反映しない
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith(45);
  });

  it("blur で min/max にクランプする", () => {
    const { onChange, input } = setup({ min: 0, max: 20 });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "100" } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith(20);
  });

  it("空/NaN は無視して元値へ戻す（0 に化けない・onChange を呼ばない）", () => {
    const { onChange, input } = setup();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);
    expect(onChange).not.toHaveBeenCalled();
    expect(input.value).toBe("10"); // 元値へ戻る
  });

  it("Enter でも確定する", () => {
    const { onChange, input } = setup();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "7" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith(7);
  });

  it("値が変わらなければ onChange を呼ばない（同値 commit で未保存にしない）", () => {
    const { onChange, input } = setup();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "10" } });
    fireEvent.blur(input);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("onClear ありなら空欄確定でクリア（onClear を呼び・onChange は呼ばない）＝終了「最後まで」/開始「自動」用", () => {
    const onChange = vi.fn();
    const onClear = vi.fn();
    render(<NumberField label="終了" value={5} onChange={onChange} onClear={onClear} />);
    const input = screen.getByRole("spinbutton") as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);
    expect(onClear).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("value=null/undefined は空欄表示（クリア状態）", () => {
    render(<NumberField label="終了" value={null} onChange={vi.fn()} placeholder="最後まで" />);
    const input = screen.getByRole("spinbutton") as HTMLInputElement;
    expect(input.value).toBe("");
  });

  it("すでに空（value=null）の欄を触って外すだけでは onClear を呼ばない（no-op クリア/履歴を出さない・#459 レビュー）", () => {
    const onChange = vi.fn();
    const onClear = vi.fn();
    render(<NumberField label="終了" value={null} onChange={onChange} onClear={onClear} placeholder="最後まで" />);
    const input = screen.getByRole("spinbutton") as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.blur(input); // 空のまま外す
    expect(onClear).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });
});

// ⚠️ **生の小数を出さない**（通し点検 2026-10-16）＝コマに乗せた時刻が `32.06666666666667` と出ていた。
describe("NumberField（見せ方だけ丸める）", () => {
  it("小数は3桁までで見せる（末尾の 0 は出さない）", () => {
    render(<NumberField label="開始" value={32 + 2 / 30} onChange={vi.fn()} />);
    expect((screen.getByRole("spinbutton") as HTMLInputElement).value).toBe("32.067");
  });

  it("整数・短い小数はそのまま", () => {
    render(<NumberField label="長さ" value={2.5} onChange={vi.fn()} />);
    expect((screen.getByRole("spinbutton") as HTMLInputElement).value).toBe("2.5");
  });

  it("触らずに離れたら値を変えない（丸めた表示で書き換えない）", () => {
    const onChange = vi.fn();
    render(<NumberField label="開始" value={32 + 2 / 30} onChange={onChange} />);
    const input = screen.getByRole("spinbutton");
    fireEvent.focus(input);
    fireEvent.blur(input);
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("打ち直したら確定する", () => {
    const onChange = vi.fn();
    render(<NumberField label="開始" value={32 + 2 / 30} onChange={onChange} />);
    const input = screen.getByRole("spinbutton");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "33" } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith(33);
  });
});
