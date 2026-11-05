// @vitest-environment jsdom
// タイムライン編集プロジェクトの画面（ADR-0032・#629 骨格）＝キャンバス×履歴・BGM・長さをそろえる・近道キーほか。
// ⚠️ **1つのファイルで約10分かかっていたので分けた**（負荷・耐久の点検 2026-10-22）＝ほかと一緒に走ると時間切れで
//   たまに落ちていた。共有の下ごしらえ（文書・開き方・テスト間の後片づけ）は `src/test/timelineScreenKit.tsx` に1つ。
import { describe, expect, it, vi } from "vitest";
import { act, render, screen, fireEvent, within } from "@testing-library/react";
import { NUDGE_GROUP_IDLE_MS } from "../hooks/keyboardShortcut";
import { TimelineProjectScreen } from "./TimelineProjectScreen";
import { NOTICE_ZONE_CLASS } from "../components/NoticeZone";
import { useTimelineStore } from "../store/timelineStore";
import { BGM_CATALOG } from "../../domain/bgm/bgmCatalog";
import { DUCK_MERGED_MESSAGE, clipOutsidePlayheadMessage, editBlockedMessage } from "../uiLabels";
import { useProjectStore } from "../store/projectStore";
import { NARRATION_STATUS, TIMELINE_CLIP_KIND, TRACK_KIND } from "../../domain/enums";
import { EDIT_BLOCKED } from "../../domain/timeline/edit";
import type { TimelineProject } from "../../domain/timeline/types";
import type { Template } from "../../domain/template/types";
import { doc, open, trackRowLabel, resetTimelineScreenBetweenTests } from "../../test/timelineScreenKit";

resetTimelineScreenBetweenTests();


// キャンバスで掴む × 履歴（#813・ADR-0020「1操作1履歴」）。
// ⚠️ **未選択の部品を掴む経路が抜けていた**＝同じ pointerdown が「選ぶ」→「まとめを開く」の順に走り、
// 選択が変わった後始末が**開いた直後のまとめを畳んで**いた。以後は動かすたびに1件ずつ積まれ、
// 60回で上限50に達して**そのドラッグより前の編集が取り消せなくなる**（「バラす」のように取り消しで
// しか戻せない操作が押し出される）。帯のドラッグしか見ていなかったので、ここで固定する。
describe("TimelineProjectScreen: キャンバスで掴む × 履歴（#813）", () => {
  const CANVAS_W = 1920;
  const twoTexts = (): void => {
    open({
      clips: [
        { id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 5,
          x: 100, y: 100, w: 400, h: 90, text: "ひとつめ" },
        { id: "clip_002", kind: TIMELINE_CLIP_KIND.text, trackId: "track_002", startSec: 0, durationSec: 5,
          x: 100, y: 300, w: 400, h: 90, text: "ふたつめ" },
      ],
      tracks: [{ id: "track_001", kind: TRACK_KIND.visual }, { id: "track_002", kind: TRACK_KIND.visual }],
    });
  };
  /** キャンバス上のその部品の枠（`FreeLayoutOverlay` が `data-free-id` を付ける）。 */
  const boxOf = (container: HTMLElement, id: string): HTMLElement => {
    const el = container.querySelector(`[data-free-id="${id}"]`);
    if (!el) throw new Error(`キャンバスに ${id} が無い`);
    // jsdom は実レイアウトを持たず clientWidth=0（→ 縮尺 0）。canvas と等倍にして動かす。
    const root = el.parentElement as HTMLElement;
    Object.defineProperty(root, "clientWidth", { value: CANVAS_W, configurable: true });
    return el as HTMLElement;
  };
  /** 掴んで3回動かして離す（1ジェスチャ）。 */
  const dragBox = (el: HTMLElement): void => {
    fireEvent.pointerDown(el, { button: 0, pointerId: 1, clientX: 0, clientY: 0 });
    for (const d of [10, 20, 30]) fireEvent.pointerMove(el, { buttons: 1, pointerId: 1, clientX: d, clientY: d });
    fireEvent.pointerUp(window, { pointerId: 1 });
  };

  it("まだ選んでいない部品を掴んで動かしても、履歴は1つ", () => {
    twoTexts();
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const before = useTimelineStore.getState().history.past.length;
    dragBox(boxOf(container, "clip_001")); // 選ばずにいきなり掴む
    expect(useTimelineStore.getState().doc?.clips[0].x).toBe(130); // 動いている（前提の確認）
    expect(useTimelineStore.getState().history.past.length).toBe(before + 1);
    expect(useTimelineStore.getState()._historyGroupDepth).toBe(0); // 開きっぱなしにしない
  });

  it("選んである部品を掴んだときも1つ（経路で挙動を割らない）", () => {
    twoTexts();
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const before = useTimelineStore.getState().history.past.length;
    dragBox(boxOf(container, "clip_001"));
    expect(useTimelineStore.getState().doc?.clips[0].x).toBe(130);
    expect(useTimelineStore.getState().history.past.length).toBe(before + 1);
    expect(useTimelineStore.getState()._historyGroupDepth).toBe(0);
  });

  // ⚠️ **畳んでから開き直す**（素通りではない）＝文字欄はフォーカス中に欄が消えると `blur` が来ず、
  // まとめが開いたまま残る（#708）。掴んだときに素通りすると、その古いまとめが閉じられないまま残り、
  // 以後の編集がひとつながりになる（取り消しが効かない範囲が広がる）。
  it("開きっぱなしの古いまとめが残っていても、掴んだぶんは1つで、古いほうも片づく", () => {
    twoTexts();
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    act(() => { useTimelineStore.getState().beginHistoryGroup(); }); // 閉じられなかったまとめ
    const before = useTimelineStore.getState().history.past.length;
    dragBox(boxOf(container, "clip_001"));
    expect(useTimelineStore.getState().history.past.length).toBe(before + 1);
    expect(useTimelineStore.getState()._historyGroupDepth).toBe(0); // 古いまとめごと閉じている
  });

  // ⚠️ **開き直すのは掴んでいるときだけ**＝掴んでいない選び直しで開くと、そこから先の編集が
  // ひとつながりになり、閉じる相手（ドラッグの終わり）も来ない。
  // ⚠️ **畳まれた後は、矢印がまとめ直す**（#817 レビュー 🔴）＝持ち主が自前の印だけを見ていると、
  // 畳まれた後も「開いている」つもりで開き直さず**1押下＝1履歴**になり、上限（50）を数秒で
  // 流し切って**取り消しでしか戻せない編集（バラすなど）を押し出す**。
  it("取り消しでまとめが畳まれた後も、続けた矢印は1つの取り消しにまとまる", () => {
    twoTexts();
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    // ⚠️ **まとめは実際の矢印で開く**＝store を直に叩くと持ち主の印が立たず、この穴を再現できない。
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(useTimelineStore.getState()._historyGroupDepth).toBe(1); // 持ち主がまとめを開いた
    act(() => { useTimelineStore.getState().undo(); }); // 取り消しで畳まれる（持ち主は知らない）
    expect(useTimelineStore.getState()._historyGroupDepth).toBe(0);
    // 畳まれた後に矢印を3回。まとめ直せていれば履歴は1つ（見ていないと3つ積まれる）。
    const before = useTimelineStore.getState().history.past.length;
    for (let i = 0; i < 3; i++) fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(useTimelineStore.getState().history.past.length).toBe(before + 1);
    expect(useTimelineStore.getState()._historyGroupDepth).toBe(1); // まとめが開き直っている
  });

  // ⚠️ **取り残されたタイマが、別人のまとめを閉じない**（#817 レビュー 🔴 の後半）＝畳まれた後も
  // 矢印の後始末（600ms）は走るので、世代を見ないと**掴んでいる最中のまとめ**を閉じてしまい、
  // 以後の動かすたびに履歴が1件ずつ積まれる（#813 で塞いだ穴が別経路から開く）。
  it("畳まれた後に走る矢印の後始末は、別のまとめを閉じない", () => {
    vi.useFakeTimers();
    try {
      twoTexts();
      useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
      render(<TimelineProjectScreen onNavigate={vi.fn()} />);
      fireEvent.keyDown(window, { key: "ArrowRight" });      // 矢印がまとめを開く（後始末が予約される）
      act(() => { useTimelineStore.getState().undo(); });    // 取り消しで畳まれる（持ち主は知らない）
      act(() => { useTimelineStore.getState().beginHistoryGroup(); }); // 別人（掴んでいる最中）が開く
      act(() => { vi.advanceTimersByTime(NUDGE_GROUP_IDLE_MS + 10); }); // 取り残された後始末が走る
      expect(useTimelineStore.getState()._historyGroupDepth).toBe(1); // 別人のまとめは開いたまま
    } finally {
      vi.useRealTimers();
    }
  });

  it("掴んでいないときの選び直しでは、まとめを開かない", () => {
    twoTexts();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    act(() => { useTimelineStore.getState().selectClip("clip_002"); });
    expect(useTimelineStore.getState()._historyGroupDepth).toBe(0);
  });

  // ⚠️ **開いた側が閉じる**（#813 レビュー 🔴）＝閉じる合図を出すのは要素のドラッグだけで、
  // 空白クリック・範囲選択・帯のドラッグは「掴んでいる」数だけ上げて終わりに何も出さない。
  // 閉じ損ねると以後の編集が履歴に積まれず、**自動保存も止まる**（`historyDepth > 0` の間は保留）
  // ＝そのままアプリを閉じると編集が消える。しかも `endHistoryGroup` は 0 で止めるので無言。
  it("キャンバスの空白を押して離しても、まとめが残らない（選択解除は閉じる合図を出さない）", () => {
    twoTexts();
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const root = container.querySelector("[data-free-id]")!.parentElement as HTMLElement;
    fireEvent.pointerDown(root, { button: 0, pointerId: 1, clientX: 5, clientY: 5 }); // 空白＝選択解除＋範囲選択
    expect(useTimelineStore.getState().selectedClipIds).toEqual([]); // 前提＝選択が変わっている
    fireEvent.pointerUp(window, { pointerId: 1 });
    expect(useTimelineStore.getState()._historyGroupDepth).toBe(0);
  });

  it("帯を掴んで動かして離しても、まとめが残らない（帯も閉じる合図を出さない）", () => {
    twoTexts();
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const band = container.querySelectorAll(".timeline-clip")[0];
    fireEvent.pointerDown(band, { button: 0, pointerId: 1, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(window, { buttons: 1, pointerId: 1, clientX: 40, clientY: 0 }); // しきい値を越える＝選び直し
    expect(useTimelineStore.getState().selectedClipIds).toHaveLength(1); // 前提＝選び直しが起きている
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 40, clientY: 0 });
    expect(useTimelineStore.getState()._historyGroupDepth).toBe(0);
  });

  // ⚠️ **中止でも閉じる**＝枠外へ出た・別の指が割り込んだ等では `pointerup` が来ず
  // `pointercancel` になる。片方しか拾わないと、その回だけ静かに開きっぱなしになる。
  it("掴んだまま中止になっても、まとめが残らない", () => {
    // ⚠️ 見るのは**掴み手が閉じてくれない経路**（範囲選択）＝要素のドラッグは中止でも自前で閉じるので、
    // ここが効いているかを判別できない。
    twoTexts();
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const root = container.querySelector("[data-free-id]")!.parentElement as HTMLElement;
    fireEvent.pointerDown(root, { button: 0, pointerId: 1, clientX: 5, clientY: 5 });
    expect(useTimelineStore.getState().selectedClipIds).toEqual([]); // 前提＝選択が変わっている
    fireEvent.pointerCancel(root, { pointerId: 1 });
    expect(useTimelineStore.getState()._historyGroupDepth).toBe(0);
  });

  // ⚠️ **`Escape` での中止は合図（イベント）を出さない**（#813 再レビュー 🔴）＝帯もマーキーも
  // 直接 `onCancel()` を呼ぶので、`pointerup`/`pointercancel` を待ち受ける形だと取り残される。
  it("範囲選択を Escape でやめても、まとめが残らない", () => {
    twoTexts();
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const root = container.querySelector("[data-free-id]")!.parentElement as HTMLElement;
    fireEvent.pointerDown(root, { button: 0, pointerId: 1, clientX: 5, clientY: 5 });
    expect(useTimelineStore.getState().selectedClipIds).toEqual([]); // 前提＝選択が変わっている
    fireEvent.keyDown(window, { key: "Escape" });
    expect(useTimelineStore.getState()._historyGroupDepth).toBe(0);
  });

  it("帯のドラッグを Escape でやめても、まとめが残らない", () => {
    twoTexts();
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const band = container.querySelectorAll(".timeline-clip")[0];
    fireEvent.pointerDown(band, { button: 0, pointerId: 1, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(window, { buttons: 1, pointerId: 1, clientX: 40, clientY: 0 });
    expect(useTimelineStore.getState().selectedClipIds).toHaveLength(1); // 前提＝選び直しが起きている
    fireEvent.keyDown(window, { key: "Escape" });
    expect(useTimelineStore.getState()._historyGroupDepth).toBe(0);
  });

  it("続けてもう1つ掴むと、それは別の1つになる（ひとつながりにしない）", () => {
    twoTexts();
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const before = useTimelineStore.getState().history.past.length;
    dragBox(boxOf(container, "clip_001"));
    dragBox(boxOf(container, "clip_002")); // 選択が変わる＝ここでも畳んで開き直す
    expect(useTimelineStore.getState().history.past.length).toBe(before + 2);
    expect(useTimelineStore.getState()._historyGroupDepth).toBe(0);
  });
});

// 字幕クリップの「見た目」（差分再監査 5巡目 🔴＋レビュー）。
//
// ⚠️ **効くのに選べない、の裏返し**＝描画も書き込みも通っているのに入口が影と帯しか無く、
// 太さの欄の知らせ（#1483・ADR-0038）＝描く字体が持ち込み・拡張パックなら「太字が効かない」と出す。
describe("太字が効かない字体の知らせ（#1483）", () => {
  const withText = (fontId?: string, projectFontId?: string): void => {
    open({ clips: [{ id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 3, x: 0, y: 0, w: 100, h: 40, text: "あ", ...(fontId ? { fontId } : {}) }] });
    if (projectFontId) useTimelineStore.setState((st) => ({ doc: st.doc ? { ...st.doc, videoSettings: { ...st.doc.videoSettings, fontId: projectFontId } } : st.doc }));
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
  };
  it("部品の字体が持ち込みなら知らせる", () => {
    withText("user_font_001");
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getByRole("note").textContent).toContain("太字が無い");
  });
  it("動画全体の字体が持ち込みなら知らせる（部品に指定が無いとき）", () => {
    withText(undefined, "user_font_002");
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.queryAllByRole("note").some((n) => (n.textContent ?? "").includes("太字が無い"))).toBe(true);
  });
  it("同梱の字体では出さない", () => {
    withText();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.queryAllByRole("note").some((n) => (n.textContent ?? "").includes("太字が無い"))).toBe(false);
  });
});

