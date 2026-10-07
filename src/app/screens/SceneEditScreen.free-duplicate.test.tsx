// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useProjectStore } from "../store/projectStore";
import type { Scene } from "../../domain/project/types";
import type { Template } from "../../domain/template/types";
import { SceneEditScreen } from "./SceneEditScreen";

// #770：FREE 要素の複製・貼り付けが**中身ごと**であること。
// 形だけ写すと「動く要素を複製したのに動かない複製」ができ、動画の使う範囲・速度・再生の開始
// タイミング・収め方も既定へ戻る（＝空の複製）。消す側（`removeFreeEl`）は per-use と動きを対で
// 片づけているのに複製側だけ欠けていた＝同じ概念の片側だけを面倒みる非対称（ADR-0026②）。

const freeTemplate = {
  schemaVersion: "1.0", templateId: "free_canvas_v1", name: "自由配置", category: "free", aspectRatio: "16:9",
  canvas: { width: 1920, height: 1080 }, defaults: { backgroundColor: "#ffffff" },
  layers: [{ id: "background", type: "background", x: 0, y: 0, w: 1920, h: 1080, zIndex: 0 }],
} as unknown as Template;

const sceneWith = (sceneId: string, order: number, els: unknown[]): Scene =>
  ({
    sceneId, partId: "part_001", order, sceneType: "free", templateId: "free_canvas_v1",
    durationSec: 8, assetRefs: {}, character: { enabled: false, characterId: "yuko" }, texts: {},
    narration: { text: "", status: "none" },
    freeLayout: els,
    slotFits: { free_001: "contain" },
    slotClips: { free_001: { startSec: 2, endSec: 5, speed: 1.5 } },
    slotVideoStart: { free_001: { mode: "delay", delaySec: 0.4 } },
    warnings: [],
  }) as unknown as Scene;

/** 貼り付け先。⚠️ per-use を**持たせない**＝持たせると「貼って付いた」のか「元から有った」のか区別できない。 */
const emptyScene = (sceneId: string, order: number): Scene =>
  ({
    sceneId, partId: "part_001", order, sceneType: "free", templateId: "free_canvas_v1",
    durationSec: 8, assetRefs: {}, character: { enabled: false, characterId: "yuko" }, texts: {},
    narration: { text: "", status: "none" }, freeLayout: [], warnings: [],
  }) as unknown as Scene;

// FREE のスロット素材は**要素の `assetId`** で解決される（`assetRefs` は通常テンプレのもの＝`findVideoSlot`）。
const slotEl = (id: string, x: number) => ({ id, kind: "slot", assetId: "asset_001", x, y: 100, w: 200, h: 200, zIndex: 10 });

const anim = (id: string, sceneId: string, targetId: string) =>
  ({ id, sceneId, targetId, keyframes: [{ timeSec: 0, opacity: 0 }, { timeSec: 0.6, opacity: 1 }] });

const setup = (scenes: Scene[], animations: unknown[]): void => {
  useProjectStore.setState({
    templates: [freeTemplate],
    parts: [{ partId: "part_001", title: "パート1", order: 1, sceneIds: scenes.map((s) => s.sceneId) }],
    scenes,
    assets: [{ assetId: "asset_001", assetType: "video", displayName: "動画A", filePath: "a.mp4" }],
    editingSceneId: scenes[0].sceneId,
    meta: { ...useProjectStore.getState().meta, timelineOverlay: { animations } },
    past: [], future: [], _historyGroupDepth: 0, saveStatus: "saved",
  } as never);
};

/** 一覧で要素を選ぶ（選ばないと「コピー/複製/削除」を持つ欄が出ない）。 */
const selectEl = (name: string): void => {
  const btn = screen.getAllByRole("button", { name }).find((b) => b.hasAttribute("aria-pressed"));
  fireEvent.click(btn!);
};

const sceneOf = (sceneId: string): Scene => useProjectStore.getState().scenes.find((s) => s.sceneId === sceneId)!;
const animsOf = (): { sceneId: string; targetId: string }[] =>
  (useProjectStore.getState().meta.timelineOverlay?.animations ?? []) as never;

