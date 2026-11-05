// @vitest-environment jsdom
// タイムライン編集プロジェクトの画面（ADR-0032・#629 骨格）＝中身を直す欄・キーと数値・説明・字体・実寸・帯の作法・拡大縮小。
// ⚠️ **1つのファイルで約10分かかっていたので分けた**（負荷・耐久の点検 2026-10-22）＝ほかと一緒に走ると時間切れで
//   たまに落ちていた。共有の下ごしらえ（文書・開き方・テスト間の後片づけ）は `src/test/timelineScreenKit.tsx` に1つ。
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, fireEvent, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ZOOM_LEVELS } from "../../domain/timeline/zoom";
import { pointerDownAt } from "../../test/pointer";
import { CLIP_HANDLE_HIT_W_PX, CLIP_HANDLE_W_PX, CLIP_MENU_W_PX, TimelineProjectScreen } from "./TimelineProjectScreen";
import { useTimelineStore } from "../store/timelineStore";
import { BGM_CATALOG } from "../../domain/bgm/bgmCatalog";
import { lockedTrackMessage, clockLabel } from "../uiLabels";
import { useProjectStore } from "../store/projectStore";
import { NARRATION_STATUS, TIMELINE_CLIP_KIND, TRACK_KIND } from "../../domain/enums";
import { TIMELINE_CLIP_INSET_PX, TIMELINE_LABEL_W_PX, TIMELINE_LANE_H_PX } from "../../domain/constants";
import type { Template } from "../../domain/template/types";
import { open, openPlaceTab, resetTimelineScreenBetweenTests } from "../../test/timelineScreenKit";

resetTimelineScreenBetweenTests();


// 中身を直す欄の関門と履歴（#720）。共有部品は props を受け取れなければ**黙って捨てる**ので、
// 「渡している」ことではなく「効いている」ことを画面ごしに固定する。
describe("TimelineProjectScreen: 中身を直す欄（#720）", () => {
  const withText = () => {
    open();
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
  };
  const withShape = () => {
    open({ clips: [{ id: "clip_001", kind: TIMELINE_CLIP_KIND.shape, trackId: "track_001", startSec: 0, durationSec: 5, x: 0, y: 0, w: 400, h: 300, fillColor: "#ff0000" }] });
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
  };

  it("書き出しの最中は色を触れない（押してから断らない）", () => {
    withText();
    useTimelineStore.setState({ exportRun: { phase: "rendering", percent: 10, message: null, cancelling: false } });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getByRole("button", { name: "文字の色" })).toBeDisabled();
    // 理由も一緒に届いていること（押せないのに理由が無い＝なぜ触れないか分からない）。
    expect(screen.getByRole("button", { name: "文字の色" })).toHaveAttribute("title", "いま動画を書き出しています。終わってから編集してください");
    expect(screen.getByText("この部品の文字の形").parentElement?.querySelector("button")).toBeDisabled();
  });

  it("枠への収め方も、書き出しの最中は触れない", () => {
    open({ clips: [{ id: "clip_001", kind: TIMELINE_CLIP_KIND.slot, trackId: "track_001", startSec: 0, durationSec: 5, x: 0, y: 0, w: 100, h: 50 }] });
    useTimelineStore.setState({ selectedClipIds: ["clip_001"], exportRun: { phase: "rendering", percent: 10, message: null, cancelling: false } });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const fit = [...document.querySelectorAll("select")].find((el) => el.querySelector('option[value="cover"]'));
    expect(fit).toBeDisabled();
  });

  it("固定した列の部品は色を触れない（動かせないのに中身は変えられる、を作らない）", () => {
    open({ tracks: [{ id: "track_001", kind: TRACK_KIND.visual, locked: true }, { id: "track_002", kind: TRACK_KIND.audio }] });
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getByRole("button", { name: "文字の色" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "文字の色" })).toHaveAttribute("title", lockedTrackMessage("content"));
  });

  // 図形の色は**別の JSX 箇所**に同じ3行を書いている（共有関数の中身ではない）ので、
  // 文字の色のテストでは「図形側だけ落ちた」退行を拾えない＝同じ観点をこちらにも置く。
  it("図形の色も、書き出しの最中は触れない", () => {
    withShape();
    useTimelineStore.setState({ exportRun: { phase: "rendering", percent: 10, message: null, cancelling: false } });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getByRole("button", { name: "図形の色" })).toBeDisabled();
  });

  it("図形の色も、ひと撫での取り消しは1回ぶん", () => {
    withShape();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const before = useTimelineStore.getState().history.past.length;
    fireEvent.click(screen.getByRole("button", { name: "図形の色" }));
    const sv = screen.getByTestId("cp-sv");
    sv.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    fireEvent.pointerDown(sv, { pointerId: 1, button: 0, buttons: 1, clientX: 10, clientY: 90 });
    for (const x of [20, 30, 40, 50, 60]) fireEvent.pointerMove(sv, { pointerId: 1, buttons: 1, clientX: x, clientY: 90 });
    fireEvent.pointerUp(sv, { pointerId: 1, clientX: 60, clientY: 90 });
    expect(useTimelineStore.getState().history.past.length).toBe(before + 1);
  });

  it("**色の面を撫でている間も倍率を変えられない**（合図が1つで配線が切れていない・#752-2）", () => {
    // ⚠️ 部品どうしの配線を見る＝`ColorPicker` が「掴んでいる」に入れる側と、`changeZoom` が
    // それを読む側は別々に固めてあるが、この画面でつながっているかは**ここでしか分からない**。
    withShape();
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    // 幅で測る（この部品は0秒に置かれるので `left` は倍率で変わらない）。
    const bandWidth = () => (container.querySelectorAll(".timeline-clip")[0] as HTMLElement).style.width;
    const before = bandWidth();
    fireEvent.click(screen.getByRole("button", { name: "図形の色" }));
    const sv = screen.getByTestId("cp-sv");
    sv.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    fireEvent.pointerDown(sv, { pointerId: 1, button: 0, buttons: 1, clientX: 10, clientY: 90 });
    fireEvent.click(screen.getByLabelText("表示を広げる"));
    expect(bandWidth()).toBe(before); // 撫でている間は効かない
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 60, clientY: 90 });
    fireEvent.click(screen.getByLabelText("表示を広げる"));
    expect(bandWidth()).not.toBe(before); // 離せば効く（塞ぎっぱなしにしない）
  });

  it("開いている最中に書き出しが始まったら、色の面ごと閉じる（#730 レビュー）", () => {
    withText();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    // キーボードで開く（`Enter`＝`detail:0` の click）。**外側の pointerdown が起きない**ので、
    // 外側クリックで閉じる仕掛けは働かない。
    fireEvent.click(screen.getByRole("button", { name: "文字の色" }));
    expect(screen.getByTestId("cp-sv")).toBeInTheDocument();
    // 同じくキーボードで「動画を書き出す」を押した、に相当する状態変化。
    act(() => {
      useTimelineStore.setState({ exportRun: { phase: "rendering", percent: 0, message: null, cancelling: false } });
    });
    // 開いたままだと、面・色相バー・パレット・色コード欄は触れてしまい（`disabled` は見本のボタンにしか
    // 効かない）、撫でるとピッカーの見た目だけ追従して部品は変わらず、あとから断り文が出る。
    expect(screen.queryByTestId("cp-sv")).not.toBeInTheDocument();
  });

  it("フォントの一覧も、開いている最中に書き出しが始まったら閉じる（同概念同挙動）", () => {
    withText();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const trigger = screen.getByText("この部品の文字の形").parentElement?.querySelector("button") as HTMLElement;
    fireEvent.click(trigger);
    expect(screen.getByText("怪盗予告ゴシック")).toBeInTheDocument(); // 一覧が開いている
    act(() => {
      useTimelineStore.setState({ exportRun: { phase: "rendering", percent: 0, message: null, cancelling: false } });
    });
    expect(screen.queryByText("怪盗予告ゴシック")).not.toBeInTheDocument();
  });

  it("色の面をひと撫でしても取り消しは1回ぶん（履歴を流し切らない）", () => {
    withText();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const before = useTimelineStore.getState().history.past.length;
    fireEvent.click(screen.getByRole("button", { name: "文字の色" }));
    const sv = screen.getByTestId("cp-sv");
    sv.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    fireEvent.pointerDown(sv, { pointerId: 1, button: 0, buttons: 1, clientX: 10, clientY: 90 });
    // 面のドラッグは `pointermove` ごとに値が返る。区切りが無いと1回ごとに履歴が積まれる。
    for (const x of [20, 30, 40, 50, 60]) fireEvent.pointerMove(sv, { pointerId: 1, buttons: 1, clientX: x, clientY: 90 });
    fireEvent.pointerUp(sv, { pointerId: 1, clientX: 60, clientY: 90 });
    expect(useTimelineStore.getState().history.past.length).toBe(before + 1);
    expect((useTimelineStore.getState().doc?.clips[0].color ?? "").toLowerCase()).not.toBe("");
  });
});

