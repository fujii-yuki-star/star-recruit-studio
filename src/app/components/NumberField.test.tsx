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
});
