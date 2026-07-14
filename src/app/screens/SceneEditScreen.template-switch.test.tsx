// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useProjectStore } from "../store/projectStore";
import type { Scene } from "../../domain/project/types";
import type { Template } from "../../domain/template/types";
import { SceneEditScreen } from "./SceneEditScreen";

// ADR-0030 Option A：FREE→通常の切替で素材が復元できず消える場合だけ確認を出し、確定するまで切替えない（#524 P1/P2）。
// カスタムテンプレ（16:9）でピッカーを制御。FREE 場面は pickableTemplatesForScene で全カテゴリが候補に出る。
const freeTemplate = {
  schemaVersion: "1.0", templateId: "free_v1", name: "自由配置", category: "free", aspectRatio: "16:9",
  canvas: { width: 1920, height: 1080 }, layers: [{ id: "bg", type: "background", x: 0, y: 0, w: 1920, h: 1080 }],
} as unknown as Template;
const normalTemplate = {
  schemaVersion: "1.0", templateId: "photo_v1", name: "写真", category: "photo_intro", aspectRatio: "16:9",
  canvas: { width: 1920, height: 1080 }, layers: [{ id: "mainVisual", type: "slot", x: 0, y: 0, w: 1920, h: 1080 }],
} as unknown as Template;

const freeScene = (partial: Partial<Scene> = {}): Scene =>
  ({
    sceneId: "scene_001", partId: "part_001", order: 1, sceneType: "free",
    templateId: "free_v1", durationSec: 8, assetRefs: {},
    character: { enabled: false, characterId: "yuko" }, texts: {},
    narration: { text: "こんにちは", status: "none" }, warnings: [], ...partial,
  }) as unknown as Scene;

function setup(scene: Scene) {
  useProjectStore.setState({
    templates: [freeTemplate, normalTemplate],
    parts: [{ partId: "part_001", title: "パート1", order: 1, sceneIds: ["scene_001"] }],
    scenes: [scene], assets: [], editingSceneId: "scene_001",
    past: [], future: [], _historyGroupDepth: 0, saveStatus: "saved",
  });
}

const withSlot = () => freeScene({ freeLayout: [{ id: "free_001", kind: "slot", x: 0, y: 0, w: 100, h: 100, assetId: "a" }] } as Partial<Scene>);
const picker = () => screen.getByLabelText("見た目パターン");
const CONFIRM = /自由配置の素材は画面に表示されなくなります/;

describe("SceneEditScreen 見た目切替の確認（ADR-0030 Option A・#524 P1/P2）", () => {
  it("ネイティブFREE→通常：確認表示・キャンセルで未変更・確定で切替", () => {
    setup(withSlot()); // 自由配置あり・通常配置（assetRefs）なし＝復元できない
    render(<SceneEditScreen onNavigate={vi.fn()} />);

    fireEvent.change(picker(), { target: { value: "photo_v1" } });
    expect(screen.getByText(CONFIRM)).toBeTruthy(); // 確認が出る
    expect(useProjectStore.getState().scenes[0].templateId).toBe("free_v1"); // まだ切替えない

    fireEvent.click(screen.getByText("やめる"));
    expect(screen.queryByText(CONFIRM)).toBeNull();
    expect(useProjectStore.getState().scenes[0].templateId).toBe("free_v1"); // 未変更

    fireEvent.change(picker(), { target: { value: "photo_v1" } });
    fireEvent.click(screen.getByText("通常の見た目に変える"));
    const s = useProjectStore.getState().scenes[0];
    expect(s.templateId).toBe("photo_v1"); // 確定で切替
    expect(s.sceneType).toBe("photo_intro"); // カテゴリ追従
  });

  it("復元できるFREE→通常（休眠 assetRefs あり）：確認なしで即切替＋通常配置が復元", () => {
    // 往復の途中状態＝FREE だが通常テンプレのスロット（mainVisual）へ復元できる休眠 assetRefs を持つ。
    setup(freeScene({
      freeLayout: [{ id: "free_001", kind: "slot", x: 0, y: 0, w: 100, h: 100, assetId: "a" }],
      assetRefs: { mainVisual: "asset_v" },
    } as Partial<Scene>));
    render(<SceneEditScreen onNavigate={vi.fn()} />);

    fireEvent.change(picker(), { target: { value: "photo_v1" } });
    expect(screen.queryByText(CONFIRM)).toBeNull(); // 復元できるので確認は出ない
    const s = useProjectStore.getState().scenes[0];
    expect(s.templateId).toBe("photo_v1"); // 即切替
    expect(s.assetRefs.mainVisual).toBe("asset_v"); // 通常配置が復元
  });
});