// 大きさ・色・太さ・揃え・フォント・縁取りが直せなかった（場面形式の自由配置の字幕は直せる）。
describe("字幕クリップの見た目", () => {
  const openSubtitle = (): void => {
    open({
      tracks: [{ id: "track_001", kind: TRACK_KIND.visual }, { id: "track_002", kind: TRACK_KIND.audio }],
      clips: [
        { id: "clip_001", kind: TIMELINE_CLIP_KIND.voice, trackId: "track_002", startSec: 0, durationSec: 2, voice: { text: "あ", status: "none" } },
        { id: "clip_002", kind: TIMELINE_CLIP_KIND.subtitle, trackId: "track_001", startSec: 0, durationSec: 2, x: 0, y: 0, w: 100, h: 40, voiceClipId: "clip_001" },
      ] as never,
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_002"] });
  };
  const openStyle = (): void => { fireEvent.click(screen.getByText("字幕の見た目")); };

  it("文字の大きさを直せる（文字クリップと同じ顔ぶれ）", () => {
    openSubtitle();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    openStyle();
    const size = screen.getByLabelText("文字の大きさ") as HTMLInputElement;
    fireEvent.focus(size);
    fireEvent.change(size, { target: { value: "48" } });
    fireEvent.blur(size);
    expect(useTimelineStore.getState().doc!.clips.find((c) => c.id === "clip_002")!.fontSize).toBe(48);
  });

  it("縁取りの太さを直せる（バラした文字に残る縁取りを外せる）", () => {
    openSubtitle();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    openStyle();
    const w = screen.getByLabelText("縁取りの太さ") as HTMLInputElement;
    fireEvent.focus(w);
    fireEvent.change(w, { target: { value: "3" } });
    fireEvent.blur(w);
    expect(useTimelineStore.getState().doc!.clips.find((c) => c.id === "clip_002")!.strokeWidth).toBe(3);
  });

  // ⚠️ **面を撫でる色選びは1つのまとまりにする**（差分再監査 5巡目 🔴）＝渡さないと `pointermove`
  // ごとに取り消しが積まれ、**取り消しでしか戻せない操作（「バラす」）が押し出される**。
  it("影の色・背景色をドラッグで選んでも、取り消しは1回で戻る", () => {
    openSubtitle();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    openStyle();
    fireEvent.click(screen.getByRole("switch", { name: "影を付ける" }));
    const before = useTimelineStore.getState().history.past.length;
    fireEvent.click(screen.getByRole("button", { name: "影の色を選ぶ" }));
    const sv = screen.getByTestId("cp-sv");
    sv.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100, x: 0, y: 0, toJSON: () => undefined }) as DOMRect;
    fireEvent.pointerDown(sv, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(sv, { pointerId: 1, clientX: 40, clientY: 20 });
    fireEvent.pointerMove(sv, { pointerId: 1, clientX: 70, clientY: 30 });
    fireEvent.pointerUp(sv, { pointerId: 1 });
    // 撫でた回数ぶん積まれていない＝1ドラッグ＝1回（渡していないと `pointermove` ごとに積まれる）。
    expect(useTimelineStore.getState().history.past.length - before).toBeLessThanOrEqual(1);
  });
});

// 「バラす」は押す前に断る（差分再監査 5巡目 🟡）。
//
// ⚠️ **同意させてから断らない**＝理由は押す前に分かる（純粋関数を空撃ちできる）のに、取り返しの
// つかない操作の顔をした確認に答えさせてから no-op にしていた（同じ画面の「分ける」は押す前に断る）。
describe("バラせないときは押す前に理由を出す", () => {
  const tpl: Template = {
    schemaVersion: "1.0", templateId: "tmpl_explode", name: "バラす用", category: "photo_intro",
    aspectRatio: "16:9", canvas: { width: 1920, height: 1080 },
    layers: [{ id: "background", type: "background", x: 0, y: 0, w: 1920, h: 1080 }],
  };
  const openCropped = (crop?: object, cropAlign?: string): void => {
    useProjectStore.setState({ templates: [tpl] });
    open({
      tracks: [{ id: "track_001", kind: TRACK_KIND.visual }],
      clips: [{
        id: "clip_001", kind: TIMELINE_CLIP_KIND.template, trackId: "track_001", startSec: 0, durationSec: 5,
        templateId: "tmpl_explode",
        ...(crop ? { crop } : {}), ...(cropAlign ? { cropAlign } : {}),
      }] as never,
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
  };
  const explodeButton = (): HTMLButtonElement => {
    // ⚠️ **帯の方を押す**（#1031）＝「置く」欄のタブにも同じ名前のボタンができた。
    fireEvent.click(screen.getAllByText("見た目パターン").find((el) => el.closest(".timeline-clip"))!);
    return screen.getByRole("button", { name: "中身をバラす" }) as HTMLButtonElement;
  };

  it("切り抜いてある部品では押せず、理由が出る", () => {
    openCropped({ left: 0.1 });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const btn = explodeButton();
    expect(btn).toBeDisabled();
    expect(btn.title).toContain("切り抜き");
  });

  it("寄せだけ設定してある部品でも押せない（案内どおり解除できる文言）", () => {
    openCropped(undefined, "top");
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const btn = explodeButton();
    expect(btn).toBeDisabled();
    expect(btn.title).toContain("寄せ");
  });

  it("何も設定していない部品は押せる", () => {
    openCropped();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(explodeButton()).not.toBeDisabled();
  });

  // ⚠️ **右クリックのメニューも同じ判定を通す**（差分再監査 6巡目 🟡）＝欄のボタンだけ塞ぐと、
  // メニューから押せて**確認に同意させてから断る**（同じ操作の断り方が2通り＝ADR-0026②）。
  it("右クリックのメニューでも押せず、理由が出る", () => {
    openCropped({ left: 0.1 });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.contextMenu(container.querySelector(".timeline-clip") as HTMLElement);
    const item = screen.getByRole("menuitem", { name: "中身をバラす" });
    expect(item).toBeDisabled();
    expect(item.title).toContain("切り抜き");
  });

  it("何も設定していなければ、右クリックのメニューからは押せる", () => {
    openCropped();
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.contextMenu(container.querySelector(".timeline-clip") as HTMLElement);
    expect(screen.getByRole("menuitem", { name: "中身をバラす" })).not.toBeDisabled();
  });
});

// 種別ごとの文字の形（差分再監査 6巡目 🟡）。
//
// ⚠️ **1つ選ぶと他が消える、を作らない**（まるごと差し替えで解かれるので、残りを引き継ぐ）。
// ⚠️ **休眠の種別も直せる**＝書き出しの門は休眠のぶんも数えて断るので、欄が「いま使う種別」だけだと
// 持ち込みフォントが消えたとき**案内どおりに選び直す先が無い**（§2-5 の行き止まり）。
describe("見た目パターンの部品の種別ごとの文字の形", () => {
  const tpl2: Template = {
    schemaVersion: "1.0", templateId: "tmpl_two_texts", name: "文字2つ", category: "photo_intro",
    aspectRatio: "16:9", canvas: { width: 1920, height: 1080 },
    layers: [
      { id: "background", type: "background", x: 0, y: 0, w: 1920, h: 1080 },
      { id: "title", type: "text", textKey: "title", x: 0, y: 0, w: 100, h: 50 },
      { id: "main", type: "text", textKey: "main", x: 0, y: 60, w: 100, h: 50 },
    ],
  } as unknown as Template;
  const openWith = (textFontIds?: object): void => {
    useProjectStore.setState({ templates: [tpl2] });
    open({
      tracks: [{ id: "track_001", kind: TRACK_KIND.visual }],
      clips: [{
        id: "clip_001", kind: TIMELINE_CLIP_KIND.template, trackId: "track_001", startSec: 0, durationSec: 5,
        templateId: "tmpl_two_texts", ...(textFontIds ? { textFontIds } : {}),
      }] as never,
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
  };
  const clip = () => useTimelineStore.getState().doc!.clips[0];
  /** 種別の欄を開いて選ぶ。開く側（`button.select`）と選ぶ側（一覧の項目）を取り違えない。 */
  const pickFont = (fieldLabel: string, optionText: string): void => {
    // ⚠️ 見出しは `<label htmlFor>` で欄と結ばれた（#1075）＝包む形ではなくなったので、囲いは親から採る。
    const field = screen.getByText(fieldLabel).closest(".field") as HTMLElement;
    fireEvent.click(field.querySelector("button.select") as HTMLElement);
    const option = [...field.querySelectorAll("button")].find(
      (b) => !b.classList.contains("select") && (b.textContent ?? "").startsWith(optionText),
    ) as HTMLElement;
    fireEvent.click(option);
  };

  it("1つ選び直しても、他の種別の指定は残る", () => {
    openWith({ title: "gen-interface-jp", main: "kaitou-yokoku-gothic" });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    // ⚠️ **帯の方を押す**（#1031）＝「置く」欄のタブにも同じ名前のボタンができた。
    fireEvent.click(screen.getAllByText("見た目パターン").find((el) => el.closest(".timeline-clip"))!);
    pickFont("本文の文字の形", "Gen Interface JP Display");
    expect(clip().textFontIds?.title).toBe("gen-interface-jp"); // 触っていない方は残る
    expect(clip().textFontIds?.main).toBe("gen-interface-jp-display");
  });

  it("最後の1つを「動画全体に合わせる」へ戻すと、指定ごと消える（空の入れ物を残さない）", () => {
    openWith({ title: "gen-interface-jp" });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    // ⚠️ **帯の方を押す**（#1031）＝「置く」欄のタブにも同じ名前のボタンができた。
    fireEvent.click(screen.getAllByText("見た目パターン").find((el) => el.closest(".timeline-clip"))!);
    pickFont("見出しの文字の形", "動画全体に合わせる");
    expect(clip().textFontIds).toBeUndefined();
  });

  it("いまの見た目パターンで使っていない種別でも、指定が残っていれば直せる", () => {
    openWith({ subtitle: "gen-interface-jp" }); // この見た目パターンに字幕の層は無い
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    // ⚠️ **帯の方を押す**（#1031）＝「置く」欄のタブにも同じ名前のボタンができた。
    fireEvent.click(screen.getAllByText("見た目パターン").find((el) => el.closest(".timeline-clip"))!);
    expect(screen.getByText("字幕の文字の形")).toBeInTheDocument();
    // ⚠️ **断りも添える**（8巡目）＝理由なしに混ざると「触ったのに何も起きない」に見える。
    expect(screen.getByText(/いまの見た目パターンでは使っていない文字/)).toBeInTheDocument();
  });

  it("指定が無い種別の欄は出さない（使っていないものを並べない）", () => {
    openWith();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    // ⚠️ **帯の方を押す**（#1031）＝「置く」欄のタブにも同じ名前のボタンができた。
    fireEvent.click(screen.getAllByText("見た目パターン").find((el) => el.closest(".timeline-clip"))!);
    expect(screen.queryByText("字幕の文字の形")).toBeNull();
    expect(screen.queryByText(/いまの見た目パターンでは使っていない文字/)).toBeNull();
  });

  // ⚠️ **見た目が未解決でも文字の形は直せる**（差分再監査 8巡目 🟡）＝門は見た目の解決に関係なく
  // 数えるので、欄ごと消すと「別の文字の形を選び直してください」がこの部品では実行できない。
  it("見た目パターンが見つからない部品でも、指定が残っていれば文字の形を直せる", () => {
    useProjectStore.setState({ templates: [] }); // 見た目が解決できない
    open({
      tracks: [{ id: "track_001", kind: TRACK_KIND.visual }],
      clips: [{
        id: "clip_001", kind: TIMELINE_CLIP_KIND.template, trackId: "track_001", startSec: 0, durationSec: 5,
        templateId: "tmpl_gone", fontId: "gen-interface-jp", textFontIds: { title: "kaitou-yokoku-gothic" },
      }] as never,
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getByText("この部品の文字の形")).toBeInTheDocument();
    expect(screen.getByText("見出しの文字の形")).toBeInTheDocument();
  });

  // ⚠️ **双子で見る**（差分再監査 9巡目 🟡）＝2つのフィールドをいつも一緒に有無させると、
  // 「部品ぜんぶの指定」と「種別ごとの指定」を取り違える回帰を検知できない。
  it("見た目が未解決でも、種別ごとの指定だけがあれば種別の欄は出る", () => {
    useProjectStore.setState({ templates: [] });
    open({
      tracks: [{ id: "track_001", kind: TRACK_KIND.visual }],
      clips: [{
        id: "clip_001", kind: TIMELINE_CLIP_KIND.template, trackId: "track_001", startSec: 0, durationSec: 5,
        templateId: "tmpl_gone", textFontIds: { title: "kaitou-yokoku-gothic" }, // 部品ぜんぶの指定は無い
      }] as never,
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getByText("見出しの文字の形")).toBeInTheDocument();
  });

  it("見た目が未解決で、部品ぜんぶの指定だけなら種別の欄は出さない", () => {
    useProjectStore.setState({ templates: [] });
    open({
      tracks: [{ id: "track_001", kind: TRACK_KIND.visual }],
      clips: [{
        id: "clip_001", kind: TIMELINE_CLIP_KIND.template, trackId: "track_001", startSec: 0, durationSec: 5,
        templateId: "tmpl_gone", fontId: "gen-interface-jp", // 種別ごとの指定は無い
      }] as never,
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getByText("この部品の文字の形")).toBeInTheDocument();
    expect(screen.queryByText("見出しの文字の形")).toBeNull();
  });

  it("見た目が未解決でも、指定が無ければ欄は出さない", () => {
    useProjectStore.setState({ templates: [] });
    open({
      tracks: [{ id: "track_001", kind: TRACK_KIND.visual }],
      clips: [{ id: "clip_001", kind: TIMELINE_CLIP_KIND.template, trackId: "track_001", startSec: 0, durationSec: 5, templateId: "tmpl_gone" }] as never,
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    // ⚠️ 部品ぜんぶの欄は**無条件に出す**（解決できているときと同じ）＝状態で現れたり消えたりしない。
    expect(screen.getByText("この部品の文字の形")).toBeInTheDocument();
    expect(screen.queryByText("見出しの文字の形")).toBeNull();
  });
});

// ⚠️ **何も変わらない操作は積まない**（α-6 出口監査 🟡・ADR-0032 決定）＝`commit` は同一参照で
// 弾く設計なのに、動画全体の設定は毎回作り直していたので**必ず別参照**になり、同じものを選び直す
// だけで取り消しが1つ埋まり、再生も止まっていた。
describe("動画全体の設定の空振り", () => {
  const openWithFont = (): void => {
    open({ videoSettings: { aspectRatio: "16:9", fps: 30, targetDurationSec: 60, maxDurationSec: 600, fontId: "gen-interface-jp" } } as never);
  };

  it("同じ値を書いても履歴が増えない・再生も止まらない", () => {
    openWithFont();
    useTimelineStore.setState({ isPlaying: true });
    const before = useTimelineStore.getState().history.past.length;
    act(() => { useTimelineStore.getState().updateVideoSettings({ fontId: "gen-interface-jp" }); });
    expect(useTimelineStore.getState().history.past.length).toBe(before);
    expect(useTimelineStore.getState().isPlaying).toBe(true);
  });

  it("違う値なら積む（変えたことは取り消せる）", () => {
    openWithFont();
    const before = useTimelineStore.getState().history.past.length;
    act(() => { useTimelineStore.getState().updateVideoSettings({ fontId: "kaitou-yokoku-gothic" }); });
    expect(useTimelineStore.getState().history.past.length).toBe(before + 1);
  });

  it("入れ物の中身が同じなら積まない（音の自動処理のような組の設定）", () => {
    open({ videoSettings: { aspectRatio: "16:9", fps: 30, targetDurationSec: 60, maxDurationSec: 600, audioAuto: { duckBgm: true } } } as never);
    const before = useTimelineStore.getState().history.past.length;
    act(() => { useTimelineStore.getState().updateVideoSettings({ audioAuto: { duckBgm: true } }); });
    expect(useTimelineStore.getState().history.past.length).toBe(before);
  });
});

// 立ち絵に入れた動画（#809・α-6 出口監査 🔴1）。
//
// ⚠️ **プレビューが当てるアイテムを役割で絞ると、立ち絵は必ず外れる**（立ち絵のアイテムは
// `role:'character'`）＝プレビューは静止・元の音も無音なのに、書き出しは実映像＋元の音になる
// （ADR-0001 の破れ）。domain 側の鍵の一致だけでなく、**画面の経路**も固定する。
describe("立ち絵に入れた動画のプレビュー", () => {
  const charTemplate: Template = {
    schemaVersion: "1.0", templateId: "tmpl_char", name: "立ち絵つき", category: "photo_intro",
    aspectRatio: "16:9", canvas: { width: 1920, height: 1080 },
    layers: [
      { id: "bg", type: "background", x: 0, y: 0, w: 1920, h: 1080 },
      { id: "yuko", type: "character", x: 960, y: 0, w: 960, h: 1080 },
    ],
  } as unknown as Template;

  const openWithPose = (): void => {
    useProjectStore.setState({ templates: [charTemplate] });
    open({
      assets: [{ assetId: "asset_pose", assetType: "video", displayName: "立ち絵動画", filePath: "p.mp4", metadata: { hasAudio: true } }],
      clips: [{
        id: "clip_001", kind: TIMELINE_CLIP_KIND.template, trackId: "track_001",
        startSec: 0, durationSec: 5, templateId: "tmpl_char",
        character: { enabled: true, characterId: "yuko", poseAssetId: "asset_pose" },
      }],
    } as never);
    act(() => {
      useTimelineStore.setState({
        assetSrcById: { asset_pose: "blob:thumb_pose" },
        videoSrcById: { asset_pose: "blob:body_pose" },
      });
    });
  };

  it("実映像の窓が開く（代表フレームで静止させない）", () => {
    openWithPose();
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const videos = [...container.querySelectorAll(".preview-stage video")] as HTMLVideoElement[];
    expect(videos).toHaveLength(1);
    expect(videos[0].getAttribute("src")).toBe("blob:body_pose");
  });

  // ⚠️ **元の音の欄も出す**＝差し込み口だけに絞ると、書き出しにだけ効く設定になる。
  it("元の音の欄が出る（書き出しにだけ効く設定を作らない）", () => {
    openWithPose();
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getByText("ゆうこ（立ち絵）の動画の音")).toBeInTheDocument();
    expect(screen.getByText("この動画に入っている音を流す")).toBeInTheDocument();
  });

  // ⚠️ **押した結果まで固定する**（`/canon-check` 🔴）＝欄が出ることだけを見ていたので、
  // **書き込みが毎回断られている**（素材を `assetRefs` からしか探しておらず、立ち絵の素材は
  // `character.poseAssetId` にある）のを緑のまま通していた。描けることと**設定できる**ことは別。
  it("押すと設定が載る（欄は出るのに毎回断られる、を作らない）", () => {
    openWithPose();
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const cb = screen.getByLabelText("この動画に入っている音を流す");
    act(() => { fireEvent.click(cb); });
    expect(useTimelineStore.getState().doc?.clips[0].slotClips).toEqual({ yuko: { useOriginalAudio: true } });
    // 断られていないこと＝理由が出ていない（出ていたら「音が入っていない」＝事実と違う理由）。
    expect(useTimelineStore.getState().editBlocked).toBeNull();
  });
});

// BGM を下げる区間を**つないだ**ことは、場面形式と同じように**タイムライン形式でも言う**
//（ADR-0026②・§2-5＝黙ってやると設定した意味と違う音になる）。ドメイン側の `duckMerged` の
// 算出は `export.test.ts` で固定済みなので、ここで見るのは**画面まで配線されているか**だけ
//（PR #922 範囲4 レビュー ℹ️＝配線のカバレッジが薄い）。
describe("TimelineProjectScreen: BGM を下げる区間をつないだ知らせ", () => {
  const done = (duckMerged: boolean) => {
    open({ clips: [{ id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 5, x: 0, y: 0, w: 100, h: 50, text: "あ" }] });
    useTimelineStore.setState({ exportRun: { phase: "done", percent: 100, message: "書き出しました。", cancelling: false, duckMerged } as never });
  };

  it("つないだときは出る（文言は場面形式と同じもの）", () => {
    done(true);
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getByText(DUCK_MERGED_MESSAGE)).toBeInTheDocument();
  });

  it("つないでいないときは出さない（毎回出すと意味が薄れる）", () => {
    done(false);
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.queryByText(DUCK_MERGED_MESSAGE)).toBeNull();
  });

  it("書き出しの途中では出さない（まだ結果が出ていない）", () => {
    open({ clips: [{ id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 5, x: 0, y: 0, w: 100, h: 50, text: "あ" }] });
    useTimelineStore.setState({ exportRun: { phase: "running", percent: 50, message: null, cancelling: false, duckMerged: true } as never });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.queryByText(DUCK_MERGED_MESSAGE)).toBeNull();
    useTimelineStore.setState({ exportRun: { phase: "idle", percent: 0, message: null, cancelling: false } });
  });
});

// まとめて長さをそろえる（#1005＝実機の指摘「帯を複数選択できるのに長さを一緒に調整できない」）。
describe("TimelineProjectScreen: まとめて長さをそろえる（#1005）", () => {
  /** 3秒の帯を2本（別々の列）＋再生位置を中に置く。 */
  const two = () =>
    open({
      clips: [
        { id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 5, x: 0, y: 0, w: 100, h: 50, text: "こんにちは" },
        { id: "clip_002", kind: TIMELINE_CLIP_KIND.text, trackId: "track_002", startSec: 0, durationSec: 4, x: 0, y: 0, w: 100, h: 50, text: "よろしく" },
      ],
      tracks: [
        { id: "track_001", kind: TRACK_KIND.visual },
        { id: "track_002", kind: TRACK_KIND.visual },
      ],
    });

  const selectBoth = (): void => {
    fireEvent.click(screen.getByRole("button", { name: "こんにちは" }));
    fireEvent.click(screen.getByRole("button", { name: "よろしく" }), { shiftKey: true });
  };

  it("複数選んでも長さの入口が出る（1つだけのときしか出ない、を直す）", () => {
    two();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("再生位置"), { target: { value: "2" } });
    selectBoth();
    expect(screen.getByRole("button", { name: /ここで終わる（2個）/ })).toBeEnabled();
  });

  it("選んだ全部の終わりが、再生位置へそろう", () => {
    two();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("再生位置"), { target: { value: "2" } });
    selectBoth();
    fireEvent.click(screen.getByRole("button", { name: /ここで終わる（2個）/ }));
    expect(useTimelineStore.getState().doc?.clips.map((c) => c.durationSec)).toEqual([2, 2]);
  });

  it("始まりもそろう", () => {
    two();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("再生位置"), { target: { value: "1.5" } });
    selectBoth();
    fireEvent.click(screen.getByRole("button", { name: /ここから始める（2個）/ }));
    expect(useTimelineStore.getState().doc?.clips.map((c) => [c.startSec, c.durationSec])).toEqual([[1.5, 3.5], [1.5, 2.5]]);
  });

  // ⚠️ **押す前に何個変わるかを出す**＝選んだ数をそのまま出すと、
  // かかっていない帯が混ざったとき**押したのに数が合わない**（数え方は domain と共有する）。
  it("再生位置にかかっている数を出す（選んだ数ではない）", () => {
    two();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("再生位置"), { target: { value: "4.5" } }); // clip_002 は 4 秒で終わり
    selectBoth();
    expect(screen.getByRole("button", { name: /ここで終わる（1個）/ })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: /ここで終わる（1個）/ }));
    // ⚠️ かかっていない帯は**置いた場所ごと動かさない**（潰さない）。
    expect(useTimelineStore.getState().doc?.clips.map((c) => c.durationSec)).toEqual([4.5, 4]);
  });

  it("1つもかかっていなければ押せず、次の行動を出す", () => {
    two();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("再生位置"), { target: { value: "0" } }); // 端はまたいでいない
    selectBoth();
    const btn = screen.getByRole("button", { name: /ここで終わる（0個）/ });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("title", editBlockedMessage[EDIT_BLOCKED.trimNoneAtTime]);
  });

  it("固定した列が混ざったら押せず、選び直す案内を出す", () => {
    open({
      clips: [
        { id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 5, x: 0, y: 0, w: 100, h: 50, text: "こんにちは" },
        { id: "clip_002", kind: TIMELINE_CLIP_KIND.text, trackId: "track_002", startSec: 0, durationSec: 4, x: 0, y: 0, w: 100, h: 50, text: "よろしく" },
      ],
      tracks: [
        { id: "track_001", kind: TRACK_KIND.visual },
        { id: "track_002", kind: TRACK_KIND.visual, locked: true },
      ],
    });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("再生位置"), { target: { value: "2" } });
    selectBoth();
    const btn = screen.getByRole("button", { name: /ここで終わる（2個）/ });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("title", editBlockedMessage[EDIT_BLOCKED.lockedSelection]);
  });

  // ⚠️ **再生中は押せない**（走っている位置を掴ませない＝「再生位置へ」と同じ理由）。
  // ⚠️ 門番は単体とまとめてで**共有**しているので、両方を見る（片方だけ塞ぐ形を作らない）。
  it("再生中は、単体でもまとめても押せない", () => {
    two();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("再生位置"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "こんにちは" }));
    expect(screen.getByRole("button", { name: "ここで終わる" })).toBeEnabled();
    fireEvent.click(screen.getByText("再生"));
    const single = screen.getByRole("button", { name: "ここで終わる" });
    expect(single).toBeDisabled();
    expect(single).toHaveAttribute("title", "再生を止めてから使えます");
    fireEvent.click(screen.getByRole("button", { name: "よろしく" }), { shiftKey: true });
    const many = screen.getByRole("button", { name: /ここで終わる（2個）/ });
    expect(many).toBeDisabled();
    expect(many).toHaveAttribute("title", "再生を止めてから使えます");
  });

  // ⚠️ **混ざっただけで止まらない**（#1005 レビュー ℹ️）＝再生位置にかかっていない固定の帯を
  // 選んでいるだけで、そろえられる帯まで押せなくなる形を作らない。
  it("固定の帯が再生位置にかかっていなければ、残りはそろえられる", () => {
    open({
      clips: [
        { id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 5, x: 0, y: 0, w: 100, h: 50, text: "こんにちは" },
        { id: "clip_002", kind: TIMELINE_CLIP_KIND.text, trackId: "track_002", startSec: 8, durationSec: 4, x: 0, y: 0, w: 100, h: 50, text: "よろしく" },
      ],
      tracks: [
        { id: "track_001", kind: TRACK_KIND.visual },
        { id: "track_002", kind: TRACK_KIND.visual, locked: true }, // 再生位置より後ろ＝相手にならない
      ],
    });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("再生位置"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "こんにちは" }));
    fireEvent.click(screen.getByRole("button", { name: "よろしく" }), { shiftKey: true });
    const btn = screen.getByRole("button", { name: /ここで終わる（1個）/ });
    expect(btn).toBeEnabled();
    fireEvent.click(btn);
    expect(useTimelineStore.getState().doc?.clips.map((c) => c.durationSec)).toEqual([2, 4]);
  });

  // ⚠️ **選んだ数で挙動を割らない**（ADR-0026②）＝1件のときも同じ規則で通す。
  // ここは**意図して変えた挙動**＝これまで単体の「ここで終わる」は、再生位置が帯の外にあると
  // その位置まで**伸ばして**いた。まとめてのときに同じことをすると、遠くの帯が
  // **いちばん短い長さまで潰れる**（画面の外で起きるので気づけない）ので、
  // 他社の型（再生ヘッドまでトリミング）に合わせて「またいでいる帯だけ」に統一した。
  // 伸ばす操作は「長さ（秒）」の欄が受け持つ（下の検査）。
  it("1件でも同じ規則＝またいでいるときだけ、その位置で終わる", () => {
    two();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("再生位置"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "こんにちは" }));
    fireEvent.click(screen.getByRole("button", { name: "ここで終わる" }));
    expect(useTimelineStore.getState().doc?.clips[0]?.durationSec).toBe(3);
  });

  it("1件でも、またいでいなければ押せず次の行動を出す（伸ばす道は数値の欄）", () => {
    two();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("再生位置"), { target: { value: "7" } }); // clip_001 は 5 秒で終わり
    fireEvent.click(screen.getByRole("button", { name: "こんにちは" }));
    const btn = screen.getByRole("button", { name: "ここで終わる" });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("title", editBlockedMessage[EDIT_BLOCKED.trimNoneAtTime]);
  });

  it("1件で固定された列なら「この列」の言い方になる（まとめてと言い分ける）", () => {
    open({
      clips: [{ id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 5, x: 0, y: 0, w: 100, h: 50, text: "こんにちは" }],
      tracks: [{ id: "track_001", kind: TRACK_KIND.visual, locked: true }],
    });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("再生位置"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "こんにちは" }));
    expect(screen.getByRole("button", { name: "ここで終わる" })).toHaveAttribute("title", editBlockedMessage[EDIT_BLOCKED.locked]);
  });

  // ⚠️ **数値の欄は伸ばす向きも通る**＝ボタンと同じ道にすると、
  // 伸ばす先は必ず帯の外なので「かかっていない」と判定され、**長くできなくなる**（実際に踏んだ）。
  it("「長さ（秒）」で長くできる（ボタンの絞り込みに巻き込まれない）", () => {
    two();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "こんにちは" }));
    // ⚠️ **数値の欄は「変えた」だけでは確定しない**（`NumberField` は blur/Enter で確定）＝
    // change だけで緑になる検査は嘘の安心になる（このリポジトリで記録済みの型）。
    const len = screen.getByLabelText("長さ（秒）");
    fireEvent.change(len, { target: { value: "9" } });
    fireEvent.blur(len);
    expect(useTimelineStore.getState().doc?.clips[0]?.durationSec).toBe(9);
  });
});

