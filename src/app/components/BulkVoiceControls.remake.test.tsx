// @vitest-environment jsdom
//
// 作成済みの印なのに声の音が読めないとき、「全部の声を作る」が押せる（通し点検 2026-10-16・PR レビュー 🟡）。
//
// ⚠️ store の対象選びだけ直してボタンが印だけを見ていると、公開前チェックが「声を作成」を勧めるのに押せなかった。
// ⚠️ **アプリの中だけ**＝音を読めない場（ブラウザ・検査）では、これまでどおり印だけで見る。
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const tauri = vi.hoisted(() => ({ on: true }));
vi.mock("../../infrastructure/assetFs", async (orig) => ({
  ...(await orig<typeof import("../../infrastructure/assetFs")>()),
  isTauri: () => tauri.on,
}));

import { BulkVoiceControls } from "./BulkVoiceControls";
import { useProjectStore } from "../store/projectStore";
import { useSceneBulkVoice } from "../hooks/useBulkVoiceSource";
import type { Scene } from "../../domain/project/types";

function SceneControls() {
  return <BulkVoiceControls source={useSceneBulkVoice()} />;
}
const generated = (id: string, order: number): Scene => ({
  sceneId: id, partId: "part_001", order, sceneType: "photo_intro", templateId: "t",
  durationSec: 8, assetRefs: {}, character: { enabled: false, characterId: "yuko" },
  texts: {}, narration: { text: `セリフ${order}`, status: "generated", voicePath: `voices/${id}.wav` }, warnings: [],
});

beforeEach(() => {
  tauri.on = true;
  useProjectStore.setState({
    scenes: [generated("scene_001", 1), generated("scene_002", 2)],
    narrationAudioById: { scene_001: "wav" }, // scene_002 は声のファイルが消えている
    isGeneratingNarration: false,
    narrationCancelled: false,
    exportRun: { ...useProjectStore.getState().exportRun, phase: "idle" },
  });
});

describe("BulkVoiceControls：作成済みでも音の無い声", () => {
  it("アプリの中では、押せて、進み具合も読めない分を数えない", () => {
    render(<SceneControls />);
    expect(screen.getByRole("button", { name: "全場面の声を作成" })).toBeEnabled();
    expect(screen.getByText("声 1/2")).toBeInTheDocument();
  });

  it("音を読めない場では、これまでどおり印だけで見る（全部作成済み＝押せない）", () => {
    tauri.on = false;
    render(<SceneControls />);
    expect(screen.getByRole("button", { name: "全場面の声を作成" })).toBeDisabled();
  });
});