// キーボードと、開始秒・長さの数値欄（#721・ADR-0034 決定18/決定6）。
// **どの入口からでも同じ結果**になることを画面ごしに固定する（キーだけ関門を素通りする、を作らない）。
describe("TimelineProjectScreen: キーと数値で触れる（#721）", () => {
  const one = () =>
    open({ clips: [{ id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 5, x: 0, y: 0, w: 100, h: 50, text: "あ" }] });
  const key = (k: string, init: Record<string, unknown> = {}) => fireEvent.keyDown(window, { key: k, ...init });
  // ⚠️ `parentElement` で辿ると**行**に当たり、隣の欄の input を掴む（開始と長さは同じ行に並ぶ）。
  // ラベル要素そのものを基準にする（`NumberField` は `<label>` が input を包む）。
  const field = (name: string) =>
    (screen.getByText(name).closest("label") as HTMLElement).querySelector("input") as HTMLInputElement;

  it("Space で再生・停止する（押した要素が Space で反応するときは譲る）", () => {
    one();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    key(" ");
    expect(useTimelineStore.getState().isPlaying).toBe(true);
    key(" ");
    expect(useTimelineStore.getState().isPlaying).toBe(false);
    // ボタンにフォーカスがあるときは奪わない（消えたうえに再生が始まる、を作らない）。
    fireEvent.keyDown(screen.getByRole("button", { name: "先頭へ" }), { key: " " });
    expect(useTimelineStore.getState().isPlaying).toBe(false);
  });

  it("←→ で1フレームずつ、Shift で1秒ずつ動く", () => {
    one();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    key("ArrowRight");
    expect(useTimelineStore.getState().playheadSec).toBeCloseTo(1 / 30, 5);
    key("ArrowRight", { shiftKey: true });
    expect(useTimelineStore.getState().playheadSec).toBeCloseTo(1 + 1 / 30, 5);
    key("ArrowLeft", { shiftKey: true });
    expect(useTimelineStore.getState().playheadSec).toBeCloseTo(1 / 30, 5);
    // 先頭より前へは行かない（尺の外に位置を作らない）。
    key("ArrowLeft", { shiftKey: true });
    expect(useTimelineStore.getState().playheadSec).toBe(0);
  });

  it("セレクトに手がかかっているときは矢印を奪わない（その欄の値が変わらず位置だけ動く、を作らない）", () => {
    one();
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    // 「選んだ部品」の欄の「載っている列」（#819-3 で置く側の「置く列」と名前を分けた）。
    const panel = document.querySelector('[data-panel-id="selected"]') as HTMLElement;
    const select = within(panel).getByLabelText("載っている列");
    fireEvent.keyDown(select, { key: "ArrowRight" });
    expect(useTimelineStore.getState().playheadSec).toBe(0);
  });

  it("Delete で消す（1つなら即時・取り消しで戻る）", () => {
    one();
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    key("Delete");
    expect(useTimelineStore.getState().doc!.clips).toEqual([]);
    act(() => { useTimelineStore.getState().undo(); });
    expect(useTimelineStore.getState().doc!.clips).toHaveLength(1); // 取り消しで戻る
  });

  it("Delete でまとめて消すときも確認を通す（キーだけ確認なし、を作らない）", () => {
    open({
      clips: [
        { id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 2, x: 0, y: 0, w: 10, h: 10, text: "あ" },
        { id: "clip_002", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 3, durationSec: 2, x: 0, y: 0, w: 10, h: 10, text: "い" },
      ],
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_001", "clip_002"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    key("Delete");
    expect(useTimelineStore.getState().doc!.clips).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "削除する" }));
    expect(useTimelineStore.getState().doc!.clips).toEqual([]);
  });

  it("確認を出している間は、キーで背後を触らせない（答えたのに何も起きない、を作らない）", () => {
    // ⚠️ 3つ置く＝2つだと `Ctrl+A` が通っても選択数が変わらず、**関門の位置を確かめられない**。
    open({
      clips: [
        { id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 2, x: 0, y: 0, w: 10, h: 10, text: "あ" },
        { id: "clip_002", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 3, durationSec: 2, x: 0, y: 0, w: 10, h: 10, text: "い" },
        { id: "clip_003", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 6, durationSec: 2, x: 0, y: 0, w: 10, h: 10, text: "う" },
      ],
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_001", "clip_002"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    key("Delete");
    expect(screen.getByText("選んだ2個の部品を削除しますか？")).toBeInTheDocument();
    // 再生位置も動かさない（答えを求めている最中に別の操作を通さない）。
    key("ArrowRight");
    expect(useTimelineStore.getState().playheadSec).toBe(0);
    // **全選択も通さない**＝通ると「2個」と聞いて全部消える（関門は `Ctrl+A` より前に無いといけない）。
    key("a", { ctrlKey: true });
    expect(useTimelineStore.getState().selectedClipIds).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "削除する" }));
    expect(useTimelineStore.getState().doc!.clips.map((c) => c.id)).toEqual(["clip_003"]);
  });

  // #354：`Escape` は**確認への答え（やめる）**として扱う。背後の選択は解かない。
  // ⚠️ 以前はこの確認が `Escape` を無視しており、キーボードだけでは「やめる」に到達できなかった。
  // 「答えるまで残す」（#547 P2-9）は**別の状態の変化で勝手に消さない**という規則で、
  // 利用者が押した `Escape` はその「答え」にあたる（消して足し直したら蘇る、とは別の話）。
  it("確認が出ている間の Escape は「やめる」（背後の選択は解かない）", () => {
    open({
      clips: [
        { id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 2, x: 0, y: 0, w: 100, h: 40, text: "あ" },
        { id: "clip_002", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 3, durationSec: 2, x: 0, y: 0, w: 100, h: 40, text: "い" },
      ],
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_001", "clip_002"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    key("Delete");
    expect(screen.getByText("選んだ2個の部品を削除しますか？")).toBeInTheDocument();
    key("Escape");
    expect(screen.queryByRole("button", { name: "削除する" })).toBeNull(); // 確認は閉じる
    expect(useTimelineStore.getState().selectedClipIds).toHaveLength(2); // 背後は触らない
    expect(useTimelineStore.getState().doc!.clips).toHaveLength(2); // 消えてもいない
  });

  it("色の面など、開いているものがある間もキーで背後を触らせない", () => {
    one();
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    // 色の面は自分で `Escape` を受け持つ（名乗る）だけで、画面の `overlayOpen` には出ない。
    // 材料を `Escape` と揃えていないと、開いたまま `Delete` で背後の部品が消える。
    fireEvent.click(screen.getByRole("button", { name: "文字の色" }));
    key("Delete");
    expect(useTimelineStore.getState().doc!.clips).toHaveLength(1);
  });

  it("確認は**聞いた相手**を消す（出したまま選び直しても、聞いた数と消える数がずれない）", () => {
    open({
      clips: [
        { id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 2, x: 0, y: 0, w: 10, h: 10, text: "あ" },
        { id: "clip_002", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 3, durationSec: 2, x: 0, y: 0, w: 10, h: 10, text: "い" },
        { id: "clip_003", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 6, durationSec: 2, x: 0, y: 0, w: 10, h: 10, text: "う" },
      ],
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_001", "clip_002"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    key("Delete");
    expect(screen.getByText("選んだ2個の部品を削除しますか？")).toBeInTheDocument();
    // この確認は覆いではなく知らせの段なので、背後の選択は**プログラム上は**変えられる
    //（帯を押す・別の入口から選び直す）。数だけ持っていると「2個」と聞いて1個/3個が消える。
    act(() => { useTimelineStore.setState({ selectedClipIds: ["clip_003"] }); });
    fireEvent.click(screen.getByRole("button", { name: "削除する" }));
    expect(useTimelineStore.getState().doc!.clips.map((c) => c.id)).toEqual(["clip_003"]);
  });

  it("長さを入れ直しても、欄に17桁が出ない（引き算の残差を残さない）", () => {
    // 開始秒が端数のクリップ（つかんで置く・「再生位置へ」で普通に起きる）。
    open({ clips: [{ id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0.32, durationSec: 5, x: 0, y: 0, w: 10, h: 10, text: "あ" }] });
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const len = field("長さ（秒）");
    fireEvent.change(len, { target: { value: "2" } });
    fireEvent.blur(len);
    // `(0.32 + 2) - 0.32 = 1.9999999999999998` がそのまま欄に出ていた（#561 が消したはずの症状）。
    expect(useTimelineStore.getState().doc!.clips[0].durationSec).toBe(2);
  });

  it("**箱を持つ部品を1つ選んでいる間は、矢印で少しだけ動かす**（決定18・#752-9）", () => {
    one();
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const before = useTimelineStore.getState().playheadSec;
    key("ArrowRight");
    expect(useTimelineStore.getState().doc!.clips[0].x).toBe(1); // 1px 動く
    key("ArrowDown", { shiftKey: true });
    expect(useTimelineStore.getState().doc!.clips[0].y).toBe(10); // Shift は 10px
    expect(useTimelineStore.getState().playheadSec).toBe(before); // 再生位置は動かさない
    // ⚠️ **逆向きも見る**（#752 レビュー）＝正の向きだけ固定すると、左と上の符号を取り違えても
    // 誰も気づかない（4方向のうち2方向が「テストの外」になる）。
    key("ArrowLeft");
    expect(useTimelineStore.getState().doc!.clips[0].x).toBe(0);
    key("ArrowUp", { shiftKey: true });
    expect(useTimelineStore.getState().doc!.clips[0].y).toBe(0);
  });

  it("**まとめて選んでいるときも一緒に動かす**（個数で意味を変えない・#752 レビュー）", () => {
    open({
      tracks: [{ id: "track_001", kind: TRACK_KIND.visual }, { id: "track_002", kind: TRACK_KIND.visual }],
      clips: [
        { id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 3, x: 0, y: 0, w: 100, h: 50, text: "あ" },
        { id: "clip_002", kind: TIMELINE_CLIP_KIND.text, trackId: "track_002", startSec: 0, durationSec: 3, x: 40, y: 20, w: 100, h: 50, text: "い" },
      ],
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_001", "clip_002"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    key("ArrowRight", { shiftKey: true });
    const cs = useTimelineStore.getState().doc!.clips;
    expect(cs[0].x).toBe(10);
    expect(cs[1].x).toBe(50); // 相対の位置は崩れない
  });

  it("箱を持たない相手が混ざっていても、箱を持つものだけ動かす（#752 レビュー）", () => {
    open({
      tracks: [{ id: "track_001", kind: TRACK_KIND.visual }, { id: "track_002", kind: TRACK_KIND.audio }],
      clips: [
        { id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 3, x: 0, y: 0, w: 100, h: 50, text: "あ" },
        { id: "clip_002", kind: TIMELINE_CLIP_KIND.voice, trackId: "track_002", startSec: 0, durationSec: 3, voice: { text: "い", status: NARRATION_STATUS.none } },
      ],
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_001", "clip_002"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    key("ArrowRight");
    expect(useTimelineStore.getState().doc!.clips[0].x).toBe(1);
    // ⚠️ **混ざっていた相手に箱を生やさない**（読み上げに位置は無い＝保存も通らない）。
    expect(useTimelineStore.getState().doc!.clips[1]).not.toHaveProperty("x");
  });

  it("**選んでいても見えていなければ奪わない**（画面が変わらないのに文書だけ動く、を作らない・#752 レビュー）", () => {
    // ⚠️ 再生位置の外にある部品はキャンバスに出ていない＝動かしても**どこも変わらない**。
    // そのまま自動保存されるので、あとから見ると理由の分からないずれになる。
    open({ clips: [{ id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 5, durationSec: 3, x: 0, y: 0, w: 100, h: 50, text: "あ" }] });
    useTimelineStore.setState({ selectedClipIds: ["clip_001"], playheadSec: 0 }); // 部品は 5秒から＝いま出ていない
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    key("ArrowRight");
    expect(useTimelineStore.getState().doc!.clips[0].x).toBe(0); // 動かさない
    expect(useTimelineStore.getState().playheadSec).toBeGreaterThan(0); // 再生位置は送る
  });

  it("**押し続けても取り消しは1回ぶん**（履歴の上限を数秒で流し切らない・#752 レビュー）", () => {
    one();
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const before = useTimelineStore.getState().history.past.length;
    for (let i = 0; i < 8; i++) key("ArrowRight");
    expect(useTimelineStore.getState().doc!.clips[0].x).toBe(8); // 8px 動く
    expect(useTimelineStore.getState().history.past.length).toBe(before + 1); // 取り消しは1つ
  });

  it("選んでいないときは矢印で再生位置を送る（文脈で分かれる・#752-9）", () => {
    one();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    key("ArrowRight");
    expect(useTimelineStore.getState().playheadSec).toBeGreaterThan(0);
    expect(useTimelineStore.getState().doc!.clips[0].x).toBe(0); // 部品は動かない
  });

  it("**動かせない部品では矢印を奪わない**（行き止まりを作らない・#752-9）", () => {
    // ⚠️ 固定した列の部品を選んだまま奪うと、部品も動かず再生位置も送れない。
    // ⚠️ **部品はキャンバスに出ている状態にする**（`startSec: 0`・#759 レビュー）＝出ていないと
    // その時点で対象から外れ、**固定の判定まで届かない**（テストの名前と、実際に通る道が食い違う）。
    open({
      tracks: [{ id: "track_001", kind: TRACK_KIND.visual, locked: true }, { id: "track_002", kind: TRACK_KIND.audio }],
      clips: [{ id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 5, x: 0, y: 0, w: 100, h: 50, text: "あ" }],
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    key("ArrowRight");
    expect(useTimelineStore.getState().doc!.clips[0].x).toBe(0);
    expect(useTimelineStore.getState().playheadSec).toBeGreaterThan(0); // 再生位置は動く
  });

  it("箱を持たない部品（読み上げ・音）では矢印を奪わない（#752-9）", () => {
    open({
      tracks: [{ id: "track_001", kind: TRACK_KIND.visual }, { id: "track_002", kind: TRACK_KIND.audio }],
      clips: [{ id: "clip_001", kind: TIMELINE_CLIP_KIND.voice, trackId: "track_002", startSec: 1, durationSec: 5, voice: { text: "あ", status: NARRATION_STATUS.none } }],
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    key("ArrowRight");
    expect(useTimelineStore.getState().playheadSec).toBeGreaterThan(0);
  });

  it("断る理由は**画面の内側だけ**で使う（描画結果に出さない・#752-3 レビュー）", () => {
    open({
      tracks: [{ id: "track_001", kind: TRACK_KIND.visual, locked: true }, { id: "track_002", kind: TRACK_KIND.audio }],
      clips: [{ id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 5, x: 0, y: 0, w: 10, h: 10, text: "あ" }],
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const del = screen.getByRole("button", { name: "削除" });
    // ⚠️ 押せない理由の**組**をそのままボタンへ流すと、内部の合図が属性として描かれる
    //（React は知らない小文字の属性を素通しする＝§2-3 の「技術用語を出さない」に触れる）。
    expect(del.getAttribute("reason")).toBeNull();
  });

  it("Delete も固定した列の部品は消せない（ボタンと同じ関門を通る）", () => {
    open({
      tracks: [{ id: "track_001", kind: TRACK_KIND.visual, locked: true }, { id: "track_002", kind: TRACK_KIND.audio }],
      clips: [{ id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 5, x: 0, y: 0, w: 10, h: 10, text: "あ" }],
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    key("Delete");
    expect(useTimelineStore.getState().doc!.clips).toHaveLength(1);
    // ⚠️ **キーには理由を出す**（#752-3）。以前はここで「断り文は出ない」を固定していたが、
    // それはボタンの説明が見えている前提の書き方だった＝**キーを押した人はボタンを指していない**。
    // 分ける `Ctrl+K` は理由を立てるのに消すだけ黙る、という非対称も消える（ADR-0026②）。
    expect(useTimelineStore.getState().editBlocked?.reason).toBe("TIMELINE_EDIT_LOCKED_SELECTION");
    expect(screen.getByText(/固定を外すか、選び直してください/)).toBeInTheDocument();
    // 理由はボタンの側にも、押す前から出ている（押せないことも一緒に見る）。
    expect(screen.getByRole("button", { name: "削除" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "削除" }).getAttribute("title")).toContain("固定を外すか");
  });

  it("開始・長さを数値で揃えられる（ボタンだけでは「3.0秒から」に合わせられない）", () => {
    one();
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const start = field("開始（秒）");
    fireEvent.change(start, { target: { value: "3" } });
    fireEvent.blur(start);
    expect(useTimelineStore.getState().doc!.clips[0].startSec).toBe(3);
    const len = field("長さ（秒）");
    fireEvent.change(len, { target: { value: "2" } });
    fireEvent.blur(len);
    // 長さは**終わりの端**を動かす＝始まりは動かない。
    expect(useTimelineStore.getState().doc!.clips[0]).toMatchObject({ startSec: 3, durationSec: 2 });
  });

  it("数値欄も固定した列では触れない", () => {
    open({
      tracks: [{ id: "track_001", kind: TRACK_KIND.visual, locked: true }, { id: "track_002", kind: TRACK_KIND.audio }],
      clips: [{ id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 5, x: 0, y: 0, w: 10, h: 10, text: "あ" }],
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(field("開始（秒）")).toBeDisabled();
    expect(field("長さ（秒）")).toBeDisabled();
  });
});

// 案内の指す先が実在するか（#723・ADR-0034 決定5）。**文言の中で名指ししたものが、この画面にある**ことを固定する。
// 文言だけ直しても、指す先が消えれば元の行き止まりへ戻る＝両方を1つのテストで見る。
describe("TimelineProjectScreen: 案内が行き止まりでない（#723）", () => {
  it("音が見つからないときの案内が指す「鳴らす音」の欄が実在する", () => {
    open({
      assets: [],
      tracks: [{ id: "track_001", kind: TRACK_KIND.visual }, { id: "track_002", kind: TRACK_KIND.audio }],
      clips: [{ id: "clip_001", kind: TIMELINE_CLIP_KIND.audio, trackId: "track_002", startSec: 0, durationSec: 5, assetId: "asset_missing" }],
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getAllByRole("alert").some((el) => el.textContent?.includes("「鳴らす音」で選び直す"))).toBe(true);
    expect(screen.getByText("鳴らす音")).toBeInTheDocument(); // 指した先が同じ画面にある
  });

  it("鳴らす音を選び直せる（同梱BGM と、この動画が持っている音）", () => {
    open({
      assets: [{ assetId: "asset_001", assetType: "bgm", displayName: "曲", filePath: "assets/asset_001.mp3" }],
      tracks: [{ id: "track_001", kind: TRACK_KIND.visual }, { id: "track_002", kind: TRACK_KIND.audio }],
      clips: [{ id: "clip_001", kind: TIMELINE_CLIP_KIND.audio, trackId: "track_002", startSec: 0, durationSec: 5, assetId: "asset_missing", volume: 0.5 }],
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const select = screen.getByText("鳴らす音").closest("label")?.querySelector("select") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "asset:asset_001" } });
    // 消して置き直すのと違い、**音量などの設定は残る**（この欄がある理由）。
    expect(useTimelineStore.getState().doc!.clips[0]).toMatchObject({ assetId: "asset_001", volume: 0.5 });
    // ⚠️ **曲の名前は画面で使う言い方**（#802-2）＝目録は「`label`/`note` は選択UI・`title`/`artist` は
    // クレジット専用」と定めており、置く欄・帯の名前も `label`。ここだけ原題に戻ると**同じ物が
    // 画面内で別の名**になる（ADR-0026②）ので、先祖返りを止める。
    expect(select.textContent).toContain(BGM_CATALOG[0].label);
    expect(select.textContent).not.toContain(BGM_CATALOG[0].title);
  });

  it("音が見つからない部品では、別の曲が選ばれているように見せない（#734 レビュー）", () => {
    open({
      assets: [],
      tracks: [{ id: "track_001", kind: TRACK_KIND.visual }, { id: "track_002", kind: TRACK_KIND.audio }],
      clips: [{ id: "clip_001", kind: TIMELINE_CLIP_KIND.audio, trackId: "track_002", startSec: 0, durationSec: 5, assetId: "asset_missing" }],
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const select = screen.getByText("鳴らす音").closest("label")?.querySelector("select") as HTMLSelectElement;
    // ⚠️ `value` に合う `option` が無いと、ブラウザは**先頭の候補を選択済みに見せる**＝
    // 「見つかりません」と警告しているのに、欄では別の曲が入っているように読める（§2-5）。
    expect(select.selectedOptions[0]?.textContent).toContain("見つかりません");
    expect(select.value).toBe("asset:asset_missing"); // いまの値が保たれている（別の音に化けない）
  });

  it("何も置いていないときの案内が指すボタンが実在する", () => {
    open({ clips: [] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getByText(/「文字を置く」を押すと再生位置へ置けます/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "文字を置く" })).toBeInTheDocument();
  });

  it("置ける列が無いときの案内は、固定だけでなく非表示も言う（絞り込みが両方を除いている）", () => {
    open({
      tracks: [{ id: "track_001", kind: TRACK_KIND.visual, hidden: true }, { id: "track_002", kind: TRACK_KIND.audio, hidden: true }],
      clips: [],
    });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    // 「固定を外してください」だけだと、言われたとおりにしても直らない。
    for (const el of screen.getAllByText(/置ける.*列がありません/)) {
      expect(el.textContent).toContain("固定・非表示");
    }
  });
});

// 置く先の見せ方（#724）。**欄に出ている列＝実際に置く列**で、既定はどの種別も「いちばん手前」。
describe("TimelineProjectScreen: どこへ置くかを見せる（#724）", () => {
  // 見た目パターンの欄は「置ける見た目パターンが1つもない」と列の欄ごと出ないので、1つ用意する。
  const aTemplate: Template = {
    schemaVersion: "1.0", templateId: "tmpl_001", name: "見本", category: "photo_intro",
    aspectRatio: "16:9", canvas: { width: 1920, height: 1080 },
    layers: [{ id: "background", type: "background", x: 0, y: 0, w: 1920, h: 1080 }],
    defaults: { durationSec: 5 },
  } as unknown as Template;
  const twoEach = () => {
    useProjectStore.setState({ templates: [aTemplate] });
    return open({
      tracks: [
        { id: "track_001", kind: TRACK_KIND.visual }, // 奥
        { id: "track_002", kind: TRACK_KIND.visual }, // 手前
        { id: "track_003", kind: TRACK_KIND.audio },  // 奥
        { id: "track_004", kind: TRACK_KIND.audio },  // 手前
      ],
      clips: [],
    });
  };
  /**
   * その種別の「置く列」の欄（#1031＝置くものは1つの欄のタブになった）。
   *
   * ⚠️ **タブを開いてから読む**＝閉じているタブの中身は描かれない。
   */
  const placeSelect = (tab: string) => {
    openPlaceTab(tab);
    return (document.querySelector('[data-panel-id="place"]') as HTMLElement)
      .querySelector("select") as HTMLSelectElement;
  };

  it("音・読み上げにも「置く列」が出る（無言で1本に固定しない）", () => {
    twoEach();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(placeSelect("音")).not.toBeNull();
    expect(placeSelect("読み上げ")).not.toBeNull();
  });

  it("既定はどの種別も**いちばん手前**の置ける列（種別で割らない）", () => {
    twoEach();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    // 手前＝配列の末尾（`11 §7.6` の重ね順）。奥を既定にすると、手前の部品の裏に隠れる（#722 と同じ理由）。
    expect(placeSelect("音").value).toBe("track_004");
    expect(placeSelect("見た目パターン").value).toBe("track_002");
  });

  it("見た目パターンの「置く列」が空欄で固まらない（どこへ入るか読めない、を作らない）", () => {
    twoEach();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(placeSelect("見た目パターン").value).not.toBe("");
  });

  it("読み上げは選んだ列へ置く（欄に出ている列＝実際の置き先）", () => {
    twoEach();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.change(placeSelect("読み上げ"), { target: { value: "track_003" } });
    openPlaceTab("読み上げ");
    fireEvent.click(screen.getByRole("button", { name: "読み上げを置く" }));
    expect(useTimelineStore.getState().doc!.clips[0].trackId).toBe("track_003");
  });

  it("音量とフェードは読み上げにも出る（点は置けるのに基準は直せない、を作らない）", () => {
    open({
      tracks: [{ id: "track_001", kind: TRACK_KIND.visual }, { id: "track_002", kind: TRACK_KIND.audio }],
      clips: [{ id: "clip_001", kind: TIMELINE_CLIP_KIND.voice, trackId: "track_002", startSec: 0, durationSec: 3, voice: { text: "あ", status: "none" } }],
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    // 「音量」は節の見出しと入力欄の両方にあるので、**入力欄がある**ことで見る。
    expect(screen.getAllByText("音量").some((el) => el.closest("label")?.querySelector("input"))).toBe(true);
    expect(screen.getByText("だんだん大きく（秒）")).toBeInTheDocument();
    // 素材の話（速さ・使い始め）は出さない＝声の長さは実尺で合わせてあるので、変えると区間とずれる。
    expect(screen.queryByText("速さ（倍）")).not.toBeInTheDocument();
    expect(screen.queryByText("素材の使い始め（秒）")).not.toBeInTheDocument();
  });
});

// フォントの継承（#731）。`null` = 動画全体に合わせる、を**画面が表せる**ことを固定する。
describe("TimelineProjectScreen: フォントは動画全体に合わせられる（#731）", () => {
  const textClip = (over: Record<string, unknown> = {}) => {
    open({
      videoSettings: { aspectRatio: "16:9", fps: 30, targetDurationSec: 60, maxDurationSec: 600, fontId: "kaitou-yokoku-gothic" },
      clips: [{ id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 5, x: 0, y: 0, w: 100, h: 50, text: "あ", ...over }],
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
  };
  // ⚠️ 見出しは `<label htmlFor>` で欄と結ばれている（#1075）＝包む形ではなくなったので、結び先から掴む。
  const trigger = () => {
    const label = screen.getByText("この部品の文字の形") as HTMLLabelElement;
    return document.getElementById(label.htmlFor) as HTMLElement;
  };
  // ⚠️ 引き金のボタンも継承中は同じ文字を出すので、**一覧の中の項目**に絞る（`li` の中にある方）。
  const inheritOption = () =>
    screen.getAllByText("動画全体に合わせる").find((el) => el.closest("li"))?.closest("button") as HTMLElement;

  it("指定が無いときは「動画全体に合わせる」と出す（既定の字体名を現在値に見せない）", () => {
    textClip();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    // 動画全体は「怪盗予告ゴシック」なので、既定の字体名を出すと**表示と実際が食い違う**。
    expect(trigger().textContent).toContain("動画全体に合わせる");
  });

  it("選んだあと「動画全体に合わせる」へ戻せる（戻したらキーごと落ちる）", () => {
    textClip({ fontId: "gen-interface-jp-display" });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(trigger());
    fireEvent.click(inheritOption());
    expect("fontId" in useTimelineStore.getState().doc!.clips[0]).toBe(false);
  });

  it("すでに「動画全体に合わせる」のときに選び直しても、取り消しは増えない（空振りしない）", () => {
    textClip();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const before = useTimelineStore.getState().history.past.length;
    fireEvent.click(trigger());
    fireEvent.click(inheritOption());
    expect(useTimelineStore.getState().history.past.length).toBe(before);
  });
});

// 素材の実寸を測る回数（#724）。効果が**自分の出力**（`assetSizes`）を依存に持つと、1件測れるたびに
// 未計測の全素材を作り直す＝素材 N 件で最悪 O(N²)。「一度始めたものは二度始めない」を固定する。
describe("TimelineProjectScreen: 実寸は素材1つにつき一度だけ測る（#724）", () => {
  const originalImage = window.Image;
  afterEach(() => { window.Image = originalImage; });

  /** 生成された偽 `Image` を集める（`onload` は手で発火させる）。 */
  function stubImage(): { made: { src: string; fire: () => void }[] } {
    const made: { src: string; fire: () => void }[] = [];
    /* eslint-disable @typescript-eslint/no-explicit-any */
    (window as any).Image = function (this: any) {
      const el: any = { naturalWidth: 100, naturalHeight: 50, onload: null, onerror: null };
      const rec = { src: "", fire: () => el.onload?.() };
      Object.defineProperty(el, "src", { set(v: string) { rec.src = v; }, get() { return rec.src; } });
      made.push(rec);
      return el;
    } as unknown as typeof Image;
    return { made };
  }

  const withAssets = (n: number) => {
    const assets = Array.from({ length: n }, (_, i) => ({
      assetId: `asset_${String(i + 1).padStart(3, "0")}`,
      assetType: "image" as const,
      displayName: `写真${i + 1}`,
      filePath: `assets/a${i}.png`,
    }));
    open({ assets, clips: [] });
    useTimelineStore.setState({
      assetSrcById: Object.fromEntries(assets.map((a) => [a.assetId, `blob:${a.assetId}`])),
      assetSizes: {},
    });
    return assets;
  };

  it("素材の数だけ測る（1件測れるたびに全部作り直さない）", () => {
    const { made } = stubImage();
    withAssets(4);
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(made).toHaveLength(4);
    // 1件ずつ着地させる。印を持たず「済みかどうか」だけで判定していると、依存に自分の出力が入っている
    // 版では**未計測ぶんが毎回作り直される**（4件なら 4→3→2→1 で合計10個）。
    act(() => { made[0].fire(); });
    act(() => { made[1].fire(); });
    act(() => { made[2].fire(); });
    act(() => { made[3].fire(); });
    expect(made).toHaveLength(4);
    expect(Object.keys(useTimelineStore.getState().assetSizes)).toHaveLength(4);
  });

  it("**測り終わっていない素材があるまま**別の素材が増えても、測り直さない（#724 レビュー）", () => {
    // ⚠️ ここが「印」の本当の役目。済みの判定（`assetSizes`）だけでは**まだ着地していない素材**を
    // 弾けないので、効果が別の理由（素材の追加）で走り直すと、その素材ぶんを作り直してしまう。
    const { made } = stubImage();
    withAssets(2);
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    act(() => { made[0].fire(); }); // asset_001 だけ着地。asset_002 は測っている最中。
    act(() => {
      useTimelineStore.setState({
        assetSrcById: { ...useTimelineStore.getState().assetSrcById, asset_003: "blob:asset_003" },
      });
    });
    // 増えたぶんの1つだけ（asset_002 を作り直さない）。
    expect(made).toHaveLength(3);
    expect(made[2].src).toBe("blob:asset_003");
    // 着地していなかったぶんも、後から着地すれば入る（途中で無効化しない）。
    act(() => { made[1].fire(); });
    expect(Object.keys(useTimelineStore.getState().assetSizes).sort()).toEqual(["asset_001", "asset_002"]);
  });

  it("素材が増えたら、その1つだけ測る（既に測ったものを測り直さない）", () => {
    const { made } = stubImage();
    withAssets(2);
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    act(() => { made[0].fire(); made[1].fire(); });
    act(() => {
      useTimelineStore.setState({
        assetSrcById: { ...useTimelineStore.getState().assetSrcById, asset_003: "blob:asset_003" },
      });
    });
    expect(made).toHaveLength(3);
    expect(made[2].src).toBe("blob:asset_003");
  });

  it("読めたのに大きさが取れなかったものも、印を残さない（失敗と同じ扱い）", () => {
    const made: { src: string; fire: () => void }[] = [];
    /* eslint-disable @typescript-eslint/no-explicit-any */
    (window as any).Image = function (this: any) {
      const el: any = { naturalWidth: 0, naturalHeight: 0, onload: null, onerror: null }; // 0×0＝測れていない
      const rec = { src: "", fire: () => el.onload?.() };
      Object.defineProperty(el, "src", { set(v: string) { rec.src = v; }, get() { return rec.src; } });
      made.push(rec);
      return el;
    } as unknown as typeof Image;
    withAssets(1);
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    act(() => { made[0].fire(); }); // `onload` は来たが 0×0＝入れられない
    expect(useTimelineStore.getState().assetSizes).toEqual({});
    act(() => {
      useTimelineStore.setState({
        assetSrcById: { ...useTimelineStore.getState().assetSrcById, asset_002: "blob:asset_002" },
      });
    });
    // 印が残っていると asset_001 は二度と測られない（＝「枠いっぱいに映す」が黙って効かなくなる）。
    expect(made.map((m) => m.src)).toEqual(["blob:asset_001", "blob:asset_001", "blob:asset_002"]);
  });

  it("**同じ動画を開き直しても**測り直す（印を残して二度と測らない、を作らない）", () => {
    const { made } = stubImage();
    withAssets(1);
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    act(() => { made[0].fire(); });
    // 開き直すと `assetSizes` は空へ戻る。「始めた」を覚える作りだと**同じ動画では印が残り**、
    // 二度と測らない＝「枠いっぱいに映す」が黙って効かなくなる（素材の実寸が要るため）。
    act(() => {
      useTimelineStore.setState({ assetSizes: {}, assetSrcById: { asset_001: "blob:asset_001_reopened" } });
    });
    expect(made).toHaveLength(2);
    expect(made[1].src).toBe("blob:asset_001_reopened");
  });

  it("測れなかった素材は、次に効果が走ったときもう一度試す（一度の失敗を永久に固定しない）", () => {
    const made: { src: string; fireError: () => void }[] = [];
    /* eslint-disable @typescript-eslint/no-explicit-any */
    (window as any).Image = function (this: any) {
      const el: any = { naturalWidth: 0, naturalHeight: 0, onload: null, onerror: null };
      const rec = { src: "", fireError: () => el.onerror?.() };
      Object.defineProperty(el, "src", { set(v: string) { rec.src = v; }, get() { return rec.src; } });
      made.push(rec);
      return el;
    } as unknown as typeof Image;
    withAssets(1);
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    act(() => { made[0].fireError(); });
    // ⚠️ 取り込み直しでは救えない（取り込みは毎回**新しい素材番号**を出すので別のキーになる）。
    // 救えるのは「別の素材が増えた／画面へ戻った」で効果が走り直したとき。
    act(() => {
      useTimelineStore.setState({
        assetSrcById: { ...useTimelineStore.getState().assetSrcById, asset_002: "blob:asset_002" },
      });
    });
    // 増えたぶん（asset_002）＋失敗した asset_001 の測り直しで2つ増える。
    expect(made.map((m) => m.src)).toEqual(["blob:asset_001", "blob:asset_001", "blob:asset_002"]);
  });
});

// 帯の作法（#701）＝右クリックのメニューと、種類ごとの色。列の行と**同じ作法**に揃える（ADR-0026②）。
describe("TimelineProjectScreen: 帯の作法（#701）", () => {
  const mixed = () =>
    open({
      tracks: [{ id: "track_001", kind: TRACK_KIND.visual }, { id: "track_002", kind: TRACK_KIND.audio }],
      clips: [
        { id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 2, x: 0, y: 0, w: 10, h: 10, text: "文字" },
        { id: "clip_002", kind: TIMELINE_CLIP_KIND.shape, trackId: "track_001", startSec: 3, durationSec: 2, x: 0, y: 0, w: 10, h: 10, shapeType: "rect" },
        { id: "clip_003", kind: TIMELINE_CLIP_KIND.voice, trackId: "track_002", startSec: 0, durationSec: 2, voice: { text: "こえ", status: "none" } },
      ],
    });
  const clipEl = (name: string) => screen.getByRole("button", { name }).className;

  it("帯の色は**部品の種類ごと**（列の種類だけで決めない）", () => {
    mixed();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    // 文字と図形は同じ列（映像）だが、種類が違うので色も違う＝並びを見て何が置いてあるか読める。
    expect(clipEl("文字")).toContain("timeline-clip--telop");
    expect(clipEl("図形")).toContain("timeline-clip--shape");
    expect(clipEl("こえ")).toContain("timeline-clip--audio");
  });

  it("帯を右クリックすると操作のメニューが出る（列の行と同じ）", () => {
    mixed();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.contextMenu(screen.getByRole("button", { name: "文字" }));
    expect(screen.getByRole("menuitem", { name: "複製" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "削除" })).toBeInTheDocument();
  });

  it("「⋮」からも同じメニューが出る（右クリックが使えない人の逃げ道）", () => {
    mixed();
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "文字の操作" }));
    expect(screen.getByRole("menuitem", { name: "複製" })).toBeInTheDocument();
  });

  it("「⋮」は**選んだ帯にだけ**出す（隣の帯の当たり判定を常時食わない）", () => {
    mixed();
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    // ⚠️ 全部の帯に出すと、複製した帯（前の終わりから置かれる＝必ず隣接）の左端を覆い、
    // **狙っていない帯が選ばれて消える**。最後の帯では列の枠の外にも出る。
    expect(screen.getByRole("button", { name: "文字の操作" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "図形の操作" })).not.toBeInTheDocument();
  });

  it("「⋮」は帯の**内側**に置く（外に出すと隣を覆う・枠の外へ出る）", () => {
    mixed();
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const left = (screen.getByRole("button", { name: "文字の操作" }) as HTMLElement).style.left;
    expect(left).toContain("- var(--clip-menu-w)"); // 帯の終わりから幅ぶん内側へ
  });

  it("列の名前の欄の幅は**両方のタイムライン画面が同じ値**を流し込む（#742 レビュー）", () => {
    // ⚠️ 片方だけ CSS の既定に頼ると、値を変えたときに**見た目だけ黙ってずれる**
    //（全体表示と錨点の計算はこの値を引くので、計算と描画が食い違う）。
    open();
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const timeline = container.querySelector(".timeline") as HTMLElement;
    expect(timeline.style.getPropertyValue("--timeline-label-w")).toBe(`${TIMELINE_LABEL_W_PX}px`);
    // ⚠️ **高さも同じ扱い**（#1104）＝行の高さと帯の余白を CSS の既定に頼ると、詰めたときに黙ってずれる。
    expect(timeline.style.getPropertyValue("--timeline-lane-h")).toBe(`${TIMELINE_LANE_H_PX}px`);
    expect(timeline.style.getPropertyValue("--timeline-clip-inset")).toBe(`${TIMELINE_CLIP_INSET_PX}px`);
  });

  it("`--clip-menu-w` は**「⋮」から見える所**で宣言する（帯で宣言すると届かない）", () => {
    // ⚠️ カスタムプロパティは**子孫にしか継承しない**。「⋮」は帯の兄弟なので、帯（`.timeline-clip`）で
    // 宣言すると `var()` が解決できず `left`/`width` の宣言ごと無効になり、**帯の左端に出る**
    // （実機で確認＝computed left が 0px・幅が内容幅の 3.86px になっていた）。
    // jsdom は CSS ファイルを読まないので、**宣言している側の階級**をここで固定する。
    const css = readFileSync(resolve(__dirname, "../components/timeline.css"), "utf8");
    const laneBlock = css.slice(css.indexOf(".timeline-lane {"), css.indexOf("}", css.indexOf(".timeline-lane {")));
    expect(laneBlock).toContain("--clip-menu-w");
    // 帯そのもので宣言し直すと、また届かなくなる。
    const clipStart = css.indexOf(["", ".timeline-clip {"].join(String.fromCharCode(10)));
    const clipBlock = css.slice(clipStart, css.indexOf("}", clipStart));
    expect(clipBlock).not.toContain("--clip-menu-w");
  });

  it("**列を足すのは「並び」の欄の中**（欄の外を探しに行かせない・#767）", () => {
    open({
      tracks: [{ id: "track_001", kind: TRACK_KIND.visual }, { id: "track_002", kind: TRACK_KIND.audio }],
      clips: [
        { id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 3, x: 0, y: 0, w: 10, h: 10, text: "あ" },
        { id: "clip_002", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 5, durationSec: 3, x: 0, y: 0, w: 10, h: 10, text: "い" },
      ],
    });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const arrange = [...container.querySelectorAll("section,div")].find(
      (el) => el.querySelector(".timeline") != null && (el.textContent || "").includes("映像の列を足す"),
    );
    expect(arrange).toBeTruthy(); // 並びの一覧と同じ入れ物の中にある
    // ⚠️ **同じ操作を2か所に置かない**（`06 §2`）＝画面下部の同じボタンは残さない。
    expect(screen.getAllByRole("button", { name: "映像の列を足す" })).toHaveLength(1);
  });

  // ⚠️ **実機で測って直した**（#1104・2026-09-10）＝列を12本にすると、欄ごと縦に流れるので
  // 「列を足す」が画面の外へ出て**列を足せなくなり**、帯は欄の下端で切り落とされていた。
  // ⚠️ **jsdom は高さを持たない**ので見られるのは配線だけ＝「どこが流す役か」（CSS の側）は
  // `timelineMetrics.test.ts`、実寸は `tools/uiProbe.mjs`。
  it("**「並び」は道具立てを留めて帯だけ流す**（列を足す道が画面の外へ出ない・#1104）", () => {
    open({
      tracks: [{ id: "track_001", kind: TRACK_KIND.visual }, { id: "track_002", kind: TRACK_KIND.audio }],
    });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const panel = container.querySelector(".timeline-panel") as HTMLElement | null;
    expect(panel).not.toBeNull();
    // 欄の器は流す役を中身へ渡している（欄ごと流すと道具立てが一緒に出ていく）。
    const body = panel!.closest(".panel-frame-body") as HTMLElement | null;
    expect(body).not.toBeNull();
    expect(body!.classList.contains("panel-frame-body--fill")).toBe(true);
    // 「列を足す」は**流れる枠の外**にある＝帯をいくら送っても押せる場所に留まる。
    const add = screen.getByRole("button", { name: "映像の列を足す" });
    expect(add.closest(".timeline-scroll")).toBeNull();
    expect(add.closest(".timeline-panel")).toBe(panel);
    // 道具立て（表示倍率・吸着）も同じく流れる枠の外。
    expect(container.querySelector(".timeline-toolbar")!.closest(".timeline-scroll")).toBeNull();
    // 帯（列の行）は流れる枠の中＝列が増えたときに動くのはここ。
    expect(container.querySelector(".timeline-row")!.closest(".timeline-scroll")).not.toBeNull();
  });

  it("**列を中身ごと複製できる**（空の列だけ増やすなら「足す」と同じ・#767）", () => {
    open({
      tracks: [{ id: "track_001", kind: TRACK_KIND.visual }, { id: "track_002", kind: TRACK_KIND.audio }],
      clips: [
        { id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 3, x: 0, y: 0, w: 10, h: 10, text: "あ" },
        { id: "clip_002", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 5, durationSec: 3, x: 0, y: 0, w: 10, h: 10, text: "い" },
      ],
    });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    // ⚠️ 目盛りの行にも**名前の空欄**があるので、名前の付いた行だけを採る（空欄を掴んでも何も起きない）。
    const labels = [...container.querySelectorAll(".timeline-row-label")].filter((el) => (el.textContent || "").trim() !== "") as HTMLElement[];
    const label = labels[labels.length - 1];
    fireEvent.contextMenu(label);
    fireEvent.click(screen.getByRole("menuitem", { name: "複製" }));
    const st = useTimelineStore.getState().doc!;
    expect(st.tracks).toHaveLength(3); // 1本増える
    expect(st.clips).toHaveLength(4); // 中身も増える（元の2つ＋複製の2つ）
  });

  it("**掴んで並べ替えられる**（帯は掴めるのに列だけメニューだけ、を作らない・#767）", () => {
    open({
      tracks: [{ id: "track_001", kind: TRACK_KIND.visual }, { id: "track_002", kind: TRACK_KIND.visual }],
      clips: [{ id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 3, x: 0, y: 0, w: 10, h: 10, text: "あ" }],
    });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    // ⚠️ 目盛りの行を数に入れない（名前の付いた行だけが列）。表示は**手前が上**＝上から track_002・track_001。
    const rows = ([...container.querySelectorAll(".timeline-row")] as HTMLElement[])
      .filter((r) => (r.querySelector(".timeline-row-label")?.textContent || "").trim() !== "");
    rows.forEach((row, i) => {
      row.getBoundingClientRect = () => ({ left: 0, top: i * 40, right: 900, bottom: i * 40 + 40, width: 900, height: 40, x: 0, y: i * 40, toJSON: () => ({}) }) as DOMRect;
    });
    const label = rows[1].querySelector(".timeline-row-label") as HTMLElement; // 奥（track_001）を掴む
    pointerDownAt(label, 1, { clientX: 10, clientY: 50 });
    fireEvent.pointerMove(window, { pointerId: 1, buttons: 1, clientX: 10, clientY: 5 }); // いちばん上へ
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 10, clientY: 5 });
    // 上＝手前＝配列の後ろ。track_001 が手前へ来る。
    expect(useTimelineStore.getState().doc!.tracks.map((t) => t.id)).toEqual(["track_002", "track_001"]);
  });

  it("**下向きに運んでも、線を引いた所へ入る**（1つずれない・#767 レビュー 🔴）", () => {
    // ⚠️ 落とし先を「行」で持つと、線は「その行の上」を指すのに確定は**抜いた後の位置**として効くので、
    // **下向きだけ1つ余計に下がる**（重ね順＝絵そのものなので、見せた線と違う絵が黙って確定する）。
    open({
      tracks: [
        { id: "track_001", kind: TRACK_KIND.visual },
        { id: "track_002", kind: TRACK_KIND.visual },
        { id: "track_003", kind: TRACK_KIND.visual },
      ],
      clips: [{ id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 3, x: 0, y: 0, w: 10, h: 10, text: "あ" }],
    });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    // 表示は上から track_003・track_002・track_001（後ろほど手前）。
    const rows = ([...container.querySelectorAll(".timeline-row")] as HTMLElement[])
      .filter((r) => (r.querySelector(".timeline-row-label")?.textContent || "").trim() !== "");
    rows.forEach((row, i) => {
      row.getBoundingClientRect = () => ({ left: 0, top: i * 40, right: 900, bottom: i * 40 + 40, width: 900, height: 40, x: 0, y: i * 40, toJSON: () => ({}) }) as DOMRect;
    });
    // いちばん上（track_003）を掴んで、**2行目（track_002）の上半分**で離す＝線は「track_002 の上」。
    const label = rows[0].querySelector(".timeline-row-label") as HTMLElement;
    pointerDownAt(label, 1, { clientX: 10, clientY: 10 });
    fireEvent.pointerMove(window, { pointerId: 1, buttons: 1, clientX: 10, clientY: 55 });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 10, clientY: 55 });
    // 線の位置＝track_002 の上＝いまと同じ並び（track_003 は既に track_002 の上）。
    expect(useTimelineStore.getState().doc!.tracks.map((t) => t.id)).toEqual(["track_001", "track_002", "track_003"]);
  });

  it("下向きに**いちばん下まで**運ぶと最背面へ入る（#767）", () => {
    open({
      tracks: [
        { id: "track_001", kind: TRACK_KIND.visual },
        { id: "track_002", kind: TRACK_KIND.visual },
        { id: "track_003", kind: TRACK_KIND.visual },
      ],
      clips: [{ id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 3, x: 0, y: 0, w: 10, h: 10, text: "あ" }],
    });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const rows = ([...container.querySelectorAll(".timeline-row")] as HTMLElement[])
      .filter((r) => (r.querySelector(".timeline-row-label")?.textContent || "").trim() !== "");
    rows.forEach((row, i) => {
      row.getBoundingClientRect = () => ({ left: 0, top: i * 40, right: 900, bottom: i * 40 + 40, width: 900, height: 40, x: 0, y: i * 40, toJSON: () => ({}) }) as DOMRect;
    });
    const label = rows[0].querySelector(".timeline-row-label") as HTMLElement; // track_003
    pointerDownAt(label, 1, { clientX: 10, clientY: 10 });
    fireEvent.pointerMove(window, { pointerId: 1, buttons: 1, clientX: 10, clientY: 115 }); // 最下行の下半分
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 10, clientY: 115 });
    expect(useTimelineStore.getState().doc!.tracks.map((t) => t.id)).toEqual(["track_003", "track_001", "track_002"]);
  });

  // #771(c)：**すき間 → 入れる位置**の計算は場面カード・台本表の行と同じ1か所（`insertIndexForGap`）。
  // ⚠️ 列の並べ替えは「落ちない／固定は動かない」しか見ておらず、**実際にどこへ入るか**が
  // 無検査だった＝共有だけしても、こちら側が壊れても気づけない。
  // ⚠️ #802-3＝**列の並べ替えにも端送りと可視域丸めを入れた**（置く・運ぶ・並べ替えと同じ部品）。
  // 丸めが無いと、欄からはみ出した位置で**見えていない列のすき間**に線が決まり、そこで確定してしまう。
  it("欄の外へ指がはみ出しても、見えている範囲で並べ替え先を決める", () => {
    open({
      tracks: [
        { id: "track_001", kind: TRACK_KIND.visual },
        { id: "track_002", kind: TRACK_KIND.visual },
        { id: "track_003", kind: TRACK_KIND.visual },
      ],
    });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const rows = ([...container.querySelectorAll(".timeline-row")] as HTMLElement[])
      .filter((r) => (r.querySelector(".timeline-row-label")?.textContent || "").trim() !== "");
    rows.forEach((row, i) => {
      row.getBoundingClientRect = () => ({ left: 0, top: i * 40, right: 900, bottom: i * 40 + 40, width: 900, height: 40, x: 0, y: i * 40, toJSON: () => ({}) }) as DOMRect;
    });
    // 列を並べている器（帯の枠）は 0〜100 しか見えていない＝3行目（80〜120）は下半分が隠れている。
    // ⚠️ **縦に流れるのは帯の枠**（#1104）＝欄ごと流すと道具立てが画面の外へ出るので移した。
    const body = rows[0].closest(".timeline-scroll") as HTMLElement | null;
    if (body) {
      body.getBoundingClientRect = () => ({ left: 0, top: 0, right: 900, bottom: 70, width: 900, height: 70, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    }
    const grip = rows[0].querySelector('[aria-label*="順番"], .grabbable') ?? rows[0];
    fireEvent.pointerDown(grip, { pointerId: 1, button: 0, clientX: 0, clientY: 10 });
    fireEvent.pointerMove(window, { pointerId: 1, buttons: 1, clientX: 0, clientY: 500 }); // 欄のずっと下
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 0, clientY: 500 });
    // 見えているのは 0〜70＝3行目（80〜120）は隠れている。丸めれば「見えている最後のすき間」で決まり、
    // 丸めなければ**画面外のすき間**（最背面）まで飛ぶ＝結果が別物になる。
    expect(useTimelineStore.getState().doc!.tracks.map((t) => t.id)).toEqual(['track_001', 'track_003', 'track_002']);
  });

  // ⚠️ #802-3＝**列の並べ替えの端送りが実際に走り、離したら止まる**（配線の検査）。
  // 速さの規則（domain）と時計まわり（フック）は別に見ているが、**この画面が繋いだか**は無検査だった
  // ＝`track`/`stop` の呼び忘れや欄の取り違えがあっても、どのテストも赤くならない。
  it("欄の下端まで運ぶと送りが走り、離すと止まる", () => {
    const rafQueue: Array<(t: number) => void> = [];
    const realRaf = globalThis.requestAnimationFrame;
    const realCancel = globalThis.cancelAnimationFrame;
    const realPerf = globalThis.performance;
    let nowMs = 0;
    vi.stubGlobal("requestAnimationFrame", (cb: (t: number) => void) => { rafQueue.push(cb); return rafQueue.length; });
    vi.stubGlobal("cancelAnimationFrame", () => { rafQueue.length = 0; });
    vi.stubGlobal("performance", { now: () => nowMs });
    const tick = (ms: number) => {
      nowMs += ms;
      const run = [...rafQueue];
      rafQueue.length = 0;
      run.forEach((cb) => cb(nowMs));
    };
    try {
      open({
        tracks: [
          { id: "track_001", kind: TRACK_KIND.visual },
          { id: "track_002", kind: TRACK_KIND.visual },
          { id: "track_003", kind: TRACK_KIND.visual },
        ],
      });
      const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
      const rows = ([...container.querySelectorAll(".timeline-row")] as HTMLElement[])
        .filter((r) => (r.querySelector(".timeline-row-label")?.textContent || "").trim() !== "");
      rows.forEach((row, i) => {
        row.getBoundingClientRect = () => ({ left: 0, top: i * 40, right: 900, bottom: i * 40 + 40, width: 900, height: 40, x: 0, y: i * 40, toJSON: () => ({}) }) as DOMRect;
      });
      const body = rows[0].closest(".timeline-scroll") as HTMLElement;
      expect(body).not.toBeNull(); // 帯の枠が見つからなければ送り先が無い＝この検査自体が空振りする
      body.getBoundingClientRect = () => ({ left: 0, top: 0, right: 900, bottom: 200, width: 900, height: 200, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
      Object.defineProperty(body, "clientHeight", { value: 200, configurable: true });
      Object.defineProperty(body, "scrollHeight", { value: 1000, configurable: true });
      let top = 0; // jsdom は実寸を持たない＝送り先を自前で持たせる
      Object.defineProperty(body, "scrollTop", { get: () => top, set: (v: number) => { top = v; }, configurable: true });

      const grip = rows[0].querySelector('[aria-label*="順番"], .grabbable') ?? rows[0];
      fireEvent.pointerDown(grip, { pointerId: 1, button: 0, clientX: 100, clientY: 10 });
      fireEvent.pointerMove(window, { pointerId: 1, buttons: 1, clientX: 100, clientY: 195 }); // 下端の帯
      tick(100);
      expect(body.scrollTop).toBeGreaterThan(0); // 走っている

      fireEvent.pointerUp(window, { pointerId: 1, clientX: 100, clientY: 195 });
      const stopped = body.scrollTop;
      tick(100);
      expect(body.scrollTop).toBe(stopped); // 離したら止まる（掴んでいないのに送り続けない）
    } finally {
      vi.stubGlobal("requestAnimationFrame", realRaf);
      vi.stubGlobal("cancelAnimationFrame", realCancel);
      vi.stubGlobal("performance", realPerf);
    }
  });

  it("掴んで並べ替えると、線を出したすき間へ入る（列は手前が上＝並びは裏返る）", () => {
    open({
      tracks: [
        { id: "track_001", kind: TRACK_KIND.visual },
        { id: "track_002", kind: TRACK_KIND.visual },
        { id: "track_003", kind: TRACK_KIND.visual },
      ],
    });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const rows = ([...container.querySelectorAll(".timeline-row")] as HTMLElement[])
      .filter((r) => (r.querySelector(".timeline-row-label")?.textContent || "").trim() !== "");
    rows.forEach((row, i) => {
      row.getBoundingClientRect = () => ({ left: 0, top: i * 40, right: 900, bottom: i * 40 + 40, width: 900, height: 40, x: 0, y: i * 40, toJSON: () => ({}) }) as DOMRect;
    });
    // 行は**手前が上**＝上から track_003 / track_002 / track_001。いちばん上（track_003）を掴んで
    // いちばん下のすき間（3行目の下半分＝表示上のすき間3）へ落とす＝並びのいちばん奥へ。
    const label = rows[0].querySelector(".timeline-row-label") as HTMLElement;
    pointerDownAt(label, 1, { clientX: 10, clientY: 10 });
    fireEvent.pointerMove(window, { pointerId: 1, buttons: 1, clientX: 10, clientY: 115 });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 10, clientY: 115 });
    expect(useTimelineStore.getState().doc!.tracks.map((t) => t.id)).toEqual(["track_003", "track_001", "track_002"]);
  });

  // #771(c) の本題：**同じすき間なら、どちらから来ても同じ結果**（列でも）。
  it("反対の向きから同じすき間へ運んでも、同じ並びになる（1つズレを作らない）", () => {
    open({
      tracks: [
        { id: "track_001", kind: TRACK_KIND.visual },
        { id: "track_002", kind: TRACK_KIND.visual },
        { id: "track_003", kind: TRACK_KIND.visual },
      ],
    });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const rowsOf = () => {
      const rs = ([...container.querySelectorAll(".timeline-row")] as HTMLElement[])
        .filter((r) => (r.querySelector(".timeline-row-label")?.textContent || "").trim() !== "");
      rs.forEach((row, i) => {
        row.getBoundingClientRect = () => ({ left: 0, top: i * 40, right: 900, bottom: i * 40 + 40, width: 900, height: 40, x: 0, y: i * 40, toJSON: () => ({}) }) as DOMRect;
      });
      return rs;
    };
    // 行は**手前が上**＝上から 003 / 002 / 001。
    // ① いちばん上（003）を「2行目の下半分」＝002 と 001 の間へ運ぶ。
    let rows = rowsOf();
    pointerDownAt(rows[0].querySelector(".timeline-row-label") as HTMLElement, 1000, { clientX: 10, clientY: 10 });
    fireEvent.pointerMove(window, { pointerId: 1, buttons: 1, clientX: 10, clientY: 75 });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 10, clientY: 75 });
    // 表示は 002 / 003 / 001 ＝並びは裏返して [001, 003, 002]。
    expect(useTimelineStore.getState().doc!.tracks.map((t) => t.id)).toEqual(["track_001", "track_003", "track_002"]);

    // ② いちばん下（001）を「1行目の下半分」＝002 と 003 の間へ運ぶ＝**反対の向き**から同じ考え方。
    rows = rowsOf();
    pointerDownAt(rows[2].querySelector(".timeline-row-label") as HTMLElement, 9000, { clientX: 10, clientY: 90 });
    fireEvent.pointerMove(window, { pointerId: 1, buttons: 1, clientX: 10, clientY: 35 });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 10, clientY: 35 });
    // 表示は 002 / 001 / 003 ＝並びは [003, 001, 002]。指した2つの間に入っている。
    expect(useTimelineStore.getState().doc!.tracks.map((t) => t.id)).toEqual(["track_003", "track_001", "track_002"]);
  });

  it("**固定した列は掴んで並べ替えられない**（消せないのと揃える・#767 レビュー）", () => {
    open({
      tracks: [{ id: "track_001", kind: TRACK_KIND.visual, locked: true }, { id: "track_002", kind: TRACK_KIND.visual }],
      clips: [{ id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_002", startSec: 0, durationSec: 3, x: 0, y: 0, w: 10, h: 10, text: "あ" }],
    });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const rows = ([...container.querySelectorAll(".timeline-row")] as HTMLElement[])
      .filter((r) => (r.querySelector(".timeline-row-label")?.textContent || "").trim() !== "");
    rows.forEach((row, i) => {
      row.getBoundingClientRect = () => ({ left: 0, top: i * 40, right: 900, bottom: i * 40 + 40, width: 900, height: 40, x: 0, y: i * 40, toJSON: () => ({}) }) as DOMRect;
    });
    const label = rows[1].querySelector(".timeline-row-label") as HTMLElement; // 固定した track_001
    pointerDownAt(label, 1, { clientX: 10, clientY: 50 });
    fireEvent.pointerMove(window, { pointerId: 1, buttons: 1, clientX: 10, clientY: 5 });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 10, clientY: 5 });
    expect(useTimelineStore.getState().doc!.tracks.map((t) => t.id)).toEqual(["track_001", "track_002"]); // 動かない
    expect(useTimelineStore.getState().editBlocked?.reason).toBe("TIMELINE_EDIT_LOCKED"); // 理由を出す
  });

  it("「⋮」を押して動かしても列は並べ替わらない（入れ子の掴み口・#767 レビュー）", () => {
    open({
      tracks: [{ id: "track_001", kind: TRACK_KIND.visual }, { id: "track_002", kind: TRACK_KIND.visual }],
      clips: [{ id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 3, x: 0, y: 0, w: 10, h: 10, text: "あ" }],
    });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const rows = ([...container.querySelectorAll(".timeline-row")] as HTMLElement[])
      .filter((r) => (r.querySelector(".timeline-row-label")?.textContent || "").trim() !== "");
    rows.forEach((row, i) => {
      row.getBoundingClientRect = () => ({ left: 0, top: i * 40, right: 900, bottom: i * 40 + 40, width: 900, height: 40, x: 0, y: i * 40, toJSON: () => ({}) }) as DOMRect;
    });
    const dots = rows[1].querySelector(".timeline-row-label button") as HTMLElement;
    pointerDownAt(dots, 1, { clientX: 10, clientY: 50 });
    fireEvent.pointerMove(window, { pointerId: 1, buttons: 1, clientX: 10, clientY: 5 });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 10, clientY: 5 });
    expect(useTimelineStore.getState().doc!.tracks.map((t) => t.id)).toEqual(["track_001", "track_002"]);
  });

  it("並べ替えは**少し動かすまで起きない**（押しただけで順番が変わらない・#767）", () => {
    open({
      tracks: [{ id: "track_001", kind: TRACK_KIND.visual }, { id: "track_002", kind: TRACK_KIND.visual }],
      clips: [{ id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 3, x: 0, y: 0, w: 10, h: 10, text: "あ" }],
    });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const label = [...container.querySelectorAll(".timeline-row-label")].find((el) => (el.textContent || "").trim() !== "") as HTMLElement;
    pointerDownAt(label, 1, { clientX: 10, clientY: 10 });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 10, clientY: 10 }); // 動かさず離す
    expect(useTimelineStore.getState().doc!.tracks.map((t) => t.id)).toEqual(["track_001", "track_002"]);
  });

  it("「⋮」は**右の取っ手を避けて**置く（覆うと右端だけ掴めない）", () => {
    // ⚠️ 実機で確認＝「⋮」は帯の兄弟で `z-index` が上なので、帯の右端に置くと取っ手を丸ごと覆い、
    // 右端の中心で最前面に来るのが `timeline-clip-menu` になっていた（左端は掴めるので**左右非対称**）。
    mixed();
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const left = (screen.getByRole("button", { name: "文字の操作" }) as HTMLElement).style.left;
    // ⚠️ **避ける幅は、取っ手が実際に取っている幅と同じもの**を見る（#752-7）。
    // 見た目の幅を書き写すと、当たり判定を広げたときに**「⋮」が取っ手を覆う**（#742/#743 の裏返し）。
    // どちらを見ているかは CSS から引く＝書き写しをテスト側でも作らない。
    const css = readFileSync(resolve(__dirname, "../components/timeline.css"), "utf8");
    const handleStart = css.indexOf(".timeline-clip-handle {");
    const handleBlock = css.slice(handleStart, css.indexOf("}", handleStart));
    const widthVar = /width:\s*var\((--[\w-]+)\)/.exec(handleBlock)?.[1];
    expect(widthVar).toBeTruthy();
    expect(left).toContain(`- var(--clip-menu-w) - var(${widthVar})`);
  });

  it("編集の場所は**ページのスクロールの外**（#1104・実機の指摘）", () => {
    // ⚠️ **実機の報告**（2026-09-10）＝「タイムライン編集画面にスクロールをする必要が
    // 出てきてしまっています。これは絶対避けたいです」。
    // 器を高さで決め打つ形（`76vh` でも「画面の残り」でも）だと、上の見出しか下の知らせのぶん必ずはみ出す。
    // **器をスクロールの外へ出して flex で分ける**のが唯一の解なので、その骨格を留める。
    open();
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(container.querySelector(".main-scroll--fixed"), "ページがスクロールする骨格に戻っている").not.toBeNull();
    expect(container.querySelector(".panel-layout--fill"), "器が高さの決め打ちに戻っている").not.toBeNull();
    // 知らせは自分の中でスクロールする（消すと「注意 N件」から寄れる先が無くなる）。
    expect(container.querySelector(".timeline-notices")).not.toBeNull();
    // ⚠️ **詰めた表示（ADR-0047・#1247）**＝この印が外れると、操作と余白が元の大きさに戻り、
    // 本体（並び）に渡していた面積が黙って消える。実測では、印の有無で
    // **ボタン高 41→29px・欄の余白 24→12px・画面に収まらず隠れている量 1139→690px** と変わる。
    expect(container.querySelector(".main-scroll--fixed.dense"), "詰めた表示の印が外れている").not.toBeNull();
  });

  it("その場の返事は**欄の見出しを覆わず、欄の高さも変えない**（右下に重ねる＝α 最終点検の実機）", () => {
    // ⚠️ **実機で踏んだ**（2026-10-21）＝欄を囲いへ `absolute` で貼っていたので、流れに残る返事が
    // 囲いの**一番上**に出て、欄の見出し（タブ）を覆って押せなくしていた。
    // ⚠️ **下に場所を取って並べる直し方は採らない**（レビュー）＝出る・消えるたびに欄の高さが変わり、押した帯が指の下でずれる。
    open();
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const stack = container.querySelector(".timeline-flash-zone > .timeline-flash-stack");
    expect(stack, "返事の置き場が無い").not.toBeNull();
    // 欄は置き場の外（置き場の中に欄が入ると、重ねる側と重なられる側が逆になる）。
    expect(stack!.querySelector(".panel-layout")).toBeNull();
    const css = readFileSync(resolve(__dirname, "../../styles/theme.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const block = (sel: string): string => {
      const at = css.indexOf(`${sel} {`);
      return at < 0 ? "" : css.slice(at, css.indexOf("}", at));
    };
    const stackRule = block(".main-scroll--fixed .timeline-flash-stack");
    // 重ねる（流れに置かない＝欄の高さを変えない）・**下端**に寄せる（上端だと見出しを覆う）。
    expect(stackRule).toMatch(/position:\s*absolute/);
    expect(stackRule).toMatch(/bottom:/);
    expect(stackRule).not.toMatch(/top:/);
    // 返事が重なっても欄を覆い尽くさない。
    expect(stackRule).toMatch(/max-height:/);
    expect(stackRule).toMatch(/overflow-y:\s*auto/);
    // 空のときは場所を取らない（見えない箱が帯の上の押せる所を奪わない）。
    expect(block(".main-scroll--fixed .timeline-flash-stack:empty")).toMatch(/display:\s*none/);
    // 囲いが重ねの基準。
    expect(block(".main-scroll--fixed .timeline-flash-zone")).toMatch(/position:\s*relative/);
  });

  it("CSS の既定は**TS の値と一致する**（片方だけ変えて黙ってずれない・#752 レビュー）", () => {
    // ⚠️ 流し込みは必ず行われるので既定は普通は使われないが、**書き写しである以上ずれ得る**。
    // ずれると、この file を単独で読んだときの見え方と計算が食い違う（`--timeline-label-w` と同じ流儀）。
    const css = readFileSync(resolve(__dirname, "../components/timeline.css"), "utf8");
    const decl = (name: string): string | undefined => new RegExp(`${name}:([^;]+);`).exec(css)?.[1].trim();
    expect(decl("--timeline-label-w")).toBe(`${TIMELINE_LABEL_W_PX}px`);
    expect(decl("--clip-menu-w")).toBe(`${CLIP_MENU_W_PX}px`);
    expect(decl("--clip-handle-w")).toBe(`${CLIP_HANDLE_W_PX}px`);
    expect(decl("--clip-handle-hit-w")).toBe(`${CLIP_HANDLE_HIT_W_PX}px`);
    // ⚠️ **高さ（`--timeline-lane-h` / `--timeline-clip-inset`）の一致は
    // `src/app/components/timelineMetrics.test.ts` が見る**（#1104）＝二重に持たない。
  });

  it("取っ手の**当たり判定は見た目より広い**（指が乗る前に本体を掴まない・#752-7）", () => {
    // 型＝「見た目の2倍以上」。見た目は擬似要素で外側の端に出すので、**太く見せずに**掴みやすくする。
    const css = readFileSync(resolve(__dirname, "../components/timeline.css"), "utf8");
    const laneBlock = css.slice(css.indexOf(".timeline-lane {"), css.indexOf("}", css.indexOf(".timeline-lane {")));
    const px = (name: string): number => Number(new RegExp(`${name}:\\s*(\\d+)px`).exec(laneBlock)?.[1]);
    expect(px("--clip-handle-hit-w")).toBeGreaterThanOrEqual(px("--clip-handle-w") * 2);
    // 見た目の帯は擬似要素で描く＝本体（当たり判定）そのものを塗ると太く見える。
    expect(css).toContain(".timeline-clip--selected .timeline-clip-handle::after");
  });

  it("置けないときの赤は**選択の青に勝つ**（同じ強さだと後に載る青が残る）", () => {
    // ⚠️ 実機で確認＝`.drop-target--blocked`（theme.css）と `.timeline-clip--selected`（timeline.css）は
    // どちらも1クラスで、timeline.css が後に載るので**青のまま**だった。掴んだ帯は必ず選ばれているので、
    // 「置けない」の赤は**一度も出ていなかった**（決定10 のゴーストの色が丸ごと効いていない）。
    // class 名しか見ないテストは緑で通るので、ここでは**重なり順を実際に解く**。
    const cssOf = (f: string) => readFileSync(resolve(__dirname, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    // 載る順（`App.tsx` の import 順）。後に載るほど強い＝同じ強さなら後勝ち。
    const sheets = [cssOf("../../styles/theme.css"), cssOf("../components/timeline.css")];
    const cls = new Set(["timeline-clip", "timeline-clip--selected", "drop-target--blocked"]);
    /** その選択子が「選ばれていて置けない帯」に当たるか＋強さ（クラスの数）。 */
    const match = (sel: string): number | null => {
      const t = sel.trim();
      const parts = t.split(".").filter(Boolean);
      if (!t.startsWith(".") || parts.some((c) => !cls.has(c))) return null;
      return parts.length;
    };
    let best: { rank: number; color: string } | null = null;
    sheets.forEach((css, sheet) => {
      for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const spec = match(m[1]);
        const decl = /outline(?:-color)?:[^;]*var\(--color-([a-z]+)\)/.exec(m[2]);
        if (spec == null || !decl) continue;
        const rank = spec * 1000 + sheet; // 強さ → 同じなら後に載った方
        if (!best || rank >= best.rank) best = { rank, color: decl[1] };
      }
    });
    expect(best).not.toBeNull();
    expect(best!.color).toBe("danger");
  });

  it("細い帯では端の取っ手を出さない（本体を掴む所が無くなる）", () => {
    open({
      clips: [{ id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 0.5, x: 0, y: 0, w: 10, h: 10, text: "あ" }],
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    // 0.5秒 × 36 px/秒 = 18px。取っ手2つ（14px）と「⋮」（14px）で本体が消える。
    expect(container.querySelectorAll(".timeline-clip-handle").length).toBe(0);
  });

  it("まとめて選んでいるときは「複製」を押せなくする（押しても無反応、を作らない）", () => {
    mixed();
    useTimelineStore.setState({ selectedClipIds: ["clip_001", "clip_002"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.contextMenu(screen.getByRole("button", { name: "文字" }));
    // 複製は「選択がちょうど1件」でないと store が何もせず、理由も持たない＝黙って効かない。
    const dup = screen.getByRole("menuitem", { name: "複製" });
    expect(dup.hasAttribute("disabled") || dup.getAttribute("aria-disabled") === "true").toBe(true);
    expect(dup.getAttribute("title")).toContain("1つだけ選ぶと");
  });

  it("右クリックした帯が選ばれる（別の部品に効かせない）", () => {
    mixed();
    useTimelineStore.setState({ selectedClipIds: ["clip_003"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.contextMenu(screen.getByRole("button", { name: "文字" }));
    // 選ばずに開くと、メニューの項目が**別の部品**（読み上げ）に効いてしまう。
    expect(useTimelineStore.getState().selectedClipIds).toEqual(["clip_001"]);
  });

  it("まとめて選んでいる中の1つを右クリックしても、選択は保つ（まとめて消せる）", () => {
    mixed();
    useTimelineStore.setState({ selectedClipIds: ["clip_001", "clip_002"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.contextMenu(screen.getByRole("button", { name: "文字" }));
    expect(useTimelineStore.getState().selectedClipIds).toEqual(["clip_001", "clip_002"]);
    expect(screen.getByRole("menuitem", { name: "選んだ2個を削除" })).toBeInTheDocument();
  });

  it("固定した列の帯では、消す・複製を押せなくして理由を出す", () => {
    open({
      tracks: [{ id: "track_001", kind: TRACK_KIND.visual, locked: true }, { id: "track_002", kind: TRACK_KIND.audio }],
      clips: [{ id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 2, x: 0, y: 0, w: 10, h: 10, text: "文字" }],
    });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.contextMenu(screen.getByRole("button", { name: "文字" }));
    const del = screen.getByRole("menuitem", { name: "削除" });
    expect(del.hasAttribute("disabled") || del.getAttribute("aria-disabled") === "true").toBe(true);
    expect(del.getAttribute("title")).toContain("固定");
    // 固定の理由は「選んだ部品」の欄と**同じ言い方**にする（同じ状態を場所で言い分けない）。
    const dup = screen.getByRole("menuitem", { name: "複製" });
    expect(dup.getAttribute("title")).toBe(lockedTrackMessage("content"));
  });
});

// 表示倍率・目盛りのシーク・再生位置の線（#686 段階2・ADR-0034 決定13）。
describe("TimelineProjectScreen: 拡大縮小と時間の目盛り（#686）", () => {
  const withClip = (durationSec = 5) =>
    open({ clips: [{ id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec, x: 0, y: 0, w: 10, h: 10, text: "あ" }] });
  const lane = (c: HTMLElement) => c.querySelector(".timeline-lane") as HTMLElement;

  it("広げる・縮める・全体を表示 が出ている", () => {
    withClip();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getByRole("button", { name: "表示を広げる" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "表示を縮める" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "全体を表示" })).toBeInTheDocument();
  });

  it("広げると帯も目盛りも同じだけ伸びる（段は場面形式と同じ型）", () => {
    withClip();
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const before = (screen.getByRole("button", { name: "あ" }) as HTMLElement).style.width;
    fireEvent.click(screen.getByRole("button", { name: "表示を広げる" }));
    const after = (screen.getByRole("button", { name: "あ" }) as HTMLElement).style.width;
    // 36 → 54（段の次）＝5秒の帯は 180px → 270px。
    expect(before).toBe("180px");
    expect(after).toBe("270px");
    expect(lane(container).style.width).toBe("640px"); // 列は下限（640px）まで縮まない
  });

  it("端では押せなくする（押せるのに何も起きない、を作らない）", () => {
    withClip();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    for (let i = 0; i < 5; i += 1) fireEvent.click(screen.getByRole("button", { name: "表示を広げる" }));
    expect(screen.getByRole("button", { name: "表示を広げる" })).toBeDisabled();
    for (let i = 0; i < ZOOM_LEVELS.length; i += 1) fireEvent.click(screen.getByRole("button", { name: "表示を縮める" })); // 段の数だけ（#1258 で下へ足した）
    expect(screen.getByRole("button", { name: "表示を縮める" })).toBeDisabled();
  });

  // ⚠️ **旗は目盛りの行の「中」にある**（#1148＝α 出口監査 🔴3）＝外（`.timeline-inner` 直下）に
  // 置くと、#1104 で目盛り行を貼り付けた（`z-index: 6`）ぶん**旗が帯の下に塗られ**、当たり判定も
  // 行が取るので**押すとシークになる**（#1138 で 🔴 と判定して直した状態に戻っていた）。
  // ⚠️ **見た目（塗り順）は検査で見られない**ので、**置き場所（親子）と押した結果**で留める。
  describe("目印の旗は目盛りの中にある（#1148）", () => {
    const withMarker = (timeSec: number) => {
      withClip(20);
      useTimelineStore.setState((st) => ({
        doc: st.doc ? { ...st.doc, markers: [{ id: "marker_001", timeSec }] } : st.doc,
      }));
    };

    it("旗は目盛りの行の中・目盛りそのものの外に描かれる", () => {
      withMarker(4);
      const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
      // ⚠️ **行の中**＝外（`.timeline-inner` 直下）に出すと、貼り付いた行の下に塗られて押せなくなる。
      expect(
        container.querySelector(".timeline-row:first-child .timeline-marker"),
        "旗が目盛りの行の中にありません（外に出ると帯の下に塗られて押せなくなります）",
      ).not.toBeNull();
      // ⚠️ **目盛りそのもの（`role="slider"`）の中ではない**＝ARIA では slider の子は
      // presentational なので、中に入れると**旗の名前が読み上げの木から落ちる**
      //（#1159 レビュー由来 ℹ️）。押した結果が目盛りへ渡らないのも、この置き場所のおかげ。
      expect(
        container.querySelector(".timeline-ruler .timeline-marker"),
        "旗が目盛り（slider）の中にあります（読み上げから落ち、押すとシークに化けます）",
      ).toBeNull();
      // ⚠️ **2か所に描かない**＝片方だけ直したときに気づけない。
      expect(container.querySelectorAll(".timeline-marker")).toHaveLength(1);
    });

    // ⚠️ **掴み手も同じ理由で消えていた**（#1159 レビュー由来 🔴）＝三角は線（`.timeline-playhead`）の
    // `::before` だったので、貼り付いた目盛り行の下に塗られて**掴める合図が画面から消えていた**
    //（`cursor: ew-resize` だけが全幅に出ている状態）。線は外のまま・三角だけ行の中へ。
    it("再生ヘッドの掴み手は目盛りの行の中、線は外（全レーンを貫く）", () => {
      withMarker(4);
      const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
      expect(
        container.querySelector(".timeline-row:first-child .timeline-playhead-grip"),
        "掴み手が目盛りの行の中にありません（帯の下に塗られて合図が消えます）",
      ).not.toBeNull();
      expect(
        container.querySelector(".timeline-row:first-child .timeline-playhead"),
        "線まで行の中に入っています（全レーンを貫けなくなります）",
      ).toBeNull();
      expect(container.querySelector(".timeline-inner > .timeline-playhead")).not.toBeNull();
    });

    // ⚠️ **掴む側にも渡さない**＝目盛りは `pointerdown` からドラッグを始める（再生中なら止める）。
    // 渡してしまうと、旗を押しただけで**再生が止まり、掴んだ扱い**になる。
    it("旗を押しても、目盛りを掴んだ扱いにならない（再生が止まらない）", () => {
      withMarker(4);
      const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
      useTimelineStore.setState({ isPlaying: true });
      const flag = container.querySelector(".timeline-marker > button") as HTMLElement;
      fireEvent.pointerDown(flag, { button: 0, clientX: 300 });
      expect(useTimelineStore.getState().isPlaying, "旗を押しただけで再生が止まっています").toBe(true);
    });

    it("旗を押すと、その目印の時刻へ移る（押した場所へのシークに化けない）", () => {
      withMarker(4);
      const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
      const ruler = container.querySelector(".timeline-ruler") as HTMLElement;
      ruler.getBoundingClientRect = () => ({ left: 100, top: 0, width: 800, height: 24, right: 900, bottom: 24, x: 100, y: 0, toJSON: () => ({}) }) as DOMRect;
      const flag = container.querySelector(".timeline-marker > button") as HTMLElement;
      // ⚠️ **押す場所は目印の時刻と別**にする＝止め忘れると「押した場所（10秒）」へ跳ぶ。
      fireEvent.click(flag, { clientX: 100 + 36 * 10 });
      expect(useTimelineStore.getState().playheadSec).toBeCloseTo(4, 5);
    });
  });

  it("目盛りを押すとその時刻へ再生位置が動く（列で受けると帯の選択と取り合う）", () => {
    withClip(20);
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const ruler = container.querySelector(".timeline-ruler") as HTMLElement;
    ruler.getBoundingClientRect = () => ({ left: 100, top: 0, width: 800, height: 24, right: 900, bottom: 24, x: 100, y: 0, toJSON: () => ({}) }) as DOMRect;
    fireEvent.click(ruler, { clientX: 100 + 36 * 4 }); // 4秒の所（段の既定 36 px/秒）
    expect(useTimelineStore.getState().playheadSec).toBeCloseTo(4, 5);
  });

  it("目盛りにフォーカスがあるとき ←→ が効く（両方が手を引いて無反応、を作らない）", () => {
    withClip(20);
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const ruler = container.querySelector(".timeline-ruler") as HTMLElement;
    // ⚠️ 画面のキー操作は「矢印を使う要素」（`role="slider"` を含む）に譲るので、目盛り側が
    // 受けないと**どちらも動かず**、既定の横スクロールだけが起きる。
    fireEvent.keyDown(ruler, { key: "ArrowRight" });
    expect(useTimelineStore.getState().playheadSec).toBeCloseTo(1 / 30, 5); // 画面と同じフレーム送り
    fireEvent.keyDown(ruler, { key: "ArrowRight", shiftKey: true });
    expect(useTimelineStore.getState().playheadSec).toBeCloseTo(1 + 1 / 30, 5); // Shift で1秒
  });

  it("目盛りの間隔は**倍率**で決める（縮めても文字が重ならない）", () => {
    withClip(20);
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const gapAt = () => {
      const ticks = [...container.querySelectorAll(".timeline-tick")] as HTMLElement[];
      return parseFloat(ticks[1].style.left) - parseFloat(ticks[0].style.left);
    };
    // 尺で決めていると、縮めたときに間隔が px で潰れる（16px 間隔に「0秒/1秒/…」が並ぶ）。
    for (let i = 0; i < 5; i += 1) fireEvent.click(screen.getByRole("button", { name: "表示を縮める" }));
    expect(gapAt()).toBeGreaterThanOrEqual(40);
    for (let i = 0; i < 10; i += 1) fireEvent.click(screen.getByRole("button", { name: "表示を広げる" }));
    expect(gapAt()).toBeLessThanOrEqual(600);
  });

  it("自分で倍率を変えたあとは、部品を置いても勝手に戻さない", () => {
    open({ clips: [] });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    // ⚠️ 幅を差し込む＝jsdom は `clientWidth` が 0 なので、そのままだと**自動の合わせ自体が走らず**
    // このテストが何も見ないことになる（実際に変異が生き残った）。
    Object.defineProperty(container.querySelector(".timeline-scroll")!, "clientWidth", { value: 900, configurable: true });
    fireEvent.click(screen.getByRole("button", { name: "表示を広げる" }));
    fireEvent.click(screen.getByRole("button", { name: "表示を広げる" }));
    const clip = () => (screen.queryByRole("button", { name: "テキスト" }) as HTMLElement | null)?.style.width;
    fireEvent.click(screen.getByRole("button", { name: "文字を置く" }));
    // 36 → 54 → 80。5秒の帯は 400px。全体表示へ飛ぶと 5秒×120（幅に収まる最大段）＝600px になる。
    expect(clip()).toBe("400px");
  });

  it("まだ触っていなければ、幅が測れた時点で全体表示に合わせる", () => {
    open({ clips: [] });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    Object.defineProperty(container.querySelector(".timeline-scroll")!, "clientWidth", { value: 900, configurable: true });
    fireEvent.click(screen.getByRole("button", { name: "文字を置く" }));
    // 5秒・幅 900-84=816 → 全部入る最大段は 120。5×120＝600px。
    expect((screen.getByRole("button", { name: "テキスト" }) as HTMLElement).style.width).toBe("600px");
  });

  it("目盛りは位置を持つ操作として読み上げに伝わる（Home/End で端へ）", () => {
    withClip(20);
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const ruler = container.querySelector(".timeline-ruler") as HTMLElement;
    expect(ruler.getAttribute("role")).toBe("slider");
    expect(ruler.getAttribute("aria-valuemax")).toBe("20");
    fireEvent.keyDown(ruler, { key: "End" });
    expect(useTimelineStore.getState().playheadSec).toBe(20);
    fireEvent.keyDown(ruler, { key: "Home" });
    expect(useTimelineStore.getState().playheadSec).toBe(0);
  });

  // ⚠️ **掴んだまま動かせる**（#819-1・ADR-0034 決定1）＝再生ヘッドには掴み手の三角を描いておきながら、
  // 押した所へ跳ぶだけで**追従しなかった**（掴める合図を出して掴めない）。作法は帯・欄と同じもの。
  describe("目盛りを掴んで動かす（#819-1）", () => {
    const rulerOf = (container: HTMLElement): HTMLElement => {
      const ruler = container.querySelector(".timeline-ruler") as HTMLElement;
      // jsdom は実レイアウトを持たないので、目盛りの左端を 0 として測れるようにする。
      ruler.getBoundingClientRect = () =>
        ({ left: 0, top: 0, width: 1000, height: 24, right: 1000, bottom: 24, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
      return ruler;
    };

    it("押したまま動かすと、再生位置が指に追いてくる", () => {
      withClip(20);
      const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
      const ruler = rulerOf(container);
      fireEvent.pointerDown(ruler, { button: 0, pointerId: 1, clientX: 0, clientY: 0 });
      // ⚠️ **押した瞬間から追いてくる**（遊びを作らない）＝つまみを掴む操作なので、
      // 帯を運ぶときのような「少し動かすまで掴まない」余白があると**動かないように見える**。
      fireEvent.pointerMove(window, { buttons: 1, pointerId: 1, clientX: 2, clientY: 0 });
      expect(useTimelineStore.getState().playheadSec).toBeGreaterThan(0);
      fireEvent.pointerMove(window, { buttons: 1, pointerId: 1, clientX: 36, clientY: 0 }); // 36px＝1秒
      expect(useTimelineStore.getState().playheadSec).toBeCloseTo(1, 6);
      fireEvent.pointerMove(window, { buttons: 1, pointerId: 1, clientX: 180, clientY: 0 }); // 5秒
      expect(useTimelineStore.getState().playheadSec).toBeCloseTo(5, 6);
      fireEvent.pointerUp(window, { pointerId: 1 });
    });

    it("Escape でやめると、掴む前の位置へ戻る（帯の移動と同じ）", () => {
      withClip(20);
      const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
      act(() => { useTimelineStore.getState().setPlayhead(3); });
      const ruler = rulerOf(container);
      fireEvent.pointerDown(ruler, { button: 0, pointerId: 1, clientX: 108, clientY: 0 });
      fireEvent.pointerMove(window, { buttons: 1, pointerId: 1, clientX: 360, clientY: 0 });
      expect(useTimelineStore.getState().playheadSec).toBeCloseTo(10, 6);
      fireEvent.keyDown(window, { key: "Escape" });
      expect(useTimelineStore.getState().playheadSec).toBeCloseTo(3, 6); // 掴む前へ
    });

    // ⚠️ **やめた後に離しても上書きされない**（PR #827 レビュー 🟡）＝`pointerdown` の
    // `preventDefault` は `click` を止めないので、印を見ないと**離した位置で書き戻される**
    //（`Escape` が効かなかったことになる）。帯のドラッグと同じ印を見る。
    it("Escape でやめた後、時間が経ってから指を離しても戻した位置のまま", async () => {
      withClip(20);
      const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
      act(() => { useTimelineStore.getState().setPlayhead(3); });
      const ruler = rulerOf(container);
      fireEvent.pointerDown(ruler, { button: 0, pointerId: 1, clientX: 108, clientY: 0 });
      fireEvent.pointerMove(window, { buttons: 1, pointerId: 1, clientX: 360, clientY: 0 });
      fireEvent.keyDown(window, { key: "Escape" });
      // ⚠️ **実機の順序を再現する**（#833-1）＝`Escape` は**指を離す前**に走るので、やめてから離すまでには
      // 必ず時間が経つ。ここを飛ばして `Escape` の直後に同期で `click` を撃つと、**印を `setTimeout(0)`
      // で自分から落とす実装でも緑になる**＝実機でだけ壊れているのを見逃す（それが #833-1 で起きたこと。
      // PR #827 で直したはずの壊れ方が、テストに守られないまま残っていた）。
      await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
      // ここで実際にボタンを離す＝ブラウザは同じ要素に `click` を出す。
      fireEvent.pointerUp(window, { pointerId: 1, clientX: 360, clientY: 0 });
      fireEvent.click(ruler, { clientX: 360, clientY: 0, detail: 1 }); // 指の経路
      expect(useTimelineStore.getState().playheadSec).toBeCloseTo(3, 6);
    });

    // ⚠️ **掴んでいる間に横スクロールされてもずれない**（レビュー ℹ️）＝枠は掴んだ時点で1度だけ
    // 測るので、送られたぶんを足さないと指と線が離れる（帯のドラッグと同じ補正）。
    it("掴んでいる間に横スクロールされても、指の下の時刻を指す", () => {
      withClip(60);
      const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
      const scroll = container.querySelector(".timeline-scroll") as HTMLElement;
      const ruler = rulerOf(container);
      fireEvent.pointerDown(ruler, { button: 0, pointerId: 1, clientX: 0, clientY: 0 });
      scroll.scrollLeft = 360; // 掴んだまま 10秒ぶん送られる
      fireEvent.pointerMove(window, { buttons: 1, pointerId: 1, clientX: 36, clientY: 0 });
      expect(useTimelineStore.getState().playheadSec).toBeCloseTo(11, 6); // 送りぶん＋1秒
      fireEvent.pointerUp(window, { pointerId: 1 });
    });

    // ⚠️ **再生中は「掴ませない」ではなく「掴んだら止まる」**（#833-2・ADR-0032 決定21）＝
    // 決定21 が再生中に押させないと定めるのは**位置を使う**操作（「ここで分ける」等＝走っていると
    // 同じ操作の結果が毎回変わる）。目盛りは位置を**決める**側で結果は一意なので、決定21 の
    // 「押せるが、押した時点で再生は止まる」に当たる。以前は掴む処理だけを止めており、
    // **掴める合図（`ew-resize`）は出たまま線は追いてこず、離した瞬間に `onClick` がそこへ跳ばす**
    // ＝#819 が直したはずの「掴める合図を出して掴めない」が再生中だけ残っていた。
    it("再生中に掴むと再生が止まり、そのまま線が追いてくる", () => {
      withClip(20);
      const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
      act(() => { useTimelineStore.setState({ isPlaying: true }); });
      const ruler = rulerOf(container);
      fireEvent.pointerDown(ruler, { button: 0, pointerId: 1, clientX: 0, clientY: 0 });
      expect(useTimelineStore.getState().isPlaying).toBe(false); // 掴んだ時点で止まる
      fireEvent.pointerMove(window, { buttons: 1, pointerId: 1, clientX: 360, clientY: 0 });
      expect(useTimelineStore.getState().playheadSec).toBeCloseTo(10, 6); // 追いてくる（掴めない、を作らない）
      fireEvent.pointerUp(window, { pointerId: 1 });
    });

    // ⚠️ **掴むのは左ボタンだけ**（差分再監査② ℹ️3・PR #854 レビュー ℹ️）＝同じ関門を「再生位置」の
    // 欄と目盛りの2か所に置いたが、留めていたのは欄だけだった。**同じ一行でも、片方だけ落ちれば
    // 機械には見えない**。
    // ⚠️ **2つの `expect` は別の関門を留めている**（変異チェックで確認）＝**止まらないこと**は
    // この画面の関門（`e.button !== 0`）、**動かないこと**は掴む作法の単一の参照元
    //（`usePointerDrag` の左ボタン限定）。線を動かす側は元から共有側で弾かれているので、
    // この画面の関門が実際に足しているのは**止めないこと**だけ。両方見るのは、
    // 「右クリックでは何も起きない」を画面の側から通しで留めるため。
    it("右クリックでは止まらず、線も動かない（掴んだことにしない）", () => {
      withClip(20);
      const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
      act(() => { useTimelineStore.setState({ isPlaying: true, playheadSec: 3 }); });
      const ruler = rulerOf(container);
      fireEvent.pointerDown(ruler, { button: 2, pointerId: 1, clientX: 360, clientY: 0 });
      expect(useTimelineStore.getState().isPlaying).toBe(true); // 走ったまま
      fireEvent.pointerMove(window, { buttons: 2, pointerId: 1, clientX: 720, clientY: 0 });
      expect(useTimelineStore.getState().playheadSec).toBeCloseTo(3, 6); // 追いてこない
    });

    // ⚠️ **戻す先は store のいまの値**（レビュー 🟡）＝再生中は描画時の `playheadSec` が1コマぶん古いので、
    // クロージャの値で覚えると `Escape` が「掴む前」ではなく**1コマ前**へ戻す。ここでは再帰描画を挟まずに
    // store だけを進めて（＝描画時の値と store の値をわざとずらして）、戻り先が store 側であることを見る。
    it("再生中に掴んだときの戻し先は、描画時の値ではなくそのときの位置", () => {
      withClip(20);
      const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
      act(() => { useTimelineStore.setState({ isPlaying: true }); });
      const ruler = rulerOf(container);
      // 描き直しを挟まずに位置だけ進める＝この時点で「描画時の値」と store の値がずれる。
      useTimelineStore.setState({ playheadSec: 7 });
      fireEvent.pointerDown(ruler, { button: 0, pointerId: 1, clientX: 252, clientY: 0 });
      fireEvent.pointerMove(window, { buttons: 1, pointerId: 1, clientX: 540, clientY: 0 });
      fireEvent.keyDown(window, { key: "Escape" });
      expect(useTimelineStore.getState().playheadSec).toBeCloseTo(7, 6); // ずれた側ではなく、掴んだ時点の位置
    });

    // ⚠️ **掴んで枠の外へ運んだら送る**（#833-3）＝帯のドラッグは `autoScroll` を通すのに目盛りだけ
    // 通しておらず、**枠の外まで運んでも送りが無い**＝見えない所へ置いて離すことになっていた
    //（同じ画面の掴む操作で流儀が割れていた＝ADR-0026②）。入口は帯と同じ `useEdgeAutoScroll`。
    it("掴んだまま端まで運ぶと送りが走り、離すと止まる", () => {
      const frames: Array<(t: number) => void> = [];
      vi.stubGlobal("requestAnimationFrame", (cb: (t: number) => void) => { frames.push(cb); return frames.length; });
      vi.stubGlobal("cancelAnimationFrame", () => { frames.length = 0; });
      try {
        withClip(60);
        const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
        const scroll = container.querySelector(".timeline-scroll") as HTMLElement;
        // jsdom は実寸を持たないので、**送れる枠**として必要な値だけ差し込む。
        Object.defineProperty(scroll, "clientWidth", { value: 600, configurable: true });
        Object.defineProperty(scroll, "scrollWidth", { value: 3000, configurable: true });
        // ⚠️ jsdom は**貼り付いた要素の `scrollLeft` を動かさない**（常に 0 を返す）ので、
        // そのままだと「送っても値が変わらない」＝配線し忘れても症状が出ず**通るだけのテスト**になる。
        let sl = 0;
        Object.defineProperty(scroll, "scrollLeft", { get: () => sl, set: (v: number) => { sl = v; }, configurable: true });
        scroll.getBoundingClientRect = () => ({ left: 0, top: 0, right: 600, bottom: 100, width: 600, height: 100, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
        const ruler = rulerOf(container);
        fireEvent.pointerDown(ruler, { button: 0, pointerId: 1, clientX: 0, clientY: 10 });
        fireEvent.pointerMove(window, { buttons: 1, pointerId: 1, clientX: 590, clientY: 10 }); // 右端の送る帯へ
        expect(frames.length).toBeGreaterThan(0); // 送りが走っている
        act(() => { frames.splice(0).forEach((cb) => cb(1000)); });
        act(() => { frames.splice(0).forEach((cb) => cb(2000)); }); // （1フレーム目は dt=0 になりうる）
        expect(scroll.scrollLeft).toBeGreaterThan(0); // 実際に送られた＝見えない所へ置かせない
        fireEvent.pointerUp(window, { pointerId: 1, clientX: 590, clientY: 10 });
        const after = scroll.scrollLeft;
        act(() => { frames.splice(0).forEach((cb) => cb(3000)); });
        expect(scroll.scrollLeft).toBe(after); // 離したら止まる（rAF が回り続けない）
      } finally {
        vi.unstubAllGlobals();
      }
    });

    // ⚠️ **縦にも送る**（#1477・業界の型）＝列が多いと、枠の下に隠れた列へ帯を運べなかった（横だけ送っていた）。
    it("帯を掴んで枠の下端まで運ぶと縦に送り、離すと止まる", () => {
      const frames: Array<(t: number) => void> = [];
      vi.stubGlobal("requestAnimationFrame", (cb: (t: number) => void) => { frames.push(cb); return frames.length; });
      vi.stubGlobal("cancelAnimationFrame", () => { frames.length = 0; });
      try {
        withClip(5);
        const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
        const scroll = container.querySelector(".timeline-scroll") as HTMLElement;
        Object.defineProperty(scroll, "clientWidth", { value: 600, configurable: true });
        Object.defineProperty(scroll, "clientHeight", { value: 300, configurable: true });
        Object.defineProperty(scroll, "scrollHeight", { value: 2000, configurable: true });
        let st = 0;
        Object.defineProperty(scroll, "scrollTop", { get: () => st, set: (v: number) => { st = v; }, configurable: true });
        scroll.getBoundingClientRect = () => ({ left: 0, top: 0, right: 600, bottom: 300, width: 600, height: 300, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
        const clip = screen.getByRole("button", { name: "あ" });
        fireEvent.pointerDown(clip, { button: 0, pointerId: 1, clientX: 300, clientY: 60 });
        fireEvent.pointerMove(window, { buttons: 1, pointerId: 1, clientX: 300, clientY: 295 }); // 下端の送る帯へ
        act(() => { frames.splice(0).forEach((cb) => cb(1000)); });
        act(() => { frames.splice(0).forEach((cb) => cb(2000)); });
        expect(st).toBeGreaterThan(0); // 縦に送られた
        fireEvent.pointerUp(window, { pointerId: 1, clientX: 300, clientY: 295 });
        const after = st;
        act(() => { frames.splice(0).forEach((cb) => cb(3000)); });
        expect(st).toBe(after); // 離したら止まる
      } finally {
        vi.unstubAllGlobals();
      }
    });
  });

  // ⚠️ **再生に合わせて見える範囲を送る**（#819-1）＝送らないと、ヘッドが枠の外へ出た時点で
  // **いま何が出ているのかが画面から消える**（倍率を上げるほど早く外れる）。
  it("再生中にヘッドが枠の外へ出たら、見える範囲を送る", () => {
    withClip(60);
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const scroll = container.querySelector(".timeline-scroll") as HTMLElement;
    Object.defineProperty(scroll, "clientWidth", { value: 500, configurable: true });
    act(() => { useTimelineStore.setState({ isPlaying: true }); });
    act(() => { useTimelineStore.getState().setPlayhead(5); }); // 5秒＝180px（まだ見えている）
    expect(scroll.scrollLeft).toBe(0);
    act(() => { useTimelineStore.getState().setPlayhead(20); }); // 720px＝枠の外
    expect(scroll.scrollLeft).toBe(720); // ヘッドが左端に来るよう送る
    act(() => { useTimelineStore.setState({ isPlaying: false }); });
  });

  // ⚠️ **境界は「誰が動かしたか」**（#833-3）＝位置が変わっただけ（外から・取り消しなど）では送らない。
  // 送るのは**利用者がその操作で位置を動かしたとき**だけ（下の2件）＝「勝手に画面が動かない」は保つ。
  it("止まっている間、位置が変わっただけでは送らない（勝手に画面が動かない）", () => {
    withClip(60);
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const scroll = container.querySelector(".timeline-scroll") as HTMLElement;
    Object.defineProperty(scroll, "clientWidth", { value: 500, configurable: true });
    act(() => { useTimelineStore.getState().setPlayhead(20) ; });
    expect(scroll.scrollLeft).toBe(0);
  });

  // ⚠️ **止まっていても、利用者が位置を動かしたら追う**（#833-3）＝以前は送りが**再生中だけ**だったので、
  // 止まっている間に `End`・`Shift+→` で枠の外へ出すと**線を見失ったまま**だった。「勝手に動かない」は
  // 利用者が**枠**を動かしたときの話であって、利用者が**位置**を動かしたときは追うのが正しい。
  it("止まっていても、`End` で枠の外へ動かしたら送る", () => {
    withClip(60);
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const scroll = container.querySelector(".timeline-scroll") as HTMLElement;
    Object.defineProperty(scroll, "clientWidth", { value: 500, configurable: true });
    fireEvent.keyDown(container.querySelector(".timeline-ruler") as HTMLElement, { key: "End" });
    expect(useTimelineStore.getState().playheadSec).toBe(60);
    // 60秒＝2160px。見えている幅は 500−（列の名前の欄）なので、行き止まりまで送る。
    // ⚠️ **欄の幅を直書きしない**（#1104）＝TS が単一の参照元なので、広げたときにここだけ古くなる。
    expect(scroll.scrollLeft).toBe(2160 - (500 - TIMELINE_LABEL_W_PX));
  });

  // ⚠️ **`End` と対称に固定する**（レビュー 🟡）＝同じ形（`setPlayhead` の直後に追う）なのに
  // `Home` だけテストが無いと、片方を外しても緑のまま通る（実際に変異が素通りした）。
  it("止まっていても、`Home` で先頭へ戻したら見えるところまで送り返す", () => {
    withClip(60);
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const scroll = container.querySelector(".timeline-scroll") as HTMLElement;
    Object.defineProperty(scroll, "clientWidth", { value: 500, configurable: true });
    const ruler = container.querySelector(".timeline-ruler") as HTMLElement;
    fireEvent.keyDown(ruler, { key: "End" });    // まず末尾側へ送る
    expect(scroll.scrollLeft).toBeGreaterThan(0);
    fireEvent.keyDown(ruler, { key: "Home" });   // 先頭へ戻す
    expect(useTimelineStore.getState().playheadSec).toBe(0);
    expect(scroll.scrollLeft).toBe(0); // 先頭が見えるところまで戻る（線を見失わない）
  });

  // ⚠️ **同じ動作は入口で割れない**（#833-3 レビュー 🟡・ADR-0026②）＝「先頭へ」ボタンは `Home` キーと
  // 同じ動作なのに、追う／追わないが入口で分かれていた（キーは追い、ボタンは追わない）。
  // 「この位置へ」（キーフレーム／音量点）も同じ＝跳んだ先が枠の外だと**跳んだのに何も見えない**。
  it("「先頭へ」ボタンでも送り返す（`Home` キーと同じ動作で割れない）", () => {
    withClip(60);
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const scroll = container.querySelector(".timeline-scroll") as HTMLElement;
    Object.defineProperty(scroll, "clientWidth", { value: 500, configurable: true });
    fireEvent.keyDown(container.querySelector(".timeline-ruler") as HTMLElement, { key: "End" });
    expect(scroll.scrollLeft).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "先頭へ" }));
    expect(useTimelineStore.getState().playheadSec).toBe(0);
    expect(scroll.scrollLeft).toBe(0);
  });

  it("止まっていても、`Shift`+矢印で枠の外へ出たら送る（画面のキー操作も同じ入口）", () => {
    withClip(60);
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const scroll = container.querySelector(".timeline-scroll") as HTMLElement;
    Object.defineProperty(scroll, "clientWidth", { value: 500, configurable: true });
    act(() => { useTimelineStore.getState().setPlayhead(11); }); // 396px＝まだ見えている（416px まで）
    expect(scroll.scrollLeft).toBe(0);
    fireEvent.keyDown(window, { key: "ArrowRight", shiftKey: true }); // 1秒進む＝432px＝枠の外
    expect(useTimelineStore.getState().playheadSec).toBeCloseTo(12, 6);
    expect(scroll.scrollLeft).toBe(12 * 36); // ヘッドが左端に来るよう送る
  });

  // ⚠️ **時刻の書き方は1つにそろえる**（#819-3・§6）＝同じ画面の帯のツールチップと見わたす画面が
  // `m:ss` なのに、目盛りだけ「N秒」だった（同じ時刻が2通りに読める）。
  // ⚠️ **動く量が画面から分かる**（#819-3）＝名前だけでは 0.5秒 刻みだと分からず、押してみるまで
  // 結果が読めない（数値の欄と併用する前提の操作なので、量が要る）。
  it("「前へ／後ろへ」は動く量を添える", () => {
    withClip(20);
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getByRole("button", { name: "前へ" }).getAttribute("title")).toContain("0.5秒");
    expect(screen.getByRole("button", { name: "後ろへ" }).getAttribute("title")).toContain("0.5秒");
  });

  it("目盛りの時刻は、帯のツールチップと同じ書き方（m:ss）", () => {
    withClip(120);
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const ticks = [...container.querySelectorAll(".timeline-tick")].map((e) => e.textContent);
    expect(ticks[0]).toBe("0:00");
    expect(ticks).toContain(clockLabel(60)); // 1:00
    expect(ticks.some((t) => t?.endsWith("秒"))).toBe(false);
  });

  it("目盛りの名前は「再生位置」の欄と分ける（同じ名前の操作を2つ作らない）", () => {
    withClip();
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect((container.querySelector(".timeline-ruler") as HTMLElement).getAttribute("aria-label")).toBe("時間の目盛り");
    expect(screen.getByLabelText("再生位置")).toBeInTheDocument(); // 既存の欄は1つのまま
  });

  it("再生位置の線が並びの上に出る（いま何が出ているか分かる）", () => {
    withClip(20);
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    act(() => { useTimelineStore.getState().setPlayhead(5); });
    const head = container.querySelector(".timeline-playhead") as HTMLElement;
    expect(head).not.toBeNull();
    expect(head.style.left).toBe("calc(var(--timeline-label-w) + 180px)"); // 5秒 × 36
  });

  it("何も置いていないときは線を出さない（指す先が無い）", () => {
    open({ clips: [] });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(container.querySelector(".timeline-playhead")).toBeNull();
  });
});