// ⚠️ **押せない見た目の裏にある枝も通す**（#1005 レビュー 🟡）＝ボタンからは 0件で押せないので、
// store の「1つも当てはまらない」枝は**クリック経由では一度も通らない**。
// キーやメニューから呼ぶ道が増えたとき無言にならないための保険なので、ここで直接確かめる。
describe("timelineStore: 再生位置でそろえる（#1005）", () => {
  it("1つも当てはまらなければ、理由を立てて文書を変えない", () => {
    useTimelineStore.setState({
      doc: doc({
        clips: [{ id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 2, x: 0, y: 0, w: 100, h: 50, text: "あ" }],
      }),
      selectedClipIds: ["clip_001"],
      editBlocked: null,
    });
    const before = useTimelineStore.getState().doc;
    useTimelineStore.getState().trimSelectedClipsAt("end", 9); // 帯の外
    expect(useTimelineStore.getState().editBlocked?.reason).toBe(EDIT_BLOCKED.trimNoneAtTime);
    expect(useTimelineStore.getState().doc, "断ったのに文書を書き換えている").toBe(before);
  });

  it("当てはまるものがあれば、そこだけそろえる", () => {
    useTimelineStore.setState({
      doc: doc({
        clips: [
          { id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 5, x: 0, y: 0, w: 100, h: 50, text: "あ" },
          { id: "clip_002", kind: TIMELINE_CLIP_KIND.text, trackId: "track_002", startSec: 0, durationSec: 2, x: 0, y: 0, w: 100, h: 50, text: "い" },
        ],
        tracks: [{ id: "track_001", kind: TRACK_KIND.visual }, { id: "track_002", kind: TRACK_KIND.visual }],
      }),
      selectedClipIds: ["clip_001", "clip_002"],
      editBlocked: null,
    });
    useTimelineStore.getState().trimSelectedClipsAt("end", 3);
    expect(useTimelineStore.getState().doc?.clips.map((c) => c.durationSec)).toEqual([3, 2]);
  });
});

