// @vitest-environment jsdom
// 編集中の AI 補助の次の段（#1316・ADR-0053）：掛け合いの各行の言い直し・掛け合いの場面の見出し・動画の題名。
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { NARRATION_STATUS } from "../../domain/enums";
import type { Scene } from "../../domain/project/types";

const ai = vi.hoisted(() => ({ available: true, calls: [] as { system: string; user: string }[], reply: "" }));
vi.mock("../../infrastructure/aiClient", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  localAiAvailable: () => Promise.resolve(ai.available),
  localAiAssist: (system: string, user: string) => {
    ai.calls.push({ system, user });
    return Promise.resolve(ai.reply);
  },
}));

import { useProjectStore } from "../store/projectStore";
import { resetAiSuggestAvailabilityForTest } from "../components/AiSuggest";
import { ProjectNameField } from "../components/ProjectNameField";
import { SceneEditScreen } from "./SceneEditScreen";
import { sampleTemplates } from "../../infrastructure/sampleData";
import { AI_ASSIST_USE_LABEL, AI_ASSIST_VIDEO_TITLE_LABEL } from "../uiLabels";

const TEMPLATE = sampleTemplates.find((t) => t.templateId === "photo_left_text_right_yuko_v1")!;
const dialogue = (): Scene =>
  ({
    sceneId: "scene_001", partId: "part_001", order: 1, sceneType: "photo_intro",
    templateId: TEMPLATE.templateId, durationSec: 10, assetRefs: {},
    character: { enabled: false, characterId: "yuko" }, texts: {},
    narration: { text: "古い写し", status: NARRATION_STATUS.none }, warnings: [],
    lines: [
      { lineId: "line_001", text: "私たちは地域の配送を担っています。毎日たくさん届けます。", speaker: 8, status: NARRATION_STATUS.generated, voicePath: "voices/a.wav" },
      { lineId: "line_002", text: "未経験の方も先輩と一緒に覚えられます。", speaker: 14, status: NARRATION_STATUS.generated, voicePath: "voices/b.wav" },
    ],
  }) as unknown as Scene;

const flush = () => act(async () => { for (let i = 0; i < 4; i++) await Promise.resolve(); });

beforeEach(() => {
  cleanup();
  resetAiSuggestAvailabilityForTest();
  ai.available = true;
  ai.calls = [];
  ai.reply = "";
  useProjectStore.getState().newProject();
  useProjectStore.setState((st) => ({
    status: "ready", templates: [TEMPLATE], scenes: [dialogue()],
    parts: [{ partId: "part_001", title: "パート1", order: 1, sceneIds: ["scene_001"] }],
    editingSceneId: "scene_001", past: [], future: [], _historyGroupDepth: 0, saveStatus: "saved",
    meta: { ...st.meta, projectName: "無題の動画", companyInfo: { companyName: "株式会社サンプル物流" } },
  }));
});

describe("掛け合いの各行の言い直し（#1316）", () => {
  it("行ごとに頼め、「使う」でその行だけ書き換わり、その行の声は作り直しが要る状態に戻る", async () => {
    ai.reply = JSON.stringify({ candidates: ["先輩と一緒に覚えられます。"] });
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    await flush();
    const shortButtons = screen.getAllByRole("button", { name: "短く" });
    expect(shortButtons.length).toBeGreaterThanOrEqual(2); // 行ごとにある
    // ⚠️ **2行目**で頼む＝1行目だと「別の行を書き換える」取り違えが見えない（変異チェックで生き残った）。
    fireEvent.click(shortButtons[1]);
    await flush();
    expect(ai.calls[0].user).toContain("未経験の方も先輩と一緒に覚えられます");
    fireEvent.click(screen.getByRole("button", { name: AI_ASSIST_USE_LABEL }));
    const [l1, l2] = useProjectStore.getState().scenes[0].lines!;
    expect(l2.text).toBe("先輩と一緒に覚えられます。");
    expect(l2.status).toBe(NARRATION_STATUS.none);
    expect(l1.text).toBe("私たちは地域の配送を担っています。毎日たくさん届けます。"); // ほかの行は触らない
    expect(l1.status).toBe(NARRATION_STATUS.generated);
    // 行には表示時間が無いので「尺に合わせる」は出さない
    expect(screen.queryAllByRole("button", { name: "尺に合わせる" })).toHaveLength(0);
  });
});

describe("掛け合いの場面の見出し（#1316）", () => {
  it("見出しは行をつないだ語りから頼む（古い写しの narration.text は使わない）・字幕のボタンは出さない", async () => {
    ai.reply = JSON.stringify({ candidates: ["地域の配送と先輩の支え"] });
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "候補を出す" }));
    await flush();
    expect(ai.calls[0].user).toContain("私たちは地域の配送を担っています");
    expect(ai.calls[0].user).toContain("未経験の方も先輩と一緒に覚えられます");
    expect(ai.calls[0].user).not.toContain("古い写し");
    expect(screen.queryByRole("button", { name: "語りから作る" })).toBeNull();
  });
});

describe("動画の題名の候補（#1316）", () => {
  it("同梱の AI があればボタンを出し、主題と語りから頼み、「使う」で動画の名前を変える", async () => {
    ai.reply = JSON.stringify({ candidates: ["地域を走る配送のしごと"] });
    render(<ProjectNameField />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: AI_ASSIST_VIDEO_TITLE_LABEL }));
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "候補を出す" }));
    await flush();
    expect(ai.calls[0].user.startsWith("# 動画の内容")).toBe(true);
    expect(ai.calls[0].user).toContain("テーマ：{会社名}"); // 会社名は印で渡す
    expect(ai.calls[0].user).toContain("未経験の方も先輩と一緒に覚えられます");
    fireEvent.click(within(document.body).getByRole("button", { name: AI_ASSIST_USE_LABEL }));
    expect(useProjectStore.getState().meta.projectName).toBe("地域を走る配送のしごと");
  });

  it("同梱の AI が無ければボタンを出さない（押しても何も起きない、を作らない）", async () => {
    ai.available = false;
    render(<ProjectNameField />);
    await flush();
    expect(screen.queryByRole("button", { name: AI_ASSIST_VIDEO_TITLE_LABEL })).toBeNull();
  });
});
