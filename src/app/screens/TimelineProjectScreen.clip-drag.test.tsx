// @vitest-environment jsdom
// タイムライン編集プロジェクトの画面（ADR-0032・#629 骨格）＝帯を掴む（Alt・ドリルイン・Escape・飲み込まない）。
// ⚠️ **1つのファイルで約10分かかっていたので分けた**（負荷・耐久の点検 2026-10-22）＝ほかと一緒に走ると時間切れで
//   たまに落ちていた。共有の下ごしらえ（文書・開き方・テスト間の後片づけ）は `src/test/timelineScreenKit.tsx` に1つ。
import { describe, expect, it, vi } from "vitest";
import { act, render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { pointerDownAt } from "../../test/pointer";
import { TimelineProjectScreen } from "./TimelineProjectScreen";
import { useTimelineStore } from "../store/timelineStore";
import { DELETE_LABEL, DUPLICATE_LABEL, lockedTrackMessage } from "../uiLabels";
import { useProjectStore } from "../store/projectStore";
import { TIMELINE_CLIP_KIND, TRACK_KIND } from "../../domain/enums";
import { TIMELINE_MIN_CLIP_SEC } from "../../domain/constants";
import { EDIT_BLOCKED } from "../../domain/timeline/edit";
import type { TimelineClip, TimelineProject } from "../../domain/timeline/types";
import type { Template } from "../../domain/template/types";
import { ANIMATED_DRAG_NOTE, MOTION_PATH_NOTE } from "../uiLabels";
import { open, lastClip, trackRowLabel, resetTimelineScreenBetweenTests } from "../../test/timelineScreenKit";

resetTimelineScreenBetweenTests();


// 帯を掴んで動かす・端を縮める（#686 段階2・ADR-0034 決定9/10）。
describe("TimelineProjectScreen: 帯を掴む（#686）", () => {
  const two = (over: Record<string, unknown> = {}) =>
    open({
      clips: [
        { id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 3, x: 0, y: 0, w: 10, h: 10, text: "あ" },
        { id: "clip_002", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 5, durationSec: 3, x: 0, y: 0, w: 10, h: 10, text: "い" },
      ],
      ...over,
    });
  const band = (name: string) => screen.getByRole("button", { name });
  /** 掴んで動かす（px）。しきい値を越えるように十分動かす。 */
  const drag = (el: HTMLElement, dx: number, opts: { drop?: boolean; escape?: boolean } = {}) => {
    pointerDownAt(el, 1, { clientX: 0, clientY: 0 });
    fireEvent.pointerMove(window, { pointerId: 1, buttons: 1, clientX: dx, clientY: 0 });
    if (opts.escape) { fireEvent.keyDown(window, { key: "Escape" }); return; }
    if (opts.drop !== false) fireEvent.pointerUp(window, { pointerId: 1, clientX: dx, clientY: 0 });
  };

  it("本体を掴んで動かすと、その時刻へ移る", () => {
    two();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    drag(band("あ"), 36 * 8); // 段の既定 36 px/秒 → 8秒ぶん右へ
    expect(useTimelineStore.getState().doc!.clips[0].startSec).toBeCloseTo(8, 5);
  });

  // `Alt`＋運ぶ＝写しを置く（#1248・Premiere・Resolve・Clipchamp の型）。
  describe("Alt を押して運ぶと写しを置く（#1248）", () => {
    const altDrag = (el: HTMLElement, dx: number, opts: { drop?: boolean; altAtDrop?: boolean } = {}) => {
      pointerDownAt(el, 1, { clientX: 0, clientY: 0 });
      fireEvent.pointerMove(window, { pointerId: 1, buttons: 1, clientX: dx, clientY: 0, altKey: true });
      if (opts.drop !== false) fireEvent.pointerUp(window, { pointerId: 1, clientX: dx, clientY: 0, altKey: opts.altAtDrop ?? true });
    };
    const starts = () => useTimelineStore.getState().doc!.clips.map((c) => [c.id, c.startSec] as const);

    it("元は残り、運んだ先に写しが増えて写しを選ぶ（取り消しは1回ぶん）", () => {
      two();
      render(<TimelineProjectScreen onNavigate={vi.fn()} />);
      const before = useTimelineStore.getState().history.past.length;
      altDrag(band("あ"), 36 * 10); // 10秒へ
      const clips = useTimelineStore.getState().doc!.clips;
      expect(clips).toHaveLength(3);
      expect(clips.find((c) => c.id === "clip_001")!.startSec).toBe(0); // 元は動かない
      const copy = clips.find((c) => c.id !== "clip_001" && c.id !== "clip_002")!;
      expect(copy.startSec).toBeCloseTo(10, 5);
      expect((copy as { text?: string }).text).toBe("あ");
      expect(useTimelineStore.getState().selectedClipIds).toEqual([copy.id]);
      expect(useTimelineStore.getState().history.past.length).toBe(before + 1);
    });

    it("運んでいる間は写しの印を付け、元の位置に元を薄く残す（Alt を押していなければ出さない）", () => {
      two();
      const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
      altDrag(band("あ"), 36 * 10, { drop: false });
      expect(band("あ").className).toContain("timeline-clip--copying");
      const source = container.querySelectorAll('[data-testid="clip-copy-source"]');
      expect(source).toHaveLength(1);
      expect((source[0] as HTMLElement).style.left).toBe("0px");
      fireEvent.pointerMove(window, { pointerId: 1, buttons: 1, clientX: 36 * 10, clientY: 0, altKey: false });
      expect(band("あ").className).not.toContain("timeline-clip--copying");
      expect(container.querySelectorAll('[data-testid="clip-copy-source"]')).toHaveLength(0);
    });

    // ⚠️ **離した瞬間の押し方で決まる**（Premiere の型）＝途中で Alt を離せば、ふつうに運ぶ。
    it("離す前に Alt を離せば、写さずに運ぶ", () => {
      two();
      render(<TimelineProjectScreen onNavigate={vi.fn()} />);
      altDrag(band("あ"), 36 * 10, { altAtDrop: false });
      expect(starts()).toEqual([["clip_001", 10], ["clip_002", 5]]);
    });

    // ⚠️ **元も重なりの相手**＝元は残るので、少しだけ運ぶと元と重なる。色と結果を同じ関数で見る。
    it("元と重なる所では赤く示し、離しても増やさずに理由を出す", () => {
      two({ clips: [{ id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 3, x: 0, y: 0, w: 10, h: 10, text: "あ" }] });
      render(<TimelineProjectScreen onNavigate={vi.fn()} />);
      altDrag(band("あ"), 36 * 1, { drop: false }); // 1秒＝元（0〜3秒）と重なる
      expect(band("あ").className).toContain("drop-target--blocked");
      fireEvent.pointerUp(window, { pointerId: 1, clientX: 36, clientY: 0, altKey: true });
      expect(useTimelineStore.getState().doc!.clips).toHaveLength(1);
      expect(useTimelineStore.getState().editBlocked?.reason).toBe(EDIT_BLOCKED.overlap);
    });

    // ⚠️ **押し替えをその場で見せる**（PR #1409 レビュー 🟡）＝指を止めたまま Alt を離すと、見た目は写すのに結果は運ぶ、を作らない。
    it("指を止めたまま Alt を離すと、その場で運ぶ見た目に戻り、離せば運ぶ", () => {
      two();
      const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
      altDrag(band("あ"), 36 * 10, { drop: false });
      expect(band("あ").className).toContain("timeline-clip--copying");
      fireEvent.keyUp(window, { key: "Alt", altKey: false });
      expect(band("あ").className).not.toContain("timeline-clip--copying");
      expect(container.querySelectorAll('[data-testid="clip-copy-source"]')).toHaveLength(0);
      fireEvent.keyDown(window, { key: "Alt", altKey: true });
      expect(band("あ").className).toContain("timeline-clip--copying"); // 押し直せば写す見た目に戻る
      fireEvent.keyUp(window, { key: "Alt", altKey: false });
      fireEvent.pointerUp(window, { pointerId: 1, clientX: 36 * 10, clientY: 0, altKey: false });
      expect(starts()).toEqual([["clip_001", 10], ["clip_002", 5]]);
    });

    // ⚠️ **写すときは連動している字幕も 0 秒の床に数える**（PR #1409 レビュー 🟡）＝写しは時間ごと運ぶので、
    //   数えないと、いちばん早い字幕の写しだけが 0 秒に丸められて間隔が潰れる。
    it("連動している字幕を含めて群ごと写すとき、0秒の壁で群ごと止まる（間隔を潰さない）", () => {
      open({
        tracks: [{ id: "track_001", kind: TRACK_KIND.visual }, { id: "track_005", kind: TRACK_KIND.visual }, { id: "track_002", kind: TRACK_KIND.audio }],
        clips: [
          { id: "clip_sub", kind: TIMELINE_CLIP_KIND.subtitle, trackId: "track_001", startSec: 1, durationSec: 0.5, x: 0, y: 900, w: 1920, h: 120, voiceClipId: "clip_voice" },
          { id: "clip_voice", kind: TIMELINE_CLIP_KIND.voice, trackId: "track_002", startSec: 1, durationSec: 0.5, voice: { text: "よろしく", status: "none" } },
          // ⚠️ 短くしておく＝写しは同じ列へ置くので、元と重ならない長さにする（重なれば全か無かで何も置かれない）。
          { id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_005", startSec: 3, durationSec: 0.5, x: 0, y: 0, w: 10, h: 10, text: "あ" },
        ],
      });
      useTimelineStore.setState({ selectedClipIds: ["clip_sub", "clip_001"] });
      render(<TimelineProjectScreen onNavigate={vi.fn()} />);
      altDrag(band("あ"), -36 * 5); // 5秒ぶん左へ（群の先頭＝字幕は 1秒しかない）
      const clips = useTimelineStore.getState().doc!.clips;
      const copies = clips.filter((c) => !["clip_sub", "clip_voice", "clip_001"].includes(c.id));
      expect(copies).toHaveLength(2);
      const sub = copies.find((c) => c.kind === TIMELINE_CLIP_KIND.subtitle)!;
      const text = copies.find((c) => c.kind === TIMELINE_CLIP_KIND.text)!;
      expect(sub.startSec).toBeCloseTo(0, 5);
      expect(text.startSec).toBeCloseTo(2, 5); // 2秒の間隔が保たれる（3 - 1）
      expect(sub.voiceClipId).toBeUndefined(); // 写しは連動を外す
    });

    it("まとめて選んでいれば群ごと写す（元は全部残る・間隔はそのまま）", () => {
      two();
      useTimelineStore.setState({ selectedClipIds: ["clip_001", "clip_002"] });
      render(<TimelineProjectScreen onNavigate={vi.fn()} />);
      altDrag(band("あ"), 36 * 10);
      const clips = useTimelineStore.getState().doc!.clips;
      expect(clips).toHaveLength(4);
      expect(clips.filter((c) => c.id === "clip_001" || c.id === "clip_002").map((c) => c.startSec)).toEqual([0, 5]);
      const copies = clips.filter((c) => c.id !== "clip_001" && c.id !== "clip_002").map((c) => c.startSec).sort((a, b) => a - b);
      expect(copies[0]).toBeCloseTo(10, 5);
      expect(copies[1]).toBeCloseTo(15, 5);
      expect(useTimelineStore.getState().selectedClipIds).toHaveLength(2);
    });
  });

  it("何度動かしても**取り消しは1回ぶん**（動かした回数だけ積まない・#752-12）", () => {
    // ⚠️ 影は毎回の動きで描き替わるが、文書を書き換えるのは離したときの1回だけ。
    // ここが崩れると、ひと運びで履歴上限を流し切って「戻したかった直前の誤操作」が追い出される。
    two();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const before = useTimelineStore.getState().history.past.length;
    pointerDownAt(band("あ"), 1, { clientX: 0, clientY: 0 });
    for (const dx of [36, 108, 216, 288, 360]) fireEvent.pointerMove(window, { pointerId: 1, buttons: 1, clientX: dx, clientY: 0 });
    expect(useTimelineStore.getState().history.past.length).toBe(before); // 動かしている間は積まない
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 360, clientY: 0 });
    expect(useTimelineStore.getState().history.past.length).toBe(before + 1); // 5回動かしても1つ
    expect(useTimelineStore.getState().doc!.clips[0].startSec).toBeCloseTo(10, 5);
  });

  it("端を縮めるときも**取り消しは1回ぶん**（#752-12）", () => {
    two();
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] }); // 端の取っ手は選んだ帯にだけ出る
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const before = useTimelineStore.getState().history.past.length;
    const handle = container.querySelector(".timeline-clip-handle--right") as HTMLElement;
    pointerDownAt(handle, 1, { clientX: 0, clientY: 0 });
    for (const dx of [-18, -36, -54]) fireEvent.pointerMove(window, { pointerId: 1, buttons: 1, clientX: dx, clientY: 0 });
    expect(useTimelineStore.getState().history.past.length).toBe(before);
    fireEvent.pointerUp(window, { pointerId: 1, clientX: -54, clientY: 0 });
    expect(useTimelineStore.getState().history.past.length).toBe(before + 1);
    expect(useTimelineStore.getState().doc!.clips[0].durationSec).toBeCloseTo(1.5, 5);
  });

  it("重なる所へ落としても**寄せずに元のまま**＋離したときに理由を出す（決定10）", async () => {
    // ⚠️ 黙って戻すと「勝手に戻った」としか見えない。同じ画面の「つかんで置く」（#684）と作法を揃える。
    two();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    drag(band("あ"), 36 * 4); // 2つ目（5秒〜）に重なる所まで運ぶ
    expect(useTimelineStore.getState().doc!.clips[0].startSec).toBe(0); // 寄せない＝元のまま
    expect(useTimelineStore.getState().editBlocked?.reason).toBe(EDIT_BLOCKED.overlap); // 理由は出す
    expect(screen.getByRole("alert").textContent).toContain("列を足して"); // 次の行動が読める
  });

  it("掴んでいる間は置けないことを見た目で示す（離すまで待たせない）", () => {
    two();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    drag(band("あ"), 36 * 4, { drop: false });
    expect(band("あ").className).toContain("drop-target--blocked");
    expect(band("あ").className).toContain("timeline-clip--dragging");
  });

  it("書き出し中は**掴めない**（離してから断らない）", () => {
    two();
    useTimelineStore.setState({ exportRun: { phase: "rendering", percent: 42, message: null, cancelling: false } });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    // ⚠️ **離した後に見ても分からない**（掴めていても離せば印は消えるし、`commit` が断るので
    // どちらでも動かない）。**掴んでいる最中**を見る＝掴む処理そのものが始まらないこと。
    drag(band("あ"), 36 * 8, { drop: false });
    expect(band("あ").className).not.toContain("timeline-clip--dragging");
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 36 * 8, clientY: 0 });
    expect(useTimelineStore.getState().doc!.clips[0].startSec).toBe(0);
  });

  it("**まとめて選んでいると一緒に動く**（#686 段階4・決定15）", () => {
    two();
    useTimelineStore.setState({ selectedClipIds: ["clip_001", "clip_002"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const before = useTimelineStore.getState().doc!.clips.map((c) => c.startSec);
    drag(band("あ"), 36 * 10); // 10秒ぶん右へ
    const after = useTimelineStore.getState().doc!.clips.map((c) => c.startSec);
    // 掴んでいない相手にも**同じだけ**効く（群の形を崩さない）。
    expect(after[0] - before[0]).toBeCloseTo(10, 5);
    expect(after[1] - before[1]).toBeCloseTo(10, 5);
    expect(useTimelineStore.getState().selectedClipIds).toEqual(["clip_001", "clip_002"]); // 選択は保つ
  });

  it("まとめて動かす間、**一緒に動く相手とは重ならない**（赤いのに置ける、を作らない）", () => {
    // ⚠️ 掴んだ相手だけで見ると、**一緒に動く隣**と重なる判定になって赤くなるのに、
    // 離すと（正しく）置ける＝見えている色と結果が割れる（実機で踏んだ）。
    two(); // clip_001=[0,3) / clip_002=[5,8)
    useTimelineStore.setState({ selectedClipIds: ["clip_001", "clip_002"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    // +4秒＝clip_001 は 4〜7秒（元の clip_002 と重なる位置）だが、clip_002 も 9〜12秒へ動く。
    drag(band("あ"), 36 * 4, { drop: false });
    expect(band("あ").className).not.toContain("drop-target--blocked");
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 36 * 4, clientY: 0 });
    expect(useTimelineStore.getState().doc!.clips.map((c) => c.startSec)).toEqual([4, 9]);
  });

  it("0秒の壁で**群ごと止まる**（先頭だけ張り付いて間隔が消えない）", () => {
    // ⚠️ 帯ごとに 0 で切ると、先頭側だけ 0 に張り付いて**間隔が消える**（別の列どうしなら
    // 成功として確定してしまう）。群のいちばん早い帯が 0 に着いたら、そこで群ごと止まる。
    two({ tracks: [{ id: "track_001", kind: TRACK_KIND.visual }, { id: "track_005", kind: TRACK_KIND.visual }], clips: [
      { id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 2, durationSec: 3, x: 0, y: 0, w: 10, h: 10, text: "あ" },
      { id: "clip_002", kind: TIMELINE_CLIP_KIND.text, trackId: "track_005", startSec: 10, durationSec: 3, x: 0, y: 0, w: 10, h: 10, text: "い" },
    ] });
    useTimelineStore.setState({ selectedClipIds: ["clip_001", "clip_002"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    // ⚠️ **後ろの帯を掴む**（先頭を掴むと `at()` の 0 クランプだけで同じ結果になり、群で丸めているか
    // 区別できない＝実際にそれで変異が生き残った）。
    drag(band("い"), -36 * 15); // 15秒ぶん左へ（群の先頭は 2秒しかない）
    const after = useTimelineStore.getState().doc!.clips.map((c) => c.startSec);
    expect(after[0]).toBe(0);
    expect(after[1]).toBe(8); // 8秒の間隔が保たれる（10 - 2）
  });

  it("連動している字幕は**掴んでいる間から読み上げに付いてくる**（離した瞬間に飛ばない）", () => {
    open({
      tracks: [{ id: "track_001", kind: TRACK_KIND.visual }, { id: "track_002", kind: TRACK_KIND.audio }],
      clips: [
        { id: "clip_001", kind: TIMELINE_CLIP_KIND.voice, trackId: "track_002", startSec: 0, durationSec: 2, voice: { text: "あ", status: "none" } },
        { id: "clip_002", kind: TIMELINE_CLIP_KIND.subtitle, trackId: "track_001", startSec: 0, durationSec: 2, x: 0, y: 0, w: 10, h: 10, voiceClipId: "clip_001" },
        { id: "clip_003", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 20, durationSec: 2, x: 0, y: 0, w: 10, h: 10, text: "い" },
      ],
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_001", "clip_003"] });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    // ⚠️ **帯は id で探す**＝連動した字幕の帯にも読み上げと同じ文（「あ」）が出る（通し点検 2026-10-16）。
    const subLeft = () => (container.querySelector('.timeline-clip[data-clip-id="clip_002"]') as HTMLElement | null)?.style.left;
    const before = subLeft();
    drag(container.querySelector('.timeline-clip[data-clip-id="clip_001"]') as HTMLElement, 36 * 5, { drop: false }); // 読み上げを掴んで5秒ぶん右へ
    // ⚠️ 据え置いて見せると、離した瞬間に字幕だけ飛ぶ（確定は `withBoundSubtitles` が動かす）。
    expect(subLeft()).not.toBe(before);
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 36 * 5, clientY: 0 });
    expect(useTimelineStore.getState().doc!.clips.find((c) => c.id === "clip_002")!.startSec).toBeCloseTo(5, 5);
  });

  it("**動かない字幕**は 0秒の壁の計算に数えない（群が左へ動けなくならない）", () => {
    // ⚠️ 連動している字幕は**連動先の読み上げが群に居るときだけ**動く。居ない字幕の位置を
    // 床に数えると、それが 0秒に居るだけで**群ぜんぶが左へ動けなくなる**（断り文も出ない）。
    open({
      tracks: [{ id: "track_001", kind: TRACK_KIND.visual }, { id: "track_002", kind: TRACK_KIND.audio }],
      clips: [
        { id: "clip_001", kind: TIMELINE_CLIP_KIND.voice, trackId: "track_002", startSec: 0, durationSec: 2, voice: { text: "こえ", status: "none" } },
        // 連動先（clip_001）は**選ばない**＝この字幕は動かない。
        { id: "clip_002", kind: TIMELINE_CLIP_KIND.subtitle, trackId: "track_001", startSec: 0, durationSec: 2, x: 0, y: 0, w: 10, h: 10, voiceClipId: "clip_001" },
        { id: "clip_003", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 20, durationSec: 2, x: 0, y: 0, w: 10, h: 10, text: "あ" },
      ],
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_002", "clip_003"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    drag(band("あ"), -36 * 15); // 15秒ぶん左へ（20秒に居るので動ける）
    const clips = useTimelineStore.getState().doc!.clips;
    expect(clips.find((c) => c.id === "clip_003")!.startSec).toBeCloseTo(5, 5);
    expect(clips.find((c) => c.id === "clip_002")!.startSec).toBe(0); // 字幕は据え置き
  });

  it("まとめて動かして1つでも置けなければ**全体を動かさない**（全か無か）", () => {
    two({ clips: [
      { id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 3, x: 0, y: 0, w: 10, h: 10, text: "あ" },
      { id: "clip_002", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 5, durationSec: 3, x: 0, y: 0, w: 10, h: 10, text: "い" },
      { id: "clip_003", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 20, durationSec: 3, x: 0, y: 0, w: 10, h: 10, text: "う" },
    ] });
    useTimelineStore.setState({ selectedClipIds: ["clip_001", "clip_002"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    // +15秒＝clip_002 が clip_003（20〜23秒）と重なる。clip_001 は空いているが**動かさない**。
    drag(band("あ"), 36 * 15);
    const after = useTimelineStore.getState().doc!.clips.map((c) => c.startSec);
    expect(after).toEqual([0, 5, 20]);
    expect(useTimelineStore.getState().editBlocked?.reason).toBe(EDIT_BLOCKED.overlap);
  });

  it("掴んだ直後の `click` で選び直さない（理由が消える・Shift で選択が外れる）", () => {
    two();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    drag(band("あ"), 36 * 4); // 重なる所＝理由が出る
    // ⚠️ **指の経路として撃つ**（`detail: 1`）＝`fireEvent.click` の既定は `detail: 0`＝**キーボード起動**
    // なので、そのままだと「捨てる印はキーの `click` には効かせない」（#833-1 レビュー 🟡）に当たって
    // **この経路を通らなくなる**（テストが空振りする）。実機で離した後に来るのは指の `click`。
    fireEvent.click(band("あ"), { shiftKey: true, detail: 1 }); // 離した後に来る click
    expect(useTimelineStore.getState().editBlocked?.reason).toBe(EDIT_BLOCKED.overlap); // 消えない
    expect(useTimelineStore.getState().selectedClipIds).toEqual(["clip_001"]); // 外れない
  });

  it("掴んでいる間に別の所から文書が変わったら**確定しない**（掴み直してもらう）", () => {
    two();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const el = band("あ");
    pointerDownAt(el, 1, { clientX: 0, clientY: 0 });
    fireEvent.pointerMove(window, { pointerId: 1, buttons: 1, clientX: 36 * 8, clientY: 0 });
    // 声の完成などで当人の区間が変わった（自分では押していない変化）。
    act(() => { useTimelineStore.getState().trimClipById("clip_001", "end", 2); });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 36 * 8, clientY: 0 });
    // 掴んだときの起点で上書きしない＝変わった後の値がそのまま残る。
    expect(useTimelineStore.getState().doc!.clips[0].startSec).toBe(0);
    expect(useTimelineStore.getState().doc!.clips[0].durationSec).toBeCloseTo(2, 5);
  });

  it("左の端を掴むと**始まりだけ**動く（終わりは動かさない）", () => {
    two();
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const handle = container.querySelector(".timeline-clip-handle--left") as HTMLElement;
    drag(handle, 36 * 1); // 1秒ぶん右へ
    const c = useTimelineStore.getState().doc!.clips[0];
    expect(c.startSec).toBeCloseTo(1, 5);
    expect(c.startSec + c.durationSec).toBeCloseTo(3, 5); // 終わりは元のまま
  });

  it("左の端は最小の長さで止まる（見えている長さと確定した長さが同じ）", () => {
    two();
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const handle = container.querySelector(".timeline-clip-handle--left") as HTMLElement;
    drag(handle, 36 * 5, { drop: false }); // 終わり（3秒）を越えて縮めようとする
    const ghost = (container.querySelector(".timeline-clip") as HTMLElement).style;
    expect(parseFloat(ghost.width)).toBeCloseTo(36 * TIMELINE_MIN_CLIP_SEC, 3); // 見た目も下限で止まる
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 36 * 5, clientY: 0 });
    const c = useTimelineStore.getState().doc!.clips[0];
    expect(c.durationSec).toBeCloseTo(TIMELINE_MIN_CLIP_SEC, 5); // 確定も同じ
  });

  // ⚠️ **端は限界で止めて確定する**（ADR-0034 追補 2026-10-05・利用者判断）＝以前は赤くなって元の長さに戻った。
  it("右の端を隣の帯の先まで引くと、隣の端で止まり、離すとそこで確定する（元に戻さない）", () => {
    two();
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const handle = container.querySelector(".timeline-clip-handle--right") as HTMLElement;
    drag(handle, 36 * 4, { drop: false }); // 3秒 → 7秒へ（隣は 5秒から）
    const el = container.querySelector(".timeline-clip") as HTMLElement;
    expect(parseFloat(el.style.width), "見た目が隣の端で止まっていない").toBeCloseTo(36 * 5, 3);
    expect(el.className, "止まった端の色が出ていない").toContain("timeline-clip--stopped-end");
    expect(el.className, "止まっただけなのに置けない色にしている").not.toContain("drop-target--blocked");
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 36 * 4, clientY: 0 });
    const c = useTimelineStore.getState().doc!.clips[0];
    expect(c.durationSec, "離したら元の長さに戻った").toBe(5);
    expect(useTimelineStore.getState().editBlocked, "止まって確定したのに断りを出している").toBeNull();
  });

  it("左の端を隣の帯の手前まで引くと、隣の終わりで止まって確定する", () => {
    two();
    useTimelineStore.setState({ selectedClipIds: ["clip_002"] });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const handle = container.querySelectorAll(".timeline-clip-handle--left")[0] as HTMLElement;
    drag(handle, -36 * 4, { drop: false }); // 5秒 → 1秒へ（前は 3秒まで）
    const el = [...container.querySelectorAll(".timeline-clip")].find((x) => x.className.includes("timeline-clip--dragging")) as HTMLElement;
    expect(el.className).toContain("timeline-clip--stopped-start");
    fireEvent.pointerUp(window, { pointerId: 1, clientX: -36 * 4, clientY: 0 });
    const c = useTimelineStore.getState().doc!.clips[1];
    expect(c.startSec).toBe(3);
    expect(c.startSec + c.durationSec).toBeCloseTo(8, 5);
  });

  it("見た目パターンの差し込み口の動画も、素材の始まりで止まる（画面が見た目パターンを渡している）", () => {
    const tmpl = {
      schemaVersion: "1.0", templateId: "tmpl_slot", name: "差し込み口", category: "photo_intro", aspectRatio: "16:9",
      canvas: { width: 1920, height: 1080 }, layers: [{ id: "main", type: "slot", x: 0, y: 0, w: 1920, h: 1080 }],
    } as unknown as Template;
    useProjectStore.setState({ templates: [tmpl] });
    open({
      assets: [{ assetId: "asset_v", assetType: "video", displayName: "動画", filePath: "v.mp4", metadata: { durationSec: 6 } }] as never,
      clips: [{ id: "clip_001", kind: TIMELINE_CLIP_KIND.template, trackId: "track_001", startSec: 2, durationSec: 3, templateId: "tmpl_slot", assetRefs: { main: "asset_v" }, slotClips: { main: { startSec: 1 } } } as never],
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const handle = container.querySelector(".timeline-clip-handle--left") as HTMLElement;
    drag(handle, -36 * 2); // 2秒 → 0秒へ（枠の動画は使い始め 1秒＝1秒より前へは伸ばせない）
    expect(useTimelineStore.getState().doc!.clips[0].startSec).toBeCloseTo(1, 4);
    useProjectStore.setState({ templates: [] });
  });

  it("0 秒・最小の長さで止まったときも、止まった端の色を出す（同じ「止まる」で色の有無を割らない）", () => {
    two();
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    const { container, unmount } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    drag(container.querySelector(".timeline-clip-handle--left") as HTMLElement, -36 * 2, { drop: false }); // 0秒より左へ
    expect((container.querySelector(".timeline-clip") as HTMLElement).className).toContain("timeline-clip--stopped-start");
    fireEvent.pointerUp(window, { pointerId: 1, clientX: -72, clientY: 0 });
    unmount();
    two();
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    const v2 = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    drag(v2.container.querySelector(".timeline-clip-handle--right") as HTMLElement, -36 * 5, { drop: false }); // 最小の長さより短く
    expect((v2.container.querySelector(".timeline-clip") as HTMLElement).className).toContain("timeline-clip--stopped-end");
    fireEvent.pointerUp(window, { pointerId: 1, clientX: -180, clientY: 0 });
  });

  it("「長さ（秒）」の欄の上限は、端が止まる所と同じ（下限と同じく欄の作法で丸める）", () => {
    two();
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const field = screen.getByLabelText("長さ（秒）") as HTMLInputElement;
    expect(field.max).toBe("5"); // 隣は 5秒から
  });

  it("止まった端は取っ手ごと赤く塗る（選択の外枠と半透明の取っ手に負けない）", () => {
    const css = readFileSync(`${process.cwd()}/src/app/components/timeline.css`, "utf8");
    const start = css.indexOf(".timeline-clip--stopped-start .timeline-clip-handle--left::after,");
    expect(start, "止まった端の取っ手を塗る規則が無い").toBeGreaterThanOrEqual(0);
    const rule = css.slice(start, css.indexOf("}", start));
    expect(rule).toContain(".timeline-clip--stopped-end .timeline-clip-handle--right::after");
    expect(rule).toContain("background: var(--color-danger);");
    expect(rule).toContain("opacity: 1;");
  });

  it("まとめて選んでいても、端を動かすときは群の床を掛けない（選んだ別の帯が 0 秒にあっても左へ伸ばせる）", () => {
    two();
    useTimelineStore.setState({ selectedClipIds: ["clip_002", "clip_001"] });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const handles = [...container.querySelectorAll(".timeline-clip-handle--left")] as HTMLElement[];
    const h2 = handles.find((h) => h.closest(".timeline-clip")?.textContent?.includes("い"));
    if (!h2) return; // まとめて選んでいるときに取っ手を出さない形なら対象外
    drag(h2, -36 * 1); // 5秒 → 4秒（前の帯は 3秒まで）
    expect(useTimelineStore.getState().doc!.clips[1].startSec).toBeCloseTo(4, 4);
  });

  // ⚠️ UI/UX 監査 2026-10-02（PR4b）＝まとめて運ぶとき、一緒に動く帯の**動かす前の端**へ吸い付いていた。
  it("まとめて運ぶとき、一緒に動く帯の元の位置へは吸い付かない", () => {
    two();
    useTimelineStore.setState({ selectedClipIds: ["clip_001", "clip_002"] });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    // ⚠️ 見えている幅を与える（jsdom は 0＝吸着先が1つも無く、どんな作りでも緑になる）。
    Object.defineProperty(container.querySelector(".timeline-scroll")!, "clientWidth", { value: 900, configurable: true });
    // 2.1 秒ぶん右へ＝「あ」の終わり（3→5.1）が「い」の**元の**始まり（5）のすぐそば。以前はそこへ吸い付いて 2.0 秒になった。
    drag(band("あ"), 36 * 2.1);
    expect(useTimelineStore.getState().doc!.clips[0].startSec).toBeCloseTo(2.1, 2);
  });

  it("まとめて少しだけ運んでも、一緒に動く帯の元の端へ引き戻されない", () => {
    open({
      clips: [
        { id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 1, durationSec: 3, x: 0, y: 0, w: 10, h: 10, text: "あ" },
        { id: "clip_002", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 6, durationSec: 3, x: 0, y: 0, w: 10, h: 10, text: "い" },
      ],
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_001", "clip_002"], playheadSec: 20 });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    Object.defineProperty(container.querySelector(".timeline-scroll")!, "clientWidth", { value: 900, configurable: true });
    // 0.15 秒だけ右へ＝群の終わり（9→9.15）が「い」の**元の**終わり（9）のすぐそば。外さないと 9 へ戻されて動かない。
    drag(band("あ"), 36 * 0.15);
    expect(useTimelineStore.getState().doc!.clips[0].startSec).toBeCloseTo(1.15, 2);
  });

  it("目印へ吸い付く（目印に合わせて置くのが主な使い道）", () => {
    two({ markers: [{ id: "marker_001", timeSec: 10 }] });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    Object.defineProperty(container.querySelector(".timeline-scroll")!, "clientWidth", { value: 900, configurable: true });
    drag(band("い"), 36 * 4.9); // 5 → 9.9 秒（目印は 10 秒）
    expect(useTimelineStore.getState().doc!.clips[1].startSec).toBeCloseTo(10, 5);
  });

  it("限界に届かない所では止まった色を出さない", () => {
    two();
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const handle = container.querySelector(".timeline-clip-handle--right") as HTMLElement;
    drag(handle, 36 * 1, { drop: false }); // 3秒 → 4秒（隣は 5秒から）
    expect((container.querySelector(".timeline-clip") as HTMLElement).className).not.toContain("timeline-clip--stopped");
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 36, clientY: 0 });
  });

  it("掴んでいる間に**列**が変わっても確定しない（変わり方で漏らさない）", () => {
    two({ tracks: [{ id: "track_001", kind: TRACK_KIND.visual }, { id: "track_003", kind: TRACK_KIND.visual }] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    pointerDownAt(band("あ"), 1, { clientX: 0, clientY: 0 });
    fireEvent.pointerMove(window, { pointerId: 1, buttons: 1, clientX: 36 * 8, clientY: 0 });
    act(() => { useTimelineStore.getState().moveClipById("clip_001", { trackId: "track_003" }); });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 36 * 8, clientY: 0 });
    expect(useTimelineStore.getState().doc!.clips[0].startSec).toBe(0); // 起点で上書きしない
    expect(useTimelineStore.getState().doc!.clips[0].trackId).toBe("track_003"); // 変わった側が残る
  });

  it("`Escape` でやめた後の `click` も捨てる（選び直しで理由が消えない）", () => {
    two();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    drag(band("あ"), 36 * 4, { escape: true }); // 掴んでからやめる＝`onCancel` の道
    // `Shift` 付きの `click` は選択の付け外し＝捨てないと**やめた帯の選択が外れる**（取っ手も消える）。
    fireEvent.click(band("あ"), { shiftKey: true, detail: 1 }); // 指の経路（既定の `detail: 0` はキー起動）
    expect(useTimelineStore.getState().selectedClipIds).toEqual(["clip_001"]);
  });

  it("断った後に**帯の外で離しても**選択は消えない（当たり外れを作らない）", () => {
    // ⚠️ 帯の上で離したときだけ守られる形だと、少し外れただけで選択が丸ごと消える。
    two();
    useTimelineStore.setState({ selectedClipIds: ["clip_001", "clip_002"] });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const clip = container.querySelectorAll(".timeline-clip")[0] as HTMLElement;
    drag(clip, 36 * 10); // まとめて動かして、指が帯の外で離れた
    const lane = container.querySelector(".timeline-lane") as HTMLElement;
    fireEvent.click(lane, { detail: 1 }); // 列の余白で離した＝「何もない所を押した」経路（指）
    expect(useTimelineStore.getState().selectedClipIds).toEqual(["clip_001", "clip_002"]);
  });

  // ⚠️ **キーボードで起こした `click` は捨てない**（#833-1 レビュー 🟡）＝帯は `<button>` なので
  // `Tab`→`Enter` でも `click` が来るが、そこに `pointerdown` は**無い**。印は「次に指で押し始めたとき」に
  // 落とす形にしたので、印が消費されずに残った回（列をまたいで離して DOM が作り直された回）のあと
  // 次の操作がキーだけだと落とす合図が永久に来ず、**`Enter` の1回目が無言で飲み込まれる**
  //（キーで到達できなくなる＝ADR-0034 決定19）。指の経路かどうかは `detail` で見分ける。
  it("印が残っていても、キーボードで選ぶ1回目は飲み込まない（キーで到達できる）", () => {
    two();
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    // 列をまたいで離す＝帯の DOM が作り直され、`click` を消費する相手が居ないまま印が残る回。
    drag(band("あ"), 36 * 8);
    expect(useTimelineStore.getState().selectedClipIds).toEqual(["clip_001"]);
    useTimelineStore.getState().clearSelection();
    // ここで指を使わず**キーボードだけ**で別の帯を選ぶ（`detail: 0`＝キー起動の `click`）。
    const other = [...container.querySelectorAll(".timeline-clip")].find((el) => (el.textContent ?? "").includes("い")) as HTMLElement;
    fireEvent.click(other);
    expect(useTimelineStore.getState().selectedClipIds).toEqual(["clip_002"]); // 1回目から効く
  });

  it("**書き出し中は再生を始めない**（押しても何も起きない、を作らない・#752-6）", () => {
    // ⚠️ 成果物は壊れないが、音が鳴り出す入口だけ開いていた（編集も声の作成も塞いであるのに）。
    two();
    useTimelineStore.setState({ exportRun: { phase: "rendering", percent: 0, message: null, cancelling: false } });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const play = screen.getByRole("button", { name: "再生" });
    expect(play).toBeDisabled();
    expect(play.getAttribute("title")).toContain("終わってから再生できます"); // 押せない理由を出す
    fireEvent.keyDown(window, { key: " " }); // キーからも始まらない（見た目を持たない入口）
    expect(useTimelineStore.getState().isPlaying).toBe(false);
    // ⚠️ **キーで断るなら理由を出す**（#752 レビュー）＝`Delete`・`Ctrl+K` は喋るのに `Space` だけ
    // 黙ると、押せない見た目を持たない入口で挙動が割れる。
    expect(useTimelineStore.getState().editBlocked?.reason).toBe("TIMELINE_PLAY_EXPORTING");
    expect(screen.getByText(/終わってから再生できます/)).toBeInTheDocument();
  });

  it("走っている最中の「停止」は塞がない（止められないまま音が流れる、を作らない・#752 レビュー）", () => {
    two();
    useTimelineStore.setState({
      isPlaying: true,
      exportRun: { phase: "rendering", percent: 0, message: null, cancelling: false },
    });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const stop = screen.getByRole("button", { name: "停止" });
    expect(stop).not.toBeDisabled();
    fireEvent.click(stop);
    expect(useTimelineStore.getState().isPlaying).toBe(false);
  });

  it("「⋮」の位置は**幅の条件だけ**で決める（再生の開始・停止で跳ばない・#752 レビュー）", () => {
    two();
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    const { rerender } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const menuLeft = () => (screen.getByRole("button", { name: "あの操作" }) as HTMLElement).style.left;
    const before = menuLeft();
    act(() => { useTimelineStore.setState({ isPlaying: true }); });
    rerender(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.queryByText("", { selector: ".timeline-clip-handle" })).toBeNull(); // 取っ手は消える（意図どおり）
    expect(menuLeft()).toBe(before); // 位置は動かない
  });

  it("押せるときはキーの割り当てを添える（あることを知らせる・#752-10）", () => {
    two();
    useTimelineStore.setState({ selectedClipIds: ["clip_001"], playheadSec: 1 }); // 描く前に選んでおく
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getByRole("button", { name: "再生" }).getAttribute("title")).toContain("（Space）");
    expect(screen.getByRole("button", { name: "ここで分ける" }).getAttribute("title")).toContain("（Ctrl+K）");
  });

  it("**再生中は帯を掴めない**（吸着の寄り先が掴んだ時点で止まる・#752-4）", () => {
    // ⚠️ 置く操作は既に塞いであるのに掴む方だけ通っていた（同じ理由なら同じ挙動・ADR-0026②）。
    two();
    useTimelineStore.setState({ isPlaying: true });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(band("あ").className).not.toContain("timeline-clip--editable"); // 見た目も掴めない
    drag(band("あ"), 36 * 8);
    expect(useTimelineStore.getState().doc!.clips[0].startSec).toBe(0); // 動かない
  });

  it("掴んでいる間は**ボタンでも**倍率を変えられない（帯が指から離れる）", () => {
    two();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const before = (band("い") as HTMLElement).style.left;
    drag(band("あ"), 36 * 1, { drop: false }); // 掴んだまま
    fireEvent.click(screen.getByLabelText("表示を広げる"));
    expect((band("い") as HTMLElement).style.left).toBe(before); // 掴んでいない帯＝倍率が変われば動く
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 36, clientY: 0 });
    fireEvent.click(screen.getByLabelText("表示を広げる"));
    expect((band("い") as HTMLElement).style.left).not.toBe(before); // 離せば効く（塞ぎっぱなしにしない）
  });

  it("**部品を運んでいる最中も**倍率を変えられない（#752-5）", () => {
    // ⚠️ 帯を掴んでいるときだけ塞いでいたので、部品を運んでいる最中（`grabToPlace`）は素通りした。
    // 落とし先の時刻は**掴んだ時点の倍率**で秒に直しているので（受け口は掴んだ時の写し）、
    // 途中で倍率が変わると**指の下と違う所へ置かれる**。掴む場所が増えるたびに関門を足さない
    // ＝合図は「いま何かを掴んでいる」1つ。
    two();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const before = (band("い") as HTMLElement).style.left; // 5秒の帯＝倍率が変われば動く
    fireEvent.pointerDown(screen.getByRole("button", { name: "図形を置く" }), { pointerId: 1, button: 0, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(window, { pointerId: 1, buttons: 1, clientX: 40, clientY: 0 }); // 運んでいる
    fireEvent.click(screen.getByLabelText("表示を広げる"));
    expect((band("い") as HTMLElement).style.left).toBe(before);
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 40, clientY: 0 }); // 列の外＝何も置かない
    fireEvent.click(screen.getByLabelText("表示を広げる"));
    expect((band("い") as HTMLElement).style.left).not.toBe(before); // 離せば効く（塞ぎっぱなしにしない）
  });

  it("倍率を断ったときは**錨点を控えない**（次の1回が古い錨点で流れる）", () => {
    two();
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const scroll = container.querySelector(".timeline-scroll") as HTMLElement;
    drag(band("あ"), 36 * 1, { drop: false }); // 掴んだまま＝倍率は断られる
    fireEvent.wheel(scroll, { ctrlKey: true, deltaY: -1, clientX: 500 });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 36, clientY: 0 });
    // 断られたのに錨点を控えていると、**錨点を持たないボタン**の1回がその古い値で位置合わせされる。
    fireEvent.click(screen.getByLabelText("表示を広げる"));
    expect(scroll.scrollLeft).toBe(0);
  });

  it("掴む前の関門は**見た目と同じもの**を見る（書き写さない）", () => {
    // `cursor: grab` を出す条件と、掴む処理を始める条件が割れると「掴めそうなのに掴めない」が戻る。
    two();
    useTimelineStore.setState({ exportRun: { phase: "rendering", percent: 0, message: null, cancelling: false } });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(band("あ").className).not.toContain("timeline-clip--editable"); // 見た目も掴めない
    drag(band("あ"), 36 * 8, { drop: false });
    expect(band("あ").className).not.toContain("timeline-clip--dragging"); // 処理も始まらない
  });

  it("端送りで枠が動いた分も**落ちる時刻に足す**（#714）", () => {
    // ⚠️ 足さないと「送られてはいるが、離すと送る前の時刻に落ちる」＝見えているものと結果が食い違う。
    two();
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const scroll = container.querySelector(".timeline-scroll") as HTMLElement;
    pointerDownAt(band("あ"), 1, { clientX: 0, clientY: 0 });
    fireEvent.pointerMove(window, { pointerId: 1, buttons: 1, clientX: 36 * 1, clientY: 0 });
    scroll.scrollLeft = 36 * 1; // 端送りが枠を1秒ぶん動かした（指は止まっている）
    // ⚠️ 端送りは**送った各フレームで見せ直す**（`useEdgeAutoScroll` の `replay`）。ここでも再現する
    // ＝確定は「最後に見せた値」なので、見せ直しを省くと実装より弱い筋書きになる。
    fireEvent.pointerMove(window, { pointerId: 1, buttons: 1, clientX: 36 * 1, clientY: 0 });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 36 * 1, clientY: 0 });
    // 指の 1秒 ＋ 枠の 1秒 ＝ 2秒。枠の分を落とすと 1秒になる（どちらも置ける場所＝差だけを見る）。
    expect(useTimelineStore.getState().doc!.clips[0].startSec).toBeCloseTo(2, 5);
  });

  it("「置く列」は**移せる列だけ**出す（選べたのに事後に断らない・#714 レビュー）", () => {
    two({ tracks: [
      { id: "track_001", kind: TRACK_KIND.visual },
      { id: "track_002", kind: TRACK_KIND.audio },          // 種別違い
      { id: "track_003", kind: TRACK_KIND.visual, hidden: true }, // 隠している
      { id: "track_004", kind: TRACK_KIND.visual },          // これだけ移せる
    ] });
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    // ⚠️ **名前で1つに決まる**（#819-3）＝以前は置く欄にも同じ「置く列」があり、値で当てるしかなかった。
    const sel = screen.getByLabelText("載っている列") as HTMLSelectElement;
    const ids = [...sel.options].map((o) => o.value);
    expect(ids).toContain("track_001"); // いま載っている列は必ず残す
    expect(ids).toContain("track_004");
    expect(ids).not.toContain("track_002");
    expect(ids).not.toContain("track_003");
  });

  it("掴み直してもらうときは**送りも止める**（消したゴーストが復活しない・#714 レビュー）", () => {
    // ⚠️ 止めないと rAF が回り続け、毎フレーム「送った分でやり直す」が走って**ゴーストが戻る**＋枠も流れる。
    const frames: Array<(t: number) => void> = [];
    vi.stubGlobal("requestAnimationFrame", (cb: (t: number) => void) => { frames.push(cb); return frames.length; });
    vi.stubGlobal("cancelAnimationFrame", () => { frames.length = 0; });
    try {
      two();
      const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
      const scroll = container.querySelector(".timeline-scroll") as HTMLElement;
      // jsdom は実寸を持たないので、**送れる枠**として必要な値だけ差し込む。
      Object.defineProperty(scroll, "clientWidth", { value: 600, configurable: true });
      Object.defineProperty(scroll, "scrollWidth", { value: 3000, configurable: true });
      // ⚠️ jsdom は**貼り付いた要素の `scrollLeft` を動かさない**（常に 0 を返す）ので、
      // そのままだと「送っても値が変わらない」＝止め忘れても症状が出ず**通るだけのテスト**になる。
      let sl = 0;
      Object.defineProperty(scroll, "scrollLeft", { get: () => sl, set: (v: number) => { sl = v; }, configurable: true });
      scroll.getBoundingClientRect = () => ({ left: 0, top: 0, right: 600, bottom: 100, width: 600, height: 100, x: 0, y: 0, toJSON: () => ({}) });
      pointerDownAt(band("あ"), 1, { clientX: 0, clientY: 10 });
      fireEvent.pointerMove(window, { pointerId: 1, buttons: 1, clientX: 590, clientY: 10 }); // 右端の送る帯へ
      expect(frames.length).toBeGreaterThan(0); // 送りが走っている
      act(() => { useTimelineStore.getState().trimClipById("clip_001", "end", 1); }); // 外から文書が変わった
      fireEvent.pointerMove(window, { pointerId: 1, buttons: 1, clientX: 591, clientY: 10 });
      expect(band("あ").className).not.toContain("timeline-clip--dragging"); // ゴーストを消した
      const before = scroll.scrollLeft;
      act(() => { frames.splice(0).forEach((cb) => cb(1000)); }); // 次のフレームが来ても…
      act(() => { frames.splice(0).forEach((cb) => cb(2000)); }); // （1フレーム目は dt=0 になりうる）
      expect(scroll.scrollLeft).toBe(before); // 流れない
      expect(band("あ").className).not.toContain("timeline-clip--dragging"); // 復活しない
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("隠した列では「複製」を**押す前に**塞ぐ（動かす・縮めるは通す）", () => {
    two({ tracks: [{ id: "track_001", kind: TRACK_KIND.visual, hidden: true }] });
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getByRole("button", { name: "複製" })).toBeDisabled();
    // ⚠️ まとめて塞ぐと**その列の中身が二度と動かせない**（行き止まり）。動かす側は通ること。
    expect(screen.getByRole("button", { name: "後ろへ" })).not.toBeDisabled();
  });

  it("置いた部品の位置・大きさ・向きを数値で触れる（#685）", () => {
    // ⚠️ **箱を持っていない**部品で見る＝値は**解決した箱**（画面いっぱい）。持っている値だけ出すと
    // 空欄になり「動かせない」に見える。
    open({ clips: [{ id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 3, text: "あ" }] });
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect((screen.getByLabelText("横位置") as HTMLInputElement).value).toBe("0");
    expect((screen.getByLabelText("幅") as HTMLInputElement).value).toBe("1920");
    // `NumberField` は**離れたとき**に確定する（打っている途中で確定しない＝他の数値欄と同じ）。
    fireEvent.change(screen.getByLabelText("横位置"), { target: { value: "300" } });
    fireEvent.blur(screen.getByLabelText("横位置"));
    // 触った時点で箱ぜんぶを書き込む＝以後の見た目と数値が食い違わない。
    expect(useTimelineStore.getState().doc!.clips[0]).toMatchObject({ x: 300, y: 0, w: 1920, h: 1080 });
  });

  it("重ね順の欄は出さない（この形式の重ね順は列の並びだけ・決定17）", () => {
    two();
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    // ⚠️ 「前へ／後ろへ」はこの画面では**時間**を動かすボタン（重ね順ではない）＝名前で判定しない。
    expect(screen.queryByLabelText("重ね順")).toBeNull();
    expect(screen.queryByLabelText("奥行き")).toBeNull();
  });

  const hintTemplate: Template = {
    schemaVersion: "1.0", templateId: "tmpl_001", name: "シンプル", category: "opening",
    aspectRatio: "16:9", canvas: { width: 1920, height: 1080 },
    layers: [{ id: "background", type: "background", x: 0, y: 0, w: 1920, h: 1080 }],
  };
  const openTemplateClip = (): void => {
    open({
      clips: [{ id: "clip_001", kind: TIMELINE_CLIP_KIND.template, trackId: "track_001", startSec: 0, durationSec: 3, templateId: "tmpl_001" }],
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
  };

  // ⚠️ **見た目パターンの中へ入れる**（#818・ADR-0034 決定8＝二度押しで中へ入り、差し込み口の中身は
  // そのまま直せる）。決定8 は「(c) ドリルイン＋明示的にバラす」なのに、**バラす側しか実装されて
  // いなかった**（#685 のクローズ時に無記録で読み替えられていた）。幾何は従来どおり「バラす」。
  describe("見た目パターンの中へ入る（#818）", () => {
    const drillTemplate: Template = {
      schemaVersion: "1.0", templateId: "tmpl_001", name: "枠ふたつ", category: "opening",
      aspectRatio: "16:9", canvas: { width: 1920, height: 1080 },
      layers: [
        { id: "left", type: "slot", x: 0, y: 0, w: 960, h: 1080 },
        { id: "right", type: "slot", x: 960, y: 0, w: 960, h: 1080 },
      ],
    };
    const openTemplateClip = (over: Partial<TimelineClip> = {}): HTMLElement => {
      useProjectStore.setState({ templates: [drillTemplate], templateAssetSrcById: {} });
      open({
        assets: [{ assetId: "asset_001", assetType: "image", displayName: "写真A", filePath: "a.png" }],
        clips: [{
          id: "clip_001", kind: TIMELINE_CLIP_KIND.template, trackId: "track_001",
          startSec: 0, durationSec: 5, templateId: "tmpl_001", assetRefs: { left: "asset_001" }, ...over,
        }],
      });
      const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
      const stage = container.querySelector(".preview-stage") as HTMLElement;
      // jsdom は実レイアウトを持たないので、キャンバスの実寸を与える（1920×1080 と等倍）。
      stage.getBoundingClientRect = () =>
        ({ left: 0, top: 0, width: 1920, height: 1080, right: 1920, bottom: 1080, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
      return container.querySelector(".free-layout-overlay") as HTMLElement;
    };
    const tapAt = (root: HTMLElement, x: number, y: number, t: number): void => {
      fireEvent.pointerDown(root, { button: 0, pointerId: 1, clientX: x, clientY: y, timeStamp: t });
      fireEvent.pointerUp(root, { button: 0, pointerId: 1, clientX: x, clientY: y, timeStamp: t });
    };

    it("二度押しで中へ入り、その差し込み口の欄に手が移る", () => {
      const root = openTemplateClip();
      root.getBoundingClientRect = () =>
        ({ left: 0, top: 0, width: 1920, height: 1080, right: 1920, bottom: 1080, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
      Object.defineProperty(root, "clientWidth", { value: 1920, configurable: true });
      tapAt(root, 1400, 500, 1000); // 右の枠を1回目
      tapAt(root, 1400, 500, 1100); // 二度押し
      expect(useTimelineStore.getState().selectedClipIds).toEqual(["clip_001"]); // その部品が選ばれる
      expect((document.activeElement as HTMLElement)?.getAttribute("data-slot-field")).toBe("right");
    });

    // ⚠️ **入った所に印が出る**（レビュー 🔴）＝印が無いと、入ったかどうかも、どの層に入ったかも読めない。
    it("入った所に印が出て、抜けると消える", () => {
      const root = openTemplateClip();
      root.getBoundingClientRect = () =>
        ({ left: 0, top: 0, width: 1920, height: 1080, right: 1920, bottom: 1080, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
      Object.defineProperty(root, "clientWidth", { value: 1920, configurable: true });
      tapAt(root, 1400, 500, 1000);
      tapAt(root, 1400, 500, 1100);
      const mark = document.querySelector(".timeline-drilled-part") as HTMLElement;
      expect(mark).not.toBeNull();
      expect(mark.style.left).toBe("50%"); // 右の枠（960/1920）
      act(() => { useTimelineStore.getState().clearSelection(); }); // 空白を押して抜ける
      expect(document.querySelector(".timeline-drilled-part")).toBeNull();
    });

    // ⚠️ **反転した部品では、描かれている所で入れる**（#1416）＝層は映す前の位置で持っているので、
    // そのまま当てると「見えている所を押しても入れず、何も無い所で入る」になる。印も同じく映す。
    it("左右反転した部品は、映した先を押すと入り、印も映した先に出る", () => {
      const root = openTemplateClip({ flipX: true });
      root.getBoundingClientRect = () =>
        ({ left: 0, top: 0, width: 1920, height: 1080, right: 1920, bottom: 1080, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
      Object.defineProperty(root, "clientWidth", { value: 1920, configurable: true });
      // 左の枠（0〜960）は反転で右（960〜1920）に描かれる。右を二度押し＝左の枠に入る。
      tapAt(root, 1400, 500, 1000);
      tapAt(root, 1400, 500, 1100);
      const mark = document.querySelector(".timeline-drilled-part") as HTMLElement;
      expect(mark).not.toBeNull();
      expect(mark.style.left).toBe("0%"); // 持っている位置は左の枠
      expect(mark.style.transform).toContain("matrix(-1, 0, 0, 1, 0, 0)"); // それを映して描く
      expect(mark.style.transform).toContain("translate(100%, 0%)"); // 中心 480 → 1440（枠の幅 960 ぶん右）
    });

    // ⚠️ **文字の層にも入れる**（決定8＝「差し込み口の中身（素材・**文字**）はそのまま直せる」）。
    it("文字の層に入ると、その文字の欄へ手が移る", () => {
      const withText: Template = {
        ...drillTemplate,
        layers: [
          ...drillTemplate.layers,
          { id: "title", type: "text", textKey: "title", x: 0, y: 900, w: 1920, h: 120, fontSize: 60 },
        ],
      };
      useProjectStore.setState({ templates: [withText], templateAssetSrcById: {} });
      open({
        assets: [],
        clips: [{
          id: "clip_001", kind: TIMELINE_CLIP_KIND.template, trackId: "track_001",
          startSec: 0, durationSec: 5, templateId: "tmpl_001", texts: { title: "みだし" },
        }],
      });
      const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
      const root = container.querySelector(".free-layout-overlay") as HTMLElement;
      root.getBoundingClientRect = () =>
        ({ left: 0, top: 0, width: 1920, height: 1080, right: 1920, bottom: 1080, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
      Object.defineProperty(root, "clientWidth", { value: 1920, configurable: true });
      tapAt(root, 900, 950, 1000);
      tapAt(root, 900, 950, 1100);
      expect((document.activeElement as HTMLElement)?.getAttribute("data-text-field")).toBe("title");
    });

    // ⚠️ **入れない層では飲み込まない**（レビュー 🟡）＝欄の無い所で `true` を返すと、二度押しが
    // 何も起きずに消え、**単押しの解除まで止まる**（画面が1ピクセルも変わらない）。
    // ⚠️ 背景の層は**差し込み口に数える**（写真を入れられる）ので、入れて正しい。入れないのは
    // 「欄を持たない所」＝ここでは**差し込み口の外**（クリップ自身の塗りしか無い所）。
    it("欄の無い所では入らず、従来どおり選択が解ける", () => {
      const smallSlot: Template = {
        schemaVersion: "1.0", templateId: "tmpl_001", name: "小さい枠", category: "opening",
        aspectRatio: "16:9", canvas: { width: 1920, height: 1080 },
        layers: [{ id: "main", type: "slot", x: 0, y: 0, w: 400, h: 300 }],
      };
      useProjectStore.setState({ templates: [smallSlot], templateAssetSrcById: {} });
      open({
        assets: [{ assetId: "asset_001", assetType: "image", displayName: "写真A", filePath: "a.png" }],
        clips: [{
          id: "clip_001", kind: TIMELINE_CLIP_KIND.template, trackId: "track_001",
          startSec: 0, durationSec: 5, templateId: "tmpl_001", assetRefs: { main: "asset_001" },
        }],
      });
      const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
      const root = container.querySelector(".free-layout-overlay") as HTMLElement;
      root.getBoundingClientRect = () =>
        ({ left: 0, top: 0, width: 1920, height: 1080, right: 1920, bottom: 1080, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
      Object.defineProperty(root, "clientWidth", { value: 1920, configurable: true });
      useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
      tapAt(root, 1400, 900, 1000); // 差し込み口の外（クリップの塗りだけの所）
      tapAt(root, 1400, 900, 1100);
      expect(useTimelineStore.getState().selectedClipIds).toEqual([]); // 飲み込まず、解除が効く
      expect(document.querySelector(".timeline-drilled-part")).toBeNull();
    });

    // ⚠️ **別の部品を選んだら手は飛ばない**（レビュー 🔴）＝層 id は見た目パターンをまたいで重なるので、
    // 印を落とさないと**帯を選ぶだけで前に入った層の欄へ手が飛び**、矢印が素材を変えてしまう。
    it("別の部品を選んでも、前に入った欄へ手が戻らない", () => {
      const root = openTemplateClip();
      root.getBoundingClientRect = () =>
        ({ left: 0, top: 0, width: 1920, height: 1080, right: 1920, bottom: 1080, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
      Object.defineProperty(root, "clientWidth", { value: 1920, configurable: true });
      tapAt(root, 1400, 500, 1000);
      tapAt(root, 1400, 500, 1100);
      expect((document.activeElement as HTMLElement)?.getAttribute("data-slot-field")).toBe("right");
      (document.activeElement as HTMLElement).blur();
      // ⚠️ **画面の道を通す**＝store を直に叩くと、選び直しの入口（印を落とす所）を通らず再現できない。
      tapAt(root, 1400, 900, 3000); // 空白を単押し＝抜ける
      const band = document.querySelector(".timeline-clip") as HTMLElement;
      fireEvent.click(band); // 帯から選び直しただけ
      expect((document.activeElement as HTMLElement)?.getAttribute("data-slot-field") ?? null).toBeNull();
      expect(document.querySelector(".timeline-drilled-part")).toBeNull(); // 印も戻らない
    });

    // ⚠️ **別の帯を挟んで戻っても、印は生き返らない**（レビュー 🔴）＝空白を押さずに帯だけで
    // 行き来したときが本番（選び直しの入口が印を落としていないと、ここで生き返る）。
    it("別の帯へ移ってから戻っても、前に入った所は生き返らない", () => {
      useProjectStore.setState({ templates: [drillTemplate], templateAssetSrcById: {} });
      open({
        tracks: [{ id: "track_001", kind: TRACK_KIND.visual }, { id: "track_002", kind: TRACK_KIND.visual }],
        assets: [{ assetId: "asset_001", assetType: "image", displayName: "写真A", filePath: "a.png" }],
        clips: [
          { id: "clip_001", kind: TIMELINE_CLIP_KIND.template, trackId: "track_001", startSec: 0, durationSec: 5,
            templateId: "tmpl_001", assetRefs: { left: "asset_001" } },
          { id: "clip_002", kind: TIMELINE_CLIP_KIND.text, trackId: "track_002", startSec: 0, durationSec: 5,
            x: 0, y: 0, w: 100, h: 50, text: "ほか" },
        ],
      });
      const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
      const root = container.querySelector(".free-layout-overlay") as HTMLElement;
      root.getBoundingClientRect = () =>
        ({ left: 0, top: 0, width: 1920, height: 1080, right: 1920, bottom: 1080, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
      Object.defineProperty(root, "clientWidth", { value: 1920, configurable: true });
      tapAt(root, 1400, 500, 1000);
      tapAt(root, 1400, 500, 1100);
      expect(document.querySelector(".timeline-drilled-part")).not.toBeNull();
      (document.activeElement as HTMLElement).blur();
      // 帯は**中身で見分ける**（並び順は列の順に依るので、位置で取ると取り違える）。
      const bandOf = (text: string): HTMLElement =>
        [...container.querySelectorAll(".timeline-clip")].find((b) => (b.textContent ?? "").includes(text)) as HTMLElement;
      fireEvent.click(bandOf("ほか")); // 別の帯へ
      fireEvent.click(bandOf("見た目パターン")); // 戻る（空白は押さない）
      // ⚠️ **戻れていることを確かめる**＝戻れていないと「印が出ない」が当たり前になり、空振りする。
      expect(useTimelineStore.getState().selectedClipIds).toEqual(["clip_001"]);
      expect(document.querySelector(".timeline-drilled-part")).toBeNull();
      expect((document.activeElement as HTMLElement)?.getAttribute("data-slot-field") ?? null).toBeNull();
    });

    // ⚠️ **当てるのは一度だけ**＝描き直しのたびに当てると、別の欄を触っている最中に手を奪われる。
    it("入った後に別の欄を触っていても、描き直しで手を奪わない", () => {
      const root = openTemplateClip();
      root.getBoundingClientRect = () =>
        ({ left: 0, top: 0, width: 1920, height: 1080, right: 1920, bottom: 1080, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
      Object.defineProperty(root, "clientWidth", { value: 1920, configurable: true });
      tapAt(root, 1400, 500, 1000);
      tapAt(root, 1400, 500, 1100);
      expect((document.activeElement as HTMLElement)?.getAttribute("data-slot-field")).toBe("right");
      const other = document.querySelector('[data-slot-field="left"]') as HTMLElement;
      other.focus(); // 利用者が別の欄へ移る
      // ⚠️ **文書が変わる操作**で描き直す＝再生位置だけでは効果の材料が変わらず、この穴を突けない。
      act(() => { useTimelineStore.getState().moveSelectedClip({ startSec: 1 }); });
      expect((document.activeElement as HTMLElement)?.getAttribute("data-slot-field")).toBe("left");
    });

    // ⚠️ **どの経路で選び直しても生き返らない**（PR #828 レビュー 🔴）＝以前は「選ぶ入口で印を落とす」
    // 形にしていたので、`Escape`・`Ctrl+A`・範囲選択・取り消しなど**入口を通らない選択更新**で
    // 「触れていないのに入っている表示」が戻った。選択の**同一性**で見る形にして1か所で担保する。
    it("Escape で外して Ctrl+A で選び直しても、入った印は戻らない", () => {
      const root = openTemplateClip();
      root.getBoundingClientRect = () =>
        ({ left: 0, top: 0, width: 1920, height: 1080, right: 1920, bottom: 1080, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
      Object.defineProperty(root, "clientWidth", { value: 1920, configurable: true });
      tapAt(root, 1400, 500, 1000);
      tapAt(root, 1400, 500, 1100);
      expect(document.querySelector(".timeline-drilled-part")).not.toBeNull();
      // ⚠️ **`act` で包む**＝ドリルインの欄は入った直後に自動でフォーカスされる（#832）ので、ここで
      // 外す `blur()` は「名乗り」（`useEscapeOwner(drilledFieldFocused)`）を降ろす副作用を持つ。
      // 素の DOM 呼び出しのままだと、その後始末（`owners -= 1`）が**まだ効いていない状態**で直後の
      // `Escape` が飛び、名乗りが残ったまま扱われて`clearSelection` が動かない（実測＝変異チェックで発覚）。
      act(() => { (document.activeElement as HTMLElement).blur(); });
      fireEvent.keyDown(window, { key: "Escape" });      // 選択を外す
      fireEvent.keyDown(window, { key: "a", ctrlKey: true }); // 全選択＝同じ部品が選ばれ直す
      expect(useTimelineStore.getState().selectedClipIds).toEqual(["clip_001"]); // 選び直せている
      expect(document.querySelector(".timeline-drilled-part")).toBeNull();       // それでも戻らない
    });

    // ⚠️ **欄がフォーカスされたまま消えても、名乗りは残らない**（#842・差分再監査の🔴）＝
    // `drilledFieldFocused` は欄の `onBlur` でしか戻らないが、**フォーカス中の欄が消えると `blur` は
    // 来ない**（React 19/jsdom で実測＝unmount 時の `onBlur` は 0回）。降ろし損ねると
    // `hasEscapeOwner()` が真のまま固着し、画面のキー操作が**丸ごと素通り**する。
    // ⚠️ **ここで `blur()` を呼ばない**のが要点＝上のテスト群は Escape の前に必ず明示的に `blur()` して
    // いたので、この経路だけ**素通りしていた**（監査で発覚）。実機の道（取り消しで欄ごと消える）を再現する。
    it("フォーカス中の欄が消えても、以後のキー操作が死なない", () => {
      const root = openTemplateClip();
      root.getBoundingClientRect = () =>
        ({ left: 0, top: 0, width: 1920, height: 1080, right: 1920, bottom: 1080, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
      Object.defineProperty(root, "clientWidth", { value: 1920, configurable: true });
      tapAt(root, 1400, 500, 1000);
      tapAt(root, 1400, 500, 1100);
      // 差し込み口の欄へ手が移っている（＝名乗っている状態）。
      expect((document.activeElement as HTMLElement)?.getAttribute("data-slot-field")).toBe("right");
      // **`blur()` を呼ばずに**欄を消す＝選択が外れてパネルごと消える（取り消しで踏む道と同じ）。
      act(() => { useTimelineStore.getState().clearSelection(); });
      expect(document.querySelector("[data-slot-field]")).toBeNull(); // 欄は消えた
      // 名乗りが残っていると、ここから先のキーが画面のハンドラで素通りする。
      act(() => { useTimelineStore.getState().selectClip("clip_001"); });
      fireEvent.keyDown(window, { key: "Escape" });
      expect(useTimelineStore.getState().selectedClipIds).toEqual([]); // Escape が効く＝名乗りは降りている
    });

    // ⚠️ **選択が変わらないまま欄だけ消えても、名乗りは残らない**（#842 レビュー 🟡）＝
    // 実機で踏む道は**欄の配置の組み替え**（ADR-0033＝「選んだ部品」欄の見出しを掴んで別の場所へ
    // 落とす）。掴む処理が `pointerdown` を `preventDefault` するので**手は欄に残ったまま**、欄は
    // 別の親の下へ移る＝unmount する。`selectedKey` は変わらないので選択の後始末は走らない。
    // ここでは同じ状態（フォーカス中の欄が、選択そのままで消える）を欄を閉じることで作る。
    it("選択そのままで欄が消えても、以後のキー操作が死なない", () => {
      const root = openTemplateClip();
      root.getBoundingClientRect = () =>
        ({ left: 0, top: 0, width: 1920, height: 1080, right: 1920, bottom: 1080, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
      Object.defineProperty(root, "clientWidth", { value: 1920, configurable: true });
      tapAt(root, 1400, 500, 1000);
      tapAt(root, 1400, 500, 1100);
      expect((document.activeElement as HTMLElement)?.getAttribute("data-slot-field")).toBe("right");
      const before = useTimelineStore.getState().selectedClipIds;
      // **`blur()` を呼ばず・選択も変えずに**欄を消す（「選んだ部品」欄を閉じる）。
      fireEvent.click(screen.getByLabelText("選んだ部品の欄の操作"));
      fireEvent.click(screen.getByRole("menuitem", { name: "この欄を閉じる" }));
      expect(document.querySelector("[data-slot-field]")).toBeNull();       // 欄は消えた
      expect(useTimelineStore.getState().selectedClipIds).toEqual(before);  // 選択は変わっていない
      // 名乗りが残っていると、ここから先のキーが画面のハンドラで素通りする。
      fireEvent.keyDown(window, { key: "Escape" });
      expect(useTimelineStore.getState().selectedClipIds).toEqual([]); // Escape が効く＝名乗りは降りている
    });

    // ⚠️ **文字の欄でも名乗りは降りる**（#847 レビュー 🔴）＝React は**後始末を返した ref を `null` で
    // 呼ばない**（`safelyDetachRef`）。文字の欄は #847 で `textGroup.ref`（後始末を返す）と合成したので、
    // 降ろす処理を後始末の中に入れないと**`null` が来ず名乗りが固着する**。
    // ⚠️ **差し込み口の無い見た目パターンで試す**のが要点＝差し込み口があると、同時に消える `<select>`
    // （素の ref＝`null` で呼ばれる）が代わりに降ろしてしまい、この不具合が**隠れる**（実際に隠れていた）。
    it("文字だけの見た目パターンでも、欄が消えれば名乗りは降りる", () => {
      useProjectStore.setState({
        templates: [{
          schemaVersion: "1.0", templateId: "tmpl_text", name: "文字だけ", category: "opening",
          aspectRatio: "16:9", canvas: { width: 1920, height: 1080 },
          layers: [{ id: "title", type: "text", textKey: "title", x: 0, y: 0, w: 1920, h: 1080, fontSize: 80 }],
        } as Template],
        templateAssetSrcById: {},
      });
      open({
        clips: [{
          id: "clip_001", kind: TIMELINE_CLIP_KIND.template, trackId: "track_001",
          startSec: 0, durationSec: 5, templateId: "tmpl_text", texts: { title: "みだし" },
        }],
      });
      const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
      const stage = container.querySelector(".preview-stage") as HTMLElement;
      stage.getBoundingClientRect = () =>
        ({ left: 0, top: 0, width: 1920, height: 1080, right: 1920, bottom: 1080, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
      const root = container.querySelector(".free-layout-overlay") as HTMLElement;
      root.getBoundingClientRect = stage.getBoundingClientRect;
      Object.defineProperty(root, "clientWidth", { value: 1920, configurable: true });
      tapAt(root, 900, 500, 1000);
      tapAt(root, 900, 500, 1100);
      // 文字の欄へ手が移っている（差し込み口は1つも無い）。
      expect((document.activeElement as HTMLElement)?.getAttribute("data-text-field")).toBe("title");
      expect(document.querySelector("[data-slot-field]")).toBeNull();
      // **`blur()` を呼ばずに**欄を消す。
      act(() => { useTimelineStore.getState().clearSelection(); });
      expect(document.querySelector("[data-text-field]")).toBeNull();
      act(() => { useTimelineStore.getState().selectClip("clip_001"); });
      fireEvent.keyDown(window, { key: "Escape" });
      expect(useTimelineStore.getState().selectedClipIds).toEqual([]); // Escape が効く＝名乗りは降りている
    });

    // ⚠️ **履歴のまとめも欄の寿命で閉じる**（#847）＝閉じ損ねると**自動保存が止まり、以後の編集が
    // 履歴に積まれない**。画面の配線（合成 ref）まで通して見る＝フックの単体テストでは、
    // `ref` を渡し忘れても赤くならない。
    it("欄が消えたら履歴のまとめも閉じる（自動保存が止まらない）", () => {
      useProjectStore.setState({
        templates: [{
          schemaVersion: "1.0", templateId: "tmpl_text", name: "文字だけ", category: "opening",
          aspectRatio: "16:9", canvas: { width: 1920, height: 1080 },
          layers: [{ id: "title", type: "text", textKey: "title", x: 0, y: 0, w: 1920, h: 1080, fontSize: 80 }],
        } as Template],
        templateAssetSrcById: {},
      });
      open({
        clips: [{
          id: "clip_001", kind: TIMELINE_CLIP_KIND.template, trackId: "track_001",
          startSec: 0, durationSec: 5, templateId: "tmpl_text", texts: { title: "みだし" },
        }],
      });
      const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
      const stage = container.querySelector(".preview-stage") as HTMLElement;
      stage.getBoundingClientRect = () =>
        ({ left: 0, top: 0, width: 1920, height: 1080, right: 1920, bottom: 1080, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
      const root = container.querySelector(".free-layout-overlay") as HTMLElement;
      root.getBoundingClientRect = stage.getBoundingClientRect;
      Object.defineProperty(root, "clientWidth", { value: 1920, configurable: true });
      tapAt(root, 900, 500, 1000);
      tapAt(root, 900, 500, 1100);
      // 入った時点で文字の欄へ手が移る＝まとめが開く。
      expect((document.activeElement as HTMLElement)?.getAttribute("data-text-field")).toBe("title");
      expect(useTimelineStore.getState()._historyGroupDepth).toBeGreaterThan(0);
      // ⚠️ **選択を変えて消してはいけない**＝選択が変わる道は `resetHistoryGroup()` が畳むので、
      // 配線（`ref`）を外しても緑のまま通る（実測で空振りを確認）。**選択そのままで欄だけ消す**
      // ＝欄を閉じる（実機の道は ADR-0033 の配置の組み替え）＝ここだけが ref の後始末に懸かる。
      const before = useTimelineStore.getState().selectedClipIds;
      fireEvent.click(screen.getByLabelText("選んだ部品の欄の操作"));
      fireEvent.click(screen.getByRole("menuitem", { name: "この欄を閉じる" }));
      expect(document.querySelector("[data-text-field]")).toBeNull();
      expect(useTimelineStore.getState().selectedClipIds).toEqual(before); // 選択は変えていない
      expect(useTimelineStore.getState()._historyGroupDepth).toBe(0); // 閉じている＝自動保存が止まらない
    });

    // ⚠️ **取り消しなど store 側の選択更新でも戻らない**（入口を数え上げない形の要）。
    it("取り消しで選択が入れ替わっても、入った印は戻らない", () => {
      const root = openTemplateClip();
      root.getBoundingClientRect = () =>
        ({ left: 0, top: 0, width: 1920, height: 1080, right: 1920, bottom: 1080, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
      Object.defineProperty(root, "clientWidth", { value: 1920, configurable: true });
      tapAt(root, 1400, 500, 1000);
      tapAt(root, 1400, 500, 1100);
      (document.activeElement as HTMLElement).blur();
      act(() => { useTimelineStore.getState().selectClips(["clip_001"]); }); // store 側の選択更新
      expect(useTimelineStore.getState().selectedClipIds).toEqual(["clip_001"]);
      expect(document.querySelector(".timeline-drilled-part")).toBeNull();
    });

    it("単押しでは入らない（従来どおり選択が解ける）", () => {
      const root = openTemplateClip();
      root.getBoundingClientRect = () =>
        ({ left: 0, top: 0, width: 1920, height: 1080, right: 1920, bottom: 1080, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
      Object.defineProperty(root, "clientWidth", { value: 1920, configurable: true });
      useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
      tapAt(root, 1400, 500, 1000);
      expect(useTimelineStore.getState().selectedClipIds).toEqual([]);
    });

    // ⚠️ **同じ所へ入り直すと手が移らなかった**（#832 レビュー 🟡）＝「当てるのは一度だけ」を
    // 当て先の**文字列キー**（`clipId/layerId`）で覚えていたので、抜けて同じ所へ入り直すとキーが
    // 前回と同じになり、手が移らなかった（同じ操作の結果が2通り）。`drilled` **そのもの（同一性）**を
    // 覚える形に直したので、入り直しは必ず手が移る。
    it("同じ差し込み口へ入り直すと、もう一度手が移る", () => {
      const root = openTemplateClip();
      root.getBoundingClientRect = () =>
        ({ left: 0, top: 0, width: 1920, height: 1080, right: 1920, bottom: 1080, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
      Object.defineProperty(root, "clientWidth", { value: 1920, configurable: true });
      tapAt(root, 1400, 500, 1000);
      tapAt(root, 1400, 500, 1100);
      expect((document.activeElement as HTMLElement)?.getAttribute("data-slot-field")).toBe("right");
      (document.activeElement as HTMLElement).blur();
      tapAt(root, 1400, 900, 3000); // 空白を単押し＝抜ける
      expect(useTimelineStore.getState().selectedClipIds).toEqual([]);
      // 同じ帯・同じ差し込み口へもう一度入り直す。
      tapAt(root, 1400, 500, 5000);
      tapAt(root, 1400, 500, 5100);
      expect((document.activeElement as HTMLElement)?.getAttribute("data-slot-field")).toBe("right"); // 手が移る
    });
  });

  // ⚠️ **Escape の抜け方が層で割れていた**（#832・06_UI_SPEC.md「抜け方はどれでも抜ける」）＝
  // 文字の層（`<input>`）は入力欄扱いで共有の window ハンドラに素通りされ、何も起きなかった。
  // 差し込み口（`<select>`）は素通りされない代わりに、1段目（欄を抜ける）を持たず即座に選択解除まで
  // 進んでいた。両方とも「1回目＝欄を抜ける・2回目＝選択解除」に揃える。
  describe("ドリルインした欄の Escape（#832）", () => {
    const drillTemplate: Template = {
      schemaVersion: "1.0", templateId: "tmpl_001", name: "枠ふたつ", category: "opening",
      aspectRatio: "16:9", canvas: { width: 1920, height: 1080 },
      layers: [
        { id: "left", type: "slot", x: 0, y: 0, w: 960, h: 1080 },
        { id: "right", type: "slot", x: 960, y: 0, w: 960, h: 1080 },
        { id: "title", type: "text", textKey: "title", x: 0, y: 900, w: 1920, h: 120, fontSize: 60 },
      ],
    };
    const openDrillable = (): HTMLElement => {
      useProjectStore.setState({ templates: [drillTemplate], templateAssetSrcById: {} });
      open({
        assets: [{ assetId: "asset_001", assetType: "image", displayName: "写真A", filePath: "a.png" }],
        clips: [{
          id: "clip_001", kind: TIMELINE_CLIP_KIND.template, trackId: "track_001",
          startSec: 0, durationSec: 5, templateId: "tmpl_001", assetRefs: { left: "asset_001" }, texts: { title: "みだし" },
        }],
      });
      const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
      const stage = container.querySelector(".preview-stage") as HTMLElement;
      stage.getBoundingClientRect = () =>
        ({ left: 0, top: 0, width: 1920, height: 1080, right: 1920, bottom: 1080, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
      const root = container.querySelector(".free-layout-overlay") as HTMLElement;
      root.getBoundingClientRect = stage.getBoundingClientRect;
      Object.defineProperty(root, "clientWidth", { value: 1920, configurable: true });
      return root;
    };
    // ⚠️ **離しも送る**＝1回目のタップは（まだ二度押しと分からないので）空白クリックとして扱われ、
    // 範囲選択（マーキー）を始めた状態のまま止まる（`pointerDown` だけだと「掴んでいる最中」を抜けない）。
    // 実機のクリックには必ず離しが来る＝離しが来ないと**掴んでいる最中の Escape の受け持ち**
    // （`FreeLayoutOverlay` 側・#752）が居座り、この節が試したい「欄の Escape」より先に消費してしまう。
    const tapAt = (root: HTMLElement, x: number, y: number, t: number): void => {
      fireEvent.pointerDown(root, { button: 0, pointerId: 1, clientX: x, clientY: y, timeStamp: t });
      fireEvent.pointerUp(root, { button: 0, pointerId: 1, clientX: x, clientY: y, timeStamp: t });
    };

    it("文字の欄：1回目の Escape は欄を抜けるだけ・2回目で選択が解ける", () => {
      const root = openDrillable();
      tapAt(root, 900, 950, 1000);
      tapAt(root, 900, 950, 1100);
      expect((document.activeElement as HTMLElement)?.getAttribute("data-text-field")).toBe("title");
      fireEvent.keyDown(document.activeElement!, { key: "Escape" });
      expect((document.activeElement as HTMLElement)?.getAttribute("data-text-field") ?? null).toBeNull(); // 抜けた
      expect(useTimelineStore.getState().selectedClipIds).toEqual(["clip_001"]); // まだ選択は残る
      fireEvent.keyDown(window, { key: "Escape" }); // 2回目
      expect(useTimelineStore.getState().selectedClipIds).toEqual([]); // 選択が解ける
    });

    it("差し込み口の欄：1回目の Escape は欄を抜けるだけ・2回目で選択が解ける", () => {
      const root = openDrillable();
      tapAt(root, 1400, 500, 1000);
      tapAt(root, 1400, 500, 1100);
      expect((document.activeElement as HTMLElement)?.getAttribute("data-slot-field")).toBe("right");
      fireEvent.keyDown(document.activeElement!, { key: "Escape" });
      expect((document.activeElement as HTMLElement)?.getAttribute("data-slot-field") ?? null).toBeNull(); // 抜けた
      expect(useTimelineStore.getState().selectedClipIds).toEqual(["clip_001"]); // まだ選択は残る（以前は即座に解けていた）
      fireEvent.keyDown(window, { key: "Escape" }); // 2回目
      expect(useTimelineStore.getState().selectedClipIds).toEqual([]);
    });
  });

  // ⚠️ **入れないときに飲み込んでいた**（#832）＝当て先が押せない／DOM に無いとき、`onDrillInAt` は
  // `true` を返したまま印だけ出て手は移らず、単押しの解除も止まっていた。押せないときは理由を出して
  // 従来の解除へ戻す／開けるものは開いて実際に入れる、のどちらかにする。
  describe("入れないときは飲み込まない（#832）", () => {
    const drillTemplate: Template = {
      schemaVersion: "1.0", templateId: "tmpl_001", name: "枠ひとつ", category: "opening",
      aspectRatio: "16:9", canvas: { width: 1920, height: 1080 },
      layers: [{ id: "main", type: "slot", x: 0, y: 0, w: 1920, h: 1080 }],
    };
    const openDrillable = (over: Partial<TimelineProject> = {}): HTMLElement => {
      useProjectStore.setState({ templates: [drillTemplate], templateAssetSrcById: {} });
      open({
        assets: [{ assetId: "asset_001", assetType: "image", displayName: "写真A", filePath: "a.png" }],
        clips: [{
          id: "clip_001", kind: TIMELINE_CLIP_KIND.template, trackId: "track_001",
          startSec: 0, durationSec: 5, templateId: "tmpl_001", assetRefs: { main: "asset_001" },
        }],
        ...over,
      });
      const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
      const stage = container.querySelector(".preview-stage") as HTMLElement;
      stage.getBoundingClientRect = () =>
        ({ left: 0, top: 0, width: 1920, height: 1080, right: 1920, bottom: 1080, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
      const root = container.querySelector(".free-layout-overlay") as HTMLElement;
      root.getBoundingClientRect = stage.getBoundingClientRect;
      Object.defineProperty(root, "clientWidth", { value: 1920, configurable: true });
      return root;
    };
    const tapAt = (root: HTMLElement, x: number, y: number, t: number): void => {
      fireEvent.pointerDown(root, { button: 0, pointerId: 1, clientX: x, clientY: y, timeStamp: t });
      fireEvent.pointerUp(root, { button: 0, pointerId: 1, clientX: x, clientY: y, timeStamp: t });
    };

    // ⚠️ **理由は store の `editBlocked` では持てない**（#832 レビューで発覚）＝`onDrillInAt` が
    // `false` を返すと `FreeLayoutOverlay` は続けて `onSelect(null)`（`clearSelection`）を呼び、
    // それが `CLEARED_NOTICES` で `editBlocked` ごと**同じ押下の中で**消してしまう。画面ローカルの
    // 知らせ（`drillBlockedNotice`）が実際に**描画されて残っている**ことまで見る。
    it("固定した列の部品では入らず、理由を出して従来どおり選択が解ける", () => {
      const root = openDrillable({ tracks: [{ id: "track_001", kind: TRACK_KIND.visual, locked: true }] });
      useTimelineStore.setState({ selectedClipIds: [] });
      tapAt(root, 900, 500, 1000);
      tapAt(root, 900, 500, 1100);
      expect(useTimelineStore.getState().selectedClipIds).toEqual([]); // 選ばれない＝従来の解除
      expect(screen.getByText(lockedTrackMessage("content"))).toBeInTheDocument(); // 理由を出す
      expect(document.querySelector(".timeline-drilled-part")).toBeNull(); // 印も出ない（入っていない）
    });

    // ⚠️ **書き出し中は試さない**＝`FreeLayoutOverlay`（ドリルインの入口そのもの）は `!exporting` でしか
    // 描かれない（すぐ上の画面の描画条件）ので、書き出し中に二度押しでここへ来ること自体が無い。
    // `onDrillInAt` 側にも `exporting` の関門は持たせていない（無い状況を確かめない＝実行できない
    // 経路のテストを書かない）。

    // ⚠️ **知らせは次の本当の選択変化まで残る**（#832）＝立てた回の「従来の解除」（selectedKey は
    // 変わらず空のまま）では消えない。あとで別の部品を選ぶ、という**新しい**変化でだけ消える。
    it("理由の知らせは、別の部品を選ぶまで残る", () => {
      const root = openDrillable({ tracks: [{ id: "track_001", kind: TRACK_KIND.visual, locked: true }] });
      useTimelineStore.setState({ selectedClipIds: [] });
      tapAt(root, 900, 500, 1000);
      tapAt(root, 900, 500, 1100);
      const msg = lockedTrackMessage("content");
      expect(screen.getByText(msg)).toBeInTheDocument();
      act(() => { useTimelineStore.getState().selectClips(["clip_001"]); }); // 別の（新しい）選択
      expect(screen.queryByText(msg)).toBeNull(); // 消える
    });

    it("「選んだ部品」欄を閉じていても、二度押しで開いて入れる（節を開いても無理なときだけ戻す）", () => {
      const root = openDrillable();
      fireEvent.click(screen.getByLabelText("選んだ部品の欄の操作"));
      fireEvent.click(screen.getByRole("menuitem", { name: "この欄を閉じる" }));
      expect(screen.queryByRole("heading", { name: "選んだ部品" })).not.toBeInTheDocument(); // 前提＝閉じている
      tapAt(root, 900, 500, 1000);
      tapAt(root, 900, 500, 1100);
      expect(screen.getByRole("heading", { name: "選んだ部品" })).toBeInTheDocument(); // 開けるものは開く
      expect(useTimelineStore.getState().selectedClipIds).toEqual(["clip_001"]); // 飲み込まず、実際に入れた
      expect((document.activeElement as HTMLElement)?.getAttribute("data-slot-field")).toBe("main");
    });

    it("「この見た目パターンの中身」の節を畳んでいても、二度押しで開いて入れる", async () => {
      const root = openDrillable();
      // ⚠️ **先に選んで節を出してから畳む**＝節は「選んだ部品」の中にあるので、何も選んでいない
      // 状態では存在しない（畳む操作そのものができない）。**`act` で包む**＝描画後の store 直更新を
      // 次のクエリの前に必ず反映させる（他の直書きは `render` より前に置いて避けている・ここは
      // 先に節を畳む必要があるので描画後にせざるを得ない）。
      act(() => { useTimelineStore.setState({ selectedClipIds: ["clip_001"] }); });
      // 節を畳む（画面ローカルの記憶＝#687）。
      fireEvent.click(screen.getByText("この見た目パターンの中身"));
      expect(screen.getByText("この見た目パターンの中身").closest("details")).toHaveProperty("open", false); // 前提＝畳んでいる
      // ⚠️ **記憶への保存を待つ**＝`<details>` の `toggle` は非同期に発火する（`CollapsibleSection.test.tsx`
      // と同じ流儀）。待たずに進むと「畳んだ」がまだ記憶に書かれておらず、末尾の
      // 「ドリルインしても記憶は書き換わらない（畳んだまま）」の確認が**そもそも畳んだ記憶が
      // 無かったから変わらなかっただけ**という空振りになる。ここで実際に書かれたことを確かめてから進む。
      await waitFor(() => expect(localStorage.getItem("timeline.sectionOpen")).not.toBeNull());
      expect(JSON.parse(localStorage.getItem("timeline.sectionOpen")!)).toMatchObject({ templateContent: false });
      tapAt(root, 900, 500, 1000);
      tapAt(root, 900, 500, 1100);
      // ⚠️ **要素を取り直す**＝ドリルインの1回目のタップは「選択を一度解く」ぶんも兼ねる（#818）ので、
      // 「選んだ部品」の中身（この節を含む）は一度アンマウントされ、選び直しで作り直される。
      // 畳む前に控えた DOM 参照は**別の要素**になっている＝取り直さないと古い参照の状態を見てしまう。
      expect(screen.getByText("この見た目パターンの中身").closest("details")).toHaveProperty("open", true); // 開けるものは開く
      expect((document.activeElement as HTMLElement)?.getAttribute("data-slot-field")).toBe("main");
      // ⚠️ **記憶は上書きしない**＝`forceOpen` は一時的に開くだけ（`CollapsibleSection.tsx` の JSDoc）。
      // 畳んだという利用者の設定はそのまま残る＝次にこの節が新しく作られる回（別の動画を開く等）は
      // 畳んだまま出る。ドリルインのたびに「開いている」が既定へ書き換わってしまうことがない。
      expect(JSON.parse(localStorage.getItem("timeline.sectionOpen")!)).toMatchObject({ templateContent: false });
    });
  });

  it("見た目パターンの部品では**次の行動を出す**（欄が消えるだけにしない）", () => {
    // ⚠️ **見た目パターンを登録してから見る**（#812）＝以前はここが空のまま `/中身をバラす/` を
    // 見ており、**未解決なのに案内だけ出る**壊れた挙動をテストが固定していた。
    useProjectStore.setState({ templates: [hintTemplate] });
    openTemplateClip();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.queryByLabelText("横位置")).toBeNull();
    expect(screen.getByText(/位置や大きさは「中身をバラす」で変えます/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "中身をバラす" })).toBeInTheDocument(); // 名指し先が実在する
  });

  // ⚠️ **二度押しできること自体の発見手段が無かった**（#832・06_UI_SPEC.md ①）＝印は入った**後**にしか
  // 出ないので、印だけでは「二度押しできること」自体は見つからない。常時見える一文に足す。
  it("差し込み口・文字がある見た目パターンでは、二度押しで直せる旨を先に知らせる", () => {
    const drillable: Template = { ...hintTemplate, layers: [...hintTemplate.layers, { id: "main", type: "slot", x: 0, y: 0, w: 1920, h: 1080 }] };
    useProjectStore.setState({ templates: [drillable] });
    openTemplateClip();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getByText(/中の写真・文字は二度押しでも直せます/)).toBeInTheDocument();
  });

  // ⚠️ **実行できない行動を名指ししない**（§2-5）＝入れる差し込み口・文字が1つも無い見た目パターンで
  // 「二度押しで直せる」と言うと、押しても何も起きない（`drillTargets` が空＝そもそも入れる層が無い）。
  // ⚠️ **`background` 層は差し込み口に数える**（`templateSlotIds`＝写真を選び直せる）ので、
  // 「入れる中身が無い」を作るには**それも持たない**層（立ち絵）だけの見た目パターンを使う。
  it("差し込み口も文字も無い見た目パターンでは、二度押しの案内を出さない", () => {
    const noDrillable: Template = {
      ...hintTemplate,
      layers: [{ id: "yuko", type: "character", x: 0, y: 0, w: 400, h: 800 }],
    };
    useProjectStore.setState({ templates: [noDrillable] });
    openTemplateClip();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getByText(/位置や大きさは「中身をバラす」で変えます/)).toBeInTheDocument(); // 前提＝一文自体は出る
    expect(screen.queryByText(/二度押しでも直せます/)).toBeNull();
  });

  // ⚠️ **無いボタンを名指ししない**（#812・§2-5）＝見た目パターンが見つからないと「中身をバラす」は
  // 描かれないので、案内だけ残ると**どこにも無いボタンを探させる**うえ、「見つかりません」と食い違う
  // 2つの案内が並ぶ。自作の見た目パターンを消すと踏む（タイムライン文書の参照は修復されない）。
  it("見た目パターンが見つからないときは、無いボタンを名指ししない", () => {
    openTemplateClip(); // 見た目パターンは登録しない＝未解決
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "中身をバラす" })).toBeNull(); // 前提＝ボタンは無い
    expect(screen.queryByText(/中身をバラす/)).toBeNull();                     // その名前を出さない
    expect(screen.getByText(/この部品の見た目パターンが見つかりません/)).toBeInTheDocument();
  });

  it("箱を持てない部品には出さない（音・読み上げ・見た目パターン）", () => {
    open({
      tracks: [{ id: "track_001", kind: TRACK_KIND.visual }, { id: "track_002", kind: TRACK_KIND.audio }],
      clips: [{ id: "clip_009", kind: TIMELINE_CLIP_KIND.audio, trackId: "track_002", startSec: 0, durationSec: 3, assetId: "asset_001" }],
      assets: [{ assetId: "asset_001", assetType: "bgm", displayName: "曲", filePath: "assets/asset_001.mp3" }],
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_009"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.queryByLabelText("横位置")).toBeNull();
  });

  /** その帯が居る列の名前（列の並びは「手前が上」なので添字で決め打ちしない）。 */
  const lanesLabel = (el: Element): string | undefined =>
    el.closest(".timeline-track")?.parentElement?.querySelector(".timeline-row-label span")?.textContent ?? undefined;

  // キャンバスで掴んで動かす（#685 後半・ADR-0034 決定6/7/15/17）。
  // ⚠️ **場面編集と同じ部品**（`FreeLayoutOverlay`）を流用する＝2つの画面で操作感を割らない。
  const canvasEls = (container: HTMLElement) => {
    const wrap = container.querySelector(".preview-stage-wrap") as HTMLElement;
    const stage = wrap?.querySelector(".preview-stage");
    const ov = wrap && wrap.lastElementChild !== stage ? (wrap.lastElementChild as HTMLElement) : null;
    return { wrap, ov };
  };

  it("キャンバスに操作レイヤを重ねる（箱を持てる部品だけ）", () => {
    open({
      tracks: [{ id: "track_001", kind: TRACK_KIND.visual }, { id: "track_002", kind: TRACK_KIND.audio }],
      assets: [{ assetId: "asset_001", assetType: "bgm", displayName: "曲", filePath: "assets/asset_001.mp3" }],
      clips: [
        { id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 3, x: 0, y: 0, w: 100, h: 50, text: "あ" },
        // 見た目パターンは**枠そのもの**なので渡さない（渡すと全面を覆って下を掴めない・決定8）。
        { id: "clip_002", kind: TIMELINE_CLIP_KIND.template, trackId: "track_001", startSec: 5, durationSec: 3, templateId: "tmpl_001" },
        // 音は画面に出ない。
        { id: "clip_003", kind: TIMELINE_CLIP_KIND.audio, trackId: "track_002", startSec: 0, durationSec: 3, assetId: "asset_001" },
      ],
    });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const { ov } = canvasEls(container);
    expect(ov).not.toBeNull();
    expect(ov!.children.length).toBe(1); // 文字だけ
  });

  it("**いま出ていない部品**は触れない（時間の外のものを掴ませない）", () => {
    open({
      clips: [{ id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 10, durationSec: 3, x: 0, y: 0, w: 100, h: 50, text: "あ" }],
    });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    // 再生位置は 0＝この部品は出ていない。
    expect(canvasEls(container).ov).toBeNull();
  });

  it("再生中は操作レイヤを出さない（動く絵と設計位置のハンドルがずれる）", () => {
    two();
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(canvasEls(container).ov).not.toBeNull();
    act(() => { useTimelineStore.setState({ isPlaying: true }); });
    expect(canvasEls(container).ov).toBeNull();
  });

  it("書き出し中も出さない（入らない編集を受け付けない）", () => {
    two();
    useTimelineStore.setState({ exportRun: { phase: "rendering", percent: 0, message: null, cancelling: false } });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(canvasEls(container).ov).toBeNull();
  });

  it("固定した列の部品は**掴めない**（帯と同じ＝場所で挙動を変えない）", () => {
    two({ tracks: [{ id: "track_001", kind: TRACK_KIND.visual, locked: true }] });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const el = canvasEls(container).ov!.children[0] as HTMLElement;
    // ロックされた要素は `cursor: default`（掴めそうに見せない）。
    expect(el.style.cursor).toBe("default");
  });

  it("**重なりは描く順で拾う**（奥の部品が掴まれない・#746-5）", () => {
    // ⚠️ 描く重ね順は**列の並び**だが、操作レイヤが文書の並びで積むと、後ろに書かれた奥の部品が
    // 手前に来る＝重なった所で**奥が掴まれる**（右クリックの「削除」も奥に当たる）。
    open({
      // 列の並び＝奥（track_001）→ 手前（track_002）。文書の並びは**わざと逆**にする。
      tracks: [{ id: "track_001", kind: TRACK_KIND.visual }, { id: "track_002", kind: TRACK_KIND.visual }],
      clips: [
        { id: "clip_front", kind: TIMELINE_CLIP_KIND.text, trackId: "track_002", startSec: 0, durationSec: 3, x: 0, y: 0, w: 100, h: 50, text: "手前" },
        { id: "clip_back", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 3, x: 0, y: 0, w: 100, h: 50, text: "奥" },
      ],
    });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const boxes = [...canvasEls(container).ov!.children] as HTMLElement[];
    // 当たりは**配列の後ろが勝つ**（DOM の後ろほど手前）＝最後が手前の列の部品であること。
    fireEvent.pointerDown(boxes[boxes.length - 1], { button: 0, pointerId: 1, clientX: 10, clientY: 10 });
    expect(useTimelineStore.getState().selectedClipIds).toEqual(["clip_front"]);
  });

  it("**動きが効いている間は、枠を描かれている場所に出す**（#746-4）", () => {
    open({
      clips: [{ id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 4, x: 0, y: 0, w: 100, h: 50, text: "あ" }],
      animations: [{ id: "anim_001", targetId: "clip_001", keyframes: [{ timeSec: 0, x: 400 }, { timeSec: 4, x: 400 }] }],
    });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const box = canvasEls(container).ov!.children[0] as HTMLElement;
    // 素の箱は x=0。動きで +400 されているので、枠もそこへ（1920 幅の 20.83%）。
    expect(box.style.left).toBe(`${(400 / 1920) * 100}%`);
  });

  // ⚠️ **ADR-0054 段階1**（利用者判断 2026-10-05）＝以前は「動きが効いている間は掴ませない」だった。
  it("動きが効いていても掴める＝掴んだ量だけ**動き全体**がずれる（描かれている場所を素の箱へ書かない）・一言添える", () => {
    open({
      clips: [{ id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 4, x: 0, y: 0, w: 100, h: 50, text: "あ" }],
      animations: [{ id: "anim_001", targetId: "clip_001", keyframes: [{ timeSec: 0, x: 400 }, { timeSec: 4, x: 400 }] }],
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const ov = canvasEls(container).ov!;
    // ⚠️ 枠の実寸を与える（jsdom は幅を持たない＝縮尺 0 で**そもそも動かない**＝空振りのテストになる）。
    Object.defineProperty(ov, "clientWidth", { value: 960, configurable: true });
    ov.getBoundingClientRect = () => ({ left: 0, top: 0, right: 960, bottom: 540, width: 960, height: 540, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    const el = ov.children[0] as HTMLElement;
    expect(el.style.cursor).toBe("move");
    expect(screen.queryByText(/仕上がり確認の上では動かせません/)).toBeNull();
    // 業界の既定と違うことを一言。位置の動きなので点が描かれる＝一言は段階2のもの（ADR-0054 決定4）。
    expect(screen.getByText(MOTION_PATH_NOTE)).toBeInTheDocument();
    expect(screen.queryByText(ANIMATED_DRAG_NOTE)).toBeNull();
    fireEvent.pointerDown(el, { button: 0, pointerId: 1, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(ov, { buttons: 1, pointerId: 1, clientX: 40, clientY: 0 });
    fireEvent.pointerUp(ov, { pointerId: 1, clientX: 40, clientY: 0 });
    // 画面で 40px（=1920 幅の 80）動かした＝素の箱も 80 だけ（描かれている 400+80 を書かない）。
    const c = useTimelineStore.getState().doc!.clips[0];
    expect(c.x).toBeCloseTo(80, 3);
    // 動き（ずれ +400）はそのまま＝始まりも止まる位置も同じだけずれる。
    expect(useTimelineStore.getState().doc!.animations![0].keyframes.map((k) => k.x)).toEqual([400, 400]);
  });

  it("**固定を除外して動かしたら一言知らせる（ただし一度だけ）**（#773・決定 (a)）", () => {
    // ⚠️ 黙って一部だけ動かさない（ADR-0026④）。ただし**見れば分かる**ので、動かすたびには出さない
    //（利用者決定）。選んだ組み合わせが変わったら出し直す。
    open({
      tracks: [{ id: "track_001", kind: TRACK_KIND.visual, locked: true }, { id: "track_002", kind: TRACK_KIND.visual }],
      clips: [
        { id: "clip_locked", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 4, x: 0, y: 0, w: 100, h: 50, text: "固定" },
        { id: "clip_free", kind: TIMELINE_CLIP_KIND.text, trackId: "track_002", startSec: 0, durationSec: 4, x: 0, y: 200, w: 100, h: 50, text: "自由" },
      ],
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_locked", "clip_free"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.keyDown(window, { key: "ArrowRight" });
    // 固定は動かず、残りは動く（＝空間の移動は「除外」・全か無かにしない）。
    const clips = () => useTimelineStore.getState().doc!.clips;
    expect(clips().find((c) => c.id === "clip_locked")!.x).toBe(0);
    expect(clips().find((c) => c.id === "clip_free")!.x).toBe(1);
    expect(screen.getByText(/固定された列の部品1個は動かしていません/)).toBeInTheDocument();
  });

  // ⚠️ #788-1：キャンバスで掴めない理由は**固定した列だけではない**（動きが効いている／グループの変形）。
  // 以前は除外の一言が常に「固定を外してください」で、**動き起因では従っても直らない**案内だった。
  it("動きのある部品の大きさを変えかけて Escape でやめても、素の箱は元のまま（描かれている場所を書き戻さない）", () => {
    open({
      clips: [{ id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 4, x: 0, y: 0, w: 100, h: 50, text: "あ" }],
      animations: [{ id: "anim_001", targetId: "clip_001", keyframes: [{ timeSec: 0, x: 400 }, { timeSec: 4, x: 400 }] }],
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const ov = canvasEls(container).ov!;
    Object.defineProperty(ov, "clientWidth", { value: 960, configurable: true });
    ov.getBoundingClientRect = () => ({ left: 0, top: 0, right: 960, bottom: 540, width: 960, height: 540, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    const handle = (ov.children[0] as HTMLElement).children[0] as HTMLElement; // 大きさを変える取っ手
    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(ov, { buttons: 1, pointerId: 1, clientX: 30, clientY: 20 });
    fireEvent.keyDown(window, { key: "Escape" });
    const c = useTimelineStore.getState().doc!.clips[0];
    expect(c.x, "描かれている場所（400）を素の箱へ書き戻した").toBeCloseTo(0, 3);
    expect(c.w).toBeCloseTo(100, 3);
  });

  it("動きのある部品も、まとめて動かすと一緒に動く（理由の知らせは出さない・ADR-0054 段階1）", () => {
    open({
      tracks: [{ id: "track_001", kind: TRACK_KIND.visual }, { id: "track_002", kind: TRACK_KIND.visual }],
      clips: [
        { id: "clip_anim", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 4, x: 0, y: 0, w: 100, h: 50, text: "動く" },
        { id: "clip_free", kind: TIMELINE_CLIP_KIND.text, trackId: "track_002", startSec: 0, durationSec: 4, x: 0, y: 200, w: 100, h: 50, text: "自由" },
      ],
      animations: [{ id: "anim_001", targetId: "clip_anim", keyframes: [{ timeSec: 0, x: 400 }, { timeSec: 4, x: 400 }] }],
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_anim", "clip_free"] });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const ov = canvasEls(container).ov!;
    // ⚠️ 枠の実寸を与える（jsdom は幅を持たない＝縮尺 0 で**そもそも動かない**＝空振りのテストになる）。
    Object.defineProperty(ov, "clientWidth", { value: 960, configurable: true });
    ov.getBoundingClientRect = () => ({ left: 0, top: 0, right: 960, bottom: 540, width: 960, height: 540, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    fireEvent.pointerDown(ov.children[1] as HTMLElement, { button: 0, clientX: 0, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(ov, { buttons: 1, pointerId: 1, clientX: 40, clientY: 0 });
    fireEvent.pointerUp(ov, { pointerId: 1, clientX: 40, clientY: 0 });
    expect(screen.queryByText(/動きが効いている部品/)).toBeNull();
    const clips = useTimelineStore.getState().doc!.clips;
    // どちらも素の箱が同じだけ（80）動く＝動きのある方に描かれている場所（400+）を書かない。
    expect(clips.find((c) => c.id === "clip_free")!.x).toBeCloseTo(80, 3);
    expect(clips.find((c) => c.id === "clip_anim")!.x).toBeCloseTo(80, 3);
  });

  // ⚠️ **グループの変形が理由のときも知らせる**（レビュー指摘＝一括経路で `group` を通すテストが無かった）。
  // 理由の並びからこの値が落ちると `join` が空文字になり、**知らせ自体が描かれない**まま一部だけ動く。
  it("グループの変形が理由のときも、その言い方で知らせる（#788-1）", () => {
    open({
      tracks: [{ id: "track_001", kind: TRACK_KIND.visual }, { id: "track_002", kind: TRACK_KIND.visual }],
      groups: [{ id: "group_001", members: ["clip_grp"], transform: { x: 300, y: 0, scale: 1, rotation: 0 } }],
      clips: [
        { id: "clip_grp", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 4, x: 0, y: 0, w: 100, h: 50, text: "まとまり" },
        { id: "clip_free", kind: TIMELINE_CLIP_KIND.text, trackId: "track_002", startSec: 0, durationSec: 4, x: 0, y: 200, w: 100, h: 50, text: "自由" },
      ],
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_grp", "clip_free"] });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const els = canvasEls(container).ov!.children;
    fireEvent.pointerDown(els[1] as HTMLElement, { button: 0, clientX: 10, clientY: 10, pointerId: 1 });
    expect(screen.getByText(/グループの変形が効いている部品1個は動かしていません/)).toBeInTheDocument();
  });

  // ⚠️ **固定した列は「動き」より先**（レビュー指摘）＝両方が理由になりうるとき、動きを先に言うと
  // 「下の数値／矢印キーで」と案内するが、その部品は数値の欄も矢印も列の固定で塞がっている。
  it("固定した列の上に動きがあるときは、固定の方を知らせる（塞がった行き先を示さない）", () => {
    open({
      tracks: [{ id: "track_001", kind: TRACK_KIND.visual, locked: true }, { id: "track_002", kind: TRACK_KIND.visual }],
      clips: [
        { id: "clip_anim", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 4, x: 0, y: 0, w: 100, h: 50, text: "動く" },
        { id: "clip_free", kind: TIMELINE_CLIP_KIND.text, trackId: "track_002", startSec: 0, durationSec: 4, x: 0, y: 200, w: 100, h: 50, text: "自由" },
      ],
      animations: [{ id: "anim_001", targetId: "clip_anim", keyframes: [{ timeSec: 0, x: 400 }, { timeSec: 4, x: 400 }] }],
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_anim", "clip_free"] });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const els = canvasEls(container).ov!.children;
    fireEvent.pointerDown(els[1] as HTMLElement, { button: 0, clientX: 10, clientY: 10, pointerId: 1 });
    expect(screen.getByText(/固定された列の部品1個は動かしていません/)).toBeInTheDocument();
    expect(screen.queryByText(/動きが効いている部品/)).toBeNull();
  });

  it("**同じ組み合わせでは二度と出さない**（見れば分かることを繰り返さない・#773・利用者決定）", () => {
    // ⚠️ 「一度だけ」が効いているかは、**知らせが消えたあとに同じ組み合わせで動かす**と分かる
    //（1本の知らせを出し直すだけでは、毎回出す形と見た目が変わらない＝そこを見ても確かめられない）。
    open({
      tracks: [{ id: "track_001", kind: TRACK_KIND.visual, locked: true }, { id: "track_002", kind: TRACK_KIND.visual }],
      clips: [
        { id: "clip_locked", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 4, x: 0, y: 0, w: 100, h: 50, text: "固定" },
        { id: "clip_free", kind: TIMELINE_CLIP_KIND.text, trackId: "track_002", startSec: 0, durationSec: 4, x: 0, y: 200, w: 100, h: 50, text: "自由" },
      ],
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_locked", "clip_free"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(screen.getByText(/動かしていません/)).toBeInTheDocument();
    // 選び直すと知らせは消える（前の選択の返事に見せない）。
    act(() => { useTimelineStore.setState({ selectedClipIds: ["clip_free"] }); });
    expect(screen.queryByText(/動かしていません/)).toBeNull();
    // **同じ組み合わせへ戻して動かしても、もう出さない**。
    act(() => { useTimelineStore.setState({ selectedClipIds: ["clip_locked", "clip_free"] }); });
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(screen.queryByText(/動かしていません/)).toBeNull();
    expect(useTimelineStore.getState().doc!.clips.find((c) => c.id === "clip_free")!.x).toBe(2); // 動きは続く
  });

  it("帯の一括移動は**全か無かで断る**＋語彙は「選んだ中に固定がある」（#773-3）", () => {
    // ⚠️ 時間の移動は一部だけ動くと間隔・並びが壊れる＝断るのが親切（決定 (a)）。
    // 断り文が `locked`（「**この**列は…」）だと、まとめて動かしている場面で指す先が外れる。
    open({
      tracks: [{ id: "track_001", kind: TRACK_KIND.visual, locked: true }, { id: "track_002", kind: TRACK_KIND.visual }],
      clips: [
        { id: "clip_locked", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 3, x: 0, y: 0, w: 10, h: 10, text: "固定" },
        { id: "clip_free", kind: TIMELINE_CLIP_KIND.text, trackId: "track_002", startSec: 0, durationSec: 3, x: 0, y: 0, w: 10, h: 10, text: "自由" },
      ],
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_locked", "clip_free"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    act(() => { useTimelineStore.getState().moveClipsBy([{ id: "clip_free", startSec: 5 }, { id: "clip_locked", startSec: 5 }]); });
    expect(useTimelineStore.getState().doc!.clips.every((c) => c.startSec === 0)).toBe(true); // 全か無か
    expect(useTimelineStore.getState().editBlocked?.reason).toBe("TIMELINE_EDIT_LOCKED_SELECTION");
  });

  it("グループの変形で動いているときは、**動きとは別の言い方**で断る（#746 レビュー）", () => {
    // ⚠️ 「動き」の欄では外せないものを「動きで調整して」と案内すると、言われたとおりにしても直らない。
    open({
      groups: [{ id: "group_001", members: ["clip_001"], transform: { x: 300, y: 0, scale: 1, rotation: 0 } }],
      clips: [{ id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 4, x: 0, y: 0, w: 100, h: 50, text: "あ" }],
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getByText(/グループの変形が効いている部品は/)).toBeInTheDocument();
    expect(screen.queryByText(/「動き」で調整してください/)).toBeNull();
  });

  it("動きが無ければ従来どおり掴める（#746-4）", () => {
    two();
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect((canvasEls(container).ov!.children[0] as HTMLElement).style.cursor).toBe("move");
  });

  it("**右クリックで黙らない**（帯と同じ「複製／削除」を出す・#746-1／語は #763-6 で統一）", () => {
    two();
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const el = canvasEls(container).ov!.children[0] as HTMLElement;
    fireEvent.contextMenu(el);
    // ⚠️ **メニューの項目として**引く＝語を統一した（#763-6）ので、欄のボタンとも同じ文字になる。
    // ⚠️ **共有の語（`uiLabels`）で引く**＝キャンバスと帯が同じ出どころを見ていることをテストでも辿る
    //（リテラルを書き写すと、片方が独自の語へ戻っても気づけない）。
    expect(screen.getByRole("menuitem", { name: DUPLICATE_LABEL })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: DELETE_LABEL })).toBeInTheDocument();
  });

  it("キャンバスのメニューから消せる（帯と同じ入口を通る・#746-1）", () => {
    two();
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const el = canvasEls(container).ov!.children[0] as HTMLElement;
    fireEvent.contextMenu(el); // 右クリックでその部品を選ぶ
    fireEvent.click(screen.getByRole("menuitem", { name: "削除" }));
    expect(useTimelineStore.getState().doc!.clips.map((c) => c.id)).toEqual(["clip_002"]);
  });

  it("押せない項目は**消さずに理由を出す**（場所によって在ったり無かったり、を作らない・#746-1）", () => {
    two({ tracks: [{ id: "track_001", kind: TRACK_KIND.visual, locked: true }] });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const el = canvasEls(container).ov!.children[0] as HTMLElement;
    fireEvent.contextMenu(el);
    const del = screen.getByRole("menuitem", { name: "削除" }) as HTMLButtonElement;
    expect(del).toBeDisabled();
    expect(del.getAttribute("title")).toContain("固定");
  });

  it("**文字は二度押しで直せる**（他社の型・#746-2）", () => {
    two();
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const el = canvasEls(container).ov!.children[0] as HTMLElement;
    fireEvent.doubleClick(el);
    const ta = within(canvasEls(container).ov!).getByRole("textbox") as HTMLTextAreaElement;
    expect(ta.value).toBe("あ"); // いまの文言が入っている（描画と同じ変換を通っている）
    fireEvent.change(ta, { target: { value: "あい" } });
    expect(useTimelineStore.getState().doc!.clips[0].text).toBe("あい");
  });

  it("**打っている間の取り消しは1回ぶん**（履歴を文字入力で食い潰さない・#746 レビュー）", () => {
    two();
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const before = useTimelineStore.getState().history.past.length;
    const el = canvasEls(container).ov!.children[0] as HTMLElement;
    fireEvent.doubleClick(el);
    const ta = within(canvasEls(container).ov!).getByRole("textbox") as HTMLTextAreaElement;
    for (const v of ["あい", "あいう", "あいうえ"]) fireEvent.change(ta, { target: { value: v } });
    fireEvent.blur(ta);
    expect(useTimelineStore.getState().doc!.clips[0].text).toBe("あいうえ");
    expect(useTimelineStore.getState().history.past.length).toBe(before + 1);
  });

  it("固定した列の文字は**編集欄に入らない**（打てない欄を開かない・#746 レビュー）", () => {
    two({ tracks: [{ id: "track_001", kind: TRACK_KIND.visual, locked: true }] });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.doubleClick(canvasEls(container).ov!.children[0] as HTMLElement);
    expect(within(canvasEls(container).ov!).queryByRole("textbox")).toBeNull();
  });

  it("**まとめて選んでいるとキャンバスの「複製」も押せない**（押しても無反応を作らない・#746 レビュー）", () => {
    two();
    useTimelineStore.setState({ selectedClipIds: ["clip_001", "clip_002"] });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.contextMenu(canvasEls(container).ov!.children[0] as HTMLElement);
    // ⚠️ **メニューの項目を名指しする**（#1256 b5）＝帯の操作の行にも「複製」が並ぶようになった。
    const dup = screen.getByRole("menuitem", { name: "複製" }) as HTMLButtonElement;
    expect(dup).toBeDisabled();
    expect(dup.getAttribute("title")).toContain("1つだけ選ぶと使えます");
  });

  it("**音の列に載った映像部品は触れない**（描かれないのに掴める、を作らない・#746 レビュー）", () => {
    open({
      tracks: [{ id: "track_001", kind: TRACK_KIND.visual }, { id: "track_002", kind: TRACK_KIND.audio }],
      clips: [
        { id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_002", startSec: 0, durationSec: 3, x: 0, y: 0, w: 100, h: 50, text: "あ" },
        { id: "clip_002", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 3, x: 0, y: 60, w: 100, h: 50, text: "い" },
      ],
    });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(canvasEls(container).ov!.children.length).toBe(1); // 映像の列のものだけ
  });

  it("直している間は**下の絵を伏せる**（二重に見えない・#746-2）", () => {
    two();
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const stage = () => container.querySelector(".preview-stage") as HTMLElement;
    expect(stage().innerHTML).toContain("あ");
    fireEvent.doubleClick(canvasEls(container).ov!.children[0] as HTMLElement);
    expect(stage().innerHTML).not.toContain(">あ<");
  });

  it("**隠したまとまりの部品は触れない**（描かれていないものの枠を出さない・#746-6）", () => {
    // ⚠️ 部品そのものの `hidden` は共通部品の側でも伏せられるが、**隠したまとまり**は
    // こちら（`isOnCanvas`）でしか見ていない＝ここが抜けると枠だけ出て掴める。
    open({
      groups: [{ id: "group_001", members: ["clip_001"], transform: { x: 0, y: 0, scale: 1, rotation: 0 }, hidden: true }],
      clips: [
        { id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 3, x: 0, y: 0, w: 100, h: 50, text: "あ" },
        { id: "clip_002", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 3, x: 0, y: 60, w: 100, h: 50, text: "い" },
      ],
    });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(canvasEls(container).ov!.children.length).toBe(1); // 隠したまとまりのものは出さない
  });

  it("隠した部品は**矢印でも動かない**（出ていないものは操作の対象にしない・#746-6）", () => {
    open({
      clips: [{ id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 3, x: 0, y: 0, w: 100, h: 50, text: "あ", hidden: true }],
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(useTimelineStore.getState().doc!.clips[0].x).toBe(0); // 動かさない
    expect(useTimelineStore.getState().playheadSec).toBeGreaterThan(0); // 再生位置は送る
  });

  it("重ね順の項目はキャンバスのメニューに出さない（列の並びだけ・決定17）", () => {
    two();
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const el = canvasEls(container).ov!.children[0] as HTMLElement;
    fireEvent.contextMenu(el);
    expect(screen.queryByText("前面")).toBeNull();
    expect(screen.queryByText("背面")).toBeNull();
  });

  it("縦型では**比を動画に合わせる**（枠と絵がずれない）", () => {
    // ⚠️ CSS の既定は 16:9 固定。縦型で letterbox が入ると、上に重ねる操作レイヤと実際に描かれている
    // 矩形がずれ、**掴む位置も動かす量も約3倍ずれる**（縦型は新規作成から到達できる）。
    open({ videoSettings: { aspectRatio: "9:16", fps: 30, targetDurationSec: 60, maxDurationSec: 600 } });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect((container.querySelector(".preview-stage") as HTMLElement).style.aspectRatio).toBe("1080 / 1920");
  });

  it("**別の列へ運べる**（#686 段階4）", () => {
    two({ tracks: [{ id: "track_001", kind: TRACK_KIND.visual }, { id: "track_005", kind: TRACK_KIND.visual }] });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const lanes = [...container.querySelectorAll(".timeline-lane")] as HTMLElement[];
    // 「置く」と同じ規則（`laneAt`）で列を採るので、列の矩形を持たせる。
    lanes.forEach((el, i) => {
      el.getBoundingClientRect = () => ({ left: 0, top: i * 40, right: 900, bottom: i * 40 + 40, width: 900, height: 40, x: 0, y: i * 40, toJSON: () => ({}) });
    });
    // 表示は**手前が上**＝配列を逆順に描くので、下の行が `track_001`（掴む相手が居る列）。
    const from = lanes.findIndex((el) => el.querySelector(".timeline-clip"));
    const to = from === 0 ? 1 : 0;
    pointerDownAt(band("あ"), 1, { clientX: 0, clientY: from * 40 + 20 });
    fireEvent.pointerMove(window, { pointerId: 1, buttons: 1, clientX: 36 * 8, clientY: to * 40 + 20 });
    // ⚠️ **運んでいる間から運び先の列に描く**＝指と一緒に列をまたぐ（元の列に置いたまま
    // 行き先だけ光らせる、にしない）。ここを見ないと「離すまで動かない」実装でも通る。
    // ⚠️ 列には他の帯も居るので、**掴んだ帯そのもの**がどちらに居るかで見る。
    expect(lanes[to].contains(band("あ"))).toBe(true);
    expect(lanes[from].contains(band("あ"))).toBe(false);
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 36 * 8, clientY: to * 40 + 20 });
    const moved = useTimelineStore.getState().doc!.clips[0];
    expect(moved.trackId).not.toBe("track_001"); // 列が変わった
    expect(moved.startSec).toBeCloseTo(8, 5); // 時刻も同時に動く
  });

  it("列の外で離したら**掴んだ列のまま**（勝手に別の列へ飛ばさない）", () => {
    two({ tracks: [{ id: "track_001", kind: TRACK_KIND.visual }, { id: "track_005", kind: TRACK_KIND.visual }] });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    // 列の矩形を与えない＝どの列にも当たらない（欄の余白の上で離した状態）。
    void container;
    drag(band("あ"), 36 * 8);
    const moved = useTimelineStore.getState().doc!.clips[0];
    expect(moved.trackId).toBe("track_001");
    expect(moved.startSec).toBeCloseTo(8, 5); // 時刻だけ動く
  });

  it("連動している字幕は**横に動かず列だけ運べる**（指のぶれで通ったり断られたりしない）", () => {
    open({
      tracks: [
        { id: "track_001", kind: TRACK_KIND.visual },
        { id: "track_005", kind: TRACK_KIND.visual },
        { id: "track_002", kind: TRACK_KIND.audio },
      ],
      clips: [
        { id: "clip_001", kind: TIMELINE_CLIP_KIND.voice, trackId: "track_002", startSec: 0, durationSec: 3, voice: { text: "あ", status: "none" } },
        { id: "clip_002", kind: TIMELINE_CLIP_KIND.subtitle, trackId: "track_001", startSec: 0, durationSec: 3, x: 0, y: 0, w: 10, h: 10, voiceClipId: "clip_001" },
      ],
    });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const lanes = [...container.querySelectorAll(".timeline-lane")] as HTMLElement[];
    lanes.forEach((el, i) => {
      el.getBoundingClientRect = () => ({ left: 0, top: i * 40, right: 900, bottom: i * 40 + 40, width: 900, height: 40, x: 0, y: i * 40, toJSON: () => ({}) });
    });
    const sub = [...container.querySelectorAll(".timeline-clip")].find((el) => lanesLabel(el) !== "音1") as HTMLElement;
    const from = lanes.findIndex((el) => el.contains(sub));
    // ⚠️ 「字幕を置ける列」を選ぶ＝音の列を選ぶと種別違いで断られ、見たいことが見えない。
    const to = lanes.findIndex((el) => el.parentElement?.textContent?.includes("映像2"));
    // **横にもぶらして**運ぶ（実際の指はまっすぐ縦には動かない）。
    pointerDownAt(sub, 1, { clientX: 0, clientY: from * 40 + 20 });
    fireEvent.pointerMove(window, { pointerId: 1, buttons: 1, clientX: 36 * 3, clientY: to * 40 + 20 });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 36 * 3, clientY: to * 40 + 20 });
    const moved = useTimelineStore.getState().doc!.clips.find((c) => c.id === "clip_002")!;
    expect(moved.startSec).toBe(0); // 時間は読み上げが決める＝動かない
    expect(useTimelineStore.getState().editBlocked).toBeNull(); // 断られない
  });

  it("捨てる印は**次に押し始めたときに落とす**（次の解除を食わない）", () => {
    // ⚠️ 列をまたいで離すと帯の DOM は親ごと作り直され、**その帯の `onClick` は走らない**＝
    // 印を消費する相手が居ない。残ると次の「何もない所を押して選択を解く」1回を飲み込む。
    // ⚠️ **時間では落とさない**（#833-1）＝`Escape` は指を**離す前**に走るので、時間で落とすと
    // 実機では「やめたのに離した位置で上書きされる」（下の中止のテスト）。代わりに**次の
    // `pointerdown`** で落とす＝実際の解除は必ず押し始めから始まるので、持ち越さないのは同じだけ守れる。
    two();
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    drag(band("あ"), 36 * 8);
    expect(useTimelineStore.getState().selectedClipIds).toEqual(["clip_001"]);
    const lane = container.querySelector(".timeline-lane") as HTMLElement;
    // 実機の解除は `pointerdown`→`click` の順に来る（`click` だけは来ない）＝押し始めで印が落ちる。
    fireEvent.pointerDown(lane, { button: 0, pointerId: 2, clientX: 0, clientY: 0 });
    fireEvent.click(lane);
    expect(useTimelineStore.getState().selectedClipIds).toEqual([]); // 解除が効く
  });

  /** 吸着を見るための枠（jsdom は実寸を持たないので、見えている時間帯が出るようにする）。 */
  const withVisibleWidth = (container: HTMLElement) => {
    const scroll = container.querySelector(".timeline-scroll") as HTMLElement;
    Object.defineProperty(scroll, "clientWidth", { value: 900, configurable: true });
    return scroll;
  };

  it("**他の帯の端へ吸着する**（#686 段階4・決定12）", () => {
    two(); // clip_001=[0,3) / clip_002=[5,8)
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    withVisibleWidth(container);
    // clip_001（長さ3）の**終わり**が clip_002 の始まり（5秒）へ寄る＝開始は 2秒ちょうどになる。
    drag(band("あ"), 36 * 2 - 3);
    expect(useTimelineStore.getState().doc!.clips[0].startSec).toBeCloseTo(2, 5);
  });

  it("`Ctrl` を押している間は吸着しない（あと少しだけずらせる）", () => {
    two();
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    withVisibleWidth(container);
    // ⚠️ **吸着してもしなくても置ける所**で見る（重なる所だと「断られて動かない」と区別できない）。
    // clip_001 は長さ3。終わりが clip_002 の始まり（5秒）へ寄る手前＝開始 2秒のわずか手前。
    const px = 36 * 2 - 3;
    pointerDownAt(band("あ"), 1, { clientX: 0, clientY: 0 });
    fireEvent.pointerMove(window, { pointerId: 1, buttons: 1, clientX: px, clientY: 0, ctrlKey: true });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: px, clientY: 0, ctrlKey: true });
    expect(useTimelineStore.getState().doc!.clips[0].startSec).toBeCloseTo(px / 36, 5); // 吸わない
  });

  // #1032：**切替を切ると、押しっぱなしにしなくても吸着しない**。
  // ⚠️ これが無いと**画面が切替を渡し忘れても緑**になる（変異チェックで生き残った）。
  it("吸着の切替を切ると、`Ctrl` なしでも吸着しない（#1032）", () => {
    two();
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    withVisibleWidth(container);
    fireEvent.click(screen.getByRole("switch", { name: "吸着" })); // 切る
    const px = 36 * 2 - 3;
    drag(band("あ"), px);
    expect(useTimelineStore.getState().doc!.clips[0].startSec).toBeCloseTo(px / 36, 5); // 吸わない
  });

  it("吸着の切替を戻すと、また寄る（切ったまま固めない）", () => {
    two();
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    withVisibleWidth(container);
    const sw = screen.getByRole("switch", { name: "吸着" });
    fireEvent.click(sw); // 切る
    fireEvent.click(sw); // 戻す
    drag(band("あ"), 36 * 2 - 3);
    expect(useTimelineStore.getState().doc!.clips[0].startSec).toBeCloseTo(2, 5);
  });

  it("`Ctrl` を先に離しても**見えていた位置**に落ちる（離す順で結果を変えない）", () => {
    // ⚠️ 離した瞬間に計算し直すと、点線が出ていなかったのに落ちた瞬間に寄る（逆順なら寄らない）。
    two();
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    withVisibleWidth(container);
    const px = 36 * 2 - 3;
    pointerDownAt(band("あ"), 1, { clientX: 0, clientY: 0 });
    fireEvent.pointerMove(window, { pointerId: 1, buttons: 1, clientX: px, clientY: 0, ctrlKey: true }); // 吸着なし
    fireEvent.pointerUp(window, { pointerId: 1, clientX: px, clientY: 0 }); // ここで Ctrl を離している
    expect(useTimelineStore.getState().doc!.clips[0].startSec).toBeCloseTo(px / 36, 5); // 見えていた位置のまま
  });

  // #771(a)：**新しく置くときも同じ吸着**。帯を運ぶときだけ吸着があって、置くときは生値のままだと、
  // 同じ「時間を決める操作」で作法が割れる（置いた直後に必ず微妙にずれる）。
  const dropOnLane = (container: HTMLElement, px: number, opts?: { ctrl?: boolean }) => {
    // ⚠️ **列を名指しで選ぶ**＝行は「手前が上」で並ぶので、先頭の `.timeline-lane` は音の列のことがある
    //（種別が合わずに断られて、置かれない＝何を見ているか分からないテストになる）。
    const row = trackRowLabel("映像1").closest(".timeline-row") ?? container;
    const lane = row.querySelector(".timeline-lane") as HTMLElement;
    lane.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 2000, height: 40, right: 2000, bottom: 40, x: 0, y: 0, toJSON: () => undefined }) as DOMRect;
    Object.defineProperty(lane, "clientWidth", { value: 2000, configurable: true });
    const place = document.querySelector('[data-panel-id="place"]') as HTMLElement;
    const btn = within(place).getByRole("button", { name: "文字を置く" });
    const ctrl = opts?.ctrl ?? false;
    pointerDownAt(btn, 1, { clientX: 0, clientY: 0 });
    fireEvent.pointerMove(window, { pointerId: 1, buttons: 1, clientX: px, clientY: 20, ctrlKey: ctrl });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: px, clientY: 20, ctrlKey: ctrl });
  };

  it("**置くときも他の帯の端へ吸着する**（帯を運ぶときと同じ作法・#771(a)）", () => {
    two(); // clip_001=[0,3) / clip_002=[5,8)
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    withVisibleWidth(container);
    // ⚠️ **吸着してもしなくても置ける所**で見る（重なる所だと「断られて置かれない」と区別できない）
    // ＝clip_002 の終わり（8秒）の**わずか後ろ**（手前だと重なって断られる）。8秒ちょうどへ寄る。
    dropOnLane(container, 36 * 8 + 3);
    const placed = lastClip();
    expect(placed.startSec).toBeCloseTo(8, 5);
  });

  it("置くときも `Ctrl` で吸着を切れる（帯を運ぶときと同じ）", () => {
    two();
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    withVisibleWidth(container);
    const px = 36 * 8 + 3;
    dropOnLane(container, px, { ctrl: true });
    const placed = lastClip();
    expect(placed.startSec).toBeCloseTo(px / 36, 5); // 吸わない
  });

  it("吸着した先に**縦の点線**を出す（なぜ止まったかを見せる）", () => {
    two();
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    withVisibleWidth(container);
    expect(container.querySelector(".timeline-snapline")).toBeNull(); // 掴む前は出さない
    drag(band("あ"), 36 * 2 - 3, { drop: false });
    const line = container.querySelector(".timeline-snapline") as HTMLElement;
    expect(line).not.toBeNull();
    expect(line.style.left).toBe(`calc(var(--timeline-label-w) + ${36 * 5}px)`); // 寄せ先＝clip_002 の始まり
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 36 * 2 - 3, clientY: 0 });
    expect(container.querySelector(".timeline-snapline")).toBeNull(); // 離したら消す
  });

  it("**再生位置で分ける**（ボタン・`Ctrl+K`・メニューが同じ入口）", () => {
    two();
    useTimelineStore.setState({ selectedClipIds: ["clip_001"], playheadSec: 2 });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "ここで分ける" }));
    const clips = useTimelineStore.getState().doc!.clips;
    expect(clips[0]).toMatchObject({ id: "clip_001", startSec: 0, durationSec: 2 }); // 前半は同じ id
    expect(clips[1]).toMatchObject({ startSec: 2, durationSec: 1 });
    // 分けたら**後半を選び直す**（続きを触りたい手が自然に繋がる）。
    expect(useTimelineStore.getState().selectedClipIds).toEqual([clips[1].id]);
  });

  it("`Ctrl+K` でも分けられる（キーだけ・ボタンだけの操作を作らない）", () => {
    two();
    useTimelineStore.setState({ selectedClipIds: ["clip_001"], playheadSec: 2 });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(useTimelineStore.getState().doc!.clips).toHaveLength(3);
  });

  it("分けられないときは**押す前に**塞ぎ、キーでは理由を出す", () => {
    two();
    useTimelineStore.setState({ selectedClipIds: ["clip_001"], playheadSec: 0 }); // 端＝片方が潰れる
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getByRole("button", { name: "ここで分ける" })).toBeDisabled();
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(useTimelineStore.getState().doc!.clips).toHaveLength(2); // 増えない
    expect(useTimelineStore.getState().editBlocked?.reason).toBe(EDIT_BLOCKED.splitOutside); // 理由は出す
  });

  // ⚠️ **差し込み口の動画でも「押す前に」塞ぐ**（PR #825 レビュー 🟡）＝事前の判定に見た目パターンを
  // 渡さないと、差し込み口の置き場所が1件も解けず「素材を使い切った先」の判定が**必ず偽**になる。
  // 押せてしまい、押した先だけで断られる＝この節の趣旨（押せるのに何も起きない、を作らない）と逆。
  it("差し込み口の動画を使い切った先でも、押す前に塞ぐ", () => {
    const oneSlot: Template = {
      schemaVersion: "1.0", templateId: "tmpl_001", name: "ひとつ枠", category: "opening",
      aspectRatio: "16:9", canvas: { width: 1920, height: 1080 },
      layers: [{ id: "main", type: "slot", x: 0, y: 0, w: 1920, h: 1080 }],
    };
    useProjectStore.setState({ templates: [oneSlot], templateAssetSrcById: {} });
    open({
      assets: [{ assetId: "asset_v", assetType: "video", displayName: "動画", filePath: "v.mp4" }],
      clips: [{
        id: "clip_001", kind: TIMELINE_CLIP_KIND.template, trackId: "track_001",
        startSec: 0, durationSec: 10, templateId: "tmpl_001", assetRefs: { main: "asset_v" },
        slotClips: { main: { startSec: 0, endSec: 3 } },
      }],
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_001"], playheadSec: 5 }); // 使い切った先
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getByRole("button", { name: "ここで分ける" })).toBeDisabled();
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(useTimelineStore.getState().doc!.clips).toHaveLength(1); // 増えない
    expect(useTimelineStore.getState().editBlocked?.reason).toBe(EDIT_BLOCKED.splitPastSource);
  });

  it("差し込み口の動画でも、素材が残っている位置なら分けられる（過剰に塞がない）", () => {
    const oneSlot: Template = {
      schemaVersion: "1.0", templateId: "tmpl_001", name: "ひとつ枠", category: "opening",
      aspectRatio: "16:9", canvas: { width: 1920, height: 1080 },
      layers: [{ id: "main", type: "slot", x: 0, y: 0, w: 1920, h: 1080 }],
    };
    useProjectStore.setState({ templates: [oneSlot], templateAssetSrcById: {} });
    open({
      assets: [{ assetId: "asset_v", assetType: "video", displayName: "動画", filePath: "v.mp4" }],
      clips: [{
        id: "clip_001", kind: TIMELINE_CLIP_KIND.template, trackId: "track_001",
        startSec: 0, durationSec: 10, templateId: "tmpl_001", assetRefs: { main: "asset_v" },
        slotClips: { main: { startSec: 0, endSec: 3 } },
      }],
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_001"], playheadSec: 2 });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getByRole("button", { name: "ここで分ける" })).toBeEnabled();
  });

  it("再生中は分けられない（位置を使う操作＝結果が毎回変わる・決定21）", () => {
    two();
    useTimelineStore.setState({ selectedClipIds: ["clip_001"], playheadSec: 2, isPlaying: true });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getByRole("button", { name: "ここで分ける" })).toBeDisabled();
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(useTimelineStore.getState().doc!.clips).toHaveLength(2);
    expect(useTimelineStore.getState().editBlocked?.reason).toBe(EDIT_BLOCKED.playing);
    // ⚠️ **右クリックの道も塞ぐ**（#750 レビュー）＝ここだけ素通しだと、走っている再生位置で
    // 分割が確定する。3つの入口が同じ材料を見ていることを、実際にメニューを開いて確かめる。
    fireEvent.contextMenu(container.querySelector(".timeline-clip") as HTMLElement);
    const item = screen.getByRole("menuitem", { name: "ここで分ける" });
    expect(item).toBeDisabled();
  });

  it("書き出し中は `Ctrl+K` でも分けない（存在しない部品を選んだ状態にしない）", () => {
    two();
    useTimelineStore.setState({
      selectedClipIds: ["clip_001"], playheadSec: 2,
      exportRun: { phase: "rendering", percent: 0, message: null, cancelling: false },
    });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(useTimelineStore.getState().doc!.clips).toHaveLength(2); // 増えない
    // ⚠️ 断られたのに選択だけ差し替わると、**存在しない id** が残って以後の操作が
    // 「見つかりません」（嘘の理由）で空振りする。
    expect(useTimelineStore.getState().selectedClipIds).toEqual(["clip_001"]);
    expect(useTimelineStore.getState().editBlocked?.reason).toBe(EDIT_BLOCKED.exporting);
  });

  it("Escape でやめたら元のまま（掴んだ位置に置かない）", () => {
    two();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    drag(band("あ"), 36 * 8, { escape: true });
    expect(useTimelineStore.getState().doc!.clips[0].startSec).toBe(0);
    expect(band("あ").className).not.toContain("timeline-clip--dragging");
  });

  it("掴んだ帯が選ばれる（「選んだ部品」の欄と一致する）", () => {
    two();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    drag(band("い"), 36 * 2);
    expect(useTimelineStore.getState().selectedClipIds).toEqual(["clip_002"]);
  });

  it("右の端を掴むと長さが変わる（始まりは動かない）", () => {
    two();
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const handle = container.querySelector(".timeline-clip-handle--right") as HTMLElement;
    drag(handle, -36); // 1秒ぶん縮める（3秒 → 2秒）
    expect(useTimelineStore.getState().doc!.clips[0]).toMatchObject({ startSec: 0 });
    expect(useTimelineStore.getState().doc!.clips[0].durationSec).toBeCloseTo(2, 5);
  });

  it("端の取っ手は**選んだ帯にだけ**出す（隣の当たり判定を常時食わない）", () => {
    two();
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(container.querySelectorAll(".timeline-clip-handle")).toHaveLength(0);
    act(() => { useTimelineStore.setState({ selectedClipIds: ["clip_001"] }); });
    expect(container.querySelectorAll(".timeline-clip-handle")).toHaveLength(2);
  });

  it("固定した列の帯は掴めない（掴めそうに見せない）", () => {
    two({ tracks: [{ id: "track_001", kind: TRACK_KIND.visual, locked: true }, { id: "track_002", kind: TRACK_KIND.audio }] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(band("あ").className).not.toContain("timeline-clip--editable");
    drag(band("あ"), 36 * 8);
    expect(useTimelineStore.getState().doc!.clips[0].startSec).toBe(0);
    // 掴ませないので、断り文も出ない（掴めそうに見せて後から断る、を作らない）。
    expect(useTimelineStore.getState().editBlocked).toBeNull();
    // ⚠️ **掴む処理そのものが始まらない**＝掴めば選ばれて見た目も動く（掴めそうに見せてしまう）。
    expect(useTimelineStore.getState().selectedClipIds).toEqual([]);
  });
});
