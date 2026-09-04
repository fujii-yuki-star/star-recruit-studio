// @vitest-environment jsdom
// 声をまとめて作っている間は、**どの画面にいても**進み具合と中止が見える（#1024 ⑤）。
//
// ⚠️ **書き出しは同じ理由で全画面バナーを持っている**（#547 P2-1・`15 §4`）のに、声の一括作成には
// 効いていなかった＝置いてある3画面を離れると「止まった」ように見え、二重に押す引き金になる。
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { BulkVoiceBanner } from "./BulkVoiceBanner";
import { BulkVoiceControls } from "./BulkVoiceControls";
import { useProjectStore } from "../store/projectStore";

/** 声が要る場面を2つ持ち、1つだけできている状態にする。 */
function scenesWithVoice() {
  useProjectStore.getState().newProject();
  useProjectStore.setState({
    scenes: [
      { sceneId: "scene_001", sceneType: "opening", templateId: "tmpl_opening_001", durationSec: 5, texts: {}, assetRefs: {},
        narration: { text: "あ", status: "generated", voicePath: "a.wav" } },
      { sceneId: "scene_002", sceneType: "closing", templateId: "tmpl_closing_001", durationSec: 5, texts: {}, assetRefs: {},
        narration: { text: "い", status: "none" } },
    ] as never,
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
  scenesWithVoice();
  useProjectStore.setState({ isGeneratingNarration: false, narrationCancelled: false });
});

describe("声をまとめて作っている間の全画面バナー（#1024 ⑤）", () => {
  it("作っていないときは出さない", () => {
    render(<BulkVoiceBanner />);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("作っている間は進み具合と中止を出す", () => {
    useProjectStore.setState({ isGeneratingNarration: true });
    render(<BulkVoiceBanner />);
    expect(screen.getByRole("status")).toHaveTextContent("声 1/2");
    expect(screen.getByRole("button", { name: "中止する" })).toBeInTheDocument();
  });

  // ⚠️ **待つ以外の次の行動を言う**（§2-5）＝この状態は書き出しを止める。
  it("何が止まっているかも言う", () => {
    useProjectStore.setState({ isGeneratingNarration: true });
    render(<BulkVoiceBanner />);
    expect(screen.getByRole("status")).toHaveTextContent("書き出しは、声ができてから始められます");
  });

  it("中止を押すと、作成が打ち切られる", () => {
    useProjectStore.setState({ isGeneratingNarration: true });
    render(<BulkVoiceBanner />);
    fireEvent.click(screen.getByRole("button", { name: "中止する" }));
    expect(useProjectStore.getState().isGeneratingNarration).toBe(false);
  });

  // ⚠️ **二重に見せない**＝操作が画面に出ているなら、そちらに進み具合がある。
  it("画面に操作が出ているときは出さない", () => {
    useProjectStore.setState({ isGeneratingNarration: true });
    render(
      <>
        <BulkVoiceBanner />
        <BulkVoiceControls />
      </>,
    );
    expect(screen.queryByRole("status")).toBeNull();
  });

  // ⚠️ **画面の名前で数えていない**＝操作が外れれば、また出る（画面を足しても配り忘れない）。
  it("操作が画面から外れたら、また出る", () => {
    useProjectStore.setState({ isGeneratingNarration: true });
    const { rerender } = render(
      <>
        <BulkVoiceBanner />
        <BulkVoiceControls />
      </>,
    );
    expect(screen.queryByRole("status")).toBeNull();
    rerender(
      <>
        <BulkVoiceBanner />
      </>,
    );
    expect(screen.getByRole("status")).toHaveTextContent("声 1/2");
  });
});
