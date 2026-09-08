// @vitest-environment jsdom
// 押す前に**どこへ入るか**を見せる（#1032・文章依存を減らす3つの型の③）。
//
// ⚠️ 以前は「再生位置（X秒）から置きます」という**同じ文が4か所**にあり、
//    「どの列の・どこに・何秒ぶん」は読んでも分からなかった。
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { useTimelineStore } from "../store/timelineStore";
import { useProjectStore } from "../store/projectStore";
import { PROJECT_FORMAT, TIMELINE_CLIP_KIND, TRACK_KIND } from "../../domain/enums";
import { TIMELINE_SCHEMA_VERSION } from "../../domain/timeline/types";
import type { TimelineProject } from "../../domain/timeline/types";
import { TimelineProjectScreen } from "./TimelineProjectScreen";

const doc = (): TimelineProject =>
  ({
    schemaVersion: TIMELINE_SCHEMA_VERSION, format: PROJECT_FORMAT.timeline,
    projectId: "proj_20260908_001", projectName: "テスト",
    createdAt: "2026-09-08T00:00:00.000Z", updatedAt: "2026-09-08T00:00:00.000Z",
    videoSettings: { aspectRatio: "16:9", fps: 30, targetDurationSec: 60, maxDurationSec: 600 },
    voiceSettings: { defaultVoiceId: "voicevox_zundamon" },
    assets: [],
    tracks: [{ id: "track_001", kind: TRACK_KIND.visual }, { id: "track_002", kind: TRACK_KIND.audio }],
    clips: [
      { id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 5,
        x: 0, y: 0, w: 100, h: 50, text: "あ" },
    ],
  }) as unknown as TimelineProject;

const setup = (playheadSec = 0) => {
  useProjectStore.setState({ templates: [] });
  useTimelineStore.setState({
    doc: doc(), loadError: null, isLoading: false, playheadSec, selectedClipIds: [],
    assetSrcById: {}, editBlocked: null,
  });
  return render(<TimelineProjectScreen onNavigate={vi.fn()} />);
};

const openTab = (label: string) =>
  fireEvent.click(within(screen.getByRole("group", { name: "置くもの" })).getByRole("button", { name: label }));
/** 押す前の置き先の帯。 */
const hints = (container: HTMLElement) => [...container.querySelectorAll(".timeline-drop-preview--hint")] as HTMLElement[];
/** その帯が入っている列。 */
const laneOfHint = (container: HTMLElement): string | undefined => {
  const el = hints(container)[0];
  const lanes = [...container.querySelectorAll(".timeline-lane")];
  const row = lanes.find((l) => l.contains(el));
  return row ? [...container.querySelectorAll(".timeline-row")].find((r) => r.contains(row))?.textContent ?? undefined : undefined;
};

describe("押す前に置き先を見せる（#1032）", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("はじめは帯を出さない（何も指していない）", () => {
    const { container } = setup();
    expect(hints(container), "指していないのに帯が出ている").toHaveLength(0);
  });

  it("「文字を置く」に手を伸ばすと、置き先の帯が出る", () => {
    const { container } = setup();
    fireEvent.mouseEnter(screen.getByRole("button", { name: "文字を置く" }));
    expect(hints(container), "帯が出ていない").toHaveLength(1);
  });

  it("離れると消える（指していないのに残らない）", () => {
    const { container } = setup();
    const btn = screen.getByRole("button", { name: "文字を置く" });
    fireEvent.mouseEnter(btn);
    fireEvent.mouseLeave(btn);
    expect(hints(container)).toHaveLength(0);
  });

  // ⚠️ **ホバー専用の情報を作らない**（ADR-0034 決定19）＝キーボードだけでも同じものが見える。
  it("キーボードで送っても出る（focus）", () => {
    const { container } = setup();
    fireEvent.focus(screen.getByRole("button", { name: "文字を置く" }));
    expect(hints(container), "focus では出ない").toHaveLength(1);
  });

  // ⚠️ **再生位置から・置く長さぶん**＝「どこに・何秒ぶん」を実寸で見せる。
  it("帯は再生位置から始まり、置く長さぶんの幅を持つ", () => {
    const { container } = setup(2);
    fireEvent.mouseEnter(screen.getByRole("button", { name: "文字を置く" }));
    const band = hints(container)[0]!;
    expect(band.style.left, "再生位置から始まっていない").not.toBe("0px");
    expect(parseFloat(band.style.width), "幅が無い").toBeGreaterThan(0);
  });

  it("再生位置を動かすと、帯の位置も動く", () => {
    const { container } = setup(0);
    fireEvent.mouseEnter(screen.getByRole("button", { name: "文字を置く" }));
    const at0 = hints(container)[0]!.style.left;
    fireEvent.mouseLeave(screen.getByRole("button", { name: "文字を置く" }));
    const { container: c2 } = setup(3);
    fireEvent.mouseEnter(within(c2).getByRole("button", { name: "文字を置く" }));
    expect(hints(c2)[0]!.style.left, "再生位置を変えても同じ場所").not.toBe(at0);
  });

  // ⚠️ **音は音の列へ**＝置く先は種別で変わるので、絵の列に出すと嘘になる。
  it("読み上げは音の列に出る（絵の列ではない）", () => {
    const { container } = setup();
    openTab("読み上げ");
    fireEvent.mouseEnter(screen.getByRole("button", { name: "読み上げを置く" }));
    expect(hints(container), "帯が出ていない").toHaveLength(1);
    expect(laneOfHint(container), "絵の列に出ている").toContain("音");
  });

  it("文字は絵の列に出る", () => {
    const { container } = setup();
    fireEvent.mouseEnter(screen.getByRole("button", { name: "文字を置く" }));
    expect(laneOfHint(container), "音の列に出ている").toContain("映像");
  });

  // ⚠️ **一覧の項目でも知らせる**（ボタンだけではない）。
  it("音の一覧の項目に手を伸ばしても出る", () => {
    const { container } = setup();
    openTab("音");
    const item = screen.getAllByRole("button").find((b) => /ポップ|BGM|前向き/.test(b.textContent ?? ""))!;
    expect(item, "音の一覧が空").toBeTruthy();
    fireEvent.mouseEnter(item);
    expect(hints(container), "一覧の項目では出ない").toHaveLength(1);
    expect(laneOfHint(container), "絵の列に出ている").toContain("音");
  });

  // ⚠️ **押せない状況では出さない**＝出しても押せない置き先を見せない。
  it("手を伸ばしたまま再生が始まったら帯を消す", () => {
    const { container } = setup();
    fireEvent.mouseEnter(screen.getByRole("button", { name: "文字を置く" }));
    expect(hints(container)).toHaveLength(1);
    act(() => { useTimelineStore.setState({ isPlaying: true } as never); });
    expect(hints(container), "再生が始まっても帯が残っている").toHaveLength(0);
  });

  it("再生中は出さない", () => {
    const { container } = setup();
    act(() => { useTimelineStore.setState({ isPlaying: true } as never); });
    fireEvent.mouseEnter(screen.getByRole("button", { name: "文字を置く" }));
    expect(hints(container).length, "再生中なのに帯が出ている").toBe(0);
  });
});
