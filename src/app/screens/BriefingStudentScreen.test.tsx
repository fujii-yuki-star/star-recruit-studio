// @vitest-environment jsdom
// あなた向け会社説明の学生の画面（β・ADR-0061 決定3）。
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { defaultBriefingCatalog, type BriefingCatalog } from "../../domain/briefing/catalog";
import type { BriefingCandidate } from "../../domain/briefing/compose";

const run = vi.hoisted(() => ({
  composeCalls: [] as { chosen: readonly string[]; length: string }[],
  picks: [] as unknown[],
  prepareFails: null as Error | null,
  prepared: [] as unknown[],
  deleted: [] as string[],
  cleanups: 0,
}));

vi.mock("../briefing/briefingRun", () => {
  class BriefingPrepareError extends Error {}
  return {
    BriefingPrepareError,
    cleanupStaleBriefingSessions: async () => { run.cleanups += 1; },
    loadBriefingSources: async () => [],
    composeForStudent: async (_c: unknown, _d: unknown, chosen: readonly string[], length: string) => {
      run.composeCalls.push({ chosen, length });
      return { picks: run.picks, totalSec: 0, by: "rules", aiProblem: null };
    },
    prepareBriefingVideo: async (input: unknown) => {
      run.prepared.push(input);
      if (run.prepareFails) throw run.prepareFails;
      return "proj_20261105_901";
    },
    withLastProjectKept: async (open: () => Promise<unknown>) => open(),
  };
});
vi.mock("../../infrastructure/briefingSessionFs", () => ({
  deleteBriefingSession: async (id: string) => { run.deleted.push(id); },
}));
vi.mock("@tauri-apps/api/path", () => ({
  appDataDir: async () => "C:/data",
  join: async (...p: string[]) => p.join("/"),
}));
vi.mock("@tauri-apps/api/core", () => ({ convertFileSrc: (p: string) => `asset://localhost/${p}`, invoke: vi.fn() }));
// 書き出しの画面は裏で動かすだけ（ここでは中身を検査しない）。
vi.mock("./ExportScreen", () => ({ ExportScreen: () => <div data-testid="hidden-export" /> }));

import { BriefingStudentScreen } from "./BriefingStudentScreen";
import { sampleTemplates } from "../../infrastructure/sampleData";
import { buildBriefingClosingScene } from "../../domain/briefing/closing";
import type { Scene } from "../../domain/project/types";
import { useProjectStore } from "../store/projectStore";
import { useStartupJobStore } from "../store/startupJobStore";
import { useBriefingStudentStore } from "../store/briefingStudentStore";
import { BRIEFING_EXIT_CODE_WRONG_MESSAGE, BRIEFING_EXPORT_FAILED_MESSAGE, BRIEFING_NO_SCENES_MESSAGE } from "../uiLabels";

function cand(key: string, title: string, durationSec: number, matched: string[]): BriefingCandidate {
  return { key, projectId: "proj_20261101_001", sceneId: `scene_00${key.slice(1)}`, title, speech: "", durationSec, interestIds: matched, matched, priority: "normal", required: false };
}

/** 開いた一時の動画（組んだ 2 つ＋締め）。`loadProject` の代わりに store へ入れる。 */
function partScene(id: string, order: number, title: string, durationSec: number): Scene {
  return {
    sceneId: id, partId: "part_001", order, sceneType: "photo_intro", templateId: "photo_left_text_right_yuko_v1", durationSec,
    assetRefs: {}, character: { enabled: false, characterId: "yuko" }, texts: { title },
    narration: { text: `${title}のセリフ`, status: "generated", voicePath: `voices/${id}.wav` }, warnings: [],
  } as Scene;
}
function openedScenes(): Scene[] {
  const closing = buildBriefingClosingScene({ sceneId: "scene_003", partId: "part_001", order: 3, orientation: "16:9", text: "すたりおで作りました。", howText: "最初の一言", logoAssetId: null, templates: sampleTemplates })!;
  return [partScene("scene_001", 1, "研修のようす", 50), partScene("scene_002", 2, "先輩の一日", 35), closing];
}
const store = vi.hoisted(() => ({ generated: [] as string[], all: 0 }));

function catalog(): BriefingCatalog {
  return { ...defaultBriefingCatalog(), exitCode: "0427" };
}

beforeEach(() => {
  run.composeCalls = [];
  run.picks = [cand("c1", "研修のようす", 50, ["interest_002"]), cand("c2", "先輩の一日", 35, ["interest_003"])];
  run.prepareFails = null;
  run.prepared = [];
  run.deleted = [];
  run.cleanups = 0;
  useProjectStore.setState({ scenes: [], narrationAudioById: {} });
  useProjectStore.getState().setExportRun({ phase: "idle", resultPath: "", message: "" });
  useStartupJobStore.setState({ pendingExportOut: null, internal: false });
  useBriefingStudentStore.setState({ catalog: catalog() });
  store.generated = [];
  store.all = 0;
  useProjectStore.setState({
    templates: sampleTemplates,
    loadProject: vi.fn(async () => { useProjectStore.setState({ scenes: openedScenes(), parts: [{ partId: "part_001", title: "p", order: 1, sceneIds: ["scene_001", "scene_002", "scene_003"] }] }); }),
    generateAllNarrations: vi.fn(async () => { store.all += 1; }),
    generateNarration: vi.fn(async (id: string) => { store.generated.push(id); }),
    saveProject: vi.fn(async () => {}),
  } as never);
});