// 再生位置が部品の外にあるとき（#996）。
describe("TimelineProjectScreen: 選んでいるのに掴めないとき（#996）", () => {
  const two = () =>
    open({
      clips: [
        { id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 4, durationSec: 3, x: 0, y: 0, w: 100, h: 50, text: "こんにちは" },
        { id: "clip_002", kind: TIMELINE_CLIP_KIND.voice, trackId: "track_002", startSec: 0, durationSec: 2, voice: { text: "よろしく", status: NARRATION_STATUS.generated, voicePath: "voices/clip_002.wav" } },
      ],
    });

  // ⚠️ **同じ画面で流儀を割らない**（ADR-0026②）＝「動き」「音量の変化」は文で断っているのに、
  // 「位置・大きさ」だけ黙って取っ手が消えていた。
  it("再生位置が部品の外なら、理由を出す", () => {
    two();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "こんにちは" })); // 4.0〜7.0秒
    expect(screen.getByText(clipOutsidePlayheadMessage(4, 7))).toBeInTheDocument();
  });

  it("中にいるときは出さない（いつも出す、を作らない）", () => {
    two();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("再生位置"), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "こんにちは" }));
    expect(screen.queryByText(clipOutsidePlayheadMessage(4, 7))).toBeNull();
  });

  // ⚠️ **行き止まりにしない**＝理由だけでなく、そこへ跳ぶ道を置く。
  it("「この部品の時間へ」で、その部品の先頭へ跳ぶ", () => {
    two();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "こんにちは" }));
    fireEvent.click(screen.getByRole("button", { name: "この部品の時間へ" }));
    expect(useTimelineStore.getState().playheadSec).toBe(4);
    // 跳んだ先では理由が消える（＝取っ手が出る状態になった）。
    expect(screen.queryByText(clipOutsidePlayheadMessage(4, 7))).toBeNull();
  });

  it("再生中は跳べない（走っている位置を掴ませない）", () => {
    two();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "こんにちは" }));
    fireEvent.click(screen.getByText("再生"));
    const btn = screen.getByRole("button", { name: "この部品の時間へ" });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("title", "再生を止めてから使えます");
  });

  // ⚠️ **「時間の外」と「隠れている」を混ぜない**（#1013 レビュー 🟡）＝
  // 描画に出ているかで見ると、隠した列・隠した部品・隠したまとまりも落ちるので、
  // **時間の中に居るのに「外にあります」と言い、跳んでも消えない**（＝行き止まり）。
  it("隠した列の部品でも、時間の中に居れば「外にあります」とは言わない", () => {
    open({
      tracks: [
        { id: "track_001", kind: TRACK_KIND.visual, hidden: true },
        { id: "track_002", kind: TRACK_KIND.audio },
      ],
      clips: [
        { id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 5, x: 0, y: 0, w: 100, h: 50, text: "こんにちは" },
      ],
    });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("再生位置"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "こんにちは" }));
    expect(screen.queryByText(clipOutsidePlayheadMessage(0, 5)), "時間の中に居るのに「外」と言っている").toBeNull();
    expect(screen.queryByRole("button", { name: "この部品の時間へ" }), "押しても何も変わらない道が出ている").toBeNull();
  });

  it("隠した部品でも同じ（隠れている理由は別の話）", () => {
    open({
      clips: [
        { id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 5, x: 0, y: 0, w: 100, h: 50, text: "こんにちは", hidden: true },
      ],
    });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("再生位置"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "こんにちは" }));
    expect(screen.queryByText(clipOutsidePlayheadMessage(0, 5))).toBeNull();
  });

  // ⚠️ **音の部品に「出ている」と言わない**（画面に映ると誤解する）。
  it("音の部品には「鳴っている」と言う", () => {
    two();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("再生位置"), { target: { value: "5" } }); // clip_002 は 0〜2秒
    fireEvent.click(screen.getByRole("button", { name: /よろしく/ }));
    expect(screen.getByText(clipOutsidePlayheadMessage(0, 2, "鳴っている", "置いて"))).toBeInTheDocument();
  });
});

