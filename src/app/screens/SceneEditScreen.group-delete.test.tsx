// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { useProjectStore } from "../store/projectStore";
import type { Scene } from "../../domain/project/types";
import type { Template } from "../../domain/template/types";
import { SceneEditScreen } from "./SceneEditScreen";

// #551：グループを中身ごと削除できる（解除して1つずつ消す手間をなくす）。
// 要素・グループ・アニメを1手で落とし、Undo 1回で丸ごと戻ることを見る。
const freeTemplate = {
  schemaVersion: "1.0", templateId: "free_canvas_v1", name: "自由配置", category: "free", aspectRatio: "16:9",
  canvas: { width: 1920, height: 1080 }, defaults: { backgroundColor: "#ffffff" },
  layers: [{ id: "background", type: "background", x: 0, y: 0, w: 1920, h: 1080, zIndex: 0 }],
} as unknown as Template;

const scene = (locked?: boolean): Scene =>
  ({
    sceneId: "scene_001", partId: "part_001", order: 1, sceneType: "free", templateId: "free_canvas_v1",
    durationSec: 8, assetRefs: {}, character: { enabled: false, characterId: "yuko" }, texts: {},
    narration: { text: "", status: "none" },
    freeLayout: [
      { id: "free_001", kind: "shape", x: 100, y: 100, w: 200, h: 200, zIndex: 1 },
      { id: "free_002", kind: "shape", x: 400, y: 100, w: 200, h: 200, zIndex: 2 },
      { id: "free_003", kind: "shape", x: 700, y: 100, w: 200, h: 200, zIndex: 3 }, // グループ外＝残る
    ],
    groups: [{ id: "group_001", members: ["free_001", "free_002"], transform: { x: 0, y: 0, rotation: 0, scale: 1 }, ...(locked ? { locked: true } : {}) }],
    warnings: [],
  }) as unknown as Scene;

const setup = (opts?: { locked?: boolean; animations?: unknown[] }) => {
  const st = useProjectStore.getState();
  useProjectStore.setState({
    templates: [freeTemplate],
    parts: [{ partId: "part_001", title: "パート1", order: 1, sceneIds: ["scene_001"] }],
    scenes: [scene(opts?.locked)],
    assets: [], editingSceneId: "scene_001",
    meta: { ...st.meta, timelineOverlay: opts?.animations ? { animations: opts.animations } : undefined } as never,
    past: [], future: [], _historyGroupDepth: 0, saveStatus: "saved",
  });
  render(<SceneEditScreen onNavigate={vi.fn()} />);
  return () => useProjectStore.getState().scenes[0];
};

/** メンバーを1回押す＝グループ選択（ツールバーが出る）。 */
const selectGroup = () => {
  const member = document.querySelector('[data-free-id="free_001"]') as HTMLElement;
  fireEvent.pointerDown(member, { button: 0, clientX: 150, clientY: 150, pointerId: 1 });
  fireEvent.pointerUp(member, { pointerId: 1 });
};

