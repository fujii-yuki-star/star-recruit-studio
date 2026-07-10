import { describe, expect, it } from "vitest";
import type { Asset } from "../../domain/project/types";
import { pickPanelAsset } from "./materialsSelection";

// #413：素材画面の右パネルは「表示中（フィルタ後）」の中からだけ選ぶ。フィルタで 0 件になったとき
// 別フィルタの素材を出さない（＝undefined を返し、右パネルは空になる）ことを固定する。
const asset = (id: string): Asset => ({ assetId: id }) as unknown as Asset;

describe("pickPanelAsset（素材右パネルの選択・#413）", () => {
  it("選択中IDが表示中にあればそれを返す", () => {
    const visible = [asset("a"), asset("b"), asset("c")];
    expect(pickPanelAsset(visible, "b")?.assetId).toBe("b");
  });

  it("選択中IDが表示中に無ければ表示中の先頭を返す（フィルタ切替で選択が範囲外になった場合）", () => {
    const visible = [asset("x"), asset("y")];
    expect(pickPanelAsset(visible, "b")?.assetId).toBe("x"); // b は別フィルタ＝表示中の先頭へ
  });

  it("選択IDが空でも表示中の先頭を返す", () => {
    expect(pickPanelAsset([asset("x")], "")?.assetId).toBe("x");
  });

  it("表示中が0件なら undefined（別フィルタの素材へフォールバックしない＝本不具合の核）", () => {
    expect(pickPanelAsset([], "b")).toBeUndefined();
  });
});
