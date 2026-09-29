// @vitest-environment jsdom
// 窓の外から落としたファイル（ADR-0049）＝並びの列へ落とせば取り込んで置く・列の無い所なら新しい列・それ以外は取り込むだけ。
// ⚠️ 窓への落とし込みは Tauri が受ける（要素の `drop` には来ない）ので、購読口（`onWindowFileDrop`）を差し替えて叩く。
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import type { FileDropEvent } from "../../infrastructure/fileDropEvents";

const handlers: ((e: FileDropEvent) => void)[] = [];
vi.mock("../../infrastructure/fileDropEvents", () => ({
  onWindowFileDrop: vi.fn(async (h: (e: FileDropEvent) => void) => {
    handlers.push(h);
    return () => { const i = handlers.indexOf(h); if (i >= 0) handlers.splice(i, 1); };
  }),
}));

import { TimelineProjectScreen } from "./TimelineProjectScreen";
import { useTimelineStore } from "../store/timelineStore";
import { PROJECT_FORMAT, TIMELINE_CLIP_KIND, TRACK_KIND } from "../../domain/enums";
import { TIMELINE_SCHEMA_VERSION } from "../../domain/timeline/types";
import type { TimelineProject } from "../../domain/timeline/types";

const doc: TimelineProject = {
  schemaVersion: TIMELINE_SCHEMA_VERSION,
  format: PROJECT_FORMAT.timeline,
  projectId: "proj_20260929_001",
  projectName: "テスト",
  createdAt: "2026-09-29T00:00:00.000Z",
  updatedAt: "2026-09-29T00:00:00.000Z",
  videoSettings: { aspectRatio: "16:9", fps: 30, targetDurationSec: 60, maxDurationSec: 600 },
  voiceSettings: { defaultVoiceId: "voicevox_zundamon" },
  assets: [],
  tracks: [{ id: "track_001", kind: TRACK_KIND.visual }],
  clips: [{ id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 2, x: 0, y: 0, w: 10, h: 10, text: "あ" }],
};

const stubRect = (el: Element, r: { left: number; top: number; width: number; height: number }) => {
  (el as HTMLElement).getBoundingClientRect = () =>
    ({ ...r, right: r.left + r.width, bottom: r.top + r.height, x: r.left, y: r.top, toJSON: () => ({}) }) as DOMRect;
};
/** Tauri から来る形（物理座標＝jsdom の devicePixelRatio は 1）。 */
const fire = (e: FileDropEvent) => act(() => { for (const h of [...handlers]) h(e); });
const over = (x: number, y: number) => fire({ kind: "over", paths: [], position: { x, y } });
const drop = (x: number, y: number, paths = ["C:/写真/b.png", "C:/写真/a.png"]) => fire({ kind: "drop", paths, position: { x, y } });

let place: ReturnType<typeof vi.fn>;
beforeEach(async () => {
  handlers.length = 0;
  place = vi.fn(async () => {});
  useTimelineStore.setState({ doc, loadError: null, isLoading: false, playheadSec: 0, selectedClipIds: [], placeDroppedFiles: place as never });
});

/** 描いて、購読が張られるのを待つ。列の箱と並びの箱を置く。 */
async function setup() {
  const r = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
  await act(async () => {});
  const lane = r.container.querySelector('.timeline-row-label[data-track-id="track_001"]')!.nextElementSibling!;
  stubRect(lane, { left: 200, top: 400, width: 800, height: 40 });
  stubRect(r.container.querySelector(".timeline-scroll")!, { left: 76, top: 380, width: 1000, height: 300 });
  return r;
}

