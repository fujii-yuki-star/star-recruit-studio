// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useProjectStore } from "../store/projectStore";
import type { Scene } from "../../domain/project/types";
import type { Template } from "../../domain/template/types";
import { SceneEditScreen } from "./SceneEditScreen";

// #779：**まとまりが消えたら、その動きも落とす**。
//
// 落とさないと `group_NNN` は**歯抜けの最小番号を再利用する**（`createGroupId`）ので、残った動きが
// **後から作った別のまとまり**に効く（`layoutScene` は場面で絞って `targetId` で引くだけ）。
// ＝利用者から見ると「解除したはずの動きで、新しく作ったまとまりが勝手に動く」。
// ADR-0028 D6 の per-use の「憑依」とまったく同じ経路。

const freeTemplate = {
  schemaVersion: "1.0", templateId: "free_canvas_v1", name: "自由配置", category: "free", aspectRatio: "16:9",
  canvas: { width: 1920, height: 1080 }, defaults: { backgroundColor: "#ffffff" },
  layers: [{ id: "background", type: "background", x: 0, y: 0, w: 1920, h: 1080, zIndex: 0 }],
} as unknown as Template;

const scene = (groups: unknown[]): Scene =>
  ({
    sceneId: "scene_001", partId: "part_001", order: 1, sceneType: "free", templateId: "free_canvas_v1",
    durationSec: 8, assetRefs: {}, character: { enabled: false, characterId: "yuko" }, texts: {},
    narration: { text: "", status: "none" },
    freeLayout: [
      { id: "free_001", kind: "shape", x: 100, y: 100, w: 200, h: 200, zIndex: 1 },
      { id: "free_002", kind: "shape", x: 400, y: 100, w: 200, h: 200, zIndex: 2 },
    ],
    groups,
    warnings: [],
  }) as unknown as Scene;

const group001 = { id: "group_001", members: ["free_001", "free_002"], transform: { x: 0, y: 0, rotation: 0, scale: 1 } };

/** group_001 に付いた動き（登場のしかた）。 */
const groupAnim = { id: "anim_001", sceneId: "scene_001", targetId: "group_001", keyframes: [{ timeSec: 0, opacity: 0 }, { timeSec: 0.6, opacity: 1 }] };

const setup = (groups: unknown[], animations: unknown[]) => {
  const st = useProjectStore.getState();
  useProjectStore.setState({
    templates: [freeTemplate],
    parts: [{ partId: "part_001", title: "パート1", order: 1, sceneIds: ["scene_001"] }],
    scenes: [scene(groups)],
    assets: [], editingSceneId: "scene_001",
    meta: { ...st.meta, timelineOverlay: { animations } } as never,
    past: [], future: [], _historyGroupDepth: 0, saveStatus: "saved",
  });
  render(<SceneEditScreen onNavigate={vi.fn()} />);
};

const animsOf = (): { targetId: string }[] =>
  (useProjectStore.getState().meta.timelineOverlay?.animations ?? []) as never;
const sceneNow = (): Scene => useProjectStore.getState().scenes[0];

/**
 * 一覧の先頭の要素を選んで消す（キャンバスを押すと「まとまり」が選ばれてしまうので一覧から選ぶ）。
 * 名前で指さないのは、1つ消すと**自動名が振り直される**ため。
 */
const deleteFirstInList = (): void => {
  const btn = screen.getAllByRole("button").find((b) => b.hasAttribute("aria-pressed") && /^図形/.test(b.textContent ?? ""));
  fireEvent.click(btn!);
  fireEvent.click(screen.getByRole("button", { name: "この配置を削除" }));
};

/** メンバーを1回押す＝まとまりを選ぶ（ツールバーが出る）。 */
const selectGroup = () => {
  const member = document.querySelector('[data-free-id="free_001"]') as HTMLElement;
  fireEvent.pointerDown(member, { button: 0, clientX: 150, clientY: 150, pointerId: 1 });
  fireEvent.pointerUp(member, { pointerId: 1 });
};

describe("SceneEditScreen まとまりが消えたら動きも落とす（#779）", () => {
  beforeEach(() => {
    useProjectStore.setState({ past: [], future: [], _historyGroupDepth: 0 });
  });

  it("**解除したらその動きも落ちる**（要素は残る・#779 の穴その1）", () => {
    setup([group001], [groupAnim]);
    selectGroup();
    fireEvent.click(screen.getByRole("button", { name: "解除" }));

    expect(sceneNow().groups ?? []).toHaveLength(0);
    expect(sceneNow().freeLayout).toHaveLength(2); // 要素は残る（解除であって削除ではない）
    expect(animsOf().filter((a) => a.targetId === "group_001")).toHaveLength(0);
  });

  it("**解除したあと作り直したまとまりは動かない**（番号の再利用で憑依しない＝利用者から見た症状）", () => {
    setup([group001], [groupAnim]);
    selectGroup();
    fireEvent.click(screen.getByRole("button", { name: "解除" }));

    // 解除した直後は元メンバーが選ばれたままなので、そのままもう一度まとめる
    //（＝歯抜けの再利用で **また `group_001`** になる）。
    fireEvent.click(screen.getByRole("button", { name: "選択をグループ化" }));

    expect(sceneNow().groups?.[0]?.id).toBe("group_001"); // 番号は実際に再利用される
    expect(animsOf().filter((x) => x.targetId === "group_001")).toHaveLength(0); // 勝手に動かない
  });

  it("**メンバーを全部消して空になったまとまり**の動きも落ちる（#779 の穴その2）", () => {
    setup([group001], [groupAnim, { ...groupAnim, id: "anim_002", targetId: "free_001" }]);
    // 一覧から1つずつ消す（まとまりはメンバーが空になって**自動で落ちる**＝利用者は解除していない）。
    // ⚠️ 名前で指さない＝1つ消すと自動名が振り直される（「図形2」が「図形1」になる）。
    deleteFirstInList();
    deleteFirstInList();
    expect(sceneNow().freeLayout).toHaveLength(0);
    expect(sceneNow().groups ?? []).toHaveLength(0);
    expect(animsOf()).toHaveLength(0); // 要素ぶんもまとまりぶんも残さない
  });

  it("消していない編集では動きを落とさない（掃除が効きすぎない）", () => {
    setup([group001], [groupAnim]);
    selectGroup();
    // まとまりを動かすだけ（消えていない）。
    useProjectStore.getState().updateScene("scene_001", (s) => ({
      ...s,
      groups: (s.groups ?? []).map((g) => ({ ...g, transform: { ...g.transform, x: 50 } })),
    }));
    expect(animsOf().filter((a) => a.targetId === "group_001")).toHaveLength(1);
  });

  it("取り消しは1回で戻る（場面と動きを別々に戻させない）", () => {
    setup([group001], [groupAnim]);
    selectGroup();
    fireEvent.click(screen.getByRole("button", { name: "解除" }));
    expect(animsOf()).toHaveLength(0);

    useProjectStore.getState().undo();
    expect(sceneNow().groups ?? []).toHaveLength(1);
    expect(animsOf().filter((a) => a.targetId === "group_001")).toHaveLength(1);
  });
});
