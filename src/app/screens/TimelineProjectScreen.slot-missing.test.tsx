// @vitest-environment jsdom
// 消した素材を指したままの差し込み口を「なし」と言わない（#1087）。
//
// ⚠️ 素材を消しても差し込み口の参照は残る（削除は文書を触らない）ので、候補に無い id を指した
//    状態になりうる。`<select>` は value に合う選択肢が無いと**先頭（「なし」）を選択済みに見せる**ので、
//    入っているのに入っていないように読めていた（ADR-0026①）。
// ⚠️ **場面編集（#1085）と同じ形・同じ文言**にそろえる（ADR-0026②）。
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { useTimelineStore } from "../store/timelineStore";
import { useProjectStore } from "../store/projectStore";
import { PICKER_MISSING_LABEL, PICKER_NOTE } from "../uiLabels";
import { sampleTemplates } from "../../infrastructure/sampleData";
import type { Asset } from "../../domain/project/types";
import type { TimelineProject } from "../../domain/timeline/types";
import { TIMELINE_SCHEMA_VERSION } from "../../domain/timeline/types";
import { PROJECT_FORMAT, TIMELINE_CLIP_KIND, TRACK_KIND } from "../../domain/enums";
import { TimelineProjectScreen } from "./TimelineProjectScreen";

/** 差し込み口（mainVisual）を持つ見た目。 */
const tmpl = sampleTemplates.find((t) => t.layers.some((l) => l.id === "mainVisual"))!;
/** ロゴの口を持つ見た目（入れられる種類が違うので別に取る）。 */
const withLogo = sampleTemplates.find((t) => t.layers.some((l) => l.type === "logo"))!;

const photo = (id: string, name: string): Asset =>
  ({ assetId: id, assetType: "image", displayName: name, filePath: `C:/${id}.png`, tags: [] } as unknown as Asset);

const video = (id: string, name: string): Asset =>
  ({ assetId: id, assetType: "video", displayName: name, filePath: `C:/${id}.mp4`, tags: [] } as unknown as Asset);

const doc = (assets: Asset[], assignedId: string, t = tmpl, layerId = "mainVisual"): TimelineProject =>
  ({
    schemaVersion: TIMELINE_SCHEMA_VERSION, format: PROJECT_FORMAT.timeline,
    projectId: "proj_20260908_001", projectName: "テスト",
    createdAt: "2026-09-08T00:00:00.000Z", updatedAt: "2026-09-08T00:00:00.000Z",
    videoSettings: { aspectRatio: "16:9", fps: 30, targetDurationSec: 60, maxDurationSec: 600 },
    voiceSettings: { defaultVoiceId: "voicevox_zundamon" },
    assets,
    tracks: [{ id: "track_001", kind: TRACK_KIND.visual }],
    clips: [
      {
        id: "clip_001", kind: TIMELINE_CLIP_KIND.template, trackId: "track_001",
        startSec: 0, durationSec: 5, templateId: t.templateId, assetRefs: { [layerId]: assignedId },
      },
    ],
  }) as unknown as TimelineProject;

const setup = (assets: Asset[], assignedId: string, t = tmpl, layerId = "mainVisual") => {
  useProjectStore.setState({ templates: sampleTemplates });
  useTimelineStore.setState({
    doc: doc(assets, assignedId, t, layerId), loadError: null, isLoading: false,
    playheadSec: 0, selectedClipIds: ["clip_001"], assetSrcById: {},
  });
  return render(<TimelineProjectScreen onNavigate={vi.fn()} />);
};

describe("差し込み口が指している素材を出せないとき（#1087）", () => {
  beforeEach(() => { localStorage.clear(); });

  /** 差し込み口の `<select>` が出している選択肢の文言。 */
  const optionTexts = (container: HTMLElement, layerId = "mainVisual"): string[] =>
    [...(container.querySelector(`select[data-slot-field="${layerId}"]`)?.querySelectorAll("option") ?? [])]
      .map((o) => o.textContent ?? "");

  it("素材そのものが消えているときも、選択肢として残す（「なし」に見せない）", () => {
    const { container } = setup([photo("asset_001", "会社の外観")], "asset_gone");
    expect(optionTexts(container), "見つからない素材が一覧から消えている").toContain(PICKER_MISSING_LABEL.asset);
  });

  it("その選択肢は選び直せない", () => {
    const { container } = setup([photo("asset_001", "会社の外観")], "asset_gone");
    const opt = [...(container.querySelector('select[data-slot-field="mainVisual"]')?.querySelectorAll("option") ?? [])]
      .find((o) => o.textContent === PICKER_MISSING_LABEL.asset) as HTMLOptionElement | undefined;
    expect(opt?.disabled, "見つからない素材が選べてしまう").toBe(true);
  });

  it("内部の綴りは画面に出さない", () => {
    const { container } = setup([photo("asset_001", "会社の外観")], "asset_gone");
    expect(optionTexts(container).join(" ")).not.toContain("asset_gone");
  });

  // ⚠️ **「無い」と「この口には入れられない」を言い分ける**＝次の行動が違う（取り込み直す／別の口へ移す）。
  it("入れられない種類の素材が入っているときは、その理由を出す", () => {
    // ロゴの口には動画を入れられない（主役の口は写真も動画も入る）。
    const { container } = setup([video("asset_009", "会社紹介の映像")], "asset_009", withLogo, "logo");
    const texts = optionTexts(container, "logo").join(" ");
    expect(texts, "入っている素材が一覧から消えている").toContain("会社紹介の映像");
    expect(texts, "入れられない理由が出ていない").toContain(PICKER_NOTE.assetNotAssignable);
    expect(texts, "「見つかりません」と混ぜている").not.toContain(PICKER_MISSING_LABEL.asset);
  });

  it("入れられる素材が入っているときは、余計な選択肢を出さない", () => {
    const { container } = setup([photo("asset_001", "会社の外観")], "asset_001");
    const texts = optionTexts(container).join(" ");
    expect(texts).not.toContain(PICKER_MISSING_LABEL.asset);
    expect(texts).not.toContain(PICKER_NOTE.assetNotAssignable);
  });
});