describe("学生の画面", () => {
  it("開いたら古い一時の動画を片づける・知りたいことを選ぶまで組めない・選んだ順でなく登録の順で頼む", async () => {
    render(<BriefingStudentScreen catalog={catalog()} />);
    await waitFor(() => expect(run.cleanups).toBe(1));
    const go = screen.getByRole("button", { name: "説明動画を組む" });
    expect((go as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "若手社員" }));
    fireEvent.click(screen.getByRole("button", { name: "研修" }));
    expect(screen.getByRole("button", { name: "研修" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("radio", { name: /しっかり/ }));
    fireEvent.click(go);
    await screen.findByText("この内容で作ります。順番を入れ替えたり、外したり、声を変えたりできます");
    expect(run.composeCalls).toEqual([{ chosen: ["interest_002", "interest_003"], length: "long" }]);
  });

  it("組んだらすぐ一時の動画を作って開き（作り方の一言つき）、本来の場面編集と同じカードで並べ替え・外すができる（締めは動かせない）", async () => {
    render(<BriefingStudentScreen catalog={catalog()} />);
    fireEvent.click(screen.getByRole("button", { name: "研修" }));
    fireEvent.click(screen.getByRole("button", { name: "説明動画を組む" }));
    const strip = await screen.findByRole("list", { name: "パートの並び" });
    const prepared = run.prepared[0] as { picks: BriefingCandidate[]; speaker: number | null; closingHowText: string };
    expect(prepared.picks.map((c) => c.key)).toEqual(["c1", "c2"]);
    expect(prepared.speaker).toBeNull();
    expect(prepared.closingHowText).toBe("あなたが選んだ「研修」に合わせて、2つの場面を選んで並べ、声も自動で作りました。");
    expect(screen.getByText("長さ：約 2 分")).toBeTruthy(); // 50＋35＋締め 6
    // 並べ替え（→）
    fireEvent.click(screen.getByRole("button", { name: "「研修のようす」を後ろへ" }));
    expect(useProjectStore.getState().scenes.map((x) => x.sceneId)).toEqual(["scene_002", "scene_001", "scene_003"]);
    // 締めの手前より後ろへは行けない・締めには並べ替えの印が無い
    expect((screen.getByRole("button", { name: "「研修のようす」を後ろへ" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole("button", { name: /すたりおで作りました。.*を前へ/ })).toBeNull();
    expect(strip.querySelectorAll("[role=listitem]")).toHaveLength(3);
    // 外す（選んで「このパートを外す」）
    fireEvent.click(screen.getByRole("button", { name: /^1\. 先輩の一日/ }));
    fireEvent.click(screen.getByRole("button", { name: "このパートを外す" }));
    expect(useProjectStore.getState().scenes.map((x) => x.sceneId)).toEqual(["scene_001", "scene_003"]);
    // 残り1つになったら外せない
    expect((screen.getByRole("button", { name: "このパートを外す" }) as HTMLButtonElement).disabled).toBe(true);
    // 締めを選ぶと外す・声は出さない
    fireEvent.click(screen.getByRole("button", { name: /^2\. / }));
    expect(screen.queryByRole("button", { name: "このパートを外す" })).toBeNull();
    expect(screen.getByText("最後のパートです（いつも最後に入ります）。")).toBeTruthy();
  });

  it("パートの声を変えると、その声ですぐ作り直す", async () => {
    render(<BriefingStudentScreen catalog={catalog()} />);
    fireEvent.click(screen.getByRole("button", { name: "研修" }));
    fireEvent.click(screen.getByRole("button", { name: "説明動画を組む" }));
    const sel = await screen.findByRole("combobox", { name: "このパートの声" });
    fireEvent.change(sel, { target: { value: "2" } });
    expect(useProjectStore.getState().scenes[0].narration).toMatchObject({ speaker: 2, status: "none" });
    expect(store.generated).toEqual(["scene_001"]);
  });

  it("作るとき、外した分だけ作り方の一言の数を合わせ、書き出しの画面へ「アプリの中の仕事」として渡す", async () => {
    render(<BriefingStudentScreen catalog={catalog()} />);
    fireEvent.click(screen.getByRole("button", { name: "研修" }));
    fireEvent.click(screen.getByRole("button", { name: "説明動画を組む" }));
    await screen.findByRole("list", { name: "パートの並び" });
    fireEvent.click(screen.getByRole("button", { name: "このパートを外す" }));
    fireEvent.click(screen.getByRole("button", { name: "この内容で作る" }));
    await waitFor(() => expect(useStartupJobStore.getState().pendingExportOut).toBe("C:/data/temporary-sessions/proj_20261105_901/briefing.mp4"));
    expect(useStartupJobStore.getState().internal).toBe(true);
    const how = useProjectStore.getState().scenes.at(-1)!.freeLayout!.find((e) => e.name === "作り方");
    expect(how?.text).toBe("あなたが選んだ「研修」に合わせて、1つの場面を選んで並べ、声も自動で作りました。");
    expect(screen.getByTestId("hidden-export")).toBeTruthy();
  });

  it("別の案を作ると、作りかけの一時の動画を消してから組み直す", async () => {
    render(<BriefingStudentScreen catalog={catalog()} />);
    fireEvent.click(screen.getByRole("button", { name: "研修" }));
    fireEvent.click(screen.getByRole("button", { name: "説明動画を組む" }));
    fireEvent.click(await screen.findByRole("button", { name: "別の案を作る" }));
    await waitFor(() => expect(run.prepared).toHaveLength(2));
    expect(run.deleted).toEqual(["proj_20261105_901"]);
  });

  it("話す声を選ぶと、その声を作るときに渡す", async () => {
    render(<BriefingStudentScreen catalog={catalog()} />);
    fireEvent.click(screen.getByRole("button", { name: "研修" }));
    fireEvent.click(screen.getByRole("radio", { name: "四国めたん" }));
    expect(screen.getByRole("radio", { name: "四国めたん" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("radio", { name: "いつもの声" }).getAttribute("aria-checked")).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "説明動画を組む" }));
    await waitFor(() => expect(run.prepared).toHaveLength(1));
    expect((run.prepared[0] as { speaker: number | null }).speaker).toBe(2);
  });

  it("仕上がったらその場で再生し、終わると一時の動画を消して最初へ戻る", async () => {
    render(<BriefingStudentScreen catalog={catalog()} />);
    fireEvent.click(screen.getByRole("button", { name: "研修" }));
    fireEvent.click(screen.getByRole("button", { name: "説明動画を組む" }));
    fireEvent.click(await screen.findByRole("button", { name: "この内容で作る" }));
    await screen.findByTestId("hidden-export");
    act(() => useProjectStore.getState().setExportRun({ phase: "done", resultPath: "C:/data/temporary-sessions/proj_20261105_901/briefing.mp4" }));
    const video = (await screen.findByText("「終わる」を押すと、この動画は消えます。")).parentElement!.querySelector("video")!;
    expect(video.getAttribute("src")).toMatch(/^asset:\/\/localhost\/C:\/data\/temporary-sessions\/proj_20261105_901\/briefing\.mp4\?t=\d+$/);
    fireEvent.click(screen.getByRole("button", { name: "終わる" }));
    await screen.findByRole("button", { name: "説明動画を組む" });
    expect(run.deleted).toEqual(["proj_20261105_901"]);
    expect(useProjectStore.getState().exportRun.phase).toBe("idle");
  });

  it("仕上げに失敗したら、学生の言葉で知らせる（編集ソフトの文をそのまま出さない）", async () => {
    render(<BriefingStudentScreen catalog={catalog()} />);
    fireEvent.click(screen.getByRole("button", { name: "研修" }));
    fireEvent.click(screen.getByRole("button", { name: "説明動画を組む" }));
    fireEvent.click(await screen.findByRole("button", { name: "この内容で作る" }));
    await screen.findByTestId("hidden-export");
    act(() => useProjectStore.getState().setExportRun({ phase: "error", message: "書き出す場面がありません。" }));
    expect(await screen.findByText(BRIEFING_EXPORT_FAILED_MESSAGE)).toBeTruthy();
    expect(screen.queryByText("書き出す場面がありません。")).toBeNull();
  });

  it("合う説明が無ければそう言う", async () => {
    run.picks = [];
    render(<BriefingStudentScreen catalog={catalog()} />);
    fireEvent.click(screen.getByRole("button", { name: "研修" }));
    fireEvent.click(screen.getByRole("button", { name: "説明動画を組む" }));
    expect(await screen.findByText(BRIEFING_NO_SCENES_MESSAGE)).toBeTruthy();
  });

  it("抜けるのは担当の人の番号だけ（違えば抜けない）", async () => {
    render(<BriefingStudentScreen catalog={catalog()} />);
    fireEvent.click(screen.getByRole("button", { name: "担当の人へ" }));
    const input = screen.getByLabelText("担当の人の番号（4 桁）");
    fireEvent.change(input, { target: { value: "1111" } });
    fireEvent.click(screen.getByRole("button", { name: "抜ける" }));
    expect(screen.getByText(BRIEFING_EXIT_CODE_WRONG_MESSAGE)).toBeTruthy();
    expect(useBriefingStudentStore.getState().catalog).not.toBeNull();
    fireEvent.change(input, { target: { value: "0427" } });
    fireEvent.click(screen.getByRole("button", { name: "抜ける" }));
    await waitFor(() => expect(useBriefingStudentStore.getState().catalog).toBeNull());
  });
});
