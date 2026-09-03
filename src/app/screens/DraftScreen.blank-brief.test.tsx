// @vitest-environment jsdom
// 白紙から作った動画にも、あとから会社情報を入れる道がある（#1003・決定 (a)）。
//
// ⚠️ **出さないと行き止まりになる**＝`companyInfo`/`generalBrief` を編集できる画面はウィザードだけで、
// 白紙（`newBlankProject`）はそこを通らない。#985 で足した導線は「入力があるとき」だけ出るので、
// **白紙の動画には永久に出なかった**＝ゆうこにたたき台を作ってもらう道が無い（作り直すしかない）。
//
// ⚠️ **#393「白紙はウィザードを通らない道」とは矛盾しない**＝あれは**始めるときの話**で、
// あとから入れる道を塞ぐ意味ではない。入口を置いても、通るかどうかは利用者が決める。
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { useProjectStore } from "../store/projectStore";
import { DraftScreen } from "./DraftScreen";
import { ADD_WIZARD_INPUT_LABEL, EDIT_WIZARD_INPUT_LABEL } from "../uiLabels";
import type { Scene } from "../../domain/project/types";

const scene = (id: string): Scene =>
  ({
    sceneId: id, partId: "part_001", order: 1, sceneType: "photo_intro",
    templateId: "photo_left_text_right_yuko_v1", durationSec: 8, assetRefs: {},
    character: { enabled: false, characterId: "yuko" }, texts: {},
    narration: { text: "", status: "none" }, warnings: [],
  }) as Scene;

const setup = (companyName: string | undefined) => {
  const meta = useProjectStore.getState().meta;
  useProjectStore.setState({
    status: "ready",
    scenes: [scene("scene_001")],
    parts: [{ partId: "part_001", title: "パート1", order: 1, sceneIds: ["scene_001"] }],
    meta: {
      ...meta,
      companyInfo: companyName ? ({ ...meta.companyInfo, companyName } as never) : undefined,
      generalBrief: undefined,
    },
  });
  const onNavigate = vi.fn();
  render(<DraftScreen onNavigate={onNavigate} />);
  return onNavigate;
};

beforeEach(() => {
  vi.restoreAllMocks();
  useProjectStore.getState().setExportRun({ phase: "idle" });
  useProjectStore.getState().newProject();
});

describe("白紙から作った動画にも、会社情報を入れる道がある（#1003）", () => {
  it("入力があるときは「見直す」と言う", () => {
    setup("テスト株式会社");
    expect(screen.getByRole("button", { name: EDIT_WIZARD_INPUT_LABEL })).toBeInTheDocument();
  });

  // ⚠️ **ここが元の穴**＝白紙の動画には**何も出なかった**。
  it("何も入れていなくても道が出る（言い方は「入れる」）", () => {
    setup(undefined);
    expect(screen.getByRole("button", { name: ADD_WIZARD_INPUT_LABEL })).toBeInTheDocument();
  });

  // ⚠️ **まだ無いものを「見直す」と言わない**（`06 §12.1`＝名指しするものはその画面に実在すること）。
  it("何も入れていないのに「見直す」とは言わない", () => {
    setup(undefined);
    expect(screen.queryByRole("button", { name: EDIT_WIZARD_INPUT_LABEL })).toBeNull();
  });

  it("押すとウィザードへ行く（どちらの言い方でも同じ行き先）", () => {
    for (const name of [undefined, "テスト株式会社"]) {
      cleanup();
      const onNavigate = setup(name);
      fireEvent.click(screen.getByRole("button", { name: name ? EDIT_WIZARD_INPUT_LABEL : ADD_WIZARD_INPUT_LABEL }));
      expect(onNavigate).toHaveBeenCalledWith("wizard");
    }
  });
});
