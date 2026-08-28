// @vitest-environment jsdom
// 動画の「その瞬間」を写真にする欄（#349）。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CaptureFrameControls } from "./CaptureFrameControls";
import { useProjectStore } from "../store/projectStore";
import { ASSET_TYPE } from "../../domain/enums";
import type { Asset } from "../../domain/project/types";

const video: Asset = {
  assetId: "asset_001",
  assetType: ASSET_TYPE.video,
  displayName: "会社紹介",
  filePath: "assets/asset_001.mp4",
};

const capture = vi.fn(async () => "asset_002");

beforeEach(() => {
  capture.mockClear();
  useProjectStore.setState({
    assetSrcById: { asset_001: "asset://v.mp4" },
    isImporting: false,
    captureVideoFrame: capture,
  } as never);
});
afterEach(() => useProjectStore.setState({ assetSrcById: {}, isImporting: false } as never));

describe("CaptureFrameControls", () => {
  /** ⚠️ §2-3＝実装用語を画面に出さない。 */
  it("「フレーム」「抽出」を画面に出さない", () => {
    const { container } = render(<CaptureFrameControls asset={video} />);
    expect(container.textContent).not.toMatch(/フレーム|抽出|キャプチャ/);
  });

  it("動画を見ながら選べる（再生できる形で出す）", () => {
    const { container } = render(<CaptureFrameControls asset={video} />);
    const v = container.querySelector("video");
    expect(v).toHaveAttribute("controls");
    expect(v).toHaveAttribute("src", "asset://v.mp4");
  });

  /** ⚠️ **いま見えている時間を切る**＝見たものと違う絵が出てこない。 */
  it("押すと、いま止めている時間で切り出す", async () => {
    const { container } = render(<CaptureFrameControls asset={video} />);
    const v = container.querySelector("video") as HTMLVideoElement;
    Object.defineProperty(v, "currentTime", { value: 12.5, writable: true });
    fireEvent.click(screen.getByRole("button", { name: "この瞬間を写真にする" }));
    await waitFor(() => expect(capture).toHaveBeenCalledWith("asset_001", 12.5));
  });

  it("できたら知らせる（どこに増えたかまで書く）", async () => {
    render(<CaptureFrameControls asset={video} />);
    fireEvent.click(screen.getByRole("button", { name: "この瞬間を写真にする" }));
    expect(await screen.findByText(/素材の一覧に増えています/)).toBeInTheDocument();
  });

  /** ⚠️ 失敗の文言は取り込みと同じ場所（`importError`）に出るので、ここでは成功だけ知らせる。 */
  it("できなかったときは「できた」と言わない", async () => {
    capture.mockResolvedValueOnce(null as never);
    render(<CaptureFrameControls asset={video} />);
    fireEvent.click(screen.getByRole("button", { name: "この瞬間を写真にする" }));
    await waitFor(() => expect(capture).toHaveBeenCalled());
    expect(screen.queryByText(/素材の一覧に増えています/)).not.toBeInTheDocument();
  });

  /** ⚠️ 見られないときも行き止まりにしない（§2-5）。 */
  it("再生できないときは理由と次の行動を出し、押せなくする", () => {
    useProjectStore.setState({ assetSrcById: {} } as never);
    render(<CaptureFrameControls asset={video} />);
    expect(screen.getByText(/取り込み直すと表示できる場合があります/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "この瞬間を写真にする" })).toBeDisabled();
  });

  it("切り出している間は押せない（二重に走らせない）", () => {
    useProjectStore.setState({ isImporting: true } as never);
    render(<CaptureFrameControls asset={video} />);
    expect(screen.getByRole("button", { name: "切り出しています…" })).toBeDisabled();
  });

  /** ⚠️ 書き出し中は**欄ごと出さない**（親の素材画面が持つ）＝ここに口を作らない（§9-2）。 */
});
