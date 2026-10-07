// @vitest-environment jsdom
// 「置く」欄をタブにまとめる（#1031）。
//
// ⚠️ 以前は「素材・文字・図形／見た目パターン／音／読み上げ」を**4つの欄**に分けており（#684）、
//    左の幅を四等分するので**1欄の中身の高さが 70〜80px** しかなく、3手順①の入口（素材の一覧・
//    見た目の一覧）が**既定の配置で視界に入らなかった**。型（CapCut/Canva/YMM4）も「置く」は1欄＋タブ。
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { useTimelineStore } from "../store/timelineStore";
import { useProjectStore } from "../store/projectStore";
import { PROJECT_FORMAT, TIMELINE_CLIP_KIND, TRACK_KIND } from "../../domain/enums";
import { TIMELINE_SCHEMA_VERSION } from "../../domain/timeline/types";
import { EDIT_BLOCKED } from "../../domain/timeline/edit";
import { PANEL_ID, PLACE_TABS } from "../timelinePanels";
import { editBlockedMessage } from "../uiLabels";
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

const setup = () => {
  useProjectStore.setState({ templates: [] });
  useTimelineStore.setState({
    doc: doc(), loadError: null, isLoading: false, playheadSec: 0, selectedClipIds: [],
    assetSrcById: {}, editBlocked: null,
  });
  return render(<TimelineProjectScreen onNavigate={vi.fn()} />);
};

/** タブの群（画面のほかの「音」「読み上げ」と混ざらないよう、群の中から引く）。 */
const tabs = () => within(screen.getByRole("group", { name: "置くもの" }));
const openTab = (label: string) => fireEvent.click(tabs().getByRole("button", { name: label }));
/** 「置く」欄の中身。 */
const placePanel = (container: HTMLElement) =>
  container.querySelector('[data-panel-id="place"]') as HTMLElement;

describe("「置く」欄のタブ（#1031）", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  // ⚠️ **欄は1つ**＝4分割をやめたことを、欄の数で固定する（見た目の言葉では見えない）。
  it("置くものの欄は1つだけ（4つに分けない）", () => {
    const { container } = setup();
    expect(placePanel(container), "「置く」の欄が無い").toBeTruthy();
    for (const id of ["templates", "audio", "voice"]) {
      expect(container.querySelector(`[data-panel-id="${id}"]`), `${id} の欄が残っている`).toBeNull();
    }
  });

  // ⚠️ **閉じている欄として案内されるのは、実際に開ける欄だけ**＝タブにした id を
  //    配置の欄として登録したままにすると、既定の配置で**中身の無い欄の「表示する」**が並ぶ
  //    （押しても空の箱が出るだけ＝§2-5 の行き止まり）。
  it("既定の配置では「表示する」が1つも出ない（全部の欄が出ている）", () => {
    const { container } = setup();
    expect([...container.querySelectorAll("button")].filter((b) => /」を表示する$/.test(b.textContent ?? ""))
      .map((b) => b.textContent), "中身の無い欄が案内されている").toEqual([]);
  });

  it("タブは4つ（素材・文字・図形／見た目パターン／音／読み上げ）", () => {
    setup();
    expect(tabs().getAllByRole("button").map((b) => b.textContent)).toEqual(PLACE_TABS.map(([, l]) => l));
  });

  // ⚠️ **いちばん多い操作から始める**＝素材を置くのが最頻（#683 の調査）。
  it("最初は「素材・文字・図形」を見せる", () => {
    const { container } = setup();
    expect(tabs().getByRole("button", { name: "素材・文字・図形" }).className).toContain("active");
    expect(placePanel(container).textContent, "素材の欄の中身が出ていない").toContain("写真・動画・音楽を取り込む");
  });

  it("タブを押すと中身が入れ替わる（前のタブの中身は残さない）", () => {
    const { container } = setup();
    openTab("読み上げ");
    expect(placePanel(container).textContent).toContain("読み上げを置く");
    expect(placePanel(container).textContent, "前のタブの中身が残っている").not.toContain("写真・動画・音楽を取り込む");
  });

  // ⚠️ **断りが消えない**＝タブになった id は配置に無いので、寄せないと「閉じている欄」と見なされ
  //    出す場所を失う（黙って何も出さない・§2-5）。
  it("タブ宛ての断りも「置く」欄の上に出る", () => {
    const { container } = setup();
    act(() => { useTimelineStore.getState().setEditBlocked(EDIT_BLOCKED.locked, PANEL_ID.audio); });
    expect(placePanel(container).textContent, "断りが消えている").toContain(editBlockedMessage[EDIT_BLOCKED.locked]);
  });

  // ⚠️ **断りと、それが指している操作を離さない**＝キーボードだけの操作などで、別のタブを見ている
  //    ときに「音の欄を見ているのに断りは見た目パターンの話」を作らない。
  it("断りが来たタブへ切り替わる", () => {
    setup();
    openTab("素材・文字・図形");
    act(() => { useTimelineStore.getState().setEditBlocked(EDIT_BLOCKED.locked, PANEL_ID.voice); });
    expect(tabs().getByRole("button", { name: "読み上げ" }).className, "そのタブへ行っていない").toContain("active");
  });

  it("「置く」以外の欄宛ての断りでは、タブを動かさない", () => {
    setup();
    act(() => { useTimelineStore.getState().setEditBlocked(EDIT_BLOCKED.locked, PANEL_ID.arrange); });
    expect(tabs().getByRole("button", { name: "素材・文字・図形" }).className, "関係ない断りでタブが動いた")
      .toContain("active");
  });

  // ⚠️ **閉じている欄には出さない**（帯へ倒す）＝出しても見えない（既存の作法を壊していない）。
  it("「置く」欄を閉じているときは、断りは帯へ出る", () => {
    const { container } = setup();
    fireEvent.click(screen.getByLabelText("置くの欄の操作"));
    fireEvent.click(screen.getByRole("menuitem", { name: "この欄を閉じる" }));
    act(() => { useTimelineStore.getState().setEditBlocked(EDIT_BLOCKED.locked, PANEL_ID.audio); });
    expect(placePanel(container), "閉じたのに欄が残っている").toBeNull();
    expect(container.textContent, "帯にも出ていない").toContain(editBlockedMessage[EDIT_BLOCKED.locked]);
  });
});
