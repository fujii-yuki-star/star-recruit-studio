// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useSceneTransitionPreview } from "./useSceneTransitionPreview";
import { transitionTimeline } from "../../domain/project/sceneTransitions";
import type { Scene, Transition } from "../../domain/project/types";

const scene = (over: Partial<Scene> = {}): Scene =>
  ({
    sceneId: "scene_002", partId: "part_001", order: 2, sceneType: "opening", templateId: "t",
    durationSec: 8, assetRefs: {}, character: { enabled: false, characterId: "yuko" },
    texts: {}, narration: { text: "", status: "none" }, warnings: [],
    ...over,
  } as unknown as Scene);
const prev = scene({ sceneId: "scene_001", order: 1 });
const fade: Transition = { in: "fade", durationSec: 0.5 };
// A→B の 2 場面プロジェクト（B が targetIndex=1）。
const ab = (bOver: Partial<Scene> = {}): Scene[] => [prev, scene(bOver)];

// requestAnimationFrame / performance.now をテスト側で制御して進捗を決める（useSceneMotionPreview.test と同手法）。
let rafCb: FrameRequestCallback | null = null;
let now = 0;
const advance = (ms: number) => act(() => { now = ms; rafCb?.(now); });
beforeEach(() => {
  rafCb = null;
  now = 0;
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { rafCb = cb; return 1; });
  vi.stubGlobal("cancelAnimationFrame", () => { rafCb = null; });
  vi.spyOn(performance, "now").mockImplementation(() => now);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("useSceneTransitionPreview（切替効果プレビュー・#408 Part 2）", () => {
  it("先頭場面（targetIndex=0）は transitionActive=false（再生ボタンを出さない相当）", () => {
    const { result } = renderHook(() => useSceneTransitionPreview([scene({ transition: fade })], 0));
    expect(result.current.transitionActive).toBe(false);
  });

  it("none は transitionActive=false（切替が無い）", () => {
    const { result } = renderHook(() => useSceneTransitionPreview(ab({ transition: { in: "none" } }), 1));
    expect(result.current.transitionActive).toBe(false);
  });

  it("scene 未定（targetIndex が範囲外）なら transitionActive=false（何も再生しない）", () => {
    const { result } = renderHook(() => useSceneTransitionPreview([prev], 1));
    expect(result.current.transitionActive).toBe(false);
  });

  it("遷移ありは transitionActive=true。停止中は progress 0（オーバーレイ非表示）・境界値は書き出しと同一", () => {
    const { result } = renderHook(() => useSceneTransitionPreview(ab({ transition: fade }), 1));
    expect(result.current.transitionActive).toBe(true);
    expect(result.current.playing).toBe(false);
    expect(result.current.progress).toBe(0);
    expect(result.current.boundary).toMatchObject({ type: "fade", durationSec: 0.5 });
  });

  it("【P1】3 場面で直前が短くても実効 D は書き出し（全場面 transitionTimeline）と一致する", () => {
    // [5, 4, 6]・3 境界目 D=5。直前(4)<D(5) だが、累積 acc=9 ゆえ書き出しは 5 秒。2 場面近似だと min(5,4,6)=4 で過小。
    const scenes = [
      scene({ sceneId: "scene_001", order: 1, durationSec: 5 }),
      scene({ sceneId: "scene_002", order: 2, durationSec: 4 }),
      scene({ sceneId: "scene_003", order: 3, durationSec: 6, transition: { in: "fade", durationSec: 5 } }),
    ];
    const { result } = renderHook(() => useSceneTransitionPreview(scenes, 2));
    const expected = transitionTimeline([5, 4, 6], [0, 0, 5]).steps[1].durationSec; // 書き出し正準＝5
    expect(result.current.boundary.durationSec).toBe(expected);
    expect(result.current.boundary.durationSec).toBe(5);
  });

  it("play で progress が 30fps 量子化で進み、D 秒で自動停止する（書き出しと同じ格子）", () => {
    const { result } = renderHook(() => useSceneTransitionPreview(ab({ transition: fade }), 1));
    act(() => result.current.play());
    expect(result.current.playing).toBe(true);
    advance(250); // 0.25秒：t=floor(0.25*30)/30=7/30、progress=(7/30)/0.5
    expect(result.current.progress).toBeCloseTo((Math.floor(0.25 * 30) / 30) / 0.5, 5);
    expect(result.current.playing).toBe(true);
    advance(600); // 0.6秒＝D(0.5) 超過→自動停止
    expect(result.current.playing).toBe(false);
  });

  it("別の場面へ切り替えると再生を止めて頭出しする", () => {
    const { result, rerender } = renderHook(
      ({ s }: { s: Scene }) => useSceneTransitionPreview([prev, s], 1),
      { initialProps: { s: scene({ transition: fade }) } },
    );
    act(() => result.current.play());
    expect(result.current.playing).toBe(true);
    rerender({ s: scene({ sceneId: "scene_003", transition: fade }) });
    expect(result.current.playing).toBe(false);
    expect(result.current.progress).toBe(0);
  });

  it("再生中に切替効果が none へ変わったら停止する（playing 固着を防ぐ・Part 1 の実バグと同型の回帰）", () => {
    const { result, rerender } = renderHook(
      ({ t }: { t: Transition }) => useSceneTransitionPreview([prev, scene({ transition: t })], 1),
      { initialProps: { t: fade } },
    );
    act(() => result.current.play());
    expect(result.current.playing).toBe(true);
    rerender({ t: { in: "none" } }); // 再生中に none へ＝transitionActive が false に落ちる
    expect(result.current.playing).toBe(false);
    expect(result.current.progress).toBe(0);
  });
});
