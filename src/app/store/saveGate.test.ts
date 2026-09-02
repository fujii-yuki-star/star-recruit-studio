// **次に開けなくなる内容は保存しない**（#974）。
//
// ⚠️ #959 とまったく同じ形＝**保存はできたのに次に開けない**。読み込みは型・必須の欠け
//（`structural`）を拒否するので、そのまま書くと動画が丸ごと開けなくなる。
// 書かなければ**前に保存できていた内容がそのまま残る**ので、取り消して直せば続けられる。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useProjectStore } from "./projectStore";
import * as fs from "../../infrastructure/projectFs";
import * as keeper from "./restorePointKeeper";
import { PROJECT_SAVE_WOULD_BREAK } from "../uiLabels";

describe("次に開けなくなる内容は保存しない（#974）", () => {
  beforeEach(() => {
    vi.spyOn(keeper, "keepRestorePoints").mockResolvedValue(undefined);
    useProjectStore.getState().newProject();
    // ⚠️ **番号を先に入れる**＝無いと `_doSave` が一覧を読みに行き、テスト環境では
    // そこで落ちて catch に入る（**門まで届かないのに「保存できない」だけが観測される**）。
    useProjectStore.setState({ meta: { ...useProjectStore.getState().meta, projectId: "proj_20260902_001" } });
  });
  afterEach(() => vi.restoreAllMocks());

  const brokenScene = () =>
    ({ sceneId: "scene_001", partId: "part_001", order: 1, sceneType: "opening", durationSec: 8,
       assetRefs: {}, character: { enabled: false, characterId: "yuko" }, texts: {},
       narration: { text: "", voiceId: null, status: "none" }, warnings: [] }) as never; // templateId 欠け＝必須

  it("必須が欠けていたら書かずに断る（前の内容を壊さない）", async () => {
    const save = vi.spyOn(fs, "saveProjectDoc").mockResolvedValue("");
    useProjectStore.setState({ scenes: [brokenScene()] });
    await useProjectStore.getState().saveProject();
    expect(save).not.toHaveBeenCalled();
    expect(useProjectStore.getState().saveStatus).toBe("error");
    expect(useProjectStore.getState().saveBlockedReason).toBe(PROJECT_SAVE_WOULD_BREAK);
  });

  it("直したら保存できる（断りも消える）", async () => {
    const save = vi.spyOn(fs, "saveProjectDoc").mockResolvedValue("");
    useProjectStore.setState({ scenes: [brokenScene()] });
    await useProjectStore.getState().saveProject();
    expect(save).not.toHaveBeenCalled();
    // 欠けていた項目を入れる＝次の保存は通る。
    useProjectStore.setState({
      scenes: [{ ...(brokenScene() as object), templateId: "tpl_x" } as never],
    });
    await useProjectStore.getState().saveProject();
    expect(save).toHaveBeenCalledTimes(1);
    expect(useProjectStore.getState().saveBlockedReason).toBeNull();
  });

  it("範囲違反だけなら、これまでどおり保存する（開ける動画を保存できなくしない）", async () => {
    // ⚠️ **読み込みは範囲違反を拒否しない**（`§8` V2）ので、止めると害のほうが大きい。
    const save = vi.spyOn(fs, "saveProjectDoc").mockResolvedValue("");
    useProjectStore.setState({
      scenes: [{ ...(brokenScene() as object), templateId: "tpl_x", durationSec: 0 } as never],
    });
    await useProjectStore.getState().saveProject();
    expect(save).toHaveBeenCalledTimes(1);
  });
});

// ⚠️ **理由の寿命**（#982 レビュー 🟡）＝前の動画で断られた理由が残ると、
// **別の動画で「保存できません」と出続ける**。文書が入れ替わる所で明示的に落とす。
describe("断りの理由は文書と一緒に消える（#982 レビュー 🟡）", () => {
  beforeEach(() => {
    vi.spyOn(keeper, "keepRestorePoints").mockResolvedValue(undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it("新しく作ると消える", () => {
    useProjectStore.setState({ saveBlockedReason: PROJECT_SAVE_WOULD_BREAK });
    useProjectStore.getState().newProject();
    expect(useProjectStore.getState().saveBlockedReason).toBeNull();
  });
});

// ⚠️ **押しても変わらないボタンを押させ続けない**（#982 レビュー 🟡）＝
// ふきだしを出さない画面（ウィザード）では、**ボタンの文字だけ**が利用者の見るものになる。
describe("保存ボタンの文言（#982 レビュー 🟡）", () => {
  it("もう一度で直らない失敗は、そう言う", async () => {
    const { saveButtonLabel } = await import("../components/saveButtonLabel");
    expect(saveButtonLabel("error", PROJECT_SAVE_WOULD_BREAK)).not.toMatch(/もう一度/);
    expect(saveButtonLabel("error", PROJECT_SAVE_WOULD_BREAK)).toMatch(/取り消して直す/);
  });

  it("ふつうの失敗は、これまでどおり「もう一度押す」", async () => {
    const { saveButtonLabel } = await import("../components/saveButtonLabel");
    expect(saveButtonLabel("error", null)).toMatch(/もう一度押す/);
    expect(saveButtonLabel("error")).toMatch(/もう一度押す/);
  });
});