// 答えを求める確認の置き場所（#990・`06 §2` 規約23／#940）。
describe("TimelineProjectScreen: 確認はスクロールで視界から出ない（#990）", () => {
  /**
   * スクロールしても消えないか（`NoticeZone.placement.test.tsx` と**同じ物差し**）。
   * 満たし方は2通りで、どちらでも結果は同じ＝**スクロールする側の外に居る**か、**貼り付いている**か。
   */
  const staysVisibleOnScroll = (el: Element): boolean =>
    el.closest(".main-scroll") == null || el.closest(`.${NOTICE_ZONE_CLASS}`) != null;

  // ⚠️ **守りのテストは動画の一覧と素材の2画面しか見ていなかった**（#990）＝
  // この画面は全体が `.main-scroll` なので、素で置くと**下へ送ったとたん確認が視野の外**へ出る。
  // 出しっぱなしのまま押せない状態が続くので、利用者からは「固まった」ようにしか見えない（§2-5）。
  it("まとめて削除の確認が、スクロールする側の外に出ている", () => {
    open({
      clips: [
        { id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 3, x: 0, y: 0, w: 100, h: 50, text: "こんにちは" },
        { id: "clip_002", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 5, durationSec: 3, x: 0, y: 0, w: 100, h: 50, text: "よろしく" },
      ],
    });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "こんにちは" }));
    fireEvent.click(screen.getByRole("button", { name: "よろしく" }), { shiftKey: true });
    fireEvent.keyDown(window, { key: "Delete" });
    const confirm = screen.getByText(/2個の部品を削除しますか/);
    expect(staysVisibleOnScroll(confirm), "確認が一緒に流れていく所に置かれている").toBe(true);
  });

  it("列を削除する確認も同じ", () => {
    open();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByLabelText("映像1の操作"));
    fireEvent.click(screen.getByRole("menuitem", { name: "削除" }));
    const confirm = screen.getByText(/この列に置いてある|を削除しますか/);
    expect(staysVisibleOnScroll(confirm)).toBe(true);
  });
});

