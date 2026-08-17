// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { EDITOR_HEADER_CLASS } from "../components/EditorToolbar";
import { saveButtonLabel } from "../components/saveButtonLabel";
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
const inHeaderEl = (el: Element): boolean => {
  if (el.closest(".panel-frame") != null) return false; // 欄の中＝閉じたり動かしたりすると見失う
  return el.closest(".page-head, .topbar") != null;
};
const inHeader = (name: string): boolean => inHeaderEl(screen.getByRole("button", { name }));

/**
 * **スクロールしても消えないか**。
 * ⚠️ 見出しの行に置いただけでは足りない＝その見出しが**スクロールする側の中**にあると、欄を伸ばして
 * 下へ動かした時点でツールバーごと視界から出る（＝移した意味がなくなる）。満たし方は2通りあり、
 * どちらでも結果は同じ＝**スクロールする側の外に居る**（場面編集の `.topbar`）か、**貼り付けてある**か。
 */
const staysVisibleOnScrollEl = (el: Element): boolean =>
  el.closest(".main-scroll") == null // そもそもスクロールしない所に居る
  || el.closest(`.${EDITOR_HEADER_CLASS}`) != null; // 貼り付けてある
const staysVisibleOnScroll = (name: string): boolean => staysVisibleOnScrollEl(screen.getByRole("button", { name }));

const scene = (): Scene =>
  ({
    sceneId: "scene_001", partId: "part_001", order: 1, sceneType: "opening",
    templateId: sampleTemplates[0].templateId, durationSec: 8, assetRefs: {},
    character: { enabled: false, characterId: "yuko" }, texts: {},
    narration: { text: "", status: "none" }, warnings: [],
  }) as unknown as Scene;

