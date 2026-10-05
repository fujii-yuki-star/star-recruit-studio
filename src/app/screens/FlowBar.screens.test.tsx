// @vitest-environment jsdom
// 流れの帯（ADR-0048 追補・利用者判断 2026-10-05）＝たたき台・場面編集・仕上がり確認・公開前チェック・書き出しの5画面で、
// 戻る（左）・いまの段（中）・進む（右）を同じ形で上に置く。段は押して移れる。
//
// ⚠️ **5画面を同じ物差しで見る**＝画面ごとに書き並べると、直し漏れた1画面を構造的に見つけられない（CLAUDE.md §7）。
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { Scene } from "../../domain/project/types";
import { useProjectStore } from "../store/projectStore";
import { FLOW_STEPS, type FlowScreen } from "../flowSteps";
import type { ScreenId } from "../data/mockData";
import { sampleTemplates } from "../../infrastructure/sampleData";
import { DraftScreen } from "./DraftScreen";
import { SceneEditScreen } from "./SceneEditScreen";
import { PreviewScreen } from "./PreviewScreen";
import { PrecheckScreen } from "./PrecheckScreen";
import { ExportScreen } from "./ExportScreen";

const scene = (id: string, order: number, templateId = "photo_left_text_right_yuko_v1"): Scene =>
  ({
    sceneId: id, partId: "part_001", order, sceneType: "photo_intro",
    templateId, durationSec: 8, assetRefs: {},
    character: { enabled: false, characterId: "yuko" }, texts: {},
    narration: { text: `場面${order}`, status: "generated" }, warnings: [],
  }) as Scene;

beforeEach(() => {
  cleanup();
  useProjectStore.getState().setExportRun({ phase: "idle" });
  useProjectStore.getState().newProject();
  useProjectStore.setState({
    status: "ready", templates: sampleTemplates,
    scenes: [scene("scene_001", 1), scene("scene_002", 2)],
    parts: [{ partId: "part_001", title: "パート1", order: 1, sceneIds: ["scene_001", "scene_002"] }],
    past: [], future: [], _historyGroupDepth: 0, saveStatus: "saved",
    previewReturnTo: null, precheckReturnTo: null, editingSceneId: null, sceneEditTrail: null,
  });
});

type Expect = { back: string | null; next: string | null };
const SCREENS: { screen: FlowScreen; render: (n: (s: ScreenId) => void) => void; expect: Expect }[] = [
  { screen: "draft", render: (n) => render(<DraftScreen onNavigate={n} />), expect: { back: null, next: "この内容で確認・編集する" } },
  { screen: "scene-edit", render: (n) => render(<SceneEditScreen onNavigate={n} />), expect: { back: "台本表へ戻る", next: "仕上がり確認へ" } },
  { screen: "preview", render: (n) => render(<PreviewScreen onNavigate={n} />), expect: { back: "たたき台へ戻る", next: "公開前チェックへ進む" } },
  { screen: "precheck", render: (n) => render(<PrecheckScreen onNavigate={n} />), expect: { back: "仕上がり確認へ戻る", next: "このまま書き出す" } },
  { screen: "export", render: (n) => render(<ExportScreen onNavigate={n} />), expect: { back: "公開前チェックへ戻る", next: null } },
];

