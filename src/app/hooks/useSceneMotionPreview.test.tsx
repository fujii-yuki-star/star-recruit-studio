// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useSceneMotionPreview } from "./useSceneMotionPreview";
import type { Asset, ElementAnimation, Scene } from "../../domain/project/types";
import type { Template } from "../../domain/template/types";

// FREE 場面（動画スロット無し＝findVideoSlots は freeLayout の video slot を見るが、ここは text 要素のみ）。
const scene = (over: Partial<Scene> = {}): Scene =>
  ({
    sceneId: "scene_001", partId: "part_001", order: 1, sceneType: "free", templateId: "user_tmpl_001",
    durationSec: 8, assetRefs: {}, character: { enabled: false, characterId: "yuko" },
    texts: {}, narration: { text: "", status: "none" }, warnings: [],
    freeLayout: [{ id: "el1", kind: "text", x: 0, y: 0, w: 100, h: 100, text: "hi" }],
    ...over,
  } as unknown as Scene);

const template = { templateId: "user_tmpl_001", category: "free", canvas: { width: 1920, height: 1080 }, layers: [] } as unknown as Template;
const assets: Asset[] = [];

// 「ふわっと」相当：0→0.6秒で opacity 0→1（animationsEndSec=0.6）。
const anim = (over: Partial<ElementAnimation> = {}): ElementAnimation => ({
  id: "anim_001", sceneId: "scene_001", targetId: "el1",
  keyframes: [{ timeSec: 0, opacity: 0 }, { timeSec: 0.6, opacity: 1 }],
  ...over,
});

// requestAnimationFrame / performance.now をテスト側で制御して再生位置を決める。
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

describe("useSceneMotionPreview（場面編集の動き再生・#408 Part 1）", () => {
  it("動きが無い場面は animActive=false（再生ボタンを出さない相当）", () => {
    const { result } = renderHook(() => useSceneMotionPreview(scene(), template, assets, []));
    expect(result.current.animActive).toBe(false);
    expect(result.current.playing).toBe(false);
    expect(result.current.previewAnimations).toEqual([]);
  });

  it("scene 未定なら animActive=false（何も再生しない）", () => {
    const { result } = renderHook(() => useSceneMotionPreview(undefined, undefined, assets, [anim()]));
    expect(result.current.animActive).toBe(false);
  });

  it("テンプレ未解決（template 未定）の場面は animActive=false（押せるのに無反応なボタンを出さない・#408 レビュー）", () => {
    const { result } = renderHook(() => useSceneMotionPreview(scene(), undefined, assets, [anim()]));
    expect(result.current.animActive).toBe(false);
  });

  it("動きがある場面は animActive=true。停止中は静止＝timeSec 0・animations 空（編集時に要素を隠さない）", () => {
    const { result } = renderHook(() => useSceneMotionPreview(scene(), template, assets, [anim()]));
    expect(result.current.animActive).toBe(true);
    expect(result.current.playing).toBe(false);
    expect(result.current.timeSec).toBe(0);
    expect(result.current.previewAnimations).toEqual([]);
  });

  it("play で再生開始＝この場面のアニメを渡す。stop で静止へ戻る", () => {
    const { result } = renderHook(() => useSceneMotionPreview(scene(), template, assets, [anim()]));
    act(() => result.current.play());
    expect(result.current.playing).toBe(true);
    expect(result.current.previewAnimations).toHaveLength(1);
    act(() => result.current.stop());
    expect(result.current.playing).toBe(false);
    expect(result.current.previewAnimations).toEqual([]);
  });

  it("再生位置は 30fps 量子化で進み、animationsEndSec を過ぎると自動停止する（書き出しと同じ格子）", () => {
    const { result } = renderHook(() => useSceneMotionPreview(scene(), template, assets, [anim()]));
    act(() => result.current.play());
    advance(100); // 0.1秒＝floor(0.1*30)/30 = 0.1
    expect(result.current.timeSec).toBeCloseTo(0.1, 5);
    expect(result.current.playing).toBe(true);
    advance(700); // 0.7秒＝animEnd(0.6) 超過→自動停止
    expect(result.current.playing).toBe(false);
    expect(result.current.timeSec).toBe(0); // 停止中は場面頭（settled と一致）
  });

  it("別の場面へ切り替えると再生を止めて頭出しする", () => {
    const { result, rerender } = renderHook(
      ({ s, a }: { s: Scene; a: ElementAnimation[] }) => useSceneMotionPreview(s, template, assets, a),
      { initialProps: { s: scene(), a: [anim()] } },
    );
    act(() => result.current.play());
    expect(result.current.playing).toBe(true);
    rerender({ s: scene({ sceneId: "scene_002" }), a: [anim({ id: "anim_002", sceneId: "scene_002" })] });
    expect(result.current.playing).toBe(false);
    expect(result.current.timeSec).toBe(0);
  });

  it("再生中にアニメが適用外になったら停止する（ボタンが消えても止まり・オーバーレイが戻る・#408 レビュー）", () => {
    const s = scene();
    const { result, rerender } = renderHook(
      ({ a }: { a: ElementAnimation[] }) => useSceneMotionPreview(s, template, assets, a),
      { initialProps: { a: [anim()] } },
    );
    act(() => result.current.play());
    expect(result.current.playing).toBe(true);
    rerender({ a: [] }); // 再生中に「動き」を外す＝適用外に落とす
    expect(result.current.playing).toBe(false);
    expect(result.current.previewAnimations).toEqual([]);
  });
});