describe("窓の外から落としたファイル（ADR-0049）", () => {
  it("列へ落とすと、その列の落とした時刻へ置く（取り込みと置くを一度に）", async () => {
    await setup();
    // 左端 200 から 5秒＝200 + 5×36 = 380px（段の既定 36 px/秒）。
    drop(380, 420);
    expect(place).toHaveBeenCalledTimes(1);
    const [paths, at] = place.mock.calls[0];
    expect(paths).toEqual(["C:/写真/b.png", "C:/写真/a.png"]);
    expect(at.trackId).toBe("track_001");
    expect(at.startSec).toBeCloseTo(5, 5);
  });

  it("列の無い所（いちばん下の列より下）へ落とすと、新しい列（trackId: null）", async () => {
    await setup();
    drop(380, 600);
    expect(place.mock.calls[0][1]).toMatchObject({ trackId: null });
    expect(place.mock.calls[0][1].startSec).toBeCloseTo(5, 5);
  });

  it("並びの外へ落とすと、取り込むだけ（置き先 null）", async () => {
    await setup();
    drop(10, 10);
    expect(place).toHaveBeenCalledWith(["C:/写真/b.png", "C:/写真/a.png"], null);
  });

  // ⚠️ **二重に取り込まない**＝取り込みの枠は自分で受ける。
  it("取り込みの枠の上では手を出さない", async () => {
    const r = await setup();
    const zone = r.container.querySelector("[data-file-drop-zone]")!;
    stubRect(zone, { left: 0, top: 0, width: 100, height: 40 });
    drop(10, 10);
    expect(place).not.toHaveBeenCalled();
  });

  // ⚠️ **欄を広げている間、隠れた列へ置かない**（#1269 レビュー 🔴）＝隠した欄も箱は残る。
  it("仕上がり確認を広げている間は、列の位置へ落としても取り込むだけ（見えない列へ置かない）", async () => {
    const { fireEvent } = await import("@testing-library/react");
    await setup();
    fireEvent.click(screen.getByRole("button", { name: "仕上がり確認の欄を広げる" }));
    drop(380, 420);
    expect(place).toHaveBeenCalledWith(["C:/写真/b.png", "C:/写真/a.png"], null);
  });

  it("並びを広げているときは、列へ置ける", async () => {
    const { fireEvent } = await import("@testing-library/react");
    await setup();
    fireEvent.click(screen.getByRole("button", { name: "並びの欄を広げる" }));
    drop(380, 420);
    expect(place.mock.calls[0][1]).toMatchObject({ trackId: "track_001" });
  });

  it("運んでいる間に行き先を見せる（列＝線／列の無い所＝新しい列の行／外＝取り込むだけの案内）", async () => {
    const r = await setup();
    over(380, 420);
    expect(r.container.querySelector(".timeline-file-drop-line"), "列の上で時刻の線が出ない").not.toBeNull();
    over(380, 600);
    expect(screen.getByTestId("file-drop-newrow").textContent).toContain("新しい列");
    over(10, 10);
    expect(screen.getByTestId("file-drop-hint").textContent).toContain("取り込みます");
    fire({ kind: "leave", paths: [], position: null });
    expect(screen.queryByTestId("file-drop-hint")).toBeNull();
    expect(r.container.querySelector(".timeline-file-drop-line")).toBeNull();
  });
});

// 離す前に「置けない」を見せる（#1272）＝名前が来るのは入った瞬間（enter）だけ。
describe("窓の外から運んでいる間の「置けない」（#1272）", () => {
  const enter = (x: number, y: number, paths: string[]) => fire({ kind: "enter", paths, position: { x, y } });
  const lane = (c: HTMLElement) => c.querySelector('.timeline-row-label[data-track-id="track_001"]')!.nextElementSibling!;

  it("入った瞬間は取り込まない（離したときだけ）", async () => {
    await setup();
    enter(380, 420, ["C:/写真/a.png"]);
    expect(place).not.toHaveBeenCalled();
  });

  it("部品の上（必ず重なる）では、離す前に置けない色と理由を出す", async () => {
    const r = await setup();
    // 左端 200 から 1秒＝236px＝clip_001（0〜2秒）の上。
    enter(236, 420, ["C:/写真/a.png"]);
    expect(lane(r.container).classList.contains("drop-target--blocked")).toBe(true);
    expect(screen.getByTestId("file-drop-hint").textContent).toBe("その場所には先に置いてある部品があります。ずらすか、列を足して重ねてください");
    // 空いている所へ動かせば消える（名前は enter で覚えたまま）。
    over(380, 420);
    expect(lane(r.container).classList.contains("drop-target--blocked")).toBe(false);
    expect(lane(r.container).classList.contains("drop-target")).toBe(true);
    expect(screen.queryByTestId("file-drop-hint")).toBeNull();
  });

  it("種類の合わない素材だけなら断らない（新しい列へ行く）", async () => {
    const r = await setup();
    enter(236, 420, ["C:/音/a.mp3"]);
    expect(lane(r.container).classList.contains("drop-target--blocked")).toBe(false);
  });

  it("固定した列では、空いている時刻でも置けない", async () => {
    useTimelineStore.setState({ doc: { ...doc, tracks: [{ id: "track_001", kind: TRACK_KIND.visual, locked: true }] } });
    const r = await setup();
    enter(380, 420, ["C:/写真/a.png"]);
    expect(lane(r.container).classList.contains("drop-target--blocked")).toBe(true);
    expect(screen.getByTestId("file-drop-hint").textContent).toBe("この列は固定されています。動かすには固定を外してください");
  });

  it("出ていったら種類を忘れる（次に入るまで断らない）", async () => {
    const r = await setup();
    enter(236, 420, ["C:/写真/a.png"]);
    fire({ kind: "leave", paths: [], position: null });
    over(236, 420); // 名前の無い通過＝種類が分からない＝断らない
    expect(lane(r.container).classList.contains("drop-target--blocked")).toBe(false);
  });
});
