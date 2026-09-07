// @vitest-environment jsdom
// 仕上がり確認を `Space` で再生⇄停止できる（#1032）。
//
// タイムライン編集には前からあるのに、仕上がり確認だけ **`keydown` を購読していなかった**＝
// 同じキーの意味が画面で割れていた（ADR-0026②）。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useProjectStore } from "../store/projectStore";
import { sampleTemplates } from "../../infrastructure/sampleData";
import type { Scene } from "../../domain/project/types";
import { PreviewScreen } from "./PreviewScreen";

const scene = (): Scene =>
  ({
    sceneId: "scene_001", partId: "part_001", order: 1, sceneType: "photo_intro",
    templateId: "photo_left_text_right_yuko_v1",
    durationSec: 8, assetRefs: {}, character: { enabled: false, characterId: "yuko" }, texts: {},
    narration: { text: "", status: "none" }, lines: [], warnings: [],
  } as unknown as Scene);

/** いま再生中か＝「停止」が押せる状態（ボタンと同じ述語で見る）。 */
function isPlaying(): boolean {
  return !(screen.getByRole("button", { name: "停止" }) as HTMLButtonElement).disabled;
}

describe("仕上がり確認：Space で再生⇄停止（#1032）", () => {
  beforeEach(() => {
    // 音は鳴らせないので play() は黙って解決させる（この検査の対象は再生状態の切り替え）。
    vi.spyOn(window.HTMLMediaElement.prototype, "play").mockImplementation(() => Promise.resolve());
    useProjectStore.getState().setExportRun({ phase: "idle" });
    useProjectStore.getState().newProject();
    useProjectStore.setState({
      templates: sampleTemplates,
      parts: [{ partId: "part_001", title: "パート1", order: 1, sceneIds: ["scene_001"] }],
      scenes: [scene()],
      status: "ready", // 自動生成を発火させない（#620）
      saveStatus: "saved",
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it("Space で再生し、もう一度 Space で止まる", () => {
    render(<PreviewScreen onNavigate={vi.fn()} />);
    expect(isPlaying()).toBe(false);
    fireEvent.keyDown(window, { key: " " });
    expect(isPlaying(), "Space で再生が始まらない").toBe(true);
    fireEvent.keyDown(window, { key: " " });
    expect(isPlaying(), "もう一度の Space で止まらない").toBe(false);
  });

  it("文字を打っている最中は奪わない（打ちかけの文字ごと再生が始まる、を作らない）", () => {
    render(<PreviewScreen onNavigate={vi.fn()} />);
    const input = document.createElement("input");
    document.body.appendChild(input);
    fireEvent.keyDown(input, { key: " " });
    expect(isPlaying()).toBe(false);
    input.remove();
  });

  it("`Space` で反応するボタンに手がかかっているときは、そちらへ譲る", () => {
    render(<PreviewScreen onNavigate={vi.fn()} />);
    // 「音を消す」は Space で押せるボタン＝奪うと「消えたうえに再生が始まる」。
    fireEvent.keyDown(screen.getByRole("button", { name: "音を消す" }), { key: " " });
    expect(isPlaying()).toBe(false);
  });

  it("修飾キー付きは奪わない（OS・ブラウザのものを取らない）", () => {
    render(<PreviewScreen onNavigate={vi.fn()} />);
    fireEvent.keyDown(window, { key: " ", ctrlKey: true });
    expect(isPlaying()).toBe(false);
  });

  it("押せるときはキーの割り当てを添える（キーだけの操作を作らない）", () => {
    render(<PreviewScreen onNavigate={vi.fn()} />);
    expect(screen.getByRole("button", { name: "再生" })).toHaveAttribute("title", "再生します（Space）");
    fireEvent.keyDown(window, { key: " " });
    expect(screen.getByRole("button", { name: "停止" })).toHaveAttribute("title", "再生を止めます（Space）");
  });

  it("場面が無いときは奪わない（押して何も起きない、を作らない）", () => {
    useProjectStore.setState({ scenes: [], parts: [] });
    render(<PreviewScreen onNavigate={vi.fn()} />);
    const e = new KeyboardEvent("keydown", { key: " ", cancelable: true, bubbles: true });
    window.dispatchEvent(e);
    expect(e.defaultPrevented, "場面が無いのに画面送りを止めている").toBe(false);
  });
});
