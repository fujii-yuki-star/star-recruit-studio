// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { useProjectStore } from "../store/projectStore";
import { BGM_CATALOG } from "../../domain/bgm/bgmCatalog";
import { BgmPicker } from "./BgmPicker";
import { MAX_INLINE_ASSET_BYTES } from "../../domain/constants";

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

// ⚠️ **大きすぎるファイルは読む前に断る**（負荷・耐久の点検 2026-10-22）＝ここは中身を丸ごと文字列にして運ぶので、
//   数百 MB の WAV を選ぶとアプリが落ちうる。
describe("自分の BGM の大きさ", () => {
  afterEach(() => vi.restoreAllMocks());

  const pick = (size: number) => {
    const setBgm = vi.fn(async () => {});
    useProjectStore.setState({
      assets: [],
      meta: { ...useProjectStore.getState().meta, bgmSettings: { enabled: true, bundledBgmId: BGM_CATALOG[0].id } as never },
      bgmError: null,
      setBgm,
    });
    const read = vi.spyOn(FileReader.prototype, "readAsDataURL").mockImplementation(() => undefined);
    const { container } = render(<BgmPicker />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["x"], "big.wav", { type: "audio/wav" });
    Object.defineProperty(file, "size", { value: size });
    fireEvent.change(input, { target: { files: [file] } });
    return { setBgm, read };
  };

  it("上限より大きいファイルは読まずに、次の行動つきで断る", () => {
    const { setBgm, read } = pick(MAX_INLINE_ASSET_BYTES + 1);
    expect(read).not.toHaveBeenCalled();
    expect(setBgm).not.toHaveBeenCalled();
    expect(useProjectStore.getState().bgmError).toMatch(/大きすぎます.*お選びください。/);
  });

  it("上限ちょうどまでは読む", () => {
    const { read } = pick(MAX_INLINE_ASSET_BYTES);
    expect(read).toHaveBeenCalledTimes(1);
    expect(useProjectStore.getState().bgmError).toBeNull();
  });
});
