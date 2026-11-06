// あなた向け会社説明の流れ（ADR-0061 決定4・5）＝一時の動画を作る・失敗したら作りかけを消す・次に開く動画を書き換えない。
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultBriefingCatalog } from "../../domain/briefing/catalog";
import type { BriefingCandidate } from "../../domain/briefing/compose";
import { BRIEFING_SESSION_ID_FLOOR } from "../../domain/constants";
import { PROJECT_SCHEMA_VERSION } from "../../domain/project/persistence";
import type { Project, Scene } from "../../domain/project/types";
import { sampleTemplates } from "../../infrastructure/sampleData";

const fs = vi.hoisted(() => ({
  summaries: [] as { projectId: string; projectName: string; updatedAt: string; format?: string }[],
  sessions: [] as string[],
  created: [] as string[],
  deleted: [] as string[],
  copied: [] as { dest: string; files: unknown[] }[],
  saved: [] as { id: string; json: string }[],
  saveFails: false,
  copyFails: false,
  kit: null as unknown,
  library: [] as unknown[],
  libCopies: [] as unknown[][],
  last: null as string | null,
  aiAvailable: false,
  asked: 0,
}));

vi.mock("../../infrastructure/projectFs", () => ({
  listProjectSummaries: async () => fs.summaries,
  loadProjectDoc: async () => "{}",
  saveProjectDoc: async (id: string, json: string) => {
    if (fs.saveFails) throw new Error("disk");
    fs.saved.push({ id, json });
    return "";
  },
  getLastProjectId: () => fs.last,
  setLastProjectId: (id: string) => { fs.last = id; },
  clearLastProjectId: () => { fs.last = null; },
}));
vi.mock("../../infrastructure/briefingSessionFs", () => ({
  listBriefingSessions: async () => fs.sessions,
  createBriefingSession: async (id: string) => { fs.created.push(id); },
  deleteBriefingSession: async (id: string) => { fs.deleted.push(id); },
  copyBriefingSessionFiles: async (dest: string, files: unknown[]) => {
    if (fs.copyFails) throw new Error("copy");
    fs.copied.push({ dest, files });
    return { copied: files.length, missing: [] };
  },
  cleanupBriefingSessions: async () => 0,
}));
vi.mock("../../infrastructure/brandKitFs", () => ({ loadBrandKit: async () => fs.kit }));
vi.mock("../../infrastructure/assetLibraryFs", () => ({
  listLibraryAssets: async () => fs.library,
  copyLibraryAssetToProject: async (...a: unknown[]) => { fs.libCopies.push(a); return `assets/${a[2] as string}`; },
}));
vi.mock("../../infrastructure/aiClient", () => ({
  localAiAvailable: async () => fs.aiAvailable,
  localAiAssist: async () => { fs.asked += 1; return '{"order":["c1"]}'; },
}));

import { BriefingPrepareError, composeForStudent, prepareBriefingVideo, withLastProjectKept } from "./briefingRun";
import { BRIEFING_NO_SCENES_MESSAGE, BRIEFING_SESSION_FULL_MESSAGE, BRIEFING_SESSION_PREPARE_FAILED_MESSAGE } from "../uiLabels";

function scene(sceneId: string): Scene {
  return {
    sceneId, partId: "part_001", order: 1, sceneType: "message", templateId: "message_yuko_v1", durationSec: 8,
    assetRefs: { background: "asset_001" }, character: { enabled: true, characterId: "yuko", poseAssetId: null },
    texts: { title: "見出し" }, narration: { text: "こんにちは", status: "generated", voicePath: `voices/${sceneId}.wav` }, warnings: [],
  };
}
const SRC: Project = {
  schemaVersion: PROJECT_SCHEMA_VERSION, videoKind: "recruit", projectId: "proj_20261101_001", projectName: "原本", purpose: "company_intro",
  createdAt: "2026-11-01T00:00:00.000Z", updatedAt: "2026-11-01T00:00:00.000Z",
  videoSettings: { aspectRatio: "16:9", fps: 30, targetDurationSec: 60, maxDurationSec: 120 },
  companyInfo: { companyName: "テスト株式会社" }, voiceSettings: { defaultVoiceId: "voicevox_zundamon" },
  assets: [{ assetId: "asset_001", assetType: "image", displayName: "a.png", filePath: "assets/asset_001.png" }],
  parts: [{ partId: "part_001", title: "はじめ", order: 1, sceneIds: ["scene_001"] }], scenes: [scene("scene_001")],
} as Project;
const PICK: BriefingCandidate = { key: "c1", projectId: SRC.projectId, sceneId: "scene_001", title: "見出し", speech: "", durationSec: 8, interestIds: [], matched: [], priority: "normal", required: true };
const NOW = new Date(2026, 10, 5, 10, 0, 0);
const firstId = `proj_20261105_${BRIEFING_SESSION_ID_FLOOR + 1}`;

function input(over: Partial<Parameters<typeof prepareBriefingVideo>[0]> = {}): Parameters<typeof prepareBriefingVideo>[0] {
  return { catalog: defaultBriefingCatalog(), docs: [SRC], picks: [PICK], templates: sampleTemplates, speaker: null, now: NOW, ...over };
}

beforeEach(() => {
  Object.assign(fs, { summaries: [], sessions: [], created: [], deleted: [], copied: [], saved: [], saveFails: false, copyFails: false, kit: null, library: [], libCopies: [], last: null, aiAvailable: false, asked: 0 });
});

