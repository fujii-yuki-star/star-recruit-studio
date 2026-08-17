// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { useProjectStore } from "../store/projectStore";
import { useTimelineStore } from "../store/timelineStore";
import { sampleTemplates } from "../../infrastructure/sampleData";
import { PROJECT_FORMAT, TIMELINE_CLIP_KIND, TRACK_KIND } from "../../domain/enums";
import { TIMELINE_SCHEMA_VERSION } from "../../domain/timeline/types";
import type { TimelineProject } from "../../domain/timeline/types";
import type { Scene } from "../../domain/project/types";
import { SceneEditScreen } from "./SceneEditScreen";
import { TimelineProjectScreen } from "./TimelineProjectScreen";
import { LooksEditScreen } from "./LooksEditScreen";

// #774：「取り消す／やり直す・保存の状態・一覧へ戻る」を**3画面で同じ場所**（見出しの行）に置く。
//
// ⚠️ **場所そのものが要件**なので、押せることだけ見ても足りない。以前は3画面3様で、とくに
// タイムラインは**画面のいちばん下**＝欄が画面の高さを超えるとスクロールしないと見えなかった
//（見えていないボタンは無いのと同じ）。場面編集も**欄の中**にあり、欄を閉じたり配置を変えると
// 見失えた（ADR-0033 で配置を動かせるようにしたので、欄の中に置くほど見失いやすい）。

/**
 * その操作が**見出しの行の中**に在るか。
 * ⚠️ **「欄の中に無い」まで見る**＝見出しの目印（`.page-head`/`.topbar`）だけを見ると、欄の中にも
 * 似た並びがあるので**欄に置いたままでも真になりうる**（下の自己検査で判別できることを固定する）。
 */
const inHeader = (name: string): boolean => {
  const el = screen.getByRole("button", { name });
  if (el.closest(".panel-frame") != null) return false; // 欄の中＝閉じたり動かしたりすると見失う
  return el.closest(".page-head, .topbar") != null;
};

const scene = (): Scene =>
  ({
    sceneId: "scene_001", partId: "part_001", order: 1, sceneType: "opening",
    templateId: sampleTemplates[0].templateId, durationSec: 8, assetRefs: {},
    character: { enabled: false, characterId: "yuko" }, texts: {},
    narration: { text: "", status: "none" }, warnings: [],
  }) as unknown as Scene;

const timelineDoc = (): TimelineProject => ({
  schemaVersion: TIMELINE_SCHEMA_VERSION,
  format: PROJECT_FORMAT.timeline,
  projectId: "proj_20260728_001",
  projectName: "焼いた動画",
  createdAt: "2026-07-28T00:00:00.000Z",
  updatedAt: "2026-07-28T00:00:00.000Z",
  videoSettings: { aspectRatio: "16:9", fps: 30, targetDurationSec: 60, maxDurationSec: 600 },
  voiceSettings: { defaultVoiceId: "voicevox_zundamon" },
  assets: [],
  tracks: [{ id: "track_001", kind: TRACK_KIND.visual }],
  clips: [
    { id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 5, x: 0, y: 0, w: 100, h: 50, text: "あ" },
  ],
});

describe("編集画面の共通ツールバーは見出しの行に在る（#774）", () => {
  beforeEach(() => {
    localStorage.clear();
    useTimelineStore.getState().closeTimelineProject();
  });

  it("場面編集：取り消す・やり直す・戻るが見出しの行（欄の中ではない）", () => {
    useProjectStore.setState({
      templates: sampleTemplates,
      parts: [{ partId: "part_001", title: "パート1", order: 1, sceneIds: ["scene_001"] }],
      scenes: [scene()], assets: [], editingSceneId: "scene_001",
      past: [], future: [], saveStatus: "saved",
    } as never);
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    expect(inHeader("取り消す")).toBe(true);
    expect(inHeader("やり直す")).toBe(true);
    expect(inHeader("台本表へ戻る")).toBe(true);
  });

  it("タイムライン編集：取り消す・やり直す・一覧へが見出しの行（画面のいちばん下ではない）", () => {
    useTimelineStore.setState({ doc: timelineDoc(), loadError: null, isLoading: false, playheadSec: 0, selectedClipIds: [], assetSrcById: {} });
    useProjectStore.setState({ templates: [] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(inHeader("取り消す")).toBe(true);
    expect(inHeader("やり直す")).toBe(true);
    expect(inHeader("動画の一覧へ")).toBe(true);
  });

  it("見た目パターン編集：取り消す・やり直す・一覧へ戻るが見出しの行", () => {
    // どのテンプレを編集しているかは store が持つ（画面は props で受け取らない）。
    useProjectStore.setState({
      templates: sampleTemplates, assets: [], scenes: [],
      editingTemplateId: sampleTemplates[0].templateId,
    } as never);
    render(<LooksEditScreen onNavigate={vi.fn()} />);
    expect(inHeader("取り消す")).toBe(true);
    expect(inHeader("やり直す")).toBe(true);
    expect(inHeader("一覧へ戻る")).toBe(true);
  });

  // ⚠️ **物差しが効いていることを確かめる**＝`inHeader` が何にでも真を返すなら、上の3件は
  // 何も検査していないのと同じ（欄の中の操作では偽になることを見る）。
  it("欄の中の操作は「見出しの行」と見なさない（物差しの自己検査）", () => {
    useProjectStore.setState({
      templates: sampleTemplates,
      parts: [{ partId: "part_001", title: "パート1", order: 1, sceneIds: ["scene_001"] }],
      scenes: [scene()], assets: [], editingSceneId: "scene_001",
      past: [], future: [], saveStatus: "saved",
    } as never);
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    expect(inHeader("場面を追加")).toBe(false); // これは欄の中にある操作
  });

  it("同じ操作を2か所に置かない（`06 §2` 統一規約5）", () => {
    useTimelineStore.setState({ doc: timelineDoc(), loadError: null, isLoading: false, playheadSec: 0, selectedClipIds: [], assetSrcById: {} });
    useProjectStore.setState({ templates: [] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getAllByRole("button", { name: "取り消す" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "動画の一覧へ" })).toHaveLength(1);
  });
});
