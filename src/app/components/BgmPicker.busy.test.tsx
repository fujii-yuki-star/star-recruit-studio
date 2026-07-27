// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { useProjectStore } from "../store/projectStore";
import { BGM_CATALOG } from "../../domain/bgm/bgmCatalog";
import { BgmPicker } from "./BgmPicker";

// #570 P2：BGM 未選択のプロジェクトで書き出し中（disabled）に仕上がり確認を開くと、自動初期化が setBundledBgm を呼び、
// 書き出し中ガードに弾かれて「操作していないのに bgmError」が出ていた。disabled 中は初期化しない（didInit も立てず解除後に初期化）。
describe("BgmPicker 自動初期化は disabled 中は走らない（#570 P2）", () => {
  afterEach(() => vi.restoreAllMocks());

  const setup = () => {
    const setBundledBgm = vi.fn();
    useProjectStore.setState({
      assets: [],
      meta: { ...useProjectStore.getState().meta, bgmSettings: undefined },
      bgmError: null,
      setBundledBgm,
    });
    return setBundledBgm;
  };

  it("disabled のときは setBundledBgm を呼ばない（操作していないのに bgmError が出ない）", () => {
    const setBundledBgm = setup();
    render(<BgmPicker disabled />);
    expect(setBundledBgm).not.toHaveBeenCalled();
    expect(useProjectStore.getState().bgmError).toBeNull();
  });

  it("有効なときは標準BGMの先頭で自動初期化する（従来どおり・書き出し完了後に効く）", () => {
    const setBundledBgm = setup();
    render(<BgmPicker />);
    expect(setBundledBgm).toHaveBeenCalledWith(BGM_CATALOG[0].id);
  });
});