describe("一時の動画を作る", () => {
  it("両方の置き場所の番号を避けて作り、ファイルを写して保存する（声は元のまま＝元の声も写す）", async () => {
    fs.summaries = [{ projectId: "proj_20261105_001", projectName: "x", updatedAt: "" }];
    fs.sessions = [firstId];
    const id = await prepareBriefingVideo(input());
    expect(id).toBe(`proj_20261105_${BRIEFING_SESSION_ID_FLOOR + 2}`);
    expect(fs.created).toEqual([id]);
    expect(fs.copied[0].dest).toBe(id);
    expect((fs.copied[0].files as { toRelPath: string }[]).map((f) => f.toRelPath)).toContain("voices/scene_001.wav");
    const doc = JSON.parse(fs.saved[0].json) as Project;
    expect(fs.saved[0].id).toBe(id);
    expect(doc.projectId).toBe(id);
    expect(doc.scenes).toHaveLength(2);
    expect(fs.deleted).toEqual([]);
  });

  it("声を選ぶと、単独の語りをその声で作り直す（元の声は写さない）", async () => {
    await prepareBriefingVideo(input({ speaker: 2 }));
    const doc = JSON.parse(fs.saved[0].json) as Project;
    expect(doc.scenes[0].narration).toMatchObject({ speaker: 2, status: "pending", voicePath: null });
    expect((fs.copied[0].files as { toRelPath: string }[]).map((f) => f.toRelPath)).not.toContain("voices/scene_001.wav");
  });

  it("会社の見た目のロゴを写して締めの場面に置く（登録で「置かない」なら写さない）", async () => {
    fs.kit = { logoLibraryAssetId: "lib_asset_001", colors: ["#cc3300"] };
    fs.library = [{ id: "lib_asset_001", fileName: "logo.png", assetType: "image", displayName: "ロゴ", tags: [] }];
    await prepareBriefingVideo(input());
    expect(fs.libCopies).toHaveLength(1);
    const doc = JSON.parse(fs.saved[0].json) as Project;
    const logo = doc.assets.find((a) => a.displayName === "ロゴ")!;
    expect(logo.filePath).toBe(`assets/${fs.libCopies[0][2] as string}`);
    expect(doc.scenes.at(-1)?.freeLayout?.some((e) => e.assetId === logo.assetId)).toBe(true);
    expect(doc.scenes.at(-1)?.freeLayout?.some((e) => e.fillColor === "#cc3300")).toBe(true);

    Object.assign(fs, { saved: [], libCopies: [] });
    const c = defaultBriefingCatalog();
    await prepareBriefingVideo(input({ catalog: { ...c, closing: { ...c.closing, useBrandLogo: false } } }));
    expect(fs.libCopies).toEqual([]);
  });

  it("途中で失敗したら作りかけを消して、学生の言葉で断る", async () => {
    fs.copyFails = true;
    await expect(prepareBriefingVideo(input())).rejects.toThrow(BRIEFING_SESSION_PREPARE_FAILED_MESSAGE);
    expect(fs.deleted).toEqual([firstId]);
    fs.copyFails = false;
    fs.saveFails = true;
    fs.deleted = [];
    await expect(prepareBriefingVideo(input())).rejects.toBeInstanceOf(BriefingPrepareError);
    expect(fs.deleted).toHaveLength(1);
  });

  it("場面が無い・番号が尽きたら作らずに断る", async () => {
    await expect(prepareBriefingVideo(input({ picks: [] }))).rejects.toThrow(BRIEFING_NO_SCENES_MESSAGE);
    fs.sessions = Array.from({ length: 999 - BRIEFING_SESSION_ID_FLOOR }, (_, i) => `proj_20261105_${BRIEFING_SESSION_ID_FLOOR + 1 + i}`);
    await expect(prepareBriefingVideo(input())).rejects.toThrow(BRIEFING_SESSION_FULL_MESSAGE);
    expect(fs.created).toEqual([]);
  });
});

describe("組む・開く", () => {
  it("同梱の AI が無ければ頼まない（外へは送らない）・あれば頼む", async () => {
    const two = { ...SRC, scenes: [scene("scene_001"), { ...scene("scene_002"), order: 2 }] } as Project;
    const rule = { interestIds: [], priority: "normal" as const, required: true, excluded: false };
    const catalog = { ...defaultBriefingCatalog(), sources: [{ projectId: SRC.projectId, enabled: true, scenes: [{ sceneId: "scene_001", ...rule }, { sceneId: "scene_002", ...rule }] }] };
    const r = await composeForStudent(catalog, [two], [], "short");
    expect(r.by).toBe("rules");
    expect(fs.asked).toBe(0);
    fs.aiAvailable = true;
    await composeForStudent(catalog, [two], [], "short");
    expect(fs.asked).toBe(1);
  });

  it("一時の動画を開いても「次に開く動画」は元のまま（失敗しても戻す）", async () => {
    fs.last = "proj_20261101_001";
    await withLastProjectKept(async () => { fs.last = firstId; });
    expect(fs.last).toBe("proj_20261101_001");
    fs.last = null;
    await expect(withLastProjectKept(async () => { fs.last = firstId; throw new Error("x"); })).rejects.toThrow();
    expect(fs.last).toBeNull();
  });
});
