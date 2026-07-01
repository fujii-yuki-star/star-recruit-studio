// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useProjectStore } from "../store/projectStore";
import { sampleTemplates } from "../../infrastructure/sampleData";
import type { Scene } from "../../domain/project/types";
import { TimelineEditScreen } from "./TimelineEditScreen";

function scene(id: string, order: number): Scene {
  return {
    sceneId: id,
    partId: "part_001",
    order,
    sceneType: "photo_intro",
    templateId: "photo_left_text_right_yuko_v1",
    durationSec: 8,
    assetRefs: {},
    character: { enabled: false, characterId: "yuko" },
    texts: {},
    narration: { text: "", status: "none" },
    warnings: [],
  };
}

describe("TimelineEditScreen（③(4a) 編集ループ）", () => {
  beforeEach(() => {
    useProjectStore.setState({
      templates: sampleTemplates,
      parts: [{ partId: "part_001", title: "パート1", order: 1, sceneIds: ["scene_001"] }],
      scenes: [scene("scene_001", 1)],
      assets: [],
      meta: { ...useProjectStore.getState().meta, timelineOverlay: undefined },
      past: [],
      future: [],
      _historyGroupDepth: 0,
      saveStatus: "saved",
    });
  });

  it("テロップ追加→編集パネル表示→文言反映→削除で消える", () => {
    render(<TimelineEditScreen onNavigate={() => {}} />);
    // 追加前は編集パネルなし（案内文のみ）。
    expect(screen.queryByTestId("overlay-clip-editor")).not.toBeInTheDocument();

    // 追加 → パネルが出て既定文言「テロップ」。store にも 1 本追加される。
    fireEvent.click(screen.getByText("＋ テロップを追加"));
    const panel = screen.getByTestId("overlay-clip-editor");
    const textInput = panel.querySelector("input") as HTMLInputElement;
    expect(textInput).toHaveValue("テロップ");
    expect(useProjectStore.getState().meta.timelineOverlay?.clips).toHaveLength(1);

    // 文言編集 → store の overlay クリップに反映。
    fireEvent.change(textInput, { target: { value: "ここがポイント" } });
    expect(useProjectStore.getState().meta.timelineOverlay?.clips?.[0].text).toBe("ここがポイント");

    // 削除 → クリップが消え、編集パネルも消える。
    fireEvent.click(screen.getByText("このテロップを削除"));
    expect(useProjectStore.getState().meta.timelineOverlay?.clips).toEqual([]);
    expect(screen.queryByTestId("overlay-clip-editor")).not.toBeInTheDocument();
  });

  it("「時間の合わせ方」を絶対時間へ切り替えても実効グローバル秒を保つ（無警告ジャンプ防止）", () => {
    // 場面2つ：scene_001(0-8s)・scene_002(8-16s)。clip を場面2アンカー・相対2秒＝実効10秒で置く。
    useProjectStore.setState({
      parts: [{ partId: "part_001", title: "パート1", order: 1, sceneIds: ["scene_001", "scene_002"] }],
      scenes: [scene("scene_001", 1), scene("scene_002", 2)],
      meta: {
        ...useProjectStore.getState().meta,
        timelineOverlay: { clips: [{ id: "ovclip_001", track: "telop", anchorSceneId: "scene_002", startSec: 2, durationSec: 3, text: "x" }] },
      },
    });
    render(<TimelineEditScreen onNavigate={() => {}} />);
    // タイムライン上の overlay クリップを pointerdown で選択 → 編集パネル。
    fireEvent.pointerDown(screen.getByText("x"), { clientX: 10, pointerId: 1 });
    fireEvent.pointerUp(screen.getByText("x"), { clientX: 10, pointerId: 1 });
    const select = screen.getByTestId("overlay-clip-editor").querySelector("select") as HTMLSelectElement;
    // 絶対時間へ切替 → 実効10秒（8+2）を保持して startSec=10 になる（無警告ジャンプしない）。
    fireEvent.change(select, { target: { value: "" } });
    const clip = useProjectStore.getState().meta.timelineOverlay?.clips?.[0];
    expect(clip?.anchorSceneId).toBeUndefined();
    expect(clip?.startSec).toBe(10);
  });

  it("ドラッグ移動で startSec を更新し、左端クランプで実効差分が無いときは履歴を積まない", () => {
    useProjectStore.setState({
      parts: [{ partId: "part_001", title: "パート1", order: 1, sceneIds: ["scene_001", "scene_002"] }],
      scenes: [scene("scene_001", 1), scene("scene_002", 2)],
      meta: {
        ...useProjectStore.getState().meta,
        timelineOverlay: { clips: [{ id: "ovclip_001", track: "telop", startSec: 1, durationSec: 3, text: "x" }] },
      },
      past: [],
      future: [],
      _historyGroupDepth: 0,
    });
    render(<TimelineEditScreen onNavigate={() => {}} />);
    const clip = () => screen.getByText("x");
    const startSec = () => useProjectStore.getState().meta.timelineOverlay?.clips?.[0].startSec;
    // 右へ +72px（既定ズーム pxPerSec=36）＝+2秒 → startSec 1→3。
    fireEvent.pointerDown(clip(), { clientX: 100, pointerId: 1 });
    fireEvent.pointerMove(clip(), { clientX: 172, pointerId: 1 });
    fireEvent.pointerUp(clip(), { clientX: 172, pointerId: 1 });
    expect(startSec()).toBe(3);
    // 左へ大きく（-360px＝-10秒）→ 3-10 をクランプ → 0。
    fireEvent.pointerDown(clip(), { clientX: 100, pointerId: 1 });
    fireEvent.pointerMove(clip(), { clientX: -260, pointerId: 1 });
    fireEvent.pointerUp(clip(), { clientX: -260, pointerId: 1 });
    expect(startSec()).toBe(0);
    const pastLen = useProjectStore.getState().past.length;
    // すでに0なのでさらに左へドラッグしてもクランプ結果は不変 → 履歴が増えない（no-op スキップ）。
    fireEvent.pointerDown(clip(), { clientX: 100, pointerId: 1 });
    fireEvent.pointerMove(clip(), { clientX: -260, pointerId: 1 });
    fireEvent.pointerUp(clip(), { clientX: -260, pointerId: 1 });
    expect(startSec()).toBe(0);
    expect(useProjectStore.getState().past.length).toBe(pastLen);
  });

  it("右端トリミングで durationSec を伸ばし、左端トリミングは右端固定・最小長でクランプする", () => {
    useProjectStore.setState({
      parts: [{ partId: "part_001", title: "パート1", order: 1, sceneIds: ["scene_001", "scene_002"] }],
      scenes: [scene("scene_001", 1), scene("scene_002", 2)],
      meta: {
        ...useProjectStore.getState().meta,
        timelineOverlay: { clips: [{ id: "ovclip_001", track: "telop", startSec: 2, durationSec: 3, text: "x" }] },
      },
      past: [],
      future: [],
      _historyGroupDepth: 0,
    });
    const { container } = render(<TimelineEditScreen onNavigate={() => {}} />);
    const clip = () => useProjectStore.getState().meta.timelineOverlay?.clips?.[0];
    const rightHandle = () => container.querySelector(".timeline-clip-handle--right") as HTMLElement;
    const leftHandle = () => container.querySelector(".timeline-clip-handle--left") as HTMLElement;
    // 右端 +36px＝+1秒 → durationSec 3→4（end 2→6）。
    fireEvent.pointerDown(rightHandle(), { clientX: 100, pointerId: 1 });
    fireEvent.pointerMove(rightHandle(), { clientX: 136, pointerId: 1 });
    fireEvent.pointerUp(rightHandle(), { clientX: 136, pointerId: 1 });
    expect(clip()).toMatchObject({ startSec: 2, durationSec: 4 });
    // 左端 +36px＝+1秒 → 右端(6)固定で startSec 2→3・durationSec 4→3。
    fireEvent.pointerDown(leftHandle(), { clientX: 100, pointerId: 1 });
    fireEvent.pointerMove(leftHandle(), { clientX: 136, pointerId: 1 });
    fireEvent.pointerUp(leftHandle(), { clientX: 136, pointerId: 1 });
    expect(clip()).toMatchObject({ startSec: 3, durationSec: 3 });
    // 右端を大きく縮める（-360px＝-10秒）→ 最小長 0.5 でクランプ。
    fireEvent.pointerDown(rightHandle(), { clientX: 100, pointerId: 1 });
    fireEvent.pointerMove(rightHandle(), { clientX: -260, pointerId: 1 });
    fireEvent.pointerUp(rightHandle(), { clientX: -260, pointerId: 1 });
    expect(clip()?.durationSec).toBe(0.5);
  });
});
