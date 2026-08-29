// @vitest-environment jsdom
// この動画にある音の素材から BGM を選ぶ（PR #910 レビュー 🟡）。
//
// ⚠️ **案内どおりに操作できなかった**＝よく使う素材から音を取り込むと「「動画を保存」のBGMから
// 選べます」と案内するのに、BGM にできるのは**ファイルを読み込む**か**同梱の3曲**だけで、
// 取り込んだ音を選ぶ導線が無かった（§2-5＝実行できない次の行動）。
import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { BgmPicker } from "./BgmPicker";
import { useProjectStore } from "../store/projectStore";
import { ASSET_TYPE } from "../../domain/enums";
import type { Asset } from "../../domain/project/types";

const bgm = (id: string, name: string): Asset =>
  ({ assetId: id, assetType: ASSET_TYPE.bgm, displayName: name, filePath: `assets/${id}.mp3` }) as Asset;

beforeEach(() => {
  const meta = useProjectStore.getState().meta;
  useProjectStore.setState({
    assets: [bgm("asset_001", "会社のテーマ"), bgm("asset_002", "しっとり")],
    meta: { ...meta, bgmSettings: { enabled: true, bundledBgmId: "calm_morning", volume: 0.25, loop: true } },
  } as never);
  useProjectStore.getState().setExportRun({ phase: "idle" });
});

describe("BgmPicker：この動画にある音", () => {
  it("取り込んだ音が並び、選べる", () => {
    render(<BgmPicker />);
    fireEvent.click(screen.getByRole("radio", { name: /会社のテーマ/ }));
    const s = useProjectStore.getState().meta.bgmSettings;
    expect(s?.assetId).toBe("asset_001");
    // ⚠️ **同梱の曲とはどちらか一方**＝両方が選ばれた状態を作らない。
    expect(s?.bundledBgmId).toBeNull();
  });

  /** ⚠️ **この動画にある音だけ**＝一覧に無い id を書くと、書き出しで「素材が見つからない」になる。 */
  it("この動画に無い素材は BGM にしない", () => {
    useProjectStore.getState().setBgmAsset("asset_999");
    expect(useProjectStore.getState().meta.bgmSettings?.assetId).toBeUndefined();
  });

  it("音の素材が無ければ、その欄は出さない", () => {
    useProjectStore.setState({ assets: [] } as never);
    render(<BgmPicker />);
    expect(screen.queryByText("この動画にある音")).toBeNull();
  });

  /**
   * ⚠️ **差し替えるのは「いま使っている音」だけ**（PR #911 レビュー 🟡）＝よく使う素材から音を
   * 取り込めるようになり、**1つの動画が複数の音を持てる**ようになった。種類だけで探すと
   * **配列の先頭にある別の音**（選んでもいないもの）のファイルを黙って上書きする（§2-5）。
   */
  it("いま使っていない音のファイルを上書きしない", async () => {
    // 2つ目（asset_002）を使っている状態で、新しいファイルを読み込む。
    useProjectStore.getState().setBgmAsset("asset_002");
    await useProjectStore.getState().setBgm({ name: "new.mp3", dataUrl: "data:audio/mp3;base64,AA==" });
    const s = useProjectStore.getState();
    // 選んでいた asset_002 が差し替わる（先頭の asset_001 は無傷）。
    expect(s.meta.bgmSettings?.assetId).toBe("asset_002");
    expect(s.assets.find((a) => a.assetId === "asset_001")?.displayName).toBe("会社のテーマ");
  });
});