describe("SceneEditScreen FREE 要素の複製は中身ごと（#770）", () => {
  beforeEach(() => {
    setup([sceneWith("scene_001", 1, [slotEl("free_001", 100)])], [anim("anim_001", "scene_001", "free_001")]);
  });

  it("複製すると per-use（収め方・使う範囲・再生の開始）も動きも新しい要素へ引き継がれる", () => {
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    selectEl("素材1");
    fireEvent.click(screen.getByRole("button", { name: "この配置を複製" }));

    const s = sceneOf("scene_001");
    const newId = s.freeLayout!.map((e) => e.id).find((id) => id !== "free_001")!;
    expect(newId).toBeTruthy();
    expect(s.slotFits?.[newId]).toBe("contain");
    expect(s.slotClips?.[newId]).toEqual({ startSec: 2, endSec: 5, speed: 1.5 });
    expect(s.slotVideoStart?.[newId]).toEqual({ mode: "delay", delaySec: 0.4 });
    // 動く要素を複製したら、複製も動く。
    expect(animsOf().filter((a) => a.sceneId === "scene_001" && a.targetId === newId)).toHaveLength(1);
    expect(s.slotClips?.free_001).toEqual({ startSec: 2, endSec: 5, speed: 1.5 }); // 元はそのまま
  });

  it("取り消しは1回で全部戻る（場面と動きを別々に戻させない）", () => {
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    selectEl("素材1");
    fireEvent.click(screen.getByRole("button", { name: "この配置を複製" }));
    expect(sceneOf("scene_001").freeLayout).toHaveLength(2);

    useProjectStore.getState().undo();
    expect(sceneOf("scene_001").freeLayout).toHaveLength(1);
    expect(sceneOf("scene_001").slotClips).toEqual({ free_001: { startSec: 2, endSec: 5, speed: 1.5 } });
    expect(animsOf()).toHaveLength(1); // 複製ぶんの動きも同じ1回で消える
  });

  it("別の場面へ貼っても中身がついてくる（動きは貼った場面の要素として動く）", () => {
    setup(
      [sceneWith("scene_001", 1, [slotEl("free_001", 100)]), emptyScene("scene_002", 2)],
      [anim("anim_001", "scene_001", "free_001")],
    );
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    selectEl("素材1");
    fireEvent.click(screen.getByRole("button", { name: "この配置をコピー" }));

    // 場面の並びで2つめの場面へ移る（利用者と同じ道＝別の場面へ貼る）。
    fireEvent.click(screen.getByRole("button", { name: /2\. 自由配置/ }));
    fireEvent.click(screen.getByRole("button", { name: /^貼り付け/ }));

    const s2 = sceneOf("scene_002");
    expect(s2.freeLayout).toHaveLength(1);
    const pasted = s2.freeLayout![0].id;
    expect(s2.slotClips?.[pasted]).toEqual({ startSec: 2, endSec: 5, speed: 1.5 });
    expect(s2.slotFits?.[pasted]).toBe("contain");
    // 動きは**貼った場面**に宛て直す（元の場面に宛てたままだと、貼った要素は動かない）。
    expect(animsOf().filter((a) => a.sceneId === "scene_002" && a.targetId === pasted)).toHaveLength(1);
    expect(animsOf().filter((a) => a.sceneId === "scene_001")).toHaveLength(1); // 元は増えない
  });

  it("コピーした後に元を消しても、貼り付けは中身つきで貼れる（写した時点の控え）", () => {
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    selectEl("素材1");
    fireEvent.click(screen.getByRole("button", { name: "この配置をコピー" }));
    fireEvent.click(screen.getByRole("button", { name: "この配置を削除" }));
    expect(sceneOf("scene_001").freeLayout).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: /^貼り付け/ }));
    const s = sceneOf("scene_001");
    expect(s.freeLayout).toHaveLength(1);
    const pasted = s.freeLayout![0].id;
    expect(s.slotClips?.[pasted]).toEqual({ startSec: 2, endSec: 5, speed: 1.5 });
    expect(animsOf().filter((a) => a.targetId === pasted)).toHaveLength(1);
  });
});