describe("5画面とも、流れの帯が上にある", () => {
  it.each(SCREENS.map((s) => [s.screen, s] as const))("%s：いまの段・戻る・進むが帯の中にあり、帯の外に同じボタンが残っていない", (_name, s) => {
    const onNavigate = vi.fn();
    s.render(onNavigate);
    const bar = screen.getByTestId("flow-bar");
    // いまの段は押せない印（aria-current）・ほかの段は押せる。
    const i = FLOW_STEPS.findIndex((x) => x.screen === s.screen);
    expect(within(bar).getByText(`${i + 1} ${FLOW_STEPS[i].label}`)).toHaveAttribute("aria-current", "step");
    expect(within(bar).getAllByRole("button").filter((b) => b.classList.contains("flow-step"))).toHaveLength(FLOW_STEPS.length - 1);
    for (const [label, want] of [["back", s.expect.back], ["next", s.expect.next]] as const) {
      if (want == null) continue;
      expect(within(bar).getByRole("button", { name: new RegExp(want) }), `${label} が帯に無い`).toBeInTheDocument();
      // ⚠️ **元の場所から外した**＝同じ操作を2か所に置かない。
      expect(screen.getAllByRole("button", { name: new RegExp(`^${want}$`) }), `${want} が帯の外にも残っている`).toHaveLength(1);
    }
    // 帯は先頭にある（いちばん上の段の並び＝ほかのボタンより先に読まれる）。
    const first = document.querySelector("button");
    expect(bar.contains(first) || bar.compareDocumentPosition(first!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("段を押して移る（来た画面の覚え方は1か所）", () => {
  it("たたき台から公開前チェックへ＝覚えられない入口なので戻り先を消して置く（前に覚えた別の画面へ戻らない）", () => {
    useProjectStore.setState({ precheckReturnTo: "export" });
    const onNavigate = vi.fn();
    render(<DraftScreen onNavigate={onNavigate} />);
    fireEvent.click(screen.getByRole("button", { name: "4 公開前チェック" }));
    expect(onNavigate).toHaveBeenCalledWith("precheck");
    expect(useProjectStore.getState().precheckReturnTo).toBeNull();
  });

  it("仕上がり確認から公開前チェックへ＝戻り先は仕上がり確認", () => {
    const onNavigate = vi.fn();
    render(<PreviewScreen onNavigate={onNavigate} />);
    fireEvent.click(screen.getByRole("button", { name: "4 公開前チェック" }));
    expect(useProjectStore.getState().precheckReturnTo).toBe("preview");
  });

  it("場面編集から仕上がり確認へ＝戻り先は場面編集・いま編集中の場面を預ける", () => {
    useProjectStore.setState({ editingSceneId: "scene_002" });
    const onNavigate = vi.fn();
    render(<SceneEditScreen onNavigate={onNavigate} />);
    fireEvent.click(screen.getByRole("button", { name: "3 仕上がり確認" }));
    expect(onNavigate).toHaveBeenCalledWith("preview");
    expect(useProjectStore.getState().previewReturnTo).toBe("scene-edit");
    expect(useProjectStore.getState().editingSceneId).toBe("scene_002");
  });

  it("公開前チェックから仕上がり確認へ＝覚えられない入口なので戻り先を消して置く", () => {
    useProjectStore.setState({ previewReturnTo: "export" });
    const onNavigate = vi.fn();
    render(<PrecheckScreen onNavigate={onNavigate} />);
    fireEvent.click(screen.getByRole("button", { name: "3 仕上がり確認" }));
    expect(useProjectStore.getState().previewReturnTo).toBeNull();
  });
});

describe("進めないときは理由を帯に出す", () => {
  it("公開前チェック：書き出しを止める項目があれば「このまま書き出す」は押せず、理由がその下に出る", () => {
    useProjectStore.setState({ scenes: [scene("scene_001", 1, "missing_template")] });
    render(<PrecheckScreen onNavigate={vi.fn()} />);
    const bar = screen.getByTestId("flow-bar");
    expect(within(bar).getByRole("button", { name: /このまま書き出す/ })).toBeDisabled();
    expect(bar.querySelector(".flow-bar-reason")?.textContent ?? "").not.toBe("");
  });

  it("書き出し中は戻るも段も押せない（以前の戻ると同じ）", () => {
    useProjectStore.getState().setExportRun({ phase: "rendering" });
    render(<ExportScreen onNavigate={vi.fn()} />);
    const bar = screen.getByTestId("flow-bar");
    expect(within(bar).getByRole("button", { name: /公開前チェックへ戻る/ })).toBeDisabled();
    for (const b of within(bar).getAllByRole("button").filter((x) => x.classList.contains("flow-step"))) expect(b).toBeDisabled();
  });
});
