// @vitest-environment jsdom
// 設定の「拡張パック」（ADR-0060）＝入れる前に見せる・外す前に使っている動画を知らせる。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

const fx = vi.hoisted(() => ({
  picked: "C:/パック/office.starpack" as string | null,
  inspect: "" as string,
  inspectError: null as string | null,
  installs: [] as { path: string; packId: string; shown: string }[],
  uninstalls: [] as string[],
  projects: [] as { projectId: string; doc: string }[],
  appVersion: "0.5.3",
}));
vi.mock("../../infrastructure/dialog", async (orig) => ({
  ...(await orig<typeof import("../../infrastructure/dialog")>()),
  showOpenExtensionPackDialog: vi.fn(async () => fx.picked),
}));
vi.mock("../../infrastructure/packFs", () => ({
  inspectPack: vi.fn(async () => {
    if (fx.inspectError) throw new Error(fx.inspectError);
    return fx.inspect;
  }),
  installPack: vi.fn(async (path: string, packId: string, shown: string) => { fx.installs.push({ path, packId, shown }); }),
  uninstallPack: vi.fn(async (packId: string) => { fx.uninstalls.push(packId); }),
  listPackManifests: vi.fn(async () => []),
  readPackText: vi.fn(),
  readPackDataUrl: vi.fn(),
}));
vi.mock("../../infrastructure/appInfo", () => ({ getAppVersion: vi.fn(async () => fx.appVersion) }));
vi.mock("../../infrastructure/projectFs", async (orig) => ({
  ...(await orig<typeof import("../../infrastructure/projectFs")>()),
  listProjectSummaries: vi.fn(async () => fx.projects.map((p) => ({ projectId: p.projectId, projectName: p.projectId, updatedAt: "" }))),
  loadProjectDoc: vi.fn(async (id: string) => fx.projects.find((p) => p.projectId === id)?.doc ?? "{}"),
}));

import { ExtensionPackSection } from "./ExtensionPackSection";
import { useProjectStore } from "../store/projectStore";
import type { ExtensionPackManifest } from "../../domain/pack/extensionPack";
import { PACK_INVALID_MESSAGE, PACK_MISSING_LICENSE_MESSAGE, packAppTooOldMessage, packRemoveConfirmMessage } from "../uiLabels";

const SHA = "a".repeat(64);
const manifest = (over: Partial<ExtensionPackManifest> = {}): ExtensionPackManifest => ({
  schemaVersion: "1.0", packId: "office", name: "オフィスの見た目", version: "1.0.0", publisher: "総務部", minAppVersion: "0.5.0",
  description: "会議室とオフィスの見た目",
  contents: { templates: [{ file: "t/a.json" }], features: ["personalized-briefing"] },
  files: [{ path: "t/a.json", sha256: SHA }],
  licenses: [{ target: "templates", license: "社内利用に限る", credit: "総務部" }, { target: "features", license: "社内利用に限る" }],
  ...over,
});

beforeEach(() => {
  fx.picked = "C:/パック/office.starpack";
  fx.inspect = JSON.stringify(manifest());
  fx.inspectError = null;
  fx.installs = [];
  fx.uninstalls = [];
  fx.projects = [];
  fx.appVersion = "0.5.3";
  useProjectStore.setState({ packs: [], packsSkipped: [] });
});
afterEach(() => vi.clearAllMocks());

