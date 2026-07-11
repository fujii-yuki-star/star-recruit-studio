// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { ClipDetailControls } from "./ClipDetailControls";
import type { Asset } from "../../domain/project/types";

// クリップ設定は呼び出し側が「表示する実効クリップ(clip)」と「編集先(patchClip)・性質(scope)」を渡す（ADR-0028・#472）。
// ここではコンポーネント単体の挙動＝scope 別の §2-5 文言・継承値プレースホルダ表示・patchClip 呼び出しを検証（jsdom・ADR-0014）。
const videoAsset = {
  assetId: "asset_v", assetType: "video", displayName: "v", filePath: "v.mp4",
  metadata: { durationSec: 30, hasAudio: true },
} as unknown as Asset;

describe("ClipDetailControls（#472・scope 別の編集先/文言・per-use）", () => {
  it("scope='material' は「元に戻せません（全場面の既定）」を表示（asset.clip＝Undo 外・ADR-0028 D3・§2-5）", () => {
    const { container } = render(<ClipDetailControls asset={videoAsset} clip={{ speed: 1 }} patchClip={() => {}} scope="material" />);
    expect(container.textContent).toContain("元に戻せません");
  });

  it("scope='scene' は「元に戻せません」を出さない（per-use＝Undo 可）", () => {
    const { container } = render(<ClipDetailControls asset={videoAsset} clip={{ speed: 1 }} patchClip={() => {}} scope="scene" />);
    expect(container.textContent).not.toContain("元に戻せません");
  });

  it("渡した clip（継承/実効値）をそのまま表示＝プレースホルダ（速度2倍を表示）", () => {
    // 場面側は resolveSlotClip の実効値を渡す＝上書きが無ければ asset.clip 継承値が出る（既定にリセットされて見えない・#472）。
    const { container } = render(<ClipDetailControls asset={videoAsset} clip={{ speed: 2 }} patchClip={() => {}} scope="scene" />);
    expect(container.textContent).toContain("2倍");
  });

  it("速度スライダー変更で patchClip({ speed }) を呼ぶ（編集先の振り分け＝slotClips か asset.clip かは呼び出し側）", () => {
    const patch = vi.fn();
    const { container } = render(<ClipDetailControls asset={videoAsset} clip={{ speed: 1 }} patchClip={patch} scope="scene" />);
    // clip.useOriginalAudio 未設定＝音量スライダーは出ないので、range は速度の1本のみ。
    const speed = container.querySelector('input[type="range"]') as HTMLInputElement;
    fireEvent.change(speed, { target: { value: "1.5" } });
    expect(patch).toHaveBeenCalledWith({ speed: 1.5 });
  });
});
