// @vitest-environment jsdom
// 切替効果プレビューのクレジット（ADR-0025・#359・PR #881 レビュー）。
//
// ⚠️ **下に敷いてある ScenePreview と同じ判定を通す**＝通さないと、同じ画面の同じ瞬間に
// 「下（出さない）と上（出す）」が食い違う。判定の共有は `sceneCreditVisibility` の1か所。
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { TransitionPreview } from "./TransitionPreview";
import { useProjectStore } from "../store/projectStore";
import type { Scene } from "../../domain/project/types";
import type { Template } from "../../domain/template/types";
import type { BoundaryTransition } from "../../domain/project/sceneTransitions";

const template = {
  schemaVersion: "1.0",
  templateId: "tpl_t",
  name: "t",
  category: "opening",
  aspectRatio: "16:9",
  canvas: { width: 1920, height: 1080 },
  layers: [],
} as unknown as Template;

const mk = (id: string, durationSec: number): Scene =>
  ({ sceneId: id, templateId: "tpl_t", sceneType: "opening", durationSec, texts: {} }) as unknown as Scene;

const boundary: BoundaryTransition = { type: "fade", direction: "left", durationSec: 0.5 };

function setProject(scenes: Scene[], creditDisplay: unknown): void {
  const meta = useProjectStore.getState().meta;
  useProjectStore.setState({
    scenes,
    meta: { ...meta, videoSettings: { ...meta.videoSettings, creditDisplay } },
  } as never);
}

describe("TransitionPreview のクレジット（#359・PR#881）", () => {
  it("「動画には出さない」なら切替中も出さない", () => {
    const scenes = [mk("s1", 8), mk("s2", 8)];
    setProject(scenes, { mode: "hidden" });
    const { container } = render(
      <TransitionPreview prevScene={scenes[0]} prevTemplate={template} scene={scenes[1]} template={template} boundary={boundary} progress={0.5} />,
    );
    expect(container.textContent).not.toContain("VOICEVOX");
  });

  it("「最初と最後」なら、真ん中どうしの切替では出さない（書き出し・下地と同じ判定）", () => {
    const scenes = [mk("s1", 8), mk("s2", 8), mk("s3", 8), mk("s4", 8)];
    setProject(scenes, { mode: "both", seconds: 3 });
    // s2→s3 の境界＝どちらも「最初の3秒」「最後の3秒」に重ならない。
    const { container } = render(
      <TransitionPreview prevScene={scenes[1]} prevTemplate={template} scene={scenes[2]} template={template} boundary={boundary} progress={0.5} />,
    );
    expect(container.textContent).not.toContain("VOICEVOX");
  });

  it("設定していなければ従来どおり出す", () => {
    const scenes = [mk("s1", 8), mk("s2", 8)];
    setProject(scenes, undefined);
    const { container } = render(
      <TransitionPreview prevScene={scenes[0]} prevTemplate={template} scene={scenes[1]} template={template} boundary={boundary} progress={0.5} />,
    );
    expect(container.textContent).toContain("VOICEVOX");
  });
});
