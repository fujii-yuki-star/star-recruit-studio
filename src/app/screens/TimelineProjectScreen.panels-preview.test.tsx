// @vitest-environment jsdom
// タイムライン編集プロジェクトの画面（ADR-0032・#629 骨格）＝列の名前・写す/貼る・囲んで選ぶ・全体図・反転・キーフレームの印ほか。
// ⚠️ **1つのファイルで約10分かかっていたので分けた**（負荷・耐久の点検 2026-10-22）＝ほかと一緒に走ると時間切れで
//   たまに落ちていた。共有の下ごしらえ（文書・開き方・テスト間の後片づけ）は `src/test/timelineScreenKit.tsx` に1つ。
import { describe, expect, it, vi } from "vitest";
import { act, render, screen, fireEvent, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { TimelineProjectScreen } from "./TimelineProjectScreen";
import { useTimelineStore } from "../store/timelineStore";
import { editBlockedMessage } from "../uiLabels";
import { TIMELINE_CLIP_KIND, TRACK_KIND } from "../../domain/enums";
import { EDIT_BLOCKED } from "../../domain/timeline/edit";
import { TIMELINE_LABEL_W_PX } from "../../domain/constants";
import type { TimelineProject } from "../../domain/timeline/types";
import { EXPORT_SIZE_HINT, SILENCE_FIND_LABEL, silenceMessage, FREEZE_FRAME_LABEL, MARKER_ADD_LABEL, TRANSCRIBE_LABEL } from "../uiLabels";
import { doc, open, resetTimelineScreenBetweenTests } from "../../test/timelineScreenKit";

resetTimelineScreenBetweenTests();


// 「置く」欄の素材タブは、素材の一覧を上へ寄せる（ADR-0048・#1256 b4）。
// ⚠️ 以前は取り込み・棚・説明・置く列・文字/図形が縦に積まれ、既定の配置でボタン14個のうち5個しか見えなかった。
describe("TimelineProjectScreen: 「置く」欄を詰める（#1256 b4）", () => {
  const place = () => document.querySelector('[data-panel-id="place"]') as HTMLElement;
  const before = (a: Element, b: Element) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

  it("取り込み・文字を置く・図形を置くが1つの行にある", () => {
    open({ tracks: [{ id: "track_001", kind: TRACK_KIND.visual }] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const text = within(place()).getByRole("button", { name: "文字を置く" });
    const row = text.closest(".row")!;
    expect(row.contains(within(place()).getByRole("button", { name: "図形を置く" }))).toBe(true);
    expect(row.textContent, "取り込みが同じ行に無い").toContain("写真・動画・音楽を取り込む");
  });

  it("「よく使う素材から取り込む」は、置く列と素材の一覧より後ろ", () => {
    open({ tracks: [{ id: "track_001", kind: TRACK_KIND.visual }] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const lib = within(place()).getByText("よく使う素材から取り込む");
    const select = within(place()).getByLabelText("置く列");
    expect(before(select, lib), "棚が置く列より前にある").toBe(true);
    expect(before(within(place()).getByText(/写真がまだありません/), lib), "棚が素材の一覧より前にある").toBe(true);
  });

  it("置く列の名前は「置く列」だけ（説明を名前に混ぜない）", () => {
    open({ tracks: [{ id: "track_001", kind: TRACK_KIND.visual }] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(within(place()).getByRole("combobox", { name: "置く列" })).toBeTruthy();
  });
});

// 帯の操作は「並び」の道具の行にある（ADR-0048・#1256 b5）。
// ⚠️ **以前は「選んだ部品」欄の上段に13個**並び、欄の中身 976px のうち見えるのは約39%だった。
describe("TimelineProjectScreen: 帯の操作の行（#1256 b5）", () => {
  const MOVED = ["ここで分ける", "ここから始める", "ここで終わる", "複製", "削除", "ここから（範囲）", "ここまで（範囲）", "範囲を削除して詰める", "範囲を削除"];
  const clips = [
    { id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 4, x: 0, y: 0, w: 10, h: 10, text: "あ" },
    { id: "clip_002", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 4, durationSec: 4, x: 0, y: 0, w: 10, h: 10, text: "い" },
  ] as TimelineProject["clips"];
  const tools = () => screen.getByRole("toolbar", { name: "帯の操作" });

  it("「並び」の欄にあり、動かした操作が全部そろっている", () => {
    open({ clips });
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(tools().closest(".timeline-panel"), "「並び」の欄の外にある").not.toBeNull();
    for (const name of MOVED) expect(within(tools()).getByRole("button", { name }), name).toBeTruthy();
  });

  it("「選んだ部品」の欄には、位置を少しずつ動かす3つだけが残る", () => {
    open({ clips });
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const panel = document.querySelector('[data-panel-id="selected"]') as HTMLElement;
    for (const name of MOVED) expect(within(panel).queryByRole("button", { name }), `${name} が残っている`).toBeNull();
    for (const name of ["前へ", "後ろへ", "再生位置へ"]) expect(within(panel).getByRole("button", { name }), name).toBeTruthy();
  });

  it("押すと効く（置き場所を変えても同じ入口）", () => {
    open({ clips });
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    act(() => useTimelineStore.getState().setPlayhead(2));
    fireEvent.click(within(tools()).getByRole("button", { name: "ここで分ける" }));
    expect(useTimelineStore.getState().doc!.clips.length).toBe(3);
  });

  // ⚠️ **選ぶ前から見えている**＝押せない理由を言わないと、押せないボタンが並んでいるだけになる（§2-5）。
  it("何も選んでいないときは、押せなくして理由を出す", () => {
    open({ clips });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    for (const name of ["ここで分ける", "複製", "削除"]) {
      const b = within(tools()).getByRole("button", { name }) as HTMLButtonElement;
      expect(b.disabled, `${name} が押せる`).toBe(true);
      expect(b.title, `${name} に理由が無い`).toMatch(/選んで/);
    }
  });

  // ⚠️ **長さをそろえるも「選んでください」**（#1259 レビュー 🟡）＝以前は「選んだ部品が再生位置にかかっていません」
  //   が出ていた（選んでいない人には事実と違う）。
  it("何も選んでいないとき、長さをそろえるは「選んでください」と言う", () => {
    open({ clips });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    for (const name of ["ここから始める", "ここで終わる"]) {
      const b = within(tools()).getByRole("button", { name }) as HTMLButtonElement;
      expect(b.disabled, `${name} が押せる`).toBe(true);
      expect(b.title, name).toBe("長さをそろえる部品を、並びかキャンバスで選んでください");
    }
  });

  it("まとめて選んでいるときは「1つだけ」と言う（選んでいる人に「選んで」と言わない）", () => {
    open({ clips });
    useTimelineStore.setState({ selectedClipIds: ["clip_001", "clip_002"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    for (const name of ["ここで分ける", "複製"]) {
      const b = within(tools()).getByRole("button", { name }) as HTMLButtonElement;
      expect(b.disabled, `${name} が押せる`).toBe(true);
      expect(b.title, name).toBe("1つだけ選ぶと使えます");
    }
    // 削除はまとめて消せる（1つに限らない）＝名前は右クリックのメニューと同じく数を言う。
    expect((within(tools()).getByRole("button", { name: "選んだ2個を削除" }) as HTMLButtonElement).disabled).toBe(false);
    // 長さをそろえるも、変わる数を押す前に出す（#1005）。
    expect(within(tools()).getByRole("button", { name: /ここから始める（\d+個）/ })).toBeTruthy();
  });
});

// 列の高さを選べる（ADR-0048 決定3・#1256 c1）。既定は 28px（#1104 で実機から決めた値）。
describe("TimelineProjectScreen: 列の高さ（#1256 c1）", () => {
  const laneVar = (c: HTMLElement) => (c.querySelector(".timeline") as HTMLElement).style.getPropertyValue("--timeline-lane-h");

  it("既定は 28px（ふつう）", () => {
    open({ tracks: [{ id: "track_001", kind: TRACK_KIND.visual }] });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect((screen.getByLabelText("列の高さ") as HTMLSelectElement).value).toBe("normal");
    expect(laneVar(container)).toBe("28px");
  });

  it("選ぶと列の高さが変わり、覚える（開き直しても同じ）", () => {
    open({ tracks: [{ id: "track_001", kind: TRACK_KIND.visual }] });
    const first = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("列の高さ"), { target: { value: "tall" } });
    expect(laneVar(first.container)).toBe("44px");
    fireEvent.change(screen.getByLabelText("列の高さ"), { target: { value: "compact" } });
    expect(laneVar(first.container)).toBe("20px");
    first.unmount();
    const second = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(laneVar(second.container), "覚えていない").toBe("20px");
  });

  it("道具立ての行にある", () => {
    open({ tracks: [{ id: "track_001", kind: TRACK_KIND.visual }] });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(container.querySelector(".timeline-toolbar")!.contains(screen.getByLabelText("列の高さ"))).toBe(true);
  });
});

// 目印を置く入口は「並び」の道具立ての行と `M` キー（ADR-0048・#1256 b2）。
// ⚠️ **以前は帯の下の節の中にあり、目印が0件でも節が 124px を取っていた**（並びの欄の本文の約27%）。
describe("TimelineProjectScreen: 目印を置く入口（#1256 b2）", () => {
  const addButton = () => screen.getByRole("button", { name: "目印を置く" });

  it("道具立ての行にあり、動画に出ないことを押す前に言う", () => {
    open();
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(container.querySelector(".timeline-toolbar")!.contains(addButton()), "道具立ての行に無い").toBe(true);
    expect(addButton().title, "動画に出ないと言っていない").toContain("動画には出ません");
    expect(addButton().title, "キーで置けることを言っていない").toContain("M キー");
  });

  it("目印が無いときは、目印の節を出さない（帯の入る高さを削らない）", () => {
    open();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.queryByText(/マーカー（目印）/)).toBeNull();
  });

  it("押すと、いまの位置に置かれ、目印の節が出る", () => {
    open();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    act(() => useTimelineStore.getState().setPlayhead(2));
    fireEvent.click(addButton());
    expect(useTimelineStore.getState().doc?.markers?.map((m) => m.timeSec)).toEqual([2]);
    expect(screen.getByText(/マーカー（目印）/)).toBeTruthy();
  });

  it("`M` キーでも置ける（業界の型）", () => {
    open();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    act(() => useTimelineStore.getState().setPlayhead(3));
    fireEvent.keyDown(window, { key: "m" });
    expect(useTimelineStore.getState().doc?.markers?.map((m) => m.timeSec)).toEqual([3]);
  });

  it("文字を打っている所では `M` を奪わない", () => {
    open({ markers: [{ id: "marker_001", timeSec: 1 }] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    act(() => useTimelineStore.getState().setPlayhead(5));
    fireEvent.keyDown(screen.getByPlaceholderText(/メモ/), { key: "m" });
    expect(useTimelineStore.getState().doc?.markers?.length).toBe(1);
    // ⚠️ **選ぶ欄も文字で中を探す**（ブラウザの標準機能）＝`I`／`O` と同じく奪わない。
    fireEvent.keyDown(screen.getByLabelText("書き出す大きさ"), { key: "m" });
    expect(useTimelineStore.getState().doc?.markers?.length, "選ぶ欄でキーを奪った").toBe(1);
  });

  it("書き出し中は理由つきで押せない", () => {
    open();
    useTimelineStore.setState({ exportRun: { phase: "rendering", percent: 42, message: null, cancelling: false } });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(addButton()).toBeDisabled();
    expect(addButton().title).not.toBe("");
    expect(addButton().title).not.toContain("動画には出ません");
  });
});

// 列の見出しの「出す／固定」（ADR-0048・ADR-0033 決定9 の改訂＝「静かな常設」・利用者判断 2026-09-29）。
// 普段は見せず、見出しに乗せた／キーで入ったときに出す。**変えた状態は常に出す**（今の状態が分かる）。
describe("TimelineProjectScreen: 列の見出しの出す／固定（静かな常設）", () => {
  const tracks2 = [{ id: "track_001", kind: TRACK_KIND.visual }, { id: "track_002", kind: TRACK_KIND.audio }];
  const clips1 = [{ id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 3, x: 0, y: 0, w: 10, h: 10, text: "あ" }] as TimelineProject["clips"];
  /** その列の帯の並ぶ箱（見出しのすぐ隣）。 */
  const lane = (c: HTMLElement, id: string) => c.querySelector(`.timeline-row-label[data-track-id="${id}"]`)!.nextElementSibling as HTMLElement;

  it("押すと出さない／出すが切り替わり、状態を名前と押された印で言う", () => {
    open({ tracks: tracks2, clips: clips1 });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const eye = screen.getByRole("button", { name: "映像1を動画に出さない" });
    expect(eye.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(eye);
    expect(useTimelineStore.getState().doc!.tracks[0].hidden).toBe(true);
    const back = screen.getByRole("button", { name: "映像1を動画に出す" });
    expect(back.getAttribute("aria-pressed")).toBe("true");
    expect(back.className, "変えた状態を常に出す印が無い").toContain("timeline-row-toggle--on");
    // 列そのものの見た目でも示す（帯が薄くなる）。
    expect(lane(container, "track_001").className).toContain("timeline-lane--hidden");
    fireEvent.click(back);
    expect(useTimelineStore.getState().doc!.tracks[0].hidden).toBeFalsy();
  });

  it("固定も同じく切り替わり、列に斜線の印が付く", () => {
    open({ tracks: tracks2, clips: clips1 });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "映像1を固定する" }));
    expect(useTimelineStore.getState().doc!.tracks[0].locked).toBe(true);
    expect(screen.getByRole("button", { name: "映像1の固定を外す" }).className).toContain("timeline-row-toggle--on");
    expect(lane(container, "track_001").className).toContain("timeline-lane--locked");
  });

  it("メニューと同じ入口＝取り消せる", () => {
    open({ tracks: tracks2, clips: clips1 });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "映像1を動画に出さない" }));
    act(() => useTimelineStore.getState().undo());
    expect(useTimelineStore.getState().doc!.tracks[0].hidden).toBeFalsy();
  });

  it("文字の印（出さない・固定中）はもう出さない＝アイコンの形で言う", () => {
    open({ tracks: [{ id: "track_001", kind: TRACK_KIND.visual, hidden: true, locked: true }] });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const label = container.querySelector('.timeline-row-label[data-track-id="track_001"]') as HTMLElement;
    expect(label.textContent).not.toContain("出さない");
    expect(label.textContent).not.toContain("固定中");
  });

  it("書き出し中は押せず、理由を言う", () => {
    open({ tracks: tracks2 });
    useTimelineStore.setState({ exportRun: { phase: "rendering", percent: 10, message: null, cancelling: false } });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const eye = screen.getByRole("button", { name: "映像1を動画に出さない" }) as HTMLButtonElement;
    expect(eye.disabled).toBe(true);
    expect(eye.title).not.toBe("");
  });

  it("出さない列・固定した列があるときだけ、道具の行に数を出す", () => {
    open({ tracks: tracks2 });
    const { container, unmount } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(container.querySelector(".timeline-toolbar")!.textContent).not.toMatch(/出さない列/);
    unmount();
    open({ tracks: [{ id: "track_001", kind: TRACK_KIND.visual, hidden: true }, { id: "track_002", kind: TRACK_KIND.audio, locked: true }] });
    const again = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(again.container.querySelector(".timeline-toolbar")!.textContent).toContain("出さない列 1・固定 1");
  });

  // ⚠️ **変えた状態は、乗せても・触る画面でも濃いまま**（#1259 レビュー 🟡＝詳細度の事故）。
  it("CSS：変えた状態の規則は、乗せたときの規則より強く・後ろにある／触る画面の規則は変えた状態を除く", () => {
    const css = readFileSync(resolve(__dirname, "../components/timeline.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    /** 詳細度（id は使っていないので、クラス・疑似クラスの数と要素の数だけ）。 */
    const spec = (sel: string) => (sel.match(/[.:][a-zA-Z-]+/g) ?? []).filter((t) => t !== ":not").length;
    const hoverSel = ".timeline-row-label:hover .timeline-row-toggle";
    const hoverAt = css.indexOf(hoverSel + ",");
    const onSels = css.slice(css.indexOf("\n.timeline-row-toggle--on,"), css.indexOf("{", css.indexOf("\n.timeline-row-toggle--on,"))).split(",").map((x) => x.trim());
    const onAt = css.indexOf("\n.timeline-row-toggle--on,");
    expect(hoverAt, "乗せたときの規則が見つからない").toBeGreaterThan(0);
    expect(onAt, "変えた状態の規則が、乗せたときの規則より前にある（後ろが勝てない）").toBeGreaterThan(hoverAt);
    expect(Math.max(...onSels.map(spec)), "変えた状態の規則が、乗せたときの規則より弱い").toBeGreaterThanOrEqual(spec(hoverSel));
    expect(css, "触る画面の規則が、変えた状態まで薄くする").toMatch(/@media \(hover: none\)\s*\{\s*\.timeline-row-toggle:not\(\.timeline-row-toggle--on\)/);
  });

  // ⚠️ jsdom は `:hover` を計算しないので、**CSS の約束**を見る（実際の見え方は preview_start で確かめた）。
  it("CSS：普段は見せず押せない・乗せる／キーで入ると出る・変えた状態は常に出る・触る画面では常に出る", () => {
    const css = readFileSync(resolve(__dirname, "../components/timeline.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const rule = (sel: string) => { const i = css.indexOf(`\n${sel} {`); return i < 0 ? "" : css.slice(i, css.indexOf("}", i)); };
    const idle = rule(".timeline-row-toggle");
    expect(idle).toMatch(/opacity:\s*0;/);
    expect(idle, "見えないのに押せる（見えない当たり判定）").toMatch(/pointer-events:\s*none/);
    expect(idle, "焦点が入らなくなる").not.toMatch(/visibility:\s*hidden/);
    const reveal = rule(".timeline-row-label:hover .timeline-row-toggle,\n.timeline-row-label:focus-within .timeline-row-toggle");
    expect(reveal, "乗せても／キーで入っても出ない").toMatch(/pointer-events:\s*auto/);
    const on = rule(".timeline-row-label .timeline-row-toggle.timeline-row-toggle--on");
    expect(on).toMatch(/opacity:\s*1/);
    expect(on).toMatch(/pointer-events:\s*auto/);
    expect(css, "触る画面で出す道が無い").toMatch(/@media \(hover: none\)\s*\{\s*\.timeline-row-toggle:not\(\.timeline-row-toggle--on\)\s*\{[^}]*pointer-events:\s*auto/);
    expect(rule(".timeline-lane--locked .timeline-clip"), "帯の上に斜線が無い（帯で埋まった固定の列が固定に見えない）").toMatch(/repeating-linear-gradient/);
  });
});

// 帯の中に長さと速さの印を出す（ADR-0048・#1256 b6）＝ホバーしなくても帯1本から読める。
describe("TimelineProjectScreen: 帯の長さと速さの印（#1256 b6）", () => {
  /** 帯（並んだ順）の印。帯の名前は中身で変わるので、並びの順で取る。 */
  const badgeAt = (c: HTMLElement, i: number) => c.querySelectorAll(".timeline-clip")[i]?.querySelector(".timeline-clip-badge") ?? null;

  it("幅のある帯には長さを出し、読み上げ名には混ぜない", () => {
    // 段の既定 36 px/秒 → 5秒は 180px（出す）・2秒は 72px（出さない）。
    open({ clips: [
      { id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 5, x: 0, y: 0, w: 10, h: 10, text: "あ" },
      { id: "clip_002", kind: TIMELINE_CLIP_KIND.shape, trackId: "track_001", startSec: 6, durationSec: 2, x: 0, y: 0, w: 10, h: 10 },
    ] as TimelineProject["clips"] });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(container.querySelectorAll(".timeline-clip").length).toBe(2);
    const wide = badgeAt(container, 0);
    expect(wide?.textContent).toBe("5.0秒");
    expect(wide?.getAttribute("aria-hidden"), "読み上げ名に混ざる").toBe("true");
    expect(badgeAt(container, 1), "細い帯にまで出して名前を潰している").toBeNull();
  });

  it("速さを変えた帯には速さも出す", () => {
    open({
      assets: [{ assetId: "asset_001", assetType: "bgm", displayName: "音", filePath: "assets/a.mp3" }],
      tracks: [{ id: "track_001", kind: TRACK_KIND.visual }, { id: "track_002", kind: TRACK_KIND.audio }],
      clips: [{ id: "clip_001", kind: TIMELINE_CLIP_KIND.audio, trackId: "track_002", startSec: 0, durationSec: 6, assetId: "asset_001", speed: 2 }] as TimelineProject["clips"],
    });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const badge = container.querySelector(".timeline-clip-badge");
    expect(badge?.textContent).toBe("×2 6.0秒");
  });
});

// 書き出しは見出しの行にある（ADR-0048・#1256＝CapCut・Clipchamp などは右上に置く）。
// ⚠️ 以前は仕上がり確認の欄の中（再生の行）にあり、大きさの選択と書き出すボタンのぶん絵が小さくなっていた。
describe("TimelineProjectScreen: 書き出しの置き場所（#1256）", () => {
  it("「動画を書き出す」と大きさは見出しの行にあり、1組のまま（仕上がり確認の欄には無い）", () => {
    open();
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const bar = container.querySelector(".editor-toolbar") as HTMLElement;
    const btn = screen.getByRole("button", { name: "動画を書き出す" });
    const size = screen.getByLabelText("書き出す大きさ");
    expect(bar.contains(btn), "書き出すボタンが見出しの行に無い").toBe(true);
    expect(btn.parentElement!.contains(size), "大きさと書き出すボタンが1組になっていない（#1255）").toBe(true);
    const preview = container.querySelector('[data-panel-id="preview"]') as HTMLElement;
    expect(preview.contains(btn), "仕上がり確認の欄に残っている").toBe(false);
  });

  it("書き出している間の進み具合も見出しの行に出す", () => {
    open();
    useTimelineStore.setState({ exportRun: { phase: "rendering", percent: 42, message: null, cancelling: false } });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const bar = container.querySelector(".editor-toolbar") as HTMLElement;
    expect(within(bar).getByText(/動画を書き出しています（42%）/)).toBeTruthy();
    expect(within(bar).getByRole("button", { name: "書き出しを中止" })).toBeTruthy();
  });
});

// 仕上がり確認の表示倍率と端の目安（#1261）＝場面編集と同じ部品。
describe("TimelineProjectScreen: 仕上がり確認の表示倍率と端の目安（#1261）", () => {
  /** jsdom には ResizeObserver が無いので、絵の置き場の大きさを渡す代役を置く。 */
  const withResizeObserver = (w: number, h: number) => {
    class RO { cb: ResizeObserverCallback; constructor(cb: ResizeObserverCallback) { this.cb = cb; }
      observe() { this.cb([{ contentRect: { width: w, height: h } } as ResizeObserverEntry], this as unknown as ResizeObserver); }
      disconnect() {} unobserve() {} }
    vi.stubGlobal("ResizeObserver", RO);
  };

  // ⚠️ **絵の上に重ねない**（実機指摘 2026-09-30＝絵と被って押し間違える）＝欄の見出しの行に置く。
  //   **再生の行にも置かない**（#1261＝%表示の幅→行の折り返し→絵の置き場の大きさ→%、の繰り返しで固まった）。
  it("見え方の道具は、仕上がり確認の欄の見出しの行にある（絵の上にも再生の行にも置かない）", () => {
    open();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const tools = screen.getByTestId("preview-view-tools");
    expect(within(tools).getByText("端の目安を出す")).toBeTruthy();
    expect(within(tools).getByRole("button", { name: "仕上がりの表示を広げる" })).toBeTruthy();
    expect(within(tools).getByRole("button", { name: "大きく見る" })).toBeTruthy();
    expect(within(tools).getByRole("button", { name: "別の窓で見る" })).toBeTruthy();
    const frame = document.querySelector('[data-panel-id="preview"]') as HTMLElement;
    expect(frame.querySelector(".panel-frame-head")!.contains(tools), "見出しの行に無い").toBe(true);
    expect(frame.querySelector(".panel-frame-body")!.contains(tools), "欄の中身（絵の上）に重ねている").toBe(false);
    // 流れの中に置く＝重ねる指定を残さない。
    const css = readFileSync(resolve(__dirname, "../../styles/theme.css"), "utf8");
    const rule = (sel: string) => { const i = css.indexOf(`\n${sel} {`); return i < 0 ? "" : css.slice(i, css.indexOf("}", i)); };
    expect(rule(".preview-view-tools"), "規則が見つからない（下の検査が空振りする）").not.toBe("");
    expect(rule(".preview-view-tools"), "道具を重ねている").not.toMatch(/position:\s*absolute/);
  });

  it("端の目安を出すと、動画の端から割合で線を引く（横は四辺 5%）", () => {
    open();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.queryByTestId("timeline-safe-area")).toBeNull();
    fireEvent.click(within(screen.getByTestId("preview-view-tools")).getByRole("checkbox"));
    const g = screen.getByTestId("timeline-safe-area");
    expect([g.style.left, g.style.top, g.style.width, g.style.height]).toEqual(["5%", "5%", "90%", "90%"]);
    fireEvent.click(within(screen.getByTestId("preview-view-tools")).getByRole("checkbox")); // 次の検査へ持ち越さない
  });

  // ⚠️ **欄が狭いと見出しの道具が切れて押せなかった**（α 最終点検 2026-10-21・実機 1280×800 の既定の配置）。
  // どれを畳むかは CSS（`@container`）が決め、「…」は**開いた時点で隠れている物**だけを並べる。
  // jsdom は描かないので `getClientRects` は空＝全部「隠れている」扱いになる。見えている物を外すのは下の検査で別に見る。
  it("「…」は隠れている道具を並べ、選ぶと同じことが起きる", () => {
    open();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const more = () => within(screen.getByTestId("preview-view-tools")).getByRole("button", { name: "仕上がり確認のほかの操作" });
    fireEvent.click(more());
    const menu = screen.getByRole("menu");
    expect(within(menu).getAllByRole("menuitem").map((b) => b.textContent?.trim())).toEqual(["全体表示", "端の目安を出す", "大きく見る", "別の窓で見る"]);
    // 全体が見えているときの「全体表示」は押せない（理由つき）。
    expect(within(menu).getByRole("menuitem", { name: "全体表示" })).toBeDisabled();
    fireEvent.click(within(menu).getByRole("menuitem", { name: "端の目安を出す" }));
    expect(screen.getByTestId("timeline-safe-area"), "選んでも端の目安が出ない").toBeTruthy();
    // 開き直すと、いまの状態に合わせた名前になる。
    fireEvent.click(more());
    fireEvent.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: "端の目安を消す" }));
    expect(screen.queryByTestId("timeline-safe-area")).toBeNull();
  });

  it("「…」は**見えている道具を二重に出さない**", () => {
    open();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const tools = screen.getByTestId("preview-view-tools");
    // 「全体表示」と「端の目安」は見えている（＝描かれている）ことにする。
    for (const key of ["fit", "safe"]) {
      const el = tools.querySelector(`[data-preview-tool="${key}"]`) as HTMLElement;
      el.getClientRects = () => ({ length: 1 }) as unknown as DOMRectList;
    }
    fireEvent.click(within(tools).getByRole("button", { name: "仕上がり確認のほかの操作" }));
    expect(within(screen.getByRole("menu")).getAllByRole("menuitem").map((b) => b.textContent?.trim())).toEqual(["大きく見る", "別の窓で見る"]);
  });

  it("畳む境目は**欄の見出しの幅**で決める（CSS の約束）", () => {
    const css = readFileSync(resolve(__dirname, "../../styles/theme.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    // 同じ選択子の規則が複数あるときは全部を合わせて見る（見出しの行は並べ方と畳み方で規則が分かれている）。
    const rule = (sel: string) => css.split(`\n${sel} {`).slice(1).map((r) => r.slice(0, r.indexOf("}"))).join("\n");
    // 窓の幅（`@media`）では決められない＝欄の幅は配置で変わる。
    expect(rule(".panel-frame-head")).toMatch(/container-type:\s*inline-size/);
    // 広いときは「…」を出さない。
    expect(rule(".preview-view-tools .preview-tools-more")).toMatch(/display:\s*none/);
    const block = (q: string): string => {
      const i = css.indexOf(`@container (${q})`);
      if (i < 0) return "";
      let depth = 0;
      for (let j = css.indexOf("{", i); j < css.length; j++) {
        if (css[j] === "{") depth++;
        else if (css[j] === "}" && --depth === 0) return css.slice(i, j);
      }
      return "";
    };
    const mid = block("max-width: 680px");
    for (const key of ["safe", "big", "window"]) expect(mid, `${key} を畳んでいない`).toContain(`[data-preview-tool="${key}"]`);
    expect(mid).toMatch(/\.preview-tools-more\s*\{\s*display:\s*inline-flex/);
    expect(block("max-width: 440px")).toContain('[data-preview-tool="fit"]');
    expect(block("max-width: 300px")).toContain(".preview-zoom-label");
  });

  // ⚠️ **箱の実寸を変える**＝操作の層は実寸から縮尺を導くので、掴む位置が合う（`transform` にしない）。
  it("広げると絵の箱の実寸が大きくなり、置き場の中で流れる", () => {
    withResizeObserver(800, 300); // 置き場 800×300 → 欄に合わせた絵は 533×300（16:9）
    open();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const wrap = () => screen.getByTestId("preview-fit").querySelector(".preview-stage-wrap") as HTMLElement;
    expect(wrap().style.width, "欄に合わせているのに実寸を決めている").toBe("");
    fireEvent.click(screen.getByRole("button", { name: "仕上がりの表示を広げる" }));
    expect(screen.getByTestId("preview-fit").className).toContain("preview-fit--zoomed");
    expect(Number.parseFloat(wrap().style.width), "広げても絵の箱が大きくならない").toBeGreaterThan(533);
    expect(wrap().style.transform, "transform で拡大している（掴む位置がずれる）").toBe("");
    vi.unstubAllGlobals();
  });
});

// 仕上がり確認の絵は欄に収まり、「再生」の行は押し出されない（#1257）。
// ⚠️ **既定の配置で「再生」が欄の外へ押し出されていた**（1920×1009 の実測＝欄の本文 284px に絵 418px）。
// jsdom は大きさを計算しないので、**構造（絵の置き場と操作の置き場を分ける）と CSS の約束**を見る。
// 実寸は `preview_start` で測った（直した後＝欄 284px の中に絵 110px・「再生」は y=220 で欄の中）。
describe("TimelineProjectScreen: 仕上がり確認の絵は欄に収まる（#1257）", () => {
  const cssOf = (f: string) => readFileSync(resolve(__dirname, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  // 規則の中身（`選択子 {` から最初の `}` まで）。**完全一致の選択子**で探す＝別の規則を拾わない。
  const ruleOf = (css: string, sel: string): string => {
    const i = css.indexOf(`\n${sel} {`);
    return i < 0 ? "" : css.slice(i, css.indexOf("}", i));
  };

  it("絵は「絵の置き場」に、「再生」は「操作の置き場」にある（別の箱）", () => {
    open();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const fit = screen.getByTestId("preview-fit");
    const below = screen.getByTestId("preview-below");
    expect(fit.querySelector(".preview-stage"), "絵が絵の置き場に無い").not.toBeNull();
    expect(below.contains(screen.getByRole("button", { name: "再生" })), "「再生」が操作の置き場に無い").toBe(true);
    expect(fit.contains(below), "操作の置き場が絵の置き場の中にある（絵と一緒に押し出される）").toBe(false);
    // 欄は**中身に高さを配らせる**器（`fillBody`）＝そうでないと絵の置き場が残りの高さを受け取れない。
    // ⚠️ 置き場は入れ物（`.preview-fit-shell`＝#1261 の浮かせた道具の基準）の中＝その入れ物が欄の直下。
    expect(fit.parentElement?.parentElement?.className, "欄が高さを配らない（絵が欄に収まらない）").toMatch(/panel-frame-body--fill/);
    // 比は動画の向きから流し込む（縦型で枠と絵がずれない）。
    expect(fit.style.getPropertyValue("--stage-ratio")).toBe(String(1920 / 1080));
  });

  it("CSS：絵は高さの側からも縛られ、操作の置き場だけが流れる", () => {
    const css = cssOf("../../styles/theme.css");
    const fit = ruleOf(css, ".preview-fit");
    expect(fit, "絵の置き場の規則が無い").toMatch(/flex:\s*1 1 0/);
    expect(fit, "高さを測れない（cqh が効かない）").toMatch(/container-type:\s*size/);
    const wrap = ruleOf(css, ".preview-fit > .preview-stage-wrap");
    expect(wrap, "絵の幅が高さから縛られていない（横長の欄で絵が欄を越える）").toMatch(/width:\s*min\(100cqw,\s*calc\(100cqh\s*\*\s*var\(--stage-ratio/);
    const below = ruleOf(css, ".preview-below");
    expect(below, "操作の置き場が流れない（設定を開くと欄を越える）").toMatch(/overflow:\s*auto/);
    expect(below, "操作の置き場が縮まない").toMatch(/min-height:\s*0/);
  });
});

// 再生位置は操作の行にある（利用者要望 2026-09-28）。
// ⚠️ **以前は欄のいちばん下**（クレジットと文字の形の設定より後ろ）にあり、**スクロールしないと届かなかった**。
describe("TimelineProjectScreen: 再生位置の置き場所", () => {
  // ⚠️ **書き出しは見出しの行へ移した**（ADR-0048・#1256）＝以前はこの検査が「書き出しと同じ行」を見ていた。
  // 守りたいのは**再生位置が「再生」の行にある（欄の奥に沈まない）**ことなので、そちらを見る。
  it("「再生」と同じ行にある（別の欄の奥に沈んでいない）", () => {
    open();
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const slider = container.querySelector('input[type="range"]');
    expect(slider, "再生位置のつまみが無い").not.toBeNull();
    const row = screen.getByRole("button", { name: "再生" }).closest(".row");
    expect(row, "「再生」が操作の行に無い").not.toBeNull();
    expect(row!.contains(slider!), "再生位置が「再生」と同じ行に無い（欄の奥に沈んでいる）").toBe(true);
    // ⚠️ **在るだけでは足りない**（変異チェックで露見）＝行の中に置いたまま隠しても通ってしまう。
    for (let el: HTMLElement | null = slider as HTMLElement; el && el !== row; el = el.parentElement) {
      expect(getComputedStyle(el).display, "再生位置（かその親）が隠れている").not.toBe("none");
    }
  });

  // ⚠️ **同じ行に在る**だけでは足りない（実機で踏んだ）＝欄が狭いと、いちばん伸び縮みする
  // つまみ**だけ**が潰れて **10px**（＝掴めない）になっていた。**下限を持っていること**を見る。
  // ⚠️ **数は定数から取らない**＝定数を 0 にする変異が「定数どおり」で通ってしまう。
  it("再生位置のつまみは、狭い欄でも掴める幅を保つ", () => {
    open();
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const slider = container.querySelector('input[type="range"]') as HTMLInputElement;
    expect(slider, "再生位置のつまみが無い").not.toBeNull();
    expect(Number.parseInt(slider.style.minWidth, 10) || 0, "つまみが潰れる（下限が無い）").toBeGreaterThanOrEqual(60);
    // 見える文字を外したので、**読み上げ用の名前**が唯一の手がかりになる。
    expect(slider.getAttribute("aria-label"), "再生位置の名前が無い").toBe("再生位置");
  });

  // ⚠️ **「大きさ」と「書き出す」は1組**（実機で踏んだ）＝別々に置いたら、欄が狭いときに
  // **その間で折り返して、書き出しボタンだけが次の行へ落ちた**。
  // ⚠️ **折り返しそのものは jsdom では測れない**（画面の配置を計算しない）＝**組になっていること**
  // （同じ包みの中に居て、その包みが**間で折り返さない**）までを見る。実寸は実機で測った。
  it("「大きさ」と「動画を書き出す」は、間で折り返さない1組になっている", () => {
    open();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const size = screen.getByLabelText("書き出す大きさ");
    const exportBtn = screen.getByRole("button", { name: "動画を書き出す" });
    const wrap = exportBtn.parentElement!;
    expect(wrap.contains(size), "大きさと書き出しが別の包みに居る").toBe(true);
    expect(wrap.style.flexWrap, "組の中で折り返す（書き出しだけが落ちる）").toBe("nowrap");
    expect(wrap.style.flexShrink, "組が縮む").toBe("0");
    expect(wrap.parentElement, "組が操作の行の直下に無い").toBe(exportBtn.closest(".row"));
  });
});

// 塞がっているときの置き方（利用者判断 2026-09-28・#1252）。
// ⚠️ **同じ「置く」でも、人のつもりが種類で違う**＝写真を続けて置くのは紙芝居、文字を置くのは重ねたい。
// アプリには分からないので**種類で決める**。⚠️ #722 案A（奥へ置かない＝裏に隠さない）は守る＝足すのは手前。
describe("TimelineProjectScreen: 塞がっているときの置き方（#1252）", () => {
  const busyVisual = () => open({
    tracks: [{ id: "track_002", kind: TRACK_KIND.audio }, { id: "track_001", kind: TRACK_KIND.visual }],
    clips: [{ id: "clip_001", kind: TIMELINE_CLIP_KIND.shape, trackId: "track_001", startSec: 0, durationSec: 5, x: 0, y: 0, w: 100, h: 100 }],
  });
  it("文字は、塞がっていたら手前に列を足して**重なる**（後ろへ並ばない）", () => {
    busyVisual();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const before = useTimelineStore.getState().doc!.tracks.length;
    fireEvent.click(screen.getByText("文字を置く"));
    const d = useTimelineStore.getState().doc!;
    expect(d.tracks.length, "列が足されていない").toBe(before + 1);
    const text = d.clips.find((c) => c.kind === TIMELINE_CLIP_KIND.text)!;
    expect(text.startSec, "後ろへずれている（重なっていない）").toBe(0);
    expect(text.trackId, "同じ列に置かれている").not.toBe("track_001");
    // ⚠️ **足すのは手前**＝裏に隠れない（配列の後ろほど手前・`11 §7.6`）。
    expect(d.tracks.findIndex((t) => t.id === text.trackId))
      .toBeGreaterThan(d.tracks.findIndex((t) => t.id === "track_001"));
  });

  it("図形も同じ", () => {
    busyVisual();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByText("図形を置く"));
    const d = useTimelineStore.getState().doc!;
    const added = d.clips.filter((c) => c.kind === TIMELINE_CLIP_KIND.shape);
    expect(added.length).toBe(2);
    expect(added[1]!.startSec, "後ろへずれている").toBe(0);
  });

  // ⚠️ **空いていれば列を足さない**＝押すたびに列が増える、を作らない。
  it("空いているときは列を足さない", () => {
    open({ tracks: [{ id: "track_001", kind: TRACK_KIND.visual }], clips: [] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByText("文字を置く"));
    expect(useTimelineStore.getState().doc!.tracks.length, "列が増えている").toBe(1);
  });

  // ⚠️ **1回の取り消しで両方戻る**＝列だけが残らない。
  it("取り消すと、足した列も一緒に戻る", () => {
    busyVisual();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const before = useTimelineStore.getState().doc!.tracks.length;
    fireEvent.click(screen.getByText("文字を置く"));
    useTimelineStore.getState().undo();
    const d = useTimelineStore.getState().doc!;
    expect(d.tracks.length, "列だけが残った").toBe(before);
    expect(d.clips.some((c) => c.kind === TIMELINE_CLIP_KIND.text)).toBe(false);
  });

  // ⚠️ **写真は後ろへ並んだまま**＝紙芝居が作れる（上の「素材を続けて置くと…」が本体）。
  it("写真は塞がっていても列を足さない（紙芝居のまま）", () => {
    open({
      tracks: [{ id: "track_002", kind: TRACK_KIND.audio }, { id: "track_001", kind: TRACK_KIND.visual }],
      assets: [{ assetId: "asset_001", assetType: "image", displayName: "会社の外観", filePath: "a.png" }],
      clips: [{ id: "clip_001", kind: TIMELINE_CLIP_KIND.slot, trackId: "track_001", startSec: 0, durationSec: 5, assetId: "asset_001", x: 0, y: 0, w: 100, h: 100 }],
    });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const before = useTimelineStore.getState().doc!.tracks.length;
    fireEvent.click(screen.getAllByRole("button", { name: "会社の外観" })[0]!);
    const d = useTimelineStore.getState().doc!;
    expect(d.tracks.length, "写真なのに列が足された").toBe(before);
    expect(d.clips[1]!.startSec, "後ろへ並んでいない").toBe(5);
  });
});

// 再生中は列と帯を描き直さない（負荷試験 2026-10-22）。⚠️ **再生中に変わりうるものは描き直す**＝
// 入れ物の `deps` から抜けると、再生中に選んだ・動かした結果が止めるまで帯に出ない（古いまま描かれる）。
describe("TimelineProjectScreen: 再生中の帯", () => {
  const clips = [
    { id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 4, x: 0, y: 0, w: 10, h: 10, text: "あ" },
    { id: "clip_002", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 6, durationSec: 4, x: 0, y: 0, w: 10, h: 10, text: "い" },
  ] as TimelineProject["clips"];
  const band = (id: string) => document.querySelector(`[data-clip-id="${id}"]`) as HTMLElement;

  it("再生中に選び直すと、帯の選んだ印がすぐ移る", () => {
    open({ clips });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    act(() => useTimelineStore.setState({ isPlaying: true, selectedClipIds: ["clip_001"] }));
    expect(band("clip_001").className).toContain("timeline-clip--selected");
    act(() => useTimelineStore.setState({ selectedClipIds: ["clip_002"] }));
    expect(band("clip_001").className).not.toContain("timeline-clip--selected");
    expect(band("clip_002").className).toContain("timeline-clip--selected");
    act(() => useTimelineStore.setState({ isPlaying: false }));
  });

  it("再生中に文書が変わると、帯の位置がすぐ変わる（再生位置だけが変わるときは描き直さない）", () => {
    open({ clips });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    act(() => useTimelineStore.setState({ isPlaying: true }));
    const before = band("clip_002").style.left;
    act(() => useTimelineStore.getState().setPlayhead(3));
    expect(band("clip_002").style.left).toBe(before);
    // 文書を差し替える（再生中は編集を断る操作もあるので、合図ではなく文書そのものを変える）。
    act(() => {
      const d = useTimelineStore.getState().doc!;
      useTimelineStore.setState({ doc: { ...d, clips: d.clips.map((c) => (c.id === "clip_002" ? { ...c, startSec: 8 } : c)) } });
    });
    expect(band("clip_002").style.left, "再生中に動かした帯が古い位置のまま").not.toBe(before);
    act(() => useTimelineStore.setState({ isPlaying: false }));
  });
});

// 「並び」の道具は1行・狭いと「…」へ畳む（ADR-0048 追補 2026-10-21・α 最終点検）。
// ⚠️ **以前は2本×2段＝118px**を取り、帯の見える高さが既定の窓で約 127px（3列ぶん）しか無かった。
// jsdom は CSS を当てないので `getClientRects` は空＝全部「隠れている」扱い。見えている物を外すのは別の検査で見る。
describe("TimelineProjectScreen: 並びの道具は1行・畳んだ物は「…」", () => {
  const clips = [
    { id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 4, x: 0, y: 0, w: 10, h: 10, text: "あ" },
  ] as TimelineProject["clips"];
  const more = () => screen.getByRole("button", { name: "並びのほかの操作" });
  // 項目の名前（右端の近道キー＝`context-menu-key` は除く）。
  const menuLabels = () => within(screen.getByRole("menu")).getAllByRole("menuitem").map((b) => {
    const copy = b.cloneNode(true) as HTMLElement;
    copy.querySelectorAll(".context-menu-key").forEach((k) => k.remove());
    return copy.textContent?.trim();
  });
  const menuKeys = () => within(screen.getByRole("menu")).getAllByRole("menuitem").map((b) => b.getAttribute("aria-keyshortcuts")).filter(Boolean);

  it("道具の行は1本＝帯の操作と見え方の道具が同じ行", () => {
    open({ clips });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const rows = container.querySelectorAll(".timeline-panel .timeline-toolbar");
    expect(rows.length, "道具の行が2本以上に戻っている").toBe(1);
    expect(rows[0].contains(screen.getByRole("toolbar", { name: "帯の操作" }))).toBe(true);
    expect(rows[0].contains(screen.getByRole("switch", { name: "吸着" }))).toBe(true);
    expect(rows[0].contains(screen.getByRole("group", { name: "表示倍率" }))).toBe(true);
  });

  it("「…」は隠れている道具を並べ、押せないものは理由つきで押せない", () => {
    open({ clips });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(more());
    // 並ぶ順＝行に並ぶ順（帯の操作→見え方の道具→列の高さ）。何も選んでいない＝帯の操作は押せない。
    expect(menuLabels()).toEqual([
      "ここで分ける", "複製", "削除", "ここから始める", "ここで終わる", FREEZE_FRAME_LABEL, SILENCE_FIND_LABEL, TRANSCRIBE_LABEL,
      "ここから（範囲）", "ここまで（範囲）", "範囲を削除して詰める", "範囲を削除",
      MARKER_ADD_LABEL, "映像の列を足す", "音の列を足す", "列の高さを「細い」にする", "列の高さを「太い」にする",
    ]);
    // 近道のキーも項目に出す（右クリックのメニューと同じ出し方）。
    expect(menuKeys()).toEqual(["Control+K", "Control+D", "Delete", "I", "O", "Shift+Delete", "M"]);
    const split = within(screen.getByRole("menu")).getByRole("menuitem", { name: "ここで分ける" });
    expect(split).toBeDisabled();
    expect(split.getAttribute("title"), "押せない理由が無い").toBeTruthy();
  });

  it("「…」から選ぶと、ボタンと同じことが起きる", () => {
    open({ clips });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const tracks = useTimelineStore.getState().doc!.tracks.length;
    fireEvent.click(more());
    fireEvent.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: "映像の列を足す" }));
    expect(useTimelineStore.getState().doc!.tracks.length).toBe(tracks + 1);
    fireEvent.click(more());
    fireEvent.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: "列の高さを「太い」にする" }));
    expect((screen.getByLabelText("列の高さ") as HTMLSelectElement).value).toBe("tall");
    // 選んでから分ける（ボタンと同じ入口）。
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    act(() => useTimelineStore.getState().setPlayhead(2));
    fireEvent.click(more());
    fireEvent.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: "ここで分ける" }));
    expect(useTimelineStore.getState().doc!.clips.length).toBe(2);
  });

  it("「…」は**見えている道具を二重に出さない**", () => {
    open({ clips });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    for (const key of ["split", "duplicate", "remove", "laneHeight"]) {
      const el = container.querySelector(`[data-arrange-tool="${key}"]`) as HTMLElement;
      el.getClientRects = () => ({ length: 1 }) as unknown as DOMRectList;
    }
    fireEvent.click(more());
    const labels = menuLabels();
    for (const name of ["ここで分ける", "複製", "削除", "列の高さを「細い」にする"]) expect(labels, name).not.toContain(name);
    expect(labels).toContain("ここから始める");
  });

  it("作業範囲を取っているときだけ、範囲の操作を行に並べる（取っていないときは「…」にだけ）", () => {
    open({ clips });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const fold = (key: string) => container.querySelector(`[data-arrange-tool="${key}"]`)?.getAttribute("data-fold");
    expect(fold("rangeCloseGap")).toBe("idle");
    expect(fold("rangeDelete")).toBe("idle");
    expect(container.querySelector('[data-arrange-tool="rangeClear"]'), "取っていないのに「やめる」がある").toBeNull();
    act(() => { useTimelineStore.getState().setRangeEdge("in", 1); useTimelineStore.getState().setRangeEdge("out", 3); });
    expect(fold("rangeCloseGap"), "取っているのに畳んでいる").toBeNull();
    expect(fold("rangeDelete")).toBeNull();
    expect(container.querySelector('[data-arrange-tool="rangeClear"]')).not.toBeNull();
    // 範囲の操作が並ぶぶん、優先度の低い物をもう1段畳む印（行を折り返して帯を縦にずらさない）。
    expect(container.querySelector(".timeline-toolbar")!.hasAttribute("data-range-active")).toBe(true);
    const css = readFileSync(resolve(__dirname, "../components/timeline.css"), "utf8");
    expect(css).toMatch(/\.timeline-toolbar\[data-range-active\] \[data-fold="narrow"\] \{\s*display:\s*none/);
    act(() => useTimelineStore.getState().clearRange());
    expect(container.querySelector(".timeline-toolbar")!.hasAttribute("data-range-active")).toBe(false);
  });

  it("畳む境目は**欄の幅**で決め、畳む物は優先度の低い順（CSS の約束）", () => {
    const css = readFileSync(resolve(__dirname, "../components/timeline.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const rule = (sel: string) => css.split(`\n${sel} {`).slice(1).map((r) => r.slice(0, r.indexOf("}"))).join("\n");
    expect(rule(".timeline-panel")).toMatch(/container-type:\s*inline-size/);
    // 入りきらないときは折り返す（切って押せなくしない）。
    expect(rule(".timeline-toolbar")).toMatch(/flex-wrap:\s*wrap/);
    expect(rule(".timeline-toolbar [data-fold=\"idle\"]")).toMatch(/display:\s*none/);
    const widthOf = (fold: string): number => {
      const m = new RegExp(`@container \\(max-width: (\\d+)px\\) \\{\\s*\\.timeline-toolbar \\[data-fold="${fold}"\\]`).exec(css);
      return m ? Number(m[1]) : NaN;
    };
    // 広い順に畳む＝wide がいちばん早く（広い幅から）畳まれる。
    expect(widthOf("wide")).toBeGreaterThan(widthOf("mid"));
    expect(widthOf("mid")).toBeGreaterThan(widthOf("narrow"));
    expect(widthOf("narrow")).toBeGreaterThan(0);
  });
});

// 列を足すボタンの置き場所（利用者要望 2026-09-28）。
// ⚠️ **帯の下に置くと、その2つのぶんだけ帯の入る高さが減る**＝道具立ては1行に畳む
//（#1104 で「表示倍率」「吸着」を1行にしたのと同じ理由）。
// ⚠️ **「並び」の欄の中には残す**（#767）＝欄の外へ出すと、欄だけ見ていて列を足せない、に戻る。
describe("TimelineProjectScreen: 列を足すボタンの置き場所", () => {
  it("道具立ての行（表示倍率・吸着と同じ行）にある", () => {
    open();
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const toolbar = container.querySelector(".timeline-toolbar");
    expect(toolbar, "道具立ての行が無い").not.toBeNull();
    // 「表示倍率」の見出しの文字は外し、まとまりの名前にした（ADR-0048 追補 2026-10-21）。
    expect(within(toolbar as HTMLElement).getByRole("group", { name: "表示倍率" })).toBeTruthy();
    expect(toolbar!.textContent, "「映像の列を足す」が同じ行に無い").toContain("映像の列を足す");
    expect(toolbar!.textContent, "「音の列を足す」が同じ行に無い").toContain("音の列を足す");
  });

  it("「並び」の欄の中にある（欄の外へ出さない・#767）", () => {
    open();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const btn = screen.getByRole("button", { name: "映像の列を足す" });
    expect(btn.closest(".timeline-panel"), "「並び」の欄の外に出ている").not.toBeNull();
  });

  it("押せば列が増える（置き場所を変えても効く）", () => {
    open();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const before = useTimelineStore.getState().doc!.tracks.length;
    fireEvent.click(screen.getByRole("button", { name: "音の列を足す" }));
    expect(useTimelineStore.getState().doc!.tracks.length).toBe(before + 1);
  });
});

// 書き出す大きさ（#1255・利用者判断 2026-09-28）。
// ⚠️ **場面形式には在るのに、こちらだけ常に 1920×1080 だった**＝同じ「動画を書き出す」なのに
// 形式でできることが違う（ADR-0026②）。口（`outputSize`）は前から在り、渡していなかっただけ。
describe("TimelineProjectScreen: 書き出す大きさ（#1255）", () => {
  it("書き出すボタンと同じ行で選べる（欄の奥に沈めない）", () => {
    open();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const sel = screen.getByLabelText("書き出す大きさ") as HTMLSelectElement;
    const row = screen.getByRole("button", { name: "動画を書き出す" }).closest(".row");
    expect(row!.contains(sel), "書き出すボタンと違う行にある").toBe(true);
    // ⚠️ **目に見える名前も要る**（変異チェックで露見）＝`aria-label` だけだと、
    //   画面の「大きさ」が消えても通る＝目で見る人には**名前の無い欄**になる。
    expect(sel.closest("label")?.textContent, "目に見える名前が無い").toContain("大きさ");
  });

  // ⚠️ **言い方は場面形式と同じ**（`06 §3`＝同じものを別の語で呼ばない）。
  it("選択肢は「きれい」「軽い」で、寸法も出る", () => {
    open();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const sel = screen.getByLabelText("書き出す大きさ") as HTMLSelectElement;
    const texts = [...sel.options].map((o) => o.text);
    expect(texts).toEqual(["きれい（1920×1080）", "ふつう（1920×1080・ファイル小さめ）", "軽い（1280×720）"]);
  });

  // #1218 レビュー：場面形式の書き出し画面と同じ説明を添える（同じ3択で片方だけ意味が書かれていない、を作らない）。
  it("「ふつう」の説明を添える（場面形式と同じ文）", () => {
    open();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getByLabelText("書き出す大きさ").getAttribute("title")).toBe(EXPORT_SIZE_HINT);
  });

  it("既定は「きれい」（場面形式の既定と同じ）", () => {
    open();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect((screen.getByLabelText("書き出す大きさ") as HTMLSelectElement).value).toBe("fullhd");
    expect(useTimelineStore.getState().exportSize).toBe("fullhd");
  });

  it("選ぶと覚える", () => {
    open();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("書き出す大きさ"), { target: { value: "hd" } });
    expect(useTimelineStore.getState().exportSize).toBe("hd");
    fireEvent.change(screen.getByLabelText("書き出す大きさ"), { target: { value: "standard" } });
    expect(useTimelineStore.getState().exportSize).toBe("standard");
  });

  // ⚠️ **縦型でも同じ関数から出す**＝数字を画面に書かない（§2-7）。
  it("縦型では縦型の寸法が出る", () => {
    open({ videoSettings: { ...doc().videoSettings, aspectRatio: "9:16" } });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const texts = [...(screen.getByLabelText("書き出す大きさ") as HTMLSelectElement).options].map((o) => o.text);
    expect(texts).toEqual(["きれい（1080×1920）", "ふつう（1080×1920・ファイル小さめ）", "軽い（720×1280）"]);
  });
});

// 無音を詰める（#1385）＝画面の関門と「聞く」。
describe("無音を詰める", () => {
  const rec = {
    assets: [{ assetId: "asset_001", assetType: "bgm" as const, displayName: "録音", filePath: "assets/rec.wav" }],
    clips: [{ id: "clip_009", kind: TIMELINE_CLIP_KIND.audio, trackId: "track_002", startSec: 0, durationSec: 10, assetId: "asset_001" }],
  };
  const button = () => screen.getByRole("button", { name: SILENCE_FIND_LABEL }) as HTMLButtonElement;

  it("固定した列があれば押す前に断る（詰めるのは全部の列）", () => {
    open({ ...rec, tracks: [{ id: "track_001", kind: TRACK_KIND.visual, locked: true }, { id: "track_002", kind: TRACK_KIND.audio }] } as Partial<TimelineProject>);
    useTimelineStore.setState({ selectedClipIds: ["clip_009"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(button().disabled).toBe(true);
    expect(button().title).toBe(editBlockedMessage[EDIT_BLOCKED.lockedSelection]);
  });

  it("音の無い部品では押せない（理由つき）・音の部品なら押せる", () => {
    const text = { id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 5, x: 0, y: 0, w: 100, h: 50, text: "あ" };
    open({ ...rec, clips: [...rec.clips, text] } as Partial<TimelineProject>);
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    const { unmount } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(button().disabled).toBe(true);
    expect(button().title).toBe(silenceMessage.SILENCE_NO_SOUND);
    unmount();
    useTimelineStore.setState({ selectedClipIds: ["clip_009"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(button().disabled).toBe(false);
  });

  it("「聞く」は候補の少し前から鳴らし、終わりを過ぎたら止める", () => {
    open(rec as Partial<TimelineProject>);
    const cand = { startSec: 2, endSec: 4 };
    useTimelineStore.setState({ selectedClipIds: ["clip_009"], silenceFind: { clipId: "clip_009", candidates: [cand], doc: useTimelineStore.getState().doc! } });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "聞く" }));
    expect(useTimelineStore.getState().isPlaying).toBe(true);
    expect(useTimelineStore.getState().playheadSec).toBeCloseTo(1.5);
    act(() => { useTimelineStore.setState({ playheadSec: 4.6 }); });
    expect(useTimelineStore.getState().isPlaying).toBe(false);
  });
});

// 全体図の帯（#1319 c2）＝全体を縮めて、見えている範囲を枠で示す。押すとその時刻へ送る。
describe("TimelineProjectScreen: 全体図の帯（#1319）", () => {
  const LABEL = TIMELINE_LABEL_W_PX;
  // 0〜20 秒に部品（36px/秒＝720px）。
  const long = () =>
    open({
      clips: [
        { id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 5, x: 0, y: 0, w: 10, h: 10, text: "あ" },
        { id: "clip_002", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 15, durationSec: 5, x: 0, y: 0, w: 10, h: 10, text: "い" },
      ],
    });
  /** jsdom は幅を持たないので、並びの枠に幅と送り量を差し込み、測り直させる。 */
  const sizeScroller = (container: HTMLElement, width: number, scrollLeft = 0): HTMLElement => {
    const el = container.querySelector(".timeline-scroll") as HTMLElement;
    let left = scrollLeft;
    Object.defineProperty(el, "clientWidth", { configurable: true, get: () => width });
    Object.defineProperty(el, "scrollWidth", { configurable: true, get: () => LABEL + 20 * 36 });
    Object.defineProperty(el, "scrollLeft", { configurable: true, get: () => left, set: (v: number) => { left = v; } });
    act(() => { el.dispatchEvent(new Event("scroll")); });
    return el;
  };

  // ⚠️ **幅を測る前は出さない**＝幅 0 は「何も見えていない」と読めて、どの動画でも出てしまう。
  it("並びの幅を測る前（幅 0）は出さない", () => {
    long();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.queryByTestId("timeline-overview")).toBeNull();
  });

  it("全体が枠に収まっていれば出さない（送る先が無い）", () => {
    long();
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    sizeScroller(container, LABEL + 20 * 36 + 10);
    expect(screen.queryByTestId("timeline-overview")).toBeNull();
    // ⚠️ **場所は取っておく**（PR #1412 レビュー 🟡）＝出し入れで並びが縦にずれない。押せない・読み上げない。
    const idle = container.querySelector(".timeline-overview--idle");
    expect(idle).not.toBeNull();
    expect(idle!.getAttribute("aria-hidden")).toBe("true");
  });

  it("Escape で、押す前の送り量へ戻す（押した瞬間に真ん中へ送った分も含めて）", () => {
    long();
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const el = sizeScroller(container, LABEL + 180, 36);
    const bar = screen.getByTestId("timeline-overview");
    bar.getBoundingClientRect = () => ({ left: 0, width: 200, top: 0, height: 28, right: 200, bottom: 28, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    fireEvent.pointerDown(bar, { pointerId: 1, button: 0, clientX: 150, clientY: 5 });
    expect(el.scrollLeft).not.toBe(36); // 押した瞬間に送る
    fireEvent.keyDown(window, { key: "Escape" });
    expect(el.scrollLeft).toBe(36);
  });

  // ⚠️ **押しても焦点を取らない**（0.5.2 出口監査 ℹ️）＝取ると、押した後の ← → が帯を送り、再生位置が動かなくなる。
  // 合成イベントは焦点を動かさないので、焦点の移動そのものではなく「既定の動き（焦点を移す）を止めたか」で見る。
  it("帯を押しても焦点を取らない（キーは並びのまま・Tab では当てられる）", () => {
    long();
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    sizeScroller(container, LABEL + 180, 36);
    const bar = screen.getByTestId("timeline-overview");
    expect(fireEvent.mouseDown(bar, { button: 0 })).toBe(false); // false＝既定の動きを止めた
    expect(bar.tabIndex).toBe(0);
  });

  it("送る相手（並びの枠）を指し、見えている範囲を読み上げる", () => {
    long();
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const el = sizeScroller(container, LABEL + 180, 180);
    const bar = screen.getByTestId("timeline-overview");
    expect(bar.getAttribute("aria-controls")).toBe(el.id);
    expect(bar.getAttribute("aria-valuetext")).toBe("5秒から10秒まで（全体 20秒）");
  });

  it("はみ出していれば出し、見えている範囲を枠で示す（名前の欄の幅は除く）", () => {
    long();
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    sizeScroller(container, LABEL + 180, 180); // 見えているのは 5〜10 秒
    const win = screen.getByTestId("timeline-overview-window");
    expect(win.style.left).toBe("25%");
    expect(win.style.width).toBe("25%");
    // 部品は列の段に、種類の色で描く。
    const marks = container.querySelectorAll<HTMLElement>(".timeline-overview-clip--telop");
    expect(marks).toHaveLength(2);
    // ⚠️ **並びと同じ上下**＝並びは文書の最後の列をいちばん上に描く。
    const rows = useTimelineStore.getState().doc!.tracks.length;
    expect(marks[0].style.top).toBe(`${(rows - 1) * (100 / rows)}%`);
  });

  it("押すとその時刻が真ん中に来るように送る", () => {
    long();
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const el = sizeScroller(container, LABEL + 180, 0);
    const bar = screen.getByTestId("timeline-overview");
    bar.getBoundingClientRect = () => ({ left: 0, width: 200, top: 0, height: 28, right: 200, bottom: 28, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    fireEvent.pointerDown(bar, { pointerId: 1, button: 0, clientX: 150, clientY: 5 }); // 15 秒
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 150, clientY: 5 });
    expect(el.scrollLeft).toBe(15 * 36 - 90); // 見えている 180px の真ん中に 15 秒
  });

  it("枠を掴んで運ぶと、動かした割合ぶん並びを送る（真ん中へ跳ばない）", () => {
    long();
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    // ⚠️ **途中まで送った所から掴む**＝0 秒付近で掴むと、真ん中へ跳んでも送り量が 0 のままで見分けられない（変異チェックで露見）。
    const el = sizeScroller(container, LABEL + 180, 360); // 見えているのは 10〜15 秒（帯の 50〜75%）
    const bar = screen.getByTestId("timeline-overview");
    bar.getBoundingClientRect = () => ({ left: 0, width: 200, top: 0, height: 28, right: 200, bottom: 28, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    const win = screen.getByTestId("timeline-overview-window");
    fireEvent.pointerDown(win, { pointerId: 1, button: 0, clientX: 110, clientY: 5 }); // 枠の中（11 秒）
    expect(el.scrollLeft).toBe(360); // 掴んだだけでは送らない（真ん中へ跳ばすと 11 秒が真ん中＝306）
    fireEvent.pointerMove(window, { pointerId: 1, buttons: 1, clientX: 130, clientY: 5 }); // 帯の 1割＝2秒ぶん
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 130, clientY: 5 });
    expect(el.scrollLeft).toBeCloseTo(360 + 2 * 36, 5);
  });

  it("矢印キーで見えている幅の1割ずつ送り、End で端へ", () => {
    long();
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const el = sizeScroller(container, LABEL + 180, 0);
    const bar = screen.getByTestId("timeline-overview");
    fireEvent.keyDown(bar, { key: "ArrowRight" });
    expect(el.scrollLeft).toBeCloseTo(0.5 * 36, 5); // 見えている 5 秒の1割
    fireEvent.keyDown(bar, { key: "End" });
    expect(el.scrollLeft).toBeGreaterThan(36 * 15);
  });
});

// 部品の反転と動きの支点（ADR-0059・#1186）＝反転は「見え方」、支点は「動き」の欄から直す（0.5.2 出口監査で動きの欄へ）。付けた部品では欄を開いておく。
describe("TimelineProjectScreen: 反転と動きの支点（#1186）", () => {
  const withShape = (over: Record<string, unknown> = {}) => {
    open({
      clips: [{ id: "clip_001", kind: TIMELINE_CLIP_KIND.shape, trackId: "track_001", startSec: 0, durationSec: 5, x: 0, y: 0, w: 100, h: 100, shapeType: "rect", ...over }],
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
  };
  const openLook = () => {
    if (!screen.queryByLabelText("左右反転")) fireEvent.click(screen.getByRole("button", { name: /見え方（色・重ね方・反転）/ }));
  };


  it("左右反転・上下反転を入れ外しできる", () => {
    withShape();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    openLook();
    fireEvent.click(screen.getByLabelText("左右反転"));
    expect(useTimelineStore.getState().doc!.clips[0].flipX).toBe(true);
    fireEvent.click(screen.getByLabelText("上下反転"));
    expect(useTimelineStore.getState().doc!.clips[0].flipY).toBe(true);
    fireEvent.click(screen.getByLabelText("左右反転"));
    expect(useTimelineStore.getState().doc!.clips[0].flipX).toBeUndefined();
  });

  it("動きの支点を選べる（足元・中心へ戻す）", () => {
    withShape();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const select = screen.getByLabelText("動きの支点");
    fireEvent.change(select, { target: { value: "bottom" } });
    expect(useTimelineStore.getState().doc!.clips[0].pivot).toEqual({ x: 0.5, y: 1 });
    fireEvent.change(select, { target: { value: "center" } });
    expect(useTimelineStore.getState().doc!.clips[0].pivot).toBeUndefined();
  });

  it("反転・支点を付けた部品では、見え方の欄を開いておく（付けたことが見える）", () => {
    withShape({ flipX: true });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect((screen.getByLabelText("左右反転") as HTMLInputElement).checked).toBe(true);
  });

  it("支点を付けた部品では、動きの欄を開いておく（見え方の欄は開かない）", () => {
    localStorage.clear(); // 欄の開閉は覚えている（前の検査で開いた欄が開いたままにならないように）
    withShape({ pivot: { x: 0.5, y: 1 } });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const pivot = screen.getByLabelText("動きの支点") as HTMLSelectElement;
    expect(pivot.value).toBe("bottom");
    // 欄は <details>（畳んでも中身は在る）＝開いているかは details で見る。支点は「動き」の欄にある。
    expect(pivot.closest("details")!.open).toBe(true);
    expect(pivot.closest("details")!.textContent).toContain("本来の見た目からのずれ");
    expect(screen.getByLabelText("左右反転").closest("details")!.open).toBe(false);
  });

  it("外の AI などが書いた半端な支点は「指定の位置」と出す（黙って中心に見せない）", () => {
    withShape({ pivot: { x: 0.3, y: 0.7 } });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect((screen.getByLabelText("動きの支点") as HTMLSelectElement).value).toBe("");
    expect(screen.getByRole("option", { name: "指定の位置" })).toBeTruthy();
  });
});

// 字幕から読み上げを作る（ADR-0055 追補 2026-10-20・#1485）＝選んだ字幕ぜんぶに効く・連動済みの1つだけなら出さない。
describe("字幕から読み上げを作る（#1485）", () => {
  const subtitle = (id: string, startSec: number, over: Record<string, unknown> = {}) =>
    ({ id, kind: TIMELINE_CLIP_KIND.subtitle, trackId: "track_001", startSec, durationSec: 2, x: 0, y: 0, w: 100, h: 40, text: "字幕", ...over });
  it("1つ選べば「この字幕から」・押すとストアの操作を呼ぶ", () => {
    open({ clips: [subtitle("clip_001", 0)] });
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    const make = vi.fn();
    useTimelineStore.setState({ makeVoicesFromSelectedSubtitles: make } as never);
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "この字幕から読み上げを作る" }));
    expect(make).toHaveBeenCalledTimes(1);
  });
  // まとめて選んだときは「選んだ部品」の欄が出ない＝右クリックのメニューが入口（数を言う）。
  it("まとめて選べば右クリックのメニューから・数を言う", () => {
    open({ clips: [subtitle("clip_001", 0), subtitle("clip_002", 2)] });
    useTimelineStore.setState({ selectedClipIds: ["clip_001", "clip_002"] });
    const make = vi.fn();
    useTimelineStore.setState({ makeVoicesFromSelectedSubtitles: make } as never);
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.contextMenu(document.querySelector('.timeline-clip[data-clip-id="clip_002"]')!);
    fireEvent.click(screen.getByRole("menuitem", { name: "選んだ字幕2個から読み上げを作る" }));
    expect(make).toHaveBeenCalledTimes(1);
  });
  it("字幕を選んでいなければメニューに出さない", () => {
    open({ clips: [{ id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 2, x: 0, y: 0, w: 100, h: 40, text: "文字" }] });
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.contextMenu(document.querySelector('.timeline-clip[data-clip-id="clip_001"]')!);
    expect(screen.queryByRole("menuitem", { name: /読み上げを作る/ })).toBeNull();
  });
  it("連動済みの字幕を1つだけ選んでいるなら出さない", () => {
    open({
      tracks: [{ id: "track_001", kind: TRACK_KIND.visual }, { id: "track_002", kind: TRACK_KIND.audio }],
      clips: [
        { id: "clip_009", kind: TIMELINE_CLIP_KIND.voice, trackId: "track_002", startSec: 0, durationSec: 2, voice: { text: "あ", status: "none" } },
        subtitle("clip_001", 0, { voiceClipId: "clip_009" }),
      ],
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /読み上げを作る/ })).toBeNull();
  });
});

// 帯のキーフレームの印（#1186 ②）＝選んだ帯にだけ、自身のキーの時刻に出す・押すとその時刻へ移る（選び直さない）。
describe("帯のキーフレームの印（#1186）", () => {
  const withKeys = (): void => {
    open({
      clips: [
        { id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 2, durationSec: 4, x: 0, y: 0, w: 100, h: 40, text: "動く" },
        { id: "clip_002", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 7, durationSec: 2, x: 0, y: 0, w: 100, h: 40, text: "隣" },
      ],
    });
    useTimelineStore.setState((st) => ({
      doc: st.doc ? { ...st.doc, animations: [{ id: "anim_001", targetId: "clip_001", keyframes: [{ timeSec: 0, x: 0 }, { timeSec: 3, x: 100 }] }] } : st.doc,
    }));
  };
  it("選んだ帯にだけ、キーの時刻に印を出す", () => {
    withKeys();
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const keys = [...document.querySelectorAll('[data-testid="clip-key"]')];
    expect(keys.map((k) => k.getAttribute("data-time"))).toEqual(["2", "5"]);
    expect(keys.every((k) => k.closest('.timeline-clip[data-clip-id="clip_001"]'))).toBe(true);
    expect((keys[1] as HTMLElement).style.left).toBe("75%");
  });
  it("選んでいなければ出さない", () => {
    withKeys();
    useTimelineStore.setState({ selectedClipIds: ["clip_002"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(document.querySelectorAll('[data-testid="clip-key"]')).toHaveLength(0);
  });
  it("押すとその時刻へ移り、選び直さない（その時刻の印が強く出る）", () => {
    withKeys();
    useTimelineStore.setState({ selectedClipIds: ["clip_001"], playheadSec: 0 });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const k = [...document.querySelectorAll('[data-testid="clip-key"]')][1] as HTMLElement;
    fireEvent.pointerDown(k, { button: 0 });
    // Shift を押したままでも選び直さない＝印を押したことは帯へ伝わらない（伝わると Shift で選択が外れる）。
    fireEvent.click(k, { shiftKey: true });
    expect(useTimelineStore.getState().playheadSec).toBe(5);
    expect(useTimelineStore.getState().selectedClipIds).toEqual(["clip_001"]);
    expect(document.querySelectorAll(".timeline-clip-key--current")).toHaveLength(1);
  });
});
