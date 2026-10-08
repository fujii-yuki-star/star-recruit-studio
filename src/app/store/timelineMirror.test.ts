// 仕上がり確認の別窓の写しと命令（ADR-0050）。
import { describe, expect, it, vi } from "vitest";
import {
  PREVIEW_DENIED_ACTIONS,
  PREVIEW_LOCAL_ACTIONS,
  isDeniedAction,
  isMirroredKey,
  isNewerPatch,
  mirrorPatch,
  mirrorUpdate,
  previewProxies,
  runPreviewCall,
  transferableArgs,
  transferablePatch,
  withoutStaleSelection,
} from "./timelineMirror";
import { useTimelineStore } from "./timelineStore";

type AnyState = Record<string, unknown>;
const storeActions = (): string[] => {
  const s = useTimelineStore.getState() as unknown as AnyState;
  return Object.keys(s).filter((k) => typeof s[k] === "function").sort();
};

describe("写し（本体→別窓）", () => {
  it("変わった項目だけを送る・操作と履歴と内部の段取りは送らない", () => {
    const f = () => {};
    const prev = { doc: { a: 1 }, playheadSec: 1, selectedClipIds: ["x"], play: f, history: { past: [] }, _audioTried: new Set() };
    const next = { ...prev, playheadSec: 2, history: { past: [1] }, _audioTried: new Set(["y"]) };
    expect(mirrorPatch(prev, next)).toEqual({ values: { playheadSec: 2 }, cleared: [] });
    expect(mirrorPatch(prev, prev)).toBeNull();
  });

  it("最初は全部（操作・履歴・内部の段取りを除く）", () => {
    const p = mirrorPatch(null, { doc: 1, play: () => {}, history: 2, _x: 3, rangeInSec: undefined })!;
    expect(p.values).toEqual({ doc: 1 });
    expect(p.cleared).toEqual(["rangeInSec"]);
  });

  it("値が undefined になった項目は別に運ぶ（JSON で落ちるので）", () => {
    const p = mirrorPatch({ rangeInSec: 3 }, { rangeInSec: undefined })!;
    expect(p).toEqual({ values: {}, cleared: ["rangeInSec"] });
    expect(mirrorUpdate({ rangeInSec: 3 }, p)).toEqual({ rangeInSec: undefined });
  });

  // ⚠️ 画面は「同じ物か」で比べる箇所を持つ（中へ入った印）＝中身が同じなら手元の物を保つ。
  it("中身が同じなら手元の物をそのまま使う（差し替えない）", () => {
    const sel = ["clip_001"];
    const up = mirrorUpdate({ selectedClipIds: sel, playheadSec: 1 }, { values: { selectedClipIds: ["clip_001"], playheadSec: 2 }, cleared: [] });
    expect(up).toEqual({ playheadSec: 2 });
    expect("selectedClipIds" in up).toBe(false);
  });

  it("写しに操作や内部の段取りが紛れても当てない", () => {
    const play = () => {};
    const up = mirrorUpdate({ play }, { values: { play: "x", _voiceRun: 1, history: 2, doc: 3 }, cleared: ["_x", "history", "play"] });
    expect(up).toEqual({ doc: 3 });
  });

  it("運べない項目だけを落とす（1つのせいで写し全体を止めない）", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(transferablePatch({ values: { doc: { a: 1 }, bad: circular, playheadSec: 2 }, cleared: ["x"] }))
      .toEqual({ values: { doc: { a: 1 }, playheadSec: 2 }, cleared: ["x"] });
  });

  it("isMirroredKey：操作・履歴・_ 始まりは写さない", () => {
    expect(isMirroredKey("doc", {})).toBe(true);
    expect(isMirroredKey("play", () => {})).toBe(false);
    expect(isMirroredKey("history", {})).toBe(false);
    expect(isMirroredKey("_audioTried", new Set())).toBe(false);
  });
});

describe("命令（別窓→本体）", () => {
  it("別窓の操作は名前と引数を送るだけ（手元では何も変えない）", () => {
    const setClipBoxFor = vi.fn();
    const sent: unknown[] = [];
    const p = previewProxies({ setClipBoxFor, doc: 1 }, (c) => sent.push(c));
    (p.setClipBoxFor as (...a: unknown[]) => void)("clip_001", { x: 1 });
    expect(setClipBoxFor).not.toHaveBeenCalled();
    expect(sent).toEqual([{ name: "setClipBoxFor", args: ["clip_001", { x: 1 }] }]);
    expect("doc" in p).toBe(false);
  });

  // ⚠️ 画面は onClick={play} のように押した出来事をそのまま渡す＝運べない物を混ぜると、送る時点で黙って失敗する（実測）。
  it("押した出来事・関数・運べない物は落として送る（末尾は省略と同じにする）", () => {
    const sent: { name: string; args: unknown[] }[] = [];
    const p = previewProxies({ play: vi.fn() }, (c) => sent.push(c));
    const reactEvent = { nativeEvent: {}, target: {} };
    (p.play as (...a: unknown[]) => void)(reactEvent);
    expect(sent).toEqual([{ name: "play", args: [] }]);
    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular;
    expect(transferableArgs([new Event("click"), () => 1, circular, "clip_001", { x: 1 }, undefined])).toEqual([undefined, undefined, undefined, "clip_001", { x: 1 }]);
    expect(transferableArgs([1, null, false])).toEqual([1, null, false]);
  });

  it("選ぶ操作は手元でも先に当ててから送る", () => {
    const selectClip = vi.fn();
    const sent: unknown[] = [];
    const p = previewProxies({ selectClip }, (c) => sent.push(c));
    (p.selectClip as (...a: unknown[]) => void)("clip_001", true);
    expect(selectClip).toHaveBeenCalledWith("clip_001", true);
    expect(sent).toEqual([{ name: "selectClip", args: ["clip_001", true] }]);
  });

  it("受けない操作は別窓で何もしない（送りもしない）", () => {
    const exportTimelineVideo = vi.fn();
    const sent: unknown[] = [];
    const p = previewProxies({ exportTimelineVideo }, (c) => sent.push(c));
    (p.exportTimelineVideo as () => void)();
    expect(exportTimelineVideo).not.toHaveBeenCalled();
    expect(sent).toEqual([]);
  });

  it("本体は受けない操作・無い名前・崩れた形を捨てる", () => {
    const play = vi.fn();
    const saveTimelineProject = vi.fn();
    const st = { play, saveTimelineProject, doc: {} };
    expect(runPreviewCall(st, { name: "play", args: [] })).toBe(true);
    expect(play).toHaveBeenCalledTimes(1);
    expect(runPreviewCall(st, { name: "saveTimelineProject", args: [] })).toBe(false);
    expect(saveTimelineProject).not.toHaveBeenCalled();
    expect(runPreviewCall(st, { name: "nope", args: [] })).toBe(false);
    expect(runPreviewCall(st, { name: "doc", args: [] })).toBe(false);
    expect(runPreviewCall(st, { name: "toString", args: [] })).toBe(false);
    expect(runPreviewCall(st, { name: "play" })).toBe(false);
    expect(runPreviewCall(st, null)).toBe(false);
  });
});