// 音の素材の選び直し（#1050）。⚠️ **同じ1つの部品に、別々の次の行動を2つ出さない**（PR #1059 レビュー 🟡）。
describe("TimelineProjectScreen: 音が出せない素材（#1050）", () => {
  const withBgm = (srcByKey: Record<string, string>) => {
    useTimelineStore.setState({
      doc: doc({
        assets: [{ assetId: "asset_009", assetType: "bgm", displayName: "曲", filePath: "assets/asset_009.mp3" }],
        tracks: [{ id: "track_009", kind: TRACK_KIND.audio }],
        clips: [{ id: "clip_009", kind: TIMELINE_CLIP_KIND.audio, trackId: "track_009", startSec: 0, durationSec: 5, assetId: "asset_009" }],
      }),
      loadError: null, isLoading: false, playheadSec: 0, selectedClipIds: [], assetSrcById: {},
      audioSrcByKey: srcByKey, missingAssetIds: [],
    });
  };

  it("音が出せない素材ごとに「ファイルを選び直す」を出す", () => {
    withBgm({});
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getAllByRole("alert").some((el) => el.textContent?.includes("音が出せない素材があります"))).toBe(true);
    expect(screen.getByRole("button", { name: "ファイルを選び直す" })).toBeInTheDocument();
  });

  // ⚠️ **2つの知らせを重ねない**＝「ファイルを選び直す」と「鳴らす音で選び直す」は別々の次の行動なので、
  //    同じ部品について両方出すと、どちらに従えばよいのか読めない（§2-5）。
  it("選び直せる素材は、古いほうの知らせに数えない", () => {
    withBgm({});
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(
      screen.queryAllByRole("alert").some((el) => el.textContent?.includes("音が見つからない部品が")),
      "同じ部品について2つの次の行動を並べた",
    ).toBe(false);
  });

  it("音が鳴る素材では知らせない", () => {
    withBgm({ "asset:asset_009": "data:audio/mp3;base64,X" });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.queryAllByRole("alert").some((el) => el.textContent?.includes("音が出せない素材"))).toBe(false);
  });
});