/** 見た目パターン編集は**自分のもの**だけ名前を直せる（下書きを汚して「未保存」を出すため）。 */
const userTemplate = { ...sampleTemplates[0], templateId: "user_tmpl_001", name: "マイ見た目" };

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

  // ⚠️ **保存の状態も規約9 の対象**（取り消す・戻るだけ見ても足りない）。ボタンではないので
  // `getByRole("button")` の物差しでは構造的に届かず、旧配置（欄の下）へ戻しても気づけなかった。
  // 出す条件が画面ごとに違う（要注意の状態だけ出す）ので、3画面とも**実際に出る状態**にしてから見る。
  it("3画面とも、保存の状態が見出しの行にある（スクロールしても消えない）", () => {
    // 場面編集：`saveStatus:"idle"` ＋ 場面あり＝「未保存の変更があります」が出る（saved は何も出ない）。
    useProjectStore.setState({
      templates: sampleTemplates,
      parts: [{ partId: "part_001", title: "パート1", order: 1, sceneIds: ["scene_001"] }],
      scenes: [scene()], assets: [], editingSceneId: "scene_001",
      past: [], future: [], saveStatus: "idle",
    } as never);
    const sceneEdit = render(<SceneEditScreen onNavigate={vi.fn()} />);
    const sceneMark = screen.getByText("● 未保存の変更があります");
    expect(inHeaderEl(sceneMark)).toBe(true);
    expect(staysVisibleOnScrollEl(sceneMark)).toBe(true);
    sceneEdit.unmount();

    // タイムライン編集：自動保存なので状態は常に出る（`role="status"`）。
    useTimelineStore.setState({ doc: timelineDoc(), loadError: null, isLoading: false, playheadSec: 0, selectedClipIds: [], assetSrcById: {} });
    useProjectStore.setState({ templates: [] });
    const timeline = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const timelineStatus = screen.getByRole("status");
    expect(inHeaderEl(timelineStatus)).toBe(true);
    expect(staysVisibleOnScrollEl(timelineStatus)).toBe(true);
    timeline.unmount();

    // 見た目パターン編集：下書きを1つ触って「未保存」を出してから見る。
    useProjectStore.setState({
      templates: [userTemplate, ...sampleTemplates], assets: [], scenes: [],
      editingTemplateId: userTemplate.templateId,
    } as never);
    render(<LooksEditScreen onNavigate={vi.fn()} />);
    fireEvent.change(screen.getByDisplayValue(userTemplate.name), { target: { value: "別の名前" } });
    const looksMark = screen.getByText("● 未保存の変更があります");
    expect(inHeaderEl(looksMark)).toBe(true);
    expect(staysVisibleOnScrollEl(looksMark)).toBe(true);
  });

  // ⚠️ 見出しの行に在ることと、**スクロールしても消えない**ことは別の話（前者だけでは #774 の
  // 「見えていないボタンは無いのと同じ」が残る）。3画面とも後者まで満たすことを固定する（ADR-0026②）。
  it("3画面とも、スクロールしても取り消す・戻るが消えない", () => {
    useProjectStore.setState({
      templates: sampleTemplates,
      parts: [{ partId: "part_001", title: "パート1", order: 1, sceneIds: ["scene_001"] }],
      scenes: [scene()], assets: [], editingSceneId: "scene_001",
      past: [], future: [], saveStatus: "idle",
    } as never);
    const sceneEdit = render(<SceneEditScreen onNavigate={vi.fn()} />);
    expect(staysVisibleOnScroll("取り消す")).toBe(true);
    expect(staysVisibleOnScroll("台本表へ戻る")).toBe(true);
    sceneEdit.unmount();

    useTimelineStore.setState({ doc: timelineDoc(), loadError: null, isLoading: false, playheadSec: 0, selectedClipIds: [], assetSrcById: {} });
    useProjectStore.setState({ templates: [] });
    const timeline = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(staysVisibleOnScroll("取り消す")).toBe(true);
    expect(staysVisibleOnScroll("動画の一覧へ")).toBe(true);
    timeline.unmount();

    useProjectStore.setState({
      templates: sampleTemplates, assets: [], scenes: [],
      editingTemplateId: sampleTemplates[0].templateId,
    } as never);
    render(<LooksEditScreen onNavigate={vi.fn()} />);
    expect(staysVisibleOnScroll("取り消す")).toBe(true);
    expect(staysVisibleOnScroll("一覧へ戻る")).toBe(true);
  });

  // ⚠️ **物差しが効いていることを確かめる**＝スクロールする側の中に居て貼り付いていない操作では偽になる。
  it("スクロールする側の中で貼り付いていない操作は「消えない」と見なさない（物差しの自己検査）", () => {
    useTimelineStore.setState({ doc: timelineDoc(), loadError: null, isLoading: false, playheadSec: 0, selectedClipIds: [], assetSrcById: {} });
    useProjectStore.setState({ templates: [] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(staysVisibleOnScroll("配置を既定に戻す")).toBe(false);
  });

  // ⚠️ **印が本当に「貼り付ける」意味を持つか**まで見る＝この検査が無いと、`.editor-header` を
  // 付けただけ（見た目は何も変わらない）でも上のテストが通ってしまう。
  it("貼り付けの印は、実際に貼り付ける指定を持つ", () => {
    const css = readFileSync("src/styles/theme.css", "utf-8"); // 走らせる場所はリポジトリの根
    const rule = css.match(new RegExp(`\\.${EDITOR_HEADER_CLASS}\\s*\\{[^}]*\\}`));
    expect(rule).not.toBeNull();
    expect(rule?.[0]).toMatch(/position:\s*sticky/);
    expect(rule?.[0]).toMatch(/top:\s*0/);
  });

  // ⚠️ 知らせだけを移すと、**欄を閉じた状態で保存に失敗したとき**「もう一度お試しください」の
  // 行き先が画面から消える（この画面は共通トップバーの保存を出さない＝§2-5 が行き止まりになる）。
  it("場面編集：保存の知らせと押せるものが同じ行にある（欄を閉じても再試行できる）", () => {
    useProjectStore.setState({
      templates: sampleTemplates,
      parts: [{ partId: "part_001", title: "パート1", order: 1, sceneIds: ["scene_001"] }],
      scenes: [scene()], assets: [], editingSceneId: "scene_001",
      past: [], future: [], saveStatus: "error",
    } as never);
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    // 知らせ（SaveStatusBadge）と保存が同じ行に居ること。
    const badge = screen.getByRole("alert");
    expect(badge.textContent).toContain("もう一度お試しください");
    const save = screen.getByRole("button", { name: saveButtonLabel("error") });
    expect(save.closest(".panel-frame")).toBeNull(); // 欄の中に残っていない
    expect(badge.closest(".editor-toolbar")).toBe(save.closest(".editor-toolbar"));
    expect(save.closest(".editor-toolbar")).not.toBeNull();
    // 保存は画面に1つだけ（`06 §2` 統一規約5）。
    expect(screen.getAllByRole("button", { name: saveButtonLabel("error") })).toHaveLength(1);
  });

  it("同じ操作を2か所に置かない（`06 §2` 統一規約5）", () => {
    useTimelineStore.setState({ doc: timelineDoc(), loadError: null, isLoading: false, playheadSec: 0, selectedClipIds: [], assetSrcById: {} });
    useProjectStore.setState({ templates: [] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getAllByRole("button", { name: "取り消す" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "動画の一覧へ" })).toHaveLength(1);
  });
});
