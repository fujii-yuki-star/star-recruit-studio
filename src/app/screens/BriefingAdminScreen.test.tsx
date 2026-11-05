// @vitest-environment jsdom
// あなた向け会社説明の登録の画面（β・ADR-0061 決定2）。
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { defaultBriefingCatalog, type BriefingCatalog } from "../../domain/briefing/catalog";

const fsState = vi.hoisted(() => ({
  catalog: null as unknown,
  saved: [] as unknown[],
  saveFails: false,
  summaries: [] as { projectId: string; projectName: string; updatedAt: string; format?: string }[],
  docs: {} as Record<string, string>,
}));
vi.mock("../../infrastructure/briefingFs", () => ({
  loadBriefingCatalog: async () => fsState.catalog,
  saveBriefingCatalog: async (c: unknown) => {
    if (fsState.saveFails) throw new Error("x");
    fsState.saved.push(c);
  },
}));
vi.mock("../../infrastructure/projectFs", () => ({
  listProjectSummaries: async () => fsState.summaries,
  loadProjectDoc: async (id: string) => {
    if (!(id in fsState.docs)) throw new Error("missing");
    return fsState.docs[id];
  },
}));
vi.mock("../../domain/project/persistence", async (orig) => {
  const actual = await orig<typeof import("../../domain/project/persistence")>();
  return { ...actual, parseProjectDoc: (t: string) => JSON.parse(t) };
});

import { BriefingAdminScreen } from "./BriefingAdminScreen";
import {
  BRIEFING_CATALOG_SAVE_FAILED_MESSAGE, BRIEFING_CATALOG_UNREADABLE_MESSAGE, BRIEFING_EXIT_CODE_INVALID_MESSAGE,
  BRIEFING_FEATURE_DISABLED_MESSAGE, BRIEFING_PROJECT_NOT_SCENE_MESSAGE,
} from "../uiLabels";

const P1 = "proj_20261101_001";

function sceneDoc(scenes: { sceneId: string; order: number; title?: string; text?: string }[]): string {
  return JSON.stringify({
    scenes: scenes.map((s) => ({ sceneId: s.sceneId, order: s.order, texts: s.title ? { title: s.title } : {}, narration: { text: s.text ?? "", status: "none" } })),
  });
}

function lastSaved(): BriefingCatalog {
  return fsState.saved.at(-1) as BriefingCatalog;
}

beforeEach(() => {
  fsState.catalog = defaultBriefingCatalog();
  fsState.saved = [];
  fsState.saveFails = false;
  fsState.summaries = [
    { projectId: P1, projectName: "会社説明 2026", updatedAt: "2026-11-01T00:00:00Z" },
    { projectId: "proj_20261102_001", projectName: "時間で作った動画", updatedAt: "2026-11-02T00:00:00Z", format: "timeline" },
  ];
  fsState.docs = { [P1]: sceneDoc([{ sceneId: "scene_002", order: 2, text: "研修のようすです" }, { sceneId: "scene_001", order: 1, title: "はじめに" }]) };
});

describe("あなた向け会社説明の登録", () => {
  it("拡張パックの鍵が無ければ、入れ方を案内して何もさせない", () => {
    render(<BriefingAdminScreen enabled={false} />);
    expect(screen.getByText(BRIEFING_FEATURE_DISABLED_MESSAGE)).toBeTruthy();
    expect(screen.queryByText("興味の項目")).toBeNull();
  });

  it("登録を読めなかったら知らせ、例の登録で上書きしない（触らせない）", async () => {
    fsState.catalog = null;
    render(<BriefingAdminScreen enabled />);
    expect(await screen.findByText(BRIEFING_CATALOG_UNREADABLE_MESSAGE)).toBeTruthy();
    expect(screen.queryByText("興味の項目")).toBeNull();
    expect(fsState.saved).toEqual([]);
  });

  it("例の興味の項目が出て、足す・消すとすぐ保存する", async () => {
    render(<BriefingAdminScreen enabled />);
    expect(await screen.findByDisplayValue("仕事内容")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("足す興味の項目"), { target: { value: "キャリア" } });
    fireEvent.click(screen.getAllByRole("button", { name: "足す" })[0]);
    await waitFor(() => expect(lastSaved().interests.at(-1)?.label).toBe("キャリア"));
    fireEvent.click(screen.getByRole("button", { name: "「仕事内容」を消す" }));
    await waitFor(() => expect(lastSaved().interests.some((i) => i.label === "仕事内容")).toBe(false));
  });

  it("足せる動画は場面形式だけ・足して場面を開くと、並びの順に場面が出て興味を付けられる", async () => {
    render(<BriefingAdminScreen enabled />);
    const select = (await screen.findByLabelText("足す動画")) as HTMLSelectElement;
    const options = [...select.options].map((o) => o.textContent);
    expect(options).toContain("会社説明 2026");
    expect(options).not.toContain("時間で作った動画");
    fireEvent.change(select, { target: { value: P1 } });
    fireEvent.click(screen.getAllByRole("button", { name: "足す" })[1]);
    await waitFor(() => expect(lastSaved().sources).toEqual([{ projectId: P1, enabled: true, scenes: [] }]));
    fireEvent.click(screen.getByRole("button", { name: "場面を設定" }));
    const groups = await screen.findAllByRole("group", { name: /を見せる興味$/ });
    expect(groups.map((g) => g.getAttribute("aria-label"))).toEqual(["1. はじめに を見せる興味", "2. 研修のようすです を見せる興味"]);
    fireEvent.click(within(groups[1]).getByLabelText("研修"));
    await waitFor(() => expect(lastSaved().sources[0].scenes).toEqual([{ sceneId: "scene_002", interestIds: ["interest_002"], priority: "normal", required: false, excluded: false }]));
  });

  it("消えた場面・タイムライン形式の動画を知らせ、消えた場面の登録を外せる", async () => {
    const c = defaultBriefingCatalog();
    c.sources = [
      { projectId: P1, enabled: true, scenes: [{ sceneId: "scene_009", interestIds: [], priority: "normal", required: true, excluded: false }] },
      { projectId: "proj_20261102_001", enabled: true, scenes: [] },
    ];
    fsState.catalog = c;
    render(<BriefingAdminScreen enabled />);
    expect(await screen.findByText(BRIEFING_PROJECT_NOT_SCENE_MESSAGE)).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "場面を設定" })[0]);
    fireEvent.click(await screen.findByRole("button", { name: "消えた場面の登録を外す" }));
    await waitFor(() => expect(lastSaved().sources[0].scenes).toEqual([]));
  });

  it("番号は4桁の数字だけ決められる（違えば知らせる）", async () => {
    render(<BriefingAdminScreen enabled />);
    const input = await screen.findByLabelText("抜ける番号（4 桁）");
    fireEvent.change(input, { target: { value: "12" } });
    fireEvent.click(screen.getByRole("button", { name: "番号を決める" }));
    expect(screen.getByText(BRIEFING_EXIT_CODE_INVALID_MESSAGE)).toBeTruthy();
    expect(fsState.saved).toEqual([]);
    fireEvent.change(input, { target: { value: "0427" } });
    fireEvent.click(screen.getByRole("button", { name: "番号を決める" }));
    await waitFor(() => expect(lastSaved().exitCode).toBe("0427"));
  });

  it("保存できなかったら知らせる", async () => {
    fsState.saveFails = true;
    render(<BriefingAdminScreen enabled />);
    fireEvent.click(await screen.findByRole("button", { name: "「研修」を消す" }));
    expect(await screen.findByText(BRIEFING_CATALOG_SAVE_FAILED_MESSAGE)).toBeTruthy();
  });
});