// 列に名前を付ける（利用者要望 2026-09-28）。自動名（映像1／音1）だけだと、列が増えたときに
// **どれが何の列か**分からない。
describe("TimelineProjectScreen: 列に名前を付ける", () => {
  it("2回押すと欄になり、打って Enter で名前が付く", () => {
    open();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.doubleClick(trackRowLabel("映像1"));
    const field = screen.getByLabelText("映像1の名前") as HTMLInputElement;
    fireEvent.change(field, { target: { value: "ゆうこの立ち絵" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(useTimelineStore.getState().doc?.tracks.find((t) => t.id === "track_001")?.name).toBe("ゆうこの立ち絵");
    expect(trackRowLabel("ゆうこの立ち絵")).toBeTruthy();
  });

  // ⚠️ **見つけられる道を残す**（ADR-0034 決定19）＝2回押しだけだと気づけない。
  it("メニューからも開ける", () => {
    open();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.contextMenu(trackRowLabel("映像1"));
    fireEvent.click(screen.getByRole("menuitem", { name: "名前を変える" }));
    expect(screen.getByLabelText("映像1の名前")).toBeTruthy();
  });

  // ⚠️ **⋮のボタンに手があるときも欄が閉じない**（通し点検 2026-10-16）＝メニューが閉じるときに⋮へ手を
  //   奪い返し、名前の欄が手を失って確定・閉じていた（実マウスで⋮を押したときだけ出た）。
  it("⋮のボタンから開いても、名前の欄に手が残る", () => {
    open();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const trigger = screen.getByRole("button", { name: "映像1の操作" });
    trigger.focus();
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("menuitem", { name: "名前を変える" }));
    const field = screen.queryByLabelText("映像1の名前");
    expect(field != null, "名前の欄が開いたまま").toBe(true);
    expect(document.activeElement === field, "手は名前の欄にある").toBe(true);
  });

  // ⚠️ **消す道を残す**＝空にすると自動の名前へ戻る。空文字のまま残すと**見出しが消える**。
  it("空にすると自動の名前へ戻る", () => {
    open({ tracks: [{ id: "track_001", kind: TRACK_KIND.visual, name: "前の名前" }] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.doubleClick(trackRowLabel("前の名前"));
    const field = screen.getByLabelText("前の名前の名前") as HTMLInputElement;
    fireEvent.change(field, { target: { value: "   " } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(useTimelineStore.getState().doc?.tracks.find((t) => t.id === "track_001")?.name).toBeUndefined();
    expect(trackRowLabel("映像1")).toBeTruthy();
  });

  // ⚠️ **やめる道を残す**＝`Escape` は書き換えずに閉じる。
  it("Escape でやめられる（書き換わらない）", () => {
    open();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.doubleClick(trackRowLabel("映像1"));
    const field = screen.getByLabelText("映像1の名前") as HTMLInputElement;
    fireEvent.change(field, { target: { value: "捨てる名前" } });
    fireEvent.keyDown(field, { key: "Escape" });
    expect(useTimelineStore.getState().doc?.tracks.find((t) => t.id === "track_001")?.name).toBeUndefined();
  });

  // ⚠️ **固定した列でも名前は変えられる**＝固定が守るのは帯の位置と長さで、呼び名はそれに当たらない。
  it("固定した列でも名前を変えられる", () => {
    open({ tracks: [{ id: "track_001", kind: TRACK_KIND.visual, locked: true }] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.doubleClick(trackRowLabel("映像1"));
    const field = screen.getByLabelText("映像1の名前") as HTMLInputElement;
    fireEvent.change(field, { target: { value: "固定した列" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(useTimelineStore.getState().doc?.tracks.find((t) => t.id === "track_001")?.name).toBe("固定した列");
  });
});

// 写す・貼る（#1265）＝Ctrl+C／Ctrl+V。
describe("TimelineProjectScreen: 写す・貼る（#1265）", () => {
  it("Ctrl+C で写し、再生位置を動かして Ctrl+V で貼る（貼ったものが選ばれ、取り消し1回で消える）", () => {
    // 尺を伸ばす長い部品を別の列に置く（再生位置は尺より先へ動かせない＝元の後ろに空きが要る）。
    open({
      tracks: [{ id: "track_001", kind: TRACK_KIND.visual }, { id: "track_002", kind: TRACK_KIND.audio }, { id: "track_003", kind: TRACK_KIND.visual }],
      clips: [
        { id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 5, x: 0, y: 0, w: 100, h: 50, text: "こんにちは" },
        { id: "clip_009", kind: TIMELINE_CLIP_KIND.text, trackId: "track_003", startSec: 0, durationSec: 20, x: 0, y: 0, w: 100, h: 50, text: "長い" },
      ] as TimelineProject["clips"],
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_001"], clipClipboard: null, history: { past: [], future: [] } });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.keyDown(window, { key: "c", ctrlKey: true });
    act(() => useTimelineStore.getState().setPlayhead(6));
    fireEvent.keyDown(window, { key: "v", ctrlKey: true });
    const s = useTimelineStore.getState();
    const pasted = s.doc!.clips.filter((c) => s.selectedClipIds.includes(c.id));
    expect(pasted).toHaveLength(1);
    expect(pasted[0].id).not.toBe("clip_001");
    expect(pasted[0].startSec).toBeCloseTo(6, 5);
    act(() => useTimelineStore.getState().undo());
    expect(useTimelineStore.getState().doc!.clips.some((c) => c.id === pasted[0].id), "取り消しで消えない").toBe(false);
  });

  it("写したあとで元を直しても、写した時点の中身を貼る", () => {
    open();
    useTimelineStore.setState({ selectedClipIds: ["clip_001"], clipClipboard: null });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.keyDown(window, { key: "c", ctrlKey: true });
    act(() => useTimelineStore.getState().setClipTextFor("clip_001", "直した"));
    expect((useTimelineStore.getState().clipClipboard![0] as { text?: string }).text).toBe("こんにちは");
  });

  it("文字を打っている欄では奪わない", () => {
    open({ markers: [{ id: "marker_001", timeSec: 1 }] });
    useTimelineStore.setState({ selectedClipIds: ["clip_001"], clipClipboard: null });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.keyDown(screen.getByPlaceholderText(/メモ/), { key: "c", ctrlKey: true });
    expect(useTimelineStore.getState().clipClipboard).toBeNull();
  });
});

// 並びの何もない所から囲んで選ぶ（#1265 後半）。
describe("TimelineProjectScreen: 囲んで選ぶ（#1265）", () => {
  // jsdom は大きさを持たないので、帯の箱だけ与える（重なりの判定＝`intersectRects` は純粋関数）。
  const stub = (el: Element, left: number, top: number, width: number, height: number) => {
    (el as HTMLElement).getBoundingClientRect = () =>
      ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect;
  };
  const three = (): void => open({
    tracks: [{ id: "track_001", kind: TRACK_KIND.visual }, { id: "track_002", kind: TRACK_KIND.audio }],
    clips: [
      { id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 2, x: 0, y: 0, w: 10, h: 10, text: "一" },
      { id: "clip_002", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 3, durationSec: 2, x: 0, y: 0, w: 10, h: 10, text: "二" },
      { id: "clip_003", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 6, durationSec: 2, x: 0, y: 0, w: 10, h: 10, text: "三" },
    ] as TimelineProject["clips"],
  });
  const setup = () => {
    const r = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const band = (id: string) => r.container.querySelector(`.timeline-clip[data-clip-id="${id}"]`)!;
    stub(band("clip_001"), 100, 100, 50, 30);
    stub(band("clip_002"), 200, 100, 50, 30);
    stub(band("clip_003"), 300, 100, 50, 30);
    const lane = band("clip_001").closest(".timeline-lane")!;
    return { ...r, lane };
  };
  const down = (el: Element, x: number, y: number, extra: object = {}) =>
    fireEvent.pointerDown(el, { pointerId: 1, button: 0, buttons: 1, clientX: x, clientY: y, ...extra });
  const move = (x: number, y: number) => fireEvent.pointerMove(window, { pointerId: 1, buttons: 1, clientX: x, clientY: y });
  const up = (x: number, y: number) => fireEvent.pointerUp(window, { pointerId: 1, clientX: x, clientY: y });

  it("何もない所から囲むと、触れた帯だけを選び、離した直後の click では解かない", () => {
    three();
    useTimelineStore.setState({ selectedClipIds: [] });
    const { container, lane } = setup();
    down(lane, 90, 90);
    move(260, 140); // 一・二に触れ、三には届かない
    expect(container.querySelector(".timeline-marquee"), "囲みの矩形が見えない").not.toBeNull();
    expect(useTimelineStore.getState().selectedClipIds).toEqual(["clip_001", "clip_002"]);
    up(260, 140);
    fireEvent.click(lane, { detail: 1 }); // 指で押した click（`detail: 0` はキーの扱い）
    expect(useTimelineStore.getState().selectedClipIds, "離した直後の click で解けた").toEqual(["clip_001", "clip_002"]);
    expect(container.querySelector(".timeline-marquee"), "離しても矩形が残る").toBeNull();
  });

  it("縮めると選びから外れる（囲みの中だけを選ぶ）", () => {
    three();
    useTimelineStore.setState({ selectedClipIds: [] });
    const { lane } = setup();
    down(lane, 90, 90);
    move(260, 140);
    move(160, 140);
    expect(useTimelineStore.getState().selectedClipIds).toEqual(["clip_001"]);
    move(95, 95); // 何にも触れない
    expect(useTimelineStore.getState().selectedClipIds).toEqual([]);
  });

  it("Shift で囲むと今の選びに足す", () => {
    three();
    useTimelineStore.setState({ selectedClipIds: ["clip_003"] });
    const { lane } = setup();
    down(lane, 90, 90, { shiftKey: true });
    move(160, 140);
    expect(useTimelineStore.getState().selectedClipIds).toEqual(["clip_003", "clip_001"]);
  });

  it("Escape でやめると、囲む前の選びへ戻す", () => {
    three();
    useTimelineStore.setState({ selectedClipIds: ["clip_003"] });
    const { container, lane } = setup();
    down(lane, 90, 90);
    move(260, 140);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(useTimelineStore.getState().selectedClipIds).toEqual(["clip_003"]);
    expect(container.querySelector(".timeline-marquee")).toBeNull();
  });

  it("見えていない帯は選ばない（並びの窓の外へ送られた帯）", () => {
    three();
    useTimelineStore.setState({ selectedClipIds: [] });
    const { container, lane } = setup();
    // 並びの窓（横に送る枠）を 0〜260 に切る＝三（300〜350）は窓の外。
    const sv = container.querySelector(".timeline-scroll") as HTMLElement;
    sv.style.overflow = "auto";
    stub(sv, 0, 0, 260, 600);
    down(lane, 90, 90);
    move(400, 140); // 囲み自体は三まで届く
    expect(useTimelineStore.getState().selectedClipIds).toEqual(["clip_001", "clip_002"]);
  });

  it("囲んでいる間に並びが送られたら、始点も一緒に動く", () => {
    three();
    useTimelineStore.setState({ selectedClipIds: [] });
    const { container, lane } = setup();
    const sv = container.querySelector(".timeline-scroll") as HTMLElement;
    down(lane, 240, 90); // 二（200〜250）の上から始める
    // 100px 送られた＝帯も始点も画面上で 100px 左へ動く。
    Object.defineProperty(sv, "scrollLeft", { configurable: true, value: 100 });
    stub(container.querySelector('.timeline-clip[data-clip-id="clip_001"]')!, 0, 100, 50, 30);
    stub(container.querySelector('.timeline-clip[data-clip-id="clip_002"]')!, 100, 100, 50, 30);
    stub(container.querySelector('.timeline-clip[data-clip-id="clip_003"]')!, 200, 100, 50, 30);
    move(260, 140); // 始点は 140 へ動いている＝二の右端（150）より右は三（200〜）だけ
    expect(useTimelineStore.getState().selectedClipIds).toEqual(["clip_002", "clip_003"]);
    expect((container.querySelector(".timeline-marquee") as HTMLElement).style.left).toBe("140px");
  });

  it("帯の上から押したときは囲まない（帯をつかむ操作のまま）", () => {
    three();
    useTimelineStore.setState({ selectedClipIds: [] });
    const { container } = setup();
    const band = container.querySelector('.timeline-clip[data-clip-id="clip_003"]')!;
    down(band, 310, 110);
    move(90, 90);
    expect(container.querySelector(".timeline-marquee")).toBeNull();
    up(90, 90);
  });

  it("動かさずに押して離しただけなら、今までどおり選びを解く", () => {
    three();
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    const { lane } = setup();
    down(lane, 90, 90);
    up(90, 90);
    fireEvent.click(lane, { detail: 1 });
    expect(useTimelineStore.getState().selectedClipIds).toEqual([]);
  });
});

// 「置く」欄の素材を絵で並べ、使っている素材に印（#1264）。
describe("TimelineProjectScreen: 素材の絵と使用中の印（#1264）", () => {
  it("素材は絵つきで並び、置いてある素材にだけ「使用中」が付く（名前は変えない）", () => {
    open({
      assets: [
        { assetId: "asset_001", assetType: "image", displayName: "社屋", filePath: "assets/a.png" },
        { assetId: "asset_002", assetType: "image", displayName: "集合写真", filePath: "assets/b.png" },
      ],
      clips: [{ id: "clip_001", kind: TIMELINE_CLIP_KIND.slot, trackId: "track_001", startSec: 0, durationSec: 5, x: 0, y: 0, w: 10, h: 10, assetId: "asset_001" }] as TimelineProject["clips"],
    });
    useTimelineStore.setState({ assetSrcById: { asset_001: "data:image/png;base64,AAA", asset_002: "data:image/png;base64,BBB" } });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const place = document.querySelector('[data-panel-id="place"]') as HTMLElement;
    const used = within(place).getByRole("button", { name: "社屋" });
    const unused = within(place).getByRole("button", { name: "集合写真" });
    expect(used.closest(".picker-grid"), "絵で並べていない").not.toBeNull();
    expect(used.querySelector("img")?.getAttribute("src")).toBe("data:image/png;base64,AAA");
    expect(used.querySelector(".picker-badge")?.textContent).toBe("使用中");
    // 印は名前に混ぜず、意味を説明で届ける（見えない人にも・#1271 レビュー）。
    expect(used.title).toBe("この素材は動画に置いてあります");
    expect(used).toHaveAccessibleDescription("この素材は動画に置いてあります");
    // ⚠️ 説明の計算は `title` へ落ちるので、上だけでは読み上げに結んだことを確かめられない＝結び先を直接見る。
    expect(document.getElementById(used.getAttribute("aria-describedby") ?? "")?.textContent).toBe("この素材は動画に置いてあります");
    expect(unused.querySelector(".picker-badge"), "使っていない素材に印が付いた").toBeNull();
    expect(unused).not.toHaveAccessibleDescription("この素材は動画に置いてあります");
  });
});

// 帯の上の音量の線（#1266）＝音の部品だけ・幅のある帯だけ・見るだけ。
describe("TimelineProjectScreen: 帯の音量の線（#1266）", () => {
  const withAudio = (durationSec: number, extra: Record<string, unknown> = {}) => open({
    tracks: [{ id: "track_001", kind: TRACK_KIND.visual }, { id: "track_002", kind: TRACK_KIND.audio }],
    clips: [
      { id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 5, x: 0, y: 0, w: 10, h: 10, text: "あ" },
      { id: "clip_002", kind: TIMELINE_CLIP_KIND.audio, trackId: "track_002", startSec: 0, durationSec, bundledBgmId: BGM_CATALOG[0].id, ...extra },
    ] as TimelineProject["clips"],
  });

  it("音の帯に線を描き、フェードの始まりは下端（無音）から", () => {
    withAudio(5, { fadeInSec: 1 });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const lines = container.querySelectorAll('[data-testid="clip-volume-line"]');
    expect(lines.length, "音の帯にだけ描く").toBe(1);
    const first = lines[0].querySelector("polyline")!.getAttribute("points")!.split(" ")[0];
    expect(first, "先頭がフェードの無音から始まっていない").toBe("0.00,100.00");
    expect(lines[0].getAttribute("aria-hidden")).toBe("true");
  });

  it("細い帯には描かない（潰れて読めない）", () => {
    withAudio(1); // 段の既定 36 px/秒 → 36px（60px 未満）
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(container.querySelector('[data-testid="clip-volume-line"]')).toBeNull();
  });
});

// 繰り返し再生（#1267）＝「再生」の行の切り替え。
describe("TimelineProjectScreen: 繰り返し再生の切り替え（#1267）", () => {
  it("押すと入・切が切り替わり、作業範囲があるかで説明が変わる", () => {
    open();
    useTimelineStore.setState({ loopPlayback: false, rangeInSec: null, rangeOutSec: null });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const b = () => screen.getByRole("button", { name: /繰り返し：/ });
    expect(b().getAttribute("aria-pressed")).toBe("false");
    expect(b().title).toContain("全体を繰り返し");
    fireEvent.click(b());
    expect(useTimelineStore.getState().loopPlayback).toBe(true);
    expect(b().getAttribute("aria-pressed")).toBe("true");
    act(() => useTimelineStore.setState({ rangeInSec: 1, rangeOutSec: 3 }));
    expect(b().title).toContain("作業範囲（I〜O）を繰り返し");
    act(() => useTimelineStore.setState({ loopPlayback: false }));
  });
});

// 取り消す／やり直すの説明に中身を出す（#1268）＝ボタンの名前は「取り消す」のまま。
describe("TimelineProjectScreen: 取り消す／やり直すの中身（#1268）", () => {
  it("置いたあとは「取り消す：部品を置く」、取り消したあとは「やり直す：部品を置く」", () => {
    open({ clips: [] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "文字を置く" }));
    expect(screen.getByRole("button", { name: "取り消す" }).title).toBe("取り消す：部品を置く（Ctrl+Z）");
    fireEvent.click(screen.getByRole("button", { name: "取り消す" }));
    expect(screen.getByRole("button", { name: "やり直す" }).title).toBe("やり直す：部品を置く（Ctrl+Y）");
  });

  it("取り消すものが無いときは、中身を言わない", () => {
    open();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getByRole("button", { name: "取り消す" }).title).toBe("取り消す（Ctrl+Z）");
  });
});

// 右クリックのメニューに近道のキーを出す（#1268）＝一覧（`timelineShortcuts.ts`）と同じ値。
describe("TimelineProjectScreen: メニューの近道のキー（#1268）", () => {
  it("帯のメニューの「ここで分ける」「削除」にキーが出る（名前は変えず、読み上げにはキーとして伝える）", async () => {
    const { SHORTCUT_KEYS, TIMELINE_SHORTCUTS } = await import("../timelineShortcuts");
    open();
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.contextMenu(container.querySelector(".timeline-clip")!);
    const split = screen.getByRole("menuitem", { name: "ここで分ける" });
    const del = screen.getByRole("menuitem", { name: "削除" });
    expect(split.querySelector(".context-menu-key")?.textContent).toBe(SHORTCUT_KEYS.split);
    expect(del.querySelector(".context-menu-key")?.textContent).toBe(SHORTCUT_KEYS.remove);
    expect(split.getAttribute("aria-keyshortcuts")).toBe("Control+K");
    // 一覧にも同じ値が載っている（片方だけ変えると食い違う）。
    expect(TIMELINE_SHORTCUTS.map((x) => x.keys)).toEqual(expect.arrayContaining([SHORTCUT_KEYS.split, SHORTCUT_KEYS.remove]));
  });
});

// 近道キーの一覧（ADR-0048・#1256 c6）＝見出しの行の「キー操作」と `?` キー。
describe("TimelineProjectScreen: 近道キーの一覧（#1256 c6）", () => {
  const dialog = () => screen.queryByRole("dialog", { name: "キー操作の一覧" });

  it("見出しの行の「キー操作」で開き、閉じられる", () => {
    open();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "キー操作" }));
    expect(dialog()).not.toBeNull();
    expect(within(dialog()!).getByText("Ctrl+K")).toBeTruthy();
    expect(within(dialog()!).getByText(/再生位置で分ける/)).toBeTruthy();
    fireEvent.click(within(dialog()!).getByRole("button", { name: "閉じる" }));
    expect(dialog()).toBeNull();
  });

  it("`?` キーで開き、`Escape` で閉じる", () => {
    open();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.keyDown(window, { key: "?", shiftKey: true });
    expect(dialog()).not.toBeNull();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(dialog()).toBeNull();
  });

  // ⚠️ **読んでいる最中に画面のキーが効かない**＝一覧を開いたまま `M` を押して目印が増える、を作らない。
  it("開いている間は、画面の近道キーが効かない", () => {
    open();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.keyDown(window, { key: "?", shiftKey: true });
    fireEvent.keyDown(window, { key: "m" });
    expect(useTimelineStore.getState().doc?.markers ?? []).toEqual([]);
  });
});