describe("SceneEditScreen グループを中身ごと削除（#551）", () => {
  beforeEach(() => {
    useProjectStore.setState({ past: [], future: [], _historyGroupDepth: 0 });
  });

  it("ツールバーの「削除」は確認を出し、確定でメンバーごと消える（グループ外の要素は残る）", () => {
    const s = setup();
    selectGroup();
    const panel = screen.getByTestId("group-panel");
    fireEvent.click(within(panel).getByText("削除"));
    // 確認前は消えない＋何個消えるかを伝える（§2-5）。
    expect(s().freeLayout).toHaveLength(3);
    expect(screen.getByText(/中の2個の要素も一緒に消えます/)).toBeTruthy();

    fireEvent.click(screen.getByText("削除する"));
    expect(s().freeLayout?.map((e) => e.id)).toEqual(["free_003"]); // メンバー2つが消え、グループ外は残る
    expect(s().groups ?? []).toEqual([]); // グループ自体も消える
  });

  it("「やめる」で何も消えない", () => {
    const s = setup();
    selectGroup();
    fireEvent.click(within(screen.getByTestId("group-panel")).getByText("削除"));
    fireEvent.click(screen.getByText("やめる"));
    expect(s().freeLayout).toHaveLength(3);
    expect(s().groups).toHaveLength(1);
  });

  it("Undo 1回で要素もグループもまとめて戻る（履歴グループ）", () => {
    const s = setup();
    selectGroup();
    fireEvent.click(within(screen.getByTestId("group-panel")).getByText("削除"));
    fireEvent.click(screen.getByText("削除する"));
    expect(s().freeLayout).toHaveLength(1);

    useProjectStore.getState().undo();
    expect(s().freeLayout).toHaveLength(3);
    expect(s().groups).toHaveLength(1);
  });

  // グループ自体もアニメの対象になりうる（④(3)・ADR-0019）。要素だけ掃除するとグループのアニメが孤児になる。
  it("メンバーとグループ自身のアニメを両方掃除する（孤児を残さない）", () => {
    const anims = [
      { id: "anim_001", sceneId: "scene_001", targetId: "free_001", keyframes: [{ timeSec: 0, opacity: 0 }] },
      { id: "anim_002", sceneId: "scene_001", targetId: "group_001", keyframes: [{ timeSec: 0, opacity: 0 }] },
      { id: "anim_003", sceneId: "scene_001", targetId: "free_003", keyframes: [{ timeSec: 0, opacity: 0 }] }, // 残る要素
    ];
    setup({ animations: anims });
    selectGroup();
    fireEvent.click(within(screen.getByTestId("group-panel")).getByText("削除"));
    fireEvent.click(screen.getByText("削除する"));
    const left = useProjectStore.getState().meta.timelineOverlay?.animations ?? [];
    expect(left.map((a) => a.targetId)).toEqual(["free_003"]); // free_001（メンバー）と group_001（グループ自身）が消える
  });

  // ADR-0028 D6：スロットが消滅したら per-use の3マップとも当該キーを掃除する。
  // free_NNN は歯抜けを再利用する（createFreeElementId）ので、残すと将来の別要素に憑依し
  // 「設定した覚えのない速度/再生開始が黙って効く」（ADR-0026① の裏面）。
  it("消えたスロット要素の per-use 上書き（クリップ/再生開始/収め方）も掃除する（D6）", () => {
    const st = useProjectStore.getState();
    useProjectStore.setState({
      templates: [freeTemplate],
      parts: [{ partId: "part_001", title: "パート1", order: 1, sceneIds: ["scene_001"] }],
      scenes: [{
        ...scene(),
        freeLayout: [
          { id: "free_001", kind: "slot", x: 0, y: 0, w: 200, h: 200, assetId: "asset_v", zIndex: 1 },
          { id: "free_002", kind: "shape", x: 400, y: 100, w: 200, h: 200, zIndex: 2 },
          { id: "free_003", kind: "slot", x: 700, y: 100, w: 200, h: 200, assetId: "asset_w", zIndex: 3 },
        ],
        groups: [{ id: "group_001", members: ["free_001", "free_002"], transform: { x: 0, y: 0, rotation: 0, scale: 1 } }],
        slotClips: { free_001: { speed: 2 }, free_003: { speed: 1.5 } },
        slotVideoStart: { free_001: { mode: "delay", delaySec: 1 } },
        slotFits: { free_001: "cover" },
      } as unknown as Scene],
      assets: [], editingSceneId: "scene_001",
      meta: { ...st.meta, timelineOverlay: undefined } as never,
      past: [], future: [], _historyGroupDepth: 0, saveStatus: "saved",
    });
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    const s = () => useProjectStore.getState().scenes[0];
    selectGroup();
    fireEvent.click(within(screen.getByTestId("group-panel")).getByText("削除"));
    fireEvent.click(screen.getByText("削除する"));

    expect(s().slotClips).toEqual({ free_003: { speed: 1.5 } }); // 消えた free_001 のぶんだけ落ちる
    expect(s().slotVideoStart).toBeUndefined(); // 空になったら undefined
    expect(s().slotFits).toBeUndefined();
  });

  // #551 レビュー P2：確認を開いたままロックされると、「削除する」を押しても内側のガードが無言 return し、
  // 確認だけ閉じて「消えたはずが消えていない」サイレント失敗になる。確認をロック状態に追従させて窓を塞ぐ。
  // （グループ一覧の行から確認を開くと、この操作列は隠れず「ロック」を押せてしまう＝実際に到達しうる。）
  it("確認中にロックされたら確認が消え、無言で失敗する窓を作らない", () => {
    const s = setup();
    selectGroup();
    const panel = () => screen.getByTestId("group-panel");
    fireEvent.click(within(panel()).getByText("削除"));
    expect(screen.getByText("削除する")).toBeTruthy();

    // 確認を出したまま（別導線から）ロックした状態を作る。act で再描画を流してから確かめる
    // （生の setState は再描画前に assert すると古い DOM を見てしまう）。
    act(() => {
      useProjectStore.setState({
        scenes: [{ ...s(), groups: [{ ...(s().groups ?? [])[0], locked: true }] } as unknown as Scene],
      });
    });
    expect(screen.queryByText("削除する")).toBeNull(); // 確認は消える
    expect(within(panel()).getByText("削除")).toBeDisabled(); // 理由つきの無効ボタンへ戻る
    expect(s().groups).toHaveLength(1); // グループは残ったまま＝「消えたはず」にならない
  });

  it("ロック中のグループは削除できない（ボタンが無効）", () => {
    const s = setup({ locked: true });
    selectGroup();
    expect(within(screen.getByTestId("group-panel")).getByText("削除")).toBeDisabled();
    expect(s().groups).toHaveLength(1);
  });
});