describe("受けない操作の既定（#1274 レビュー）", () => {
  it("`_` で始まる操作は、一覧に無くても受けない（別窓でも何もしない・本体も実行しない）", () => {
    const _inner = vi.fn();
    expect(isDeniedAction("_inner")).toBe(true);
    expect(isDeniedAction("play")).toBe(false);
    expect(runPreviewCall({ _inner }, { name: "_inner", args: [] })).toBe(false);
    const sent: unknown[] = [];
    (previewProxies({ _inner }, (c) => sent.push(c))._inner as () => void)();
    expect(sent).toEqual([]);
    expect(_inner).not.toHaveBeenCalled();
  });
});

describe("写しの順序と、先に当てた選択（#1274 レビュー）", () => {
  it("同じ回で番号が戻った写しは古いので捨てる・回が変われば受ける", () => {
    expect(isNewerPatch({ session: "a", seq: 5 }, { session: "a", seq: 6 })).toBe(true);
    expect(isNewerPatch({ session: "a", seq: 5 }, { session: "a", seq: 5 })).toBe(false);
    expect(isNewerPatch({ session: "a", seq: 5 }, { session: "a", seq: 4 })).toBe(false);
    expect(isNewerPatch({ session: "a", seq: 5 }, { session: "b", seq: 1 })).toBe(true);
    expect(isNewerPatch({ session: null, seq: 0 }, { session: "a", seq: 1 })).toBe(true);
  });

  it("本体が選ぶ命令をまだ実行していない写しの選択は当てない（ほかの項目は当てる）", () => {
    const p = { values: { selectedClipIds: ["old"], playheadSec: 2 }, cleared: ["selectedClipIds", "rangeInSec"] };
    expect(withoutStaleSelection(p, 4, 5)).toEqual({ values: { playheadSec: 2 }, cleared: ["rangeInSec"] });
    expect(withoutStaleSelection(p, 5, 5)).toBe(p);
    expect(withoutStaleSelection(p, 6, 5)).toBe(p);
  });
});

// ⚠️ **store の操作はすべて「送る／手元でも当てる／受けない」のどれかに分類されている**（ADR-0050 決定5）。
describe("操作の分類（門番）", () => {
  it("受けない・手元でも当てる、に挙げた名前は store に実在する（綴りの誤りで素通しにしない）", () => {
    const actions = new Set(storeActions());
    for (const n of [...PREVIEW_DENIED_ACTIONS, ...PREVIEW_LOCAL_ACTIONS]) expect(actions.has(n), n).toBe(true);
  });

  it("寿命と外への出口の操作は受けない", () => {
    for (const n of ["openTimelineProject", "closeTimelineProject", "createTimelineProject", "discardDeletedProject", "saveTimelineProject", "exportTimelineVideo", "_advancePlayhead", "_loopTo", "resetHistoryGroup"]) {
      expect(PREVIEW_DENIED_ACTIONS.has(n), n).toBe(true);
    }
  });

  it("操作の数を実数で留める（足したら、送る／手元でも当てる／受けないを決めてから数を直す）", () => {
    // ⚠️ 既定は「送る」＝足した操作は分類を忘れても送られる。**寿命・外への出口・本体の時計**を足したときに
    //   受けない一覧へ入れ忘れると、別窓から保存・書き出しが走る。数が変わったらここで立ち止まる。
    expect(storeActions().length).toBe(113); // findSilencesFor／applySilenceCandidates／closeSilenceFind（#1385）＝受けない（探す欄は本体の窓だけ）／ setSelectedClipTalkMotion（ADR-0056）＝送る（ほかの部品の編集と同じ）／importSubtitleFile（ADR-0055）＝受けない（バイト列は窓をまたげない）／ abandonHistoryGroup（ADR-0054 段階2）＝送る（begin/endHistoryGroup と同じ）／_measureAudioDurations（#1348）＝受けない（`_` で始まる本体の段取り）／applySelectedMotionPreset（#1349）＝送る（ほかの動きの編集と同じ）
  });
});
