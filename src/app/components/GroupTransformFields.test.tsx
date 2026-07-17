// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { GROUP_MIN_SCALE } from "../../domain/constants";
import type { GroupTransform } from "../../domain/group/types";
import { GroupTransformFields } from "./GroupTransformFields";

describe("GroupTransformFields（グループの数値入力・#554）", () => {
  const setup = (transform: Partial<GroupTransform> = {}) => {
    const onChange = vi.fn();
    render(
      <GroupTransformFields
        transform={{ x: 0, y: 0, rotation: 0, scale: 1, ...transform }}
        onChange={onChange}
      />,
    );
    const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
    return { onChange, field };
  };

  const type = (input: HTMLInputElement, value: string) => {
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value } });
    fireEvent.blur(input);
  };

  it("大きさは % 表示（100=等倍）で、拡大率へ変換して渡す", () => {
    const { onChange, field } = setup({ scale: 0.5 });
    expect(field("大きさ(%)").value).toBe("50");
    type(field("大きさ(%)"), "150");
    expect(onChange).toHaveBeenCalledWith({ scale: 1.5 });
  });

  // #554 の主眼：ドラッグの下限（GROUP_MIN_SCALE）より下は枠操作では作れない。数値欄が逃げ道になる。
  it("拡縮ドラッグの下限まで数値で縮められる", () => {
    const { onChange, field } = setup({ scale: 1 });
    type(field("大きさ(%)"), "1");
    expect(onChange).toHaveBeenCalledWith({ scale: GROUP_MIN_SCALE });
  });

  it("下限より下は下限へクランプする＝ scale>0 を割らない（project.schema $defs/Group）", () => {
    const { onChange, field } = setup({ scale: 1 });
    type(field("大きさ(%)"), "0");
    expect(onChange).toHaveBeenCalledWith({ scale: GROUP_MIN_SCALE });
    expect(onChange.mock.calls[0][0].scale).toBeGreaterThan(0);
  });

  it("大きさに上限は無い＝ドラッグと同じ到達範囲（ADR-0026②）", () => {
    const { onChange, field } = setup({ scale: 1 });
    expect(field("大きさ(%)").max).toBe(""); // max 属性を付けない
    type(field("大きさ(%)"), "800");
    expect(onChange).toHaveBeenCalledWith({ scale: 8 });
  });

  it("位置は平行移動をそのまま渡す（負値も可＝ドラッグと同じ）", () => {
    const { onChange, field } = setup({ x: 10, y: 20 });
    expect(field("横位置").value).toBe("10");
    type(field("縦位置"), "-40");
    expect(onChange).toHaveBeenCalledWith({ y: -40 });
  });

  it("角度は 0〜359 にクランプ＝回転ドラッグ（rotationFromPointer）と同じ値域", () => {
    const { onChange, field } = setup({ rotation: 30 });
    type(field("角度"), "400");
    expect(onChange).toHaveBeenCalledWith({ rotation: 359 });
  });

  it("変更した項目だけを渡す（他の値を巻き込まない）", () => {
    const { onChange, field } = setup({ x: 5, y: 6, rotation: 7, scale: 2 });
    type(field("横位置"), "99");
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ x: 99 });
  });
});