describe("ExtensionPackSection", () => {
  it("入れる前に、作った人・版・中身・使ってよい範囲を見せ、「入れる」で照合して入れる", async () => {
    render(<ExtensionPackSection />);
    fireEvent.click(screen.getByRole("button", { name: "拡張パックを入れる…" }));
    const confirm = await screen.findByTestId("extension-pack-confirm");
    expect(confirm.textContent).toContain("「オフィスの見た目」を入れますか？");
    expect(confirm.textContent).toContain("作った人：総務部");
    expect(confirm.textContent).toContain("版：1.0.0");
    expect(confirm.textContent).toContain("見た目パターン 1個");
    expect(confirm.textContent).toContain("機能：あなた向け会社説明");
    expect(confirm.textContent).toContain("見た目パターン：社内利用に限る（表記：総務部）");
    expect(fx.installs).toEqual([]); // 見せただけでは入れない
    fireEvent.click(screen.getByRole("button", { name: "入れる" }));
    // ⚠️ 見せた manifest の文字そのものを渡す（入れる時に Rust が zip の中と突き合わせる）。
    await waitFor(() => expect(fx.installs).toEqual([{ path: "C:/パック/office.starpack", packId: "office", shown: fx.inspect }]));
    expect(await screen.findByText("「オフィスの見た目」を入れました。")).toBeTruthy();
  });

  it("「やめる」なら入れない", async () => {
    render(<ExtensionPackSection />);
    fireEvent.click(screen.getByRole("button", { name: "拡張パックを入れる…" }));
    await screen.findByTestId("extension-pack-confirm");
    fireEvent.click(screen.getByRole("button", { name: "やめる" }));
    expect(screen.queryByTestId("extension-pack-confirm")).toBeNull();
    expect(fx.installs).toEqual([]);
  });

  it("読めない・権利が無いパックは、理由と次の行動を出して見せる段へ進まない", async () => {
    fx.inspect = "{";
    const { unmount } = render(<ExtensionPackSection />);
    fireEvent.click(screen.getByRole("button", { name: "拡張パックを入れる…" }));
    expect((await screen.findByRole("alert")).textContent).toBe(PACK_INVALID_MESSAGE);
    expect(screen.queryByTestId("extension-pack-confirm")).toBeNull();
    unmount();
    fx.inspect = JSON.stringify(manifest({ licenses: [{ target: "templates", license: "社内利用" }] }));
    render(<ExtensionPackSection />);
    fireEvent.click(screen.getByRole("button", { name: "拡張パックを入れる…" }));
    expect((await screen.findByRole("alert")).textContent).toBe(PACK_MISSING_LICENSE_MESSAGE);
  });

  it("Rust の断り（照合が合わない等）はそのまま出す", async () => {
    fx.inspectError = "拡張パックの中のファイルが、書かれている内容と一致しません（途中で壊れたか、書き換えられています）。配った人からもう一度受け取ってください。";
    render(<ExtensionPackSection />);
    fireEvent.click(screen.getByRole("button", { name: "拡張パックを入れる…" }));
    expect((await screen.findByRole("alert")).textContent).toBe(fx.inspectError);
  });

  it("アプリが古いと、入れる段で断る（入れない）", async () => {
    fx.inspect = JSON.stringify(manifest({ minAppVersion: "0.9.0" }));
    render(<ExtensionPackSection />);
    fireEvent.click(screen.getByRole("button", { name: "拡張パックを入れる…" }));
    await screen.findByTestId("extension-pack-confirm");
    fireEvent.click(screen.getByRole("button", { name: "入れる" }));
    expect((await screen.findByRole("alert")).textContent).toBe(packAppTooOldMessage("0.9.0"));
    expect(fx.installs).toEqual([]);
  });

  it("外す前に、そのパックの見た目パターンを使っている動画の数を知らせる", async () => {
    useProjectStore.setState({ packs: [manifest()] });
    fx.projects = [
      { projectId: "proj_1", doc: JSON.stringify({ scenes: [{ templateId: "pack_office__a" }] }) },
      { projectId: "proj_2", doc: JSON.stringify({ clips: [{ templateId: "pack_office__b" }] }) },
      { projectId: "proj_3", doc: JSON.stringify({ scenes: [{ templateId: "opening_v1" }] }) },
      // ほかのパックの見た目パターンだけを使う動画は数えない。
      { projectId: "proj_4", doc: JSON.stringify({ scenes: [{ templateId: "pack_other__a" }] }) },
    ];
    render(<ExtensionPackSection />);
    fireEvent.click(screen.getByRole("button", { name: "外す" }));
    expect(await screen.findByText(packRemoveConfirmMessage("オフィスの見た目", 2))).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getAllByRole("button", { name: "外す" }).at(-1)!);
    });
    await waitFor(() => expect(fx.uninstalls).toEqual(["office"]));
  });

  it("読めなかったパックがあれば知らせる", () => {
    useProjectStore.setState({ packsSkipped: ["壊れたパック"] });
    render(<ExtensionPackSection />);
    expect(screen.getByRole("alert").textContent).toContain("壊れたパック");
  });
});

describe("中身のあらまし", () => {
  it("この版に無い機能は、識別子を出さずに決まった言葉にする（§2-3）", async () => {
    const { packContentsSummary, PACK_UNKNOWN_FEATURE_LABEL } = await import("../uiLabels");
    const s = packContentsSummary({ contents: { features: ["personalized-briefing", "future-thing", "other-thing"] } });
    expect(s).toBe(`機能：あなた向け会社説明・${PACK_UNKNOWN_FEATURE_LABEL}`);
    expect(s).not.toContain("future-thing");
  });
  it("文字の形の数も並べる（段階2）", async () => {
    const { packContentsSummary } = await import("../uiLabels");
    const font = { fontId: "a", file: "f/a.otf", displayName: "A" };
    expect(packContentsSummary({ contents: { templates: [{ file: "t.json" }], fonts: [font, { ...font, fontId: "b" }] } }))
      .toBe("見た目パターン 1個・文字の形 2個");
    expect(packContentsSummary({ contents: { bgm: [{ bgmId: "a", file: "b/a.mp3", displayName: "A" }] } })).toBe("音楽 1曲");
  });
});
