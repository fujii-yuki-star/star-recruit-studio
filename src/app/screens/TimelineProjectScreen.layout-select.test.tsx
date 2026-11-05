// @vitest-environment jsdom
// タイムライン編集プロジェクトの画面（ADR-0032・#629 骨格）＝右クリック・欄の配置・圧迫しない・選択の作法・数値欄・固定・取り消しのまとめ・置く。
// ⚠️ **1つのファイルで約10分かかっていたので分けた**（負荷・耐久の点検 2026-10-22）＝ほかと一緒に走ると時間切れで
//   たまに落ちていた。共有の下ごしらえ（文書・開き方・テスト間の後片づけ）は `src/test/timelineScreenKit.tsx` に1つ。
import { describe, expect, it, vi } from "vitest";
import { act, render, screen, fireEvent, within } from "@testing-library/react";
import { pointerDownAt } from "../../test/pointer";
import { TimelineProjectScreen } from "./TimelineProjectScreen";
import { useTimelineStore } from "../store/timelineStore";
import { editBlockedMessage, lockedTrackMessage } from "../uiLabels";
import { useProjectStore } from "../store/projectStore";
import { TIMELINE_CLIP_KIND, TRACK_KIND } from "../../domain/enums";
import { EDIT_BLOCKED } from "../../domain/timeline/edit";
import type { Template } from "../../domain/template/types";
import * as ffmpegMod from "../../infrastructure/ffmpegExport";
import { open, openPlaceTab, openPanelMenu, lastClip, trackRowLabel, resetTimelineScreenBetweenTests } from "../../test/timelineScreenKit";

resetTimelineScreenBetweenTests();


describe("TimelineProjectScreen: 並びの操作を右クリックへ畳む（ADR-0033）", () => {
  it("行に操作の文字を常時出さない（帯が読めなくならない）", () => {
    open();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    for (const label of ["隠す", "固定", "消す", "手前へ", "奥へ"]) {
      expect(screen.queryByRole("button", { name: label })).not.toBeInTheDocument();
    }
  });

  it("行を右クリックすると、その列の操作が出る", () => {
    open();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.contextMenu(trackRowLabel("映像1"));
    expect(screen.getByRole("menuitem", { name: "動画に出さない" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "削除" })).toBeInTheDocument();
  });

  it("列のメニューは**まるごと**この顔ぶれ・この言い方（#1106）", () => {
    // ⚠️ **1つずつ書き並べる検査では、直し漏れた1か所を構造的に見つけられない**（#1027）＝
    // メニュー全体を1つの配列で見る。**主語なしでそろえる**（利用者決定 2026-09-10）＝
    // 「この列を◯◯」は少数派だったので、多数派（手前へ・奥へ・動画に出す）へ寄せた。
    open();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.contextMenu(trackRowLabel("映像1"));
    const labels = screen.getAllByRole("menuitem").map((el) => el.textContent);
    // ⚠️ **+「名前を変える」**（利用者要望 2026-09-28）＝自動名（映像1／音1）だけだと、列が増えたときに
    //   どれが何の列か分からない。2回押しでも変えられるが、**見つけられる道**としてメニューにも置く。
    expect(labels).toEqual(["名前を変える", "手前へ", "奥へ", "複製", "動画に出さない", "固定する", "削除"]);
  });

  it("固定した列では、言い方が「固定を外す」に変わる（#1106）", () => {
    // ⚠️ **いまの状態で意味が通る言い方にする**（`06 §12.1`）＝固定中に「固定する」と出ると、
    // 押すと何が起きるか分からない。⚠️ **この側は一度も検査されていなかった**（変異チェックで判明）。
    open({ tracks: [{ id: "track_001", kind: TRACK_KIND.visual, locked: true }] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.contextMenu(trackRowLabel("映像1"));
    const labels = screen.getAllByRole("menuitem").map((el) => el.textContent);
    // ⚠️ **固定中でも名前は変えられる**＝固定が守るのは帯の位置と長さで、呼び名はそれに当たらない。
    expect(labels).toEqual(["名前を変える", "手前へ", "奥へ", "複製", "動画に出さない", "固定を外す", "削除"]);
  });

  it("メニューから操作でき、選ぶと閉じる", () => {
    open();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.contextMenu(trackRowLabel("映像1"));
    fireEvent.click(screen.getByRole("menuitem", { name: "動画に出さない" }));
    expect(useTimelineStore.getState().doc?.tracks.find((t) => t.id === "track_001")?.hidden).toBe(true);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("いまの状態で意味が通る言い方にする（出していない列は「動画に出す」）", () => {
    open({ tracks: [{ id: "track_001", kind: TRACK_KIND.visual, hidden: true }, { id: "track_002", kind: TRACK_KIND.audio }] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.contextMenu(trackRowLabel("映像1"));
    expect(screen.getByRole("menuitem", { name: "動画に出す" })).toBeInTheDocument();
  });
});


describe("TimelineProjectScreen: 欄の配置（ADR-0033 段階2）", () => {
  it("既定で「再生位置」と「選んだ部品」が同時に出ている（1点置くごとに上下スクロール、を起こさない）", () => {
    open();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getByLabelText("再生位置")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "選んだ部品" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "並び" })).toBeInTheDocument();
  });

  it("欄を閉じられて、閉じたら戻す導線が出る（戻せない欄を作らない）", () => {
    open();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByLabelText("置くの欄の操作"));
    fireEvent.click(screen.getByRole("menuitem", { name: "この欄を閉じる" }));
    expect(screen.queryByRole("heading", { name: "置く" })).not.toBeInTheDocument();
    openPanelMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "「置く」を表示する" }));
    expect(screen.getByRole("heading", { name: "置く" })).toBeInTheDocument();
  });

  it("配置は覚えていて、開き直しても同じ（動画ごとには変わらない）", () => {
    open();
    const first = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByLabelText("置くの欄の操作"));
    fireEvent.click(screen.getByRole("menuitem", { name: "この欄を閉じる" }));
    first.unmount();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.queryByRole("heading", { name: "置く" })).not.toBeInTheDocument();
  });

  // 配置の型（ADR-0048 決定4・#1256 c3）＝選ぶと**いまの配置**になり、覚える（型そのものは覚えない）。
  it("欄のメニューから配置の型を選ぶと、その配置になり覚える", () => {
    open();
    const first = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    openPanelMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "配置の型：並びと仕上がりだけ" }));
    expect(document.querySelector('[data-panel-id="place"]'), "置く欄が閉じていない").toBeNull();
    expect(document.querySelector('[data-panel-id="arrange"]')).not.toBeNull();
    first.unmount(); // 離れるときに覚える
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(document.querySelector('[data-panel-id="place"]'), "選んだ型を覚えていない").toBeNull();
  });

  it("欄のメニューに3つの型が並ぶ", () => {
    open();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    openPanelMenu();
    for (const name of ["並びを広く（既定）", "仕上がりを大きく", "並びと仕上がりだけ"]) {
      expect(screen.getByRole("menuitem", { name: `配置の型：${name}` })).toBeTruthy();
    }
  });

  it("「配置を既定に戻す」で戻る（組み替えたあとの逃げ道）", () => {
    open();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByLabelText("置くの欄の操作"));
    fireEvent.click(screen.getByRole("menuitem", { name: "この欄を閉じる" }));
    openPanelMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "配置を既定に戻す" }));
    expect(screen.getByRole("heading", { name: "置く" })).toBeInTheDocument();
  });

  it("欄はメニューで別の領域へ移せる（ドラッグが使えなくても組み替えられる）", () => {
    open();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByLabelText("選んだ部品の欄の操作"));
    fireEvent.click(screen.getByRole("menuitem", { name: "左へ移す" }));
    // 移しても中身は残る（消えない）。
    expect(screen.getByRole("heading", { name: "選んだ部品" })).toBeInTheDocument();
  });

  it("境界は掴める（欄の大きさを変えられる）", () => {
    open();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getAllByRole("separator").length).toBeGreaterThan(0);
    expect(screen.getByLabelText("左の欄の幅")).toBeInTheDocument();
  });
});

describe("TimelineProjectScreen: 欄をつかんで動かす（ADR-0033 段階3）", () => {
  it("見出しをつかんでほかの欄へ落とすと移り、覚えている", () => {
    open();
    const first = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    // jsdom は大きさを持たないので、欄の箱を置く（当たり判定はこの箱で決まる）。
    const box = (id: string, left: number) => {
      const el = document.querySelector(`[data-panel-id="${id}"]`) as HTMLElement;
      el.getBoundingClientRect = () =>
        ({ left, top: 0, width: 100, height: 100, right: left + 100, bottom: 100, x: left, y: 0, toJSON: () => ({}) }) as DOMRect;
    };
    box("selected", 0);
    box("preview", 200);
    pointerDownAt(screen.getByRole("heading", { name: "選んだ部品" }).parentElement!, 1000, { clientX: 0, clientY: 0 });
    fireEvent.pointerMove(window, { buttons: 1, clientX: 250, clientY: 95, pointerId: 1 }); // 「仕上がり確認」の下寄り
    fireEvent.pointerUp(window, { clientX: 250, clientY: 95, pointerId: 1 });
    // 移しても中身は消えない。
    expect(screen.getByRole("heading", { name: "選んだ部品" })).toBeInTheDocument();
    first.unmount();
    // 覚えている（開き直しても同じ）。
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "選んだ部品" })).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem("app.panelLayout.timeline")!).nodes.right).toBeNull();
  });
});

describe("TimelineProjectScreen: 編集の場所を上から圧迫しない（利用者指摘 2026-08-04）", () => {
  it("説明文は出さない（名前だけ＝どの動画かは分かる）", () => {
    open();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getByText("焼いた動画")).toBeInTheDocument();
    expect(screen.queryByText("時間の流れを自由に組み替えて動画を作ります。")).not.toBeInTheDocument();
  });

  /**
   * 断りは**操作した欄の中**に出す（ADR-0034 決定10・#869）。
   * ⚠️ 以前は欄グリッドの直下の帯に出しており、**欄がいくつも並ぶ画面でどの操作が断られたのか
   * 読めなかった**（恒常の警告とも同じ見た目で並んでいた）。
   */
  it("置けなかった理由は**操作した欄の中**に出る（帯ではない）", () => {
    open({
      tracks: [{ id: "track_001", kind: TRACK_KIND.visual }],
      clips: [
        { id: "clip_001", kind: TIMELINE_CLIP_KIND.template, trackId: "track_001", startSec: 0, durationSec: 5, templateId: "tmpl_missing" },
        { id: "clip_002", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 6, durationSec: 5, x: 0, y: 0, w: 10, h: 10, text: "あと" },
      ],
    });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "あと" }));
    fireEvent.change(screen.getByLabelText("再生位置"), { target: { value: "2" } });
    // 「再生位置へ」は**選んだ部品**の欄のボタン＝返事もその欄の中に出る。
    fireEvent.click(screen.getByText("再生位置へ")); // clip_001（0〜5秒）と重なる＝置けない
    const notice = screen.getAllByRole("alert").find((el) => el.textContent?.includes("ずらすか、列を足して重ねて"));
    expect(notice).toBeDefined();
    // **欄の中**にある（欄グリッドの外＝帯ではない）。
    const layoutArea = container.querySelector(".panel-layout")!;
    expect(layoutArea.contains(notice!)).toBe(true);
    // **その場の返事**と分かる見た目（恒常の警告と同じ顔で並べない）。
    expect(notice!.classList.contains("timeline-flash")).toBe(true);
    // 恒常の警告（見た目パターンが見つからない）は今までどおり欄の外に残る＝2つが混ざらない。
    const outside = [...container.querySelectorAll(".notice-warn")].filter((el) => !layoutArea.contains(el));
    expect(outside.some((el) => el.textContent?.includes("見た目パターンが見つからない部品が"))).toBe(true);
    // ⚠️ **帯には重ねて出さない**＝同じ文が2か所に出ると、どちらが今の返事か読めない。
    expect(outside.some((el) => el.textContent?.includes("ずらすか、列を足して重ねて"))).toBe(false);
    expect(screen.getAllByRole("alert").filter((el) => el.textContent?.includes("ずらすか、列を足して重ねて"))).toHaveLength(1);
  });

  /**
   * ⚠️ **行き先の欄を閉じていたら帯へ倒す**（#869）＝欄の中に出しても見えないので、
   * 押した結果が**黙って消える**（§2-5）。
   */
  it("返す先の欄を閉じているときは帯に出す（黙って消えない）", () => {
    open({
      tracks: [{ id: "track_001", kind: TRACK_KIND.visual }],
      clips: [
        { id: "clip_001", kind: TIMELINE_CLIP_KIND.template, trackId: "track_001", startSec: 0, durationSec: 5, templateId: "tmpl_missing" },
        { id: "clip_002", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 6, durationSec: 5, x: 0, y: 0, w: 10, h: 10, text: "あと" },
      ],
    });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "あと" }));
    fireEvent.change(screen.getByLabelText("再生位置"), { target: { value: "2" } });
    fireEvent.click(screen.getByText("再生位置へ"));
    // 「選んだ部品」の欄を閉じる（欄の中に出しても見えなくなる）。
    fireEvent.click(screen.getByLabelText("選んだ部品の欄の操作"));
    fireEvent.click(screen.getByRole("menuitem", { name: "この欄を閉じる" }));
    const layoutArea = container.querySelector(".panel-layout")!;
    const notice = screen.getAllByRole("alert").find((el) => el.textContent?.includes("ずらすか、列を足して重ねて"));
    expect(notice).toBeDefined();
    expect(layoutArea.contains(notice!)).toBe(false); // 帯（欄の外）に出ている
  });

  /**
   * ⚠️ **消す入口は4つある**（#869 レビュー 🟡）＝「選んだ部品」欄のボタン2つ・仕上がり確認の
   * 右クリック・並びの右クリック。渡し忘れると**押していない欄に返事が出る**。
   */
  it("「選んだ部品」欄から消せないときは、その欄の中に理由が出る", () => {
    open({
      tracks: [{ id: "track_001", kind: TRACK_KIND.visual, locked: true }],
      clips: [{ id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 5, x: 0, y: 0, w: 10, h: 10, text: "あ" }],
    });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    act(() => {
      useTimelineStore.getState().removeClipsByIds(["clip_001"], "selected");
    });
    const layoutArea = container.querySelector(".panel-layout")!;
    const notice = screen.getAllByRole("alert").find((el) => el.textContent?.includes(editBlockedMessage[EDIT_BLOCKED.lockedSelection]));
    expect(notice).toBeDefined();
    expect(layoutArea.contains(notice!)).toBe(true);
  });

  /**
   * ⚠️ **画面全体の話になる理由は、欄を渡されても帯へ倒す**（#869 レビュー 🟡）。
   * 入口ごとに「書き出し中だけは帯」と書くと、入口が増えたとき片方だけ欄へ押し込まれ、
   * **同じ状況なのに出る場所が違う**（ADR-0026②）。規則は `blockTargetFor` に1つだけ置いている。
   */
  it.each([
    ["書き出し中", EDIT_BLOCKED.exporting],
    ["再生中", EDIT_BLOCKED.playing],
    ["対象が無い", EDIT_BLOCKED.notFound],
  ])("%s は欄を渡しても帯に出る", (_name, reason) => {
    open();
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    act(() => {
      useTimelineStore.getState().setEditBlocked(reason, "selected"); // 欄を渡す
    });
    const layoutArea = container.querySelector(".panel-layout")!;
    const notice = screen.getAllByRole("alert").find((el) => el.textContent?.includes(editBlockedMessage[reason]));
    expect(notice).toBeDefined();
    expect(layoutArea.contains(notice!)).toBe(false);
  });

  /** ⚠️ 逆に、**欄の話である理由は欄へ**（規則が何でも帯へ倒していないことを確かめる）。 */
  it("欄の話である理由は、渡した欄の中に出る", () => {
    open();
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    act(() => {
      useTimelineStore.getState().setEditBlocked(EDIT_BLOCKED.overlap, "selected");
    });
    const layoutArea = container.querySelector(".panel-layout")!;
    const notice = screen.getAllByRole("alert").find((el) => el.textContent?.includes(editBlockedMessage[EDIT_BLOCKED.overlap]));
    expect(notice).toBeDefined();
    expect(layoutArea.contains(notice!)).toBe(true);
  });

  /** ⚠️ **渡し忘れは帯へ倒す**＝押していない欄に返事を出さない（安全側＝必ず見える所）。 */
  it("どこから消したか渡されなければ帯に出る", () => {
    open({
      tracks: [{ id: "track_001", kind: TRACK_KIND.visual, locked: true }],
      clips: [{ id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 5, x: 0, y: 0, w: 10, h: 10, text: "あ" }],
    });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    act(() => {
      useTimelineStore.getState().removeClipsByIds(["clip_001"]);
    });
    const layoutArea = container.querySelector(".panel-layout")!;
    const notice = screen.getAllByRole("alert").find((el) => el.textContent?.includes(editBlockedMessage[EDIT_BLOCKED.lockedSelection]));
    expect(notice).toBeDefined();
    expect(layoutArea.contains(notice!)).toBe(false);
  });

  /** ⚠️ 画面全体に効く断り（書き出し中）は今までどおり帯＝欄を閉じていても見える。 */
  it("画面全体に効く断りは帯に出る", () => {
    open();
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    act(() => {
      useTimelineStore.setState({ editBlocked: { reason: EDIT_BLOCKED.exporting, at: "global" } });
    });
    const layoutArea = container.querySelector(".panel-layout")!;
    const notice = screen.getAllByRole("alert").find((el) => el.textContent?.includes(editBlockedMessage[EDIT_BLOCKED.exporting]));
    expect(notice).toBeDefined();
    expect(layoutArea.contains(notice!)).toBe(false);
  });

  it("見た目パターンが見つからない知らせも編集の下に出る", () => {
    open({
      clips: [{ id: "clip_001", kind: TIMELINE_CLIP_KIND.template, trackId: "track_001", startSec: 0, durationSec: 5, templateId: "tmpl_missing" }],
    });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const notice = screen.getAllByRole("alert").find((el) => el.textContent?.includes("見た目パターンが見つからない部品が"));
    expect(notice).toBeDefined();
    const layoutArea = container.querySelector(".panel-layout")!;
    expect(layoutArea.compareDocumentPosition(notice!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

// 「選んだ部品」の欄は縦に長く、横にも切れていた（実機の指摘 2026-08-04）＝節を畳めるようにし、
// たまにしか触らない節は最初から畳んで出す（#687）。
describe("TimelineProjectScreen: 選んだ部品の欄を整える（#687）", () => {
  // 見出しは列の名前（「音1」など）と字が重なるので、**節の見出し**に限って探す。
  const section = (title: string): HTMLDetailsElement =>
    screen.getAllByText(title).find((el) => el.tagName === "SUMMARY")!.closest("details") as HTMLDetailsElement;

  it("節を畳める＝よく触る節は開き、細かい節は畳んで出す", () => {
    open({
      clips: [
        { id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 5, x: 0, y: 0, w: 10, h: 10, text: "あ" },
      ],
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(section("動き").open).toBe(false); // 細かい調整＝畳む
    expect(section("切り抜き").open).toBe(false);
  });

  it("設定が入っている節は開いて出す（入れた設定を見失わせない）", () => {
    open({
      clips: [
        { id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 5, x: 0, y: 0, w: 10, h: 10, text: "あ" },
      ],
      animations: [{ id: "anim_001", targetId: "clip_001", keyframes: [{ timeSec: 1, x: 20 }] }],
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(section("動き").open).toBe(true); // 動きが付いている＝畳んで隠さない
  });

  // ⚠️ **キーフレーム側の「この位置へ」も送る**（PR #839 レビュー ℹ️）＝音量点側と同じ形だが、
  // 片方だけ `followPlayhead()` を外す変異が**素通りしていた**（実測）。跳んだ先が枠の外だと
  // **跳んだのに何も見えない**＝#819-1 の症状そのものなので、両方を固定する。
  it("動きの「この位置へ」で枠の外へ跳んだら、見えるところまで送る", () => {
    open({
      clips: [
        { id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 60, x: 0, y: 0, w: 10, h: 10, text: "あ" },
      ],
      animations: [{ id: "anim_001", targetId: "clip_001", keyframes: [{ timeSec: 40, x: 20 }] }],
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const scroll = container.querySelector(".timeline-scroll") as HTMLElement;
    Object.defineProperty(scroll, "clientWidth", { value: 500, configurable: true });
    expect(scroll.scrollLeft).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: "この位置へ" }));
    expect(useTimelineStore.getState().playheadSec).toBeCloseTo(40, 6);
    expect(scroll.scrollLeft).toBe(40 * 36); // 跳んだ先が左端に来るよう送る
  });

  it("まとまりに付いた動きの知らせも、畳んだ中に隠さない", () => {
    open({
      groups: [{ id: "group_001", members: ["clip_001"], transform: { x: 0, y: 0, rotation: 0, scale: 1 } }],
      clips: [
        { id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 5, x: 0, y: 0, w: 10, h: 10, text: "あ" },
      ],
      animations: [{ id: "anim_001", targetId: "group_001", keyframes: [{ timeSec: 0, opacity: 0 }, { timeSec: 1, opacity: 1 }] }],
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    // 「画面では動いているのに『動きは付いていません』と言わない」ための知らせ＝見えていないと意味がない。
    expect(section("動き").open).toBe(true);
    expect(screen.getByText(/「グループ」にも動きが付いています/)).toBeInTheDocument();
  });

  it("部品を切り替えたら節の既定を見直す（最初に選んだ部品のままにしない）", () => {
    // 同じ種類の部品を行き来する間は React が作り直さないので、`key` を付けないと開閉が固まる。
    open({
      clips: [
        { id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 5, x: 0, y: 0, w: 10, h: 10, text: "あ" },
        { id: "clip_002", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 6, durationSec: 5, x: 0, y: 0, w: 10, h: 10, text: "い" },
      ],
      animations: [{ id: "anim_001", targetId: "clip_002", keyframes: [{ timeSec: 1, x: 20 }] }],
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] }); // 動きの付いていない部品
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(section("動き").open).toBe(false);
    act(() => useTimelineStore.getState().selectClip("clip_002")); // 動きの付いた部品へ
    expect(section("動き").open).toBe(true);
  });

  it("まとまりの動きの知らせは、節を畳んでいても見える（畳める場所に置かない）", () => {
    // 一度畳んだ記憶は既定より優先されるので、知らせを節の中に置くと二度と見えなくなる。
    localStorage.setItem("timeline.sectionOpen", JSON.stringify({ anim: false }));
    open({
      groups: [{ id: "group_001", members: ["clip_001"], transform: { x: 0, y: 0, rotation: 0, scale: 1 } }],
      clips: [
        { id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 5, x: 0, y: 0, w: 10, h: 10, text: "あ" },
      ],
      animations: [{ id: "anim_001", targetId: "group_001", keyframes: [{ timeSec: 0, opacity: 0 }, { timeSec: 1, opacity: 1 }] }],
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(section("動き").open).toBe(false); // 畳んだ記憶どおり
    const notice = screen.getByText(/「グループ」にも動きが付いています/);
    expect(notice.closest("details")).toBeNull(); // どの節の中にも入っていない
    expect(container.contains(notice)).toBe(true);
  });

  it("音の部品では、よく触る節を開いて出す", () => {
    open({
      tracks: [{ id: "track_002", kind: TRACK_KIND.audio }],
      clips: [
        { id: "clip_002", kind: TIMELINE_CLIP_KIND.audio, trackId: "track_002", startSec: 0, durationSec: 5, bundledBgmId: "found-new-hope" },
      ],
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_002"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(section("音").open).toBe(true);
    expect(section("音量の変化").open).toBe(false);
  });
});

// 選択は1つのモデルに統一する（ADR-0034 決定15・#701）。#685/#686 が繋ぐ先を先に固める。
describe("TimelineProjectScreen: 選択の作法（#701）", () => {
  // **どちらも再生位置（0秒）に掛かる**ようにする＝切り替えても「動き」の欄が出たままになり、
  // 下書きが残るかどうかを見られる（同じ列には重ねられないので列を分ける＝`11 §8` V24）。
  const twoClips = () => {
    open({
      tracks: [
        { id: "track_001", kind: TRACK_KIND.visual },
        { id: "track_003", kind: TRACK_KIND.visual },
      ],
      clips: [
        { id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 5, x: 0, y: 0, w: 10, h: 10, text: "あ" },
        { id: "clip_002", kind: TIMELINE_CLIP_KIND.text, trackId: "track_003", startSec: 0, durationSec: 5, x: 0, y: 0, w: 10, h: 10, text: "い" },
      ],
    });
  };

  it("何もない所を押すと選択が解ける", () => {
    twoClips();
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "あ" }));
    expect(useTimelineStore.getState().selectedClipIds).toEqual(["clip_001"]);
    fireEvent.click(container.querySelector(".timeline-lane")!);
    expect(useTimelineStore.getState().selectedClipIds).toEqual([]);
  });

  it("帯を押したときは解けない（上がってきた分で解かない）", () => {
    twoClips();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "あ" }));
    expect(useTimelineStore.getState().selectedClipIds).toEqual(["clip_001"]);
  });

  it("Escape で解ける・Ctrl+A で全部選べる", () => {
    twoClips();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.keyDown(window, { key: "a", ctrlKey: true });
    expect(useTimelineStore.getState().selectedClipIds).toEqual(["clip_001", "clip_002"]);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(useTimelineStore.getState().selectedClipIds).toEqual([]);
  });

  it("文字を打っている間と、日本語の変換中は奪わない", () => {
    twoClips();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "あ" }));
    const input = document.createElement("input");
    document.body.appendChild(input);
    fireEvent.keyDown(input, { key: "Escape" }); // 入力欄の中
    expect(useTimelineStore.getState().selectedClipIds).toEqual(["clip_001"]);
    fireEvent.keyDown(window, { key: "Escape", isComposing: true }); // 変換中＝「変換をやめる」
    expect(useTimelineStore.getState().selectedClipIds).toEqual(["clip_001"]);
    input.remove();
  });

  it("帯には名前と時間帯を添える（短い帯でも何か分かる）", () => {
    twoClips();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getByRole("button", { name: "あ" }).title).toBe("あ（0:00〜0:05）"); // 場面形式と同じ書き方
  });

  it("選ぶ部品を切り替えたら、前の部品への入力は残さない", () => {
    twoClips();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "あ" }));
    const field = () => screen.getByLabelText("横のずれ（px）") as HTMLInputElement;
    fireEvent.change(field(), { target: { value: "200" } });
    expect(field().value).toBe("200");
    act(() => useTimelineStore.getState().selectClip("clip_002"));
    expect(field().value).toBe(""); // 打った覚えのない値が別の部品に入らない
  });
});

// レビューで見つかった経路（#701 /canon-check）。取り返しのつかない操作と、打ちかけの値を守る。
describe("TimelineProjectScreen: 選択の作法（レビュー指摘）", () => {
  const withTemplateClips = (templates: Template[]) => {
    open({
      tracks: [
        { id: "track_001", kind: TRACK_KIND.visual },
        { id: "track_003", kind: TRACK_KIND.visual },
      ],
      clips: [
        { id: "clip_001", kind: TIMELINE_CLIP_KIND.template, trackId: "track_001", startSec: 0, durationSec: 5, templateId: "tmpl_a" },
        { id: "clip_002", kind: TIMELINE_CLIP_KIND.template, trackId: "track_003", startSec: 0, durationSec: 5, templateId: "tmpl_a" },
      ],
    });
    useProjectStore.setState({ templates });
  };

  it("「バラす」の確認は、聞いた時点の部品を相手にする（選び直しで別の部品が犠牲にならない）", () => {
    const tmpl = { templateId: "tmpl_a", name: "型A", category: "opening", orientation: "16:9", canvas: { w: 1920, h: 1080 }, layers: [] } as unknown as Template;
    withTemplateClips([tmpl]);
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "中身をバラす" }));
    // 選び直しても確認は残り、相手は変わらない（消えたように見えて状態だけ残る、を作らない）。
    act(() => useTimelineStore.getState().selectClip("clip_002"));
    expect(screen.getByText(/中身を1つ1つの部品に分けますか/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "バラす" }));
    // バラされたのは**聞いた時点の** clip_001（選び直した clip_002 は見た目パターンのまま）。
    const kinds = useTimelineStore.getState().doc!.clips.filter((c) => c.id === "clip_002");
    expect(kinds[0].kind).toBe(TIMELINE_CLIP_KIND.template);
    expect(useTimelineStore.getState().doc!.clips.some((c) => c.id === "clip_001")).toBe(false);
  });

  it("確認が開いている間は Escape で選択を解かない（打ちかけの値を消さない）", () => {
    const tmpl = { templateId: "tmpl_a", name: "型A", category: "opening", orientation: "16:9", canvas: { w: 1920, h: 1080 }, layers: [] } as unknown as Template;
    withTemplateClips([tmpl]);
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "中身をバラす" }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(useTimelineStore.getState().selectedClipIds).toEqual(["clip_001"]);
  });

  it("固定した列の部品は消せない（全部選んでから消す、で固定が意味を失わない）", () => {
    open({
      tracks: [{ id: "track_001", kind: TRACK_KIND.visual, locked: true }],
      clips: [
        { id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 5, x: 0, y: 0, w: 10, h: 10, text: "あ" },
      ],
    });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.keyDown(window, { key: "a", ctrlKey: true });
    act(() => useTimelineStore.getState().removeSelectedClips());
    expect(useTimelineStore.getState().doc!.clips).toHaveLength(1); // 消えない
    // ⚠️ 断る語彙は**画面と同じ**（#752 レビュー）＝「選んだ中に固定列のものが混ざる」という同じ
    // 述語に2つの言い方を持たない（次の行動も「選び直す」で進める）。
    expect(useTimelineStore.getState().editBlocked?.reason).toBe("TIMELINE_EDIT_LOCKED_SELECTION");
  });

  it("選ぶと、前の部品で出た理由は消える（いまの部品の返事に見せない）", () => {
    open({
      clips: [
        { id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 5, x: 0, y: 0, w: 10, h: 10, text: "あ" },
      ],
    });
    useTimelineStore.setState({ editBlocked: { reason: "TIMELINE_EDIT_OVERLAP", at: "arrange" }, voiceError: "声を作れませんでした。" });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "あ" }));
    expect(useTimelineStore.getState().editBlocked).toBeNull();
    expect(useTimelineStore.getState().voiceError).toBeNull();
  });

  it("列のメニューが開いている間は Escape で選択を解かない（閉じただけで選択まで消さない）", () => {
    open({
      clips: [
        { id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 5, x: 0, y: 0, w: 10, h: 10, text: "あ" },
      ],
    });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "あ" }));
    fireEvent.click(screen.getByLabelText("映像1の操作")); // 列のメニューを開く
    fireEvent.keyDown(window, { key: "Escape" });
    expect(useTimelineStore.getState().selectedClipIds).toEqual(["clip_001"]);
  });

  it("欄の境界を掴んでいる間は Escape で選択を解かない（中止しただけで消さない）", () => {
    open({
      clips: [
        { id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 5, x: 0, y: 0, w: 10, h: 10, text: "あ" },
      ],
    });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "あ" }));
    // 欄の境界を掴む（ADR-0033）。掴んでいる間は欄の側が Escape を受け持つ。
    // jsdom は大きさを持たないので、割合を決める親の箱を置く（置かないと掴み始めない）。
    // ⚠️ **域の境界で見る**（#1031）＝「置く」をタブにまとめたので、
    // 既定の配置には**域の中の境目（欄どうし）が無い**。掴む仕組みは同じ。
    const divider = screen.getAllByLabelText("左の欄の幅")[0];
    // 域の境界は**配置全体の箱**を見る（分かれ目の境界は親の箱）。
    (document.querySelector(".panel-layout") as HTMLElement).getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    pointerDownAt(divider, 1000, { clientX: 0, clientY: 50 });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(useTimelineStore.getState().selectedClipIds).toEqual(["clip_001"]);
    fireEvent.pointerUp(window, { pointerId: 1 });
  });

  it("欄のメニューが開いている間も Escape で選択を解かない", () => {
    open({
      clips: [
        { id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 5, x: 0, y: 0, w: 10, h: 10, text: "あ" },
      ],
    });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "あ" }));
    fireEvent.click(screen.getByLabelText("選んだ部品の欄の操作")); // 欄（ADR-0033）のメニュー
    fireEvent.keyDown(window, { key: "Escape" });
    expect(useTimelineStore.getState().selectedClipIds).toEqual(["clip_001"]);
  });

  it("Mac の Cmd+A でも全部選べる", () => {
    open({
      clips: [
        { id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 5, x: 0, y: 0, w: 10, h: 10, text: "あ" },
      ],
    });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.keyDown(window, { key: "a", metaKey: true });
    expect(useTimelineStore.getState().selectedClipIds).toEqual(["clip_001"]);
  });

  it("部品が無くても Ctrl+A は画面の文字を選ばせない", () => {
    open({ clips: [] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const e = new KeyboardEvent("keydown", { key: "a", ctrlKey: true, cancelable: true, bubbles: true });
    window.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
  });
});

// 数値欄の確定タイミングと、押せない理由の出し方（#706・#703）。
describe("TimelineProjectScreen: 数値欄と押せない理由（#706・#703）", () => {
  const withBgmClip = (over: Record<string, unknown> = {}) => {
    open({
      tracks: [{ id: "track_002", kind: TRACK_KIND.audio }],
      clips: [
        { id: "clip_001", kind: TIMELINE_CLIP_KIND.audio, trackId: "track_002", startSec: 0, durationSec: 10, bundledBgmId: "found-new-hope" },
      ],
      ...over,
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
  };

  it("打っている途中は履歴を積まない（確定して初めて1回）", () => {
    withBgmClip();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const before = useTimelineStore.getState().history.past.length;
    const input = screen.getByLabelText("速さ（倍）");
    fireEvent.change(input, { target: { value: "1" } });
    fireEvent.change(input, { target: { value: "1." } });
    fireEvent.change(input, { target: { value: "1.5" } });
    expect(useTimelineStore.getState().history.past.length).toBe(before); // 打っている間は積まない
    fireEvent.blur(input);
    expect(useTimelineStore.getState().history.past.length).toBe(before + 1); // 確定で1回だけ
    expect(useTimelineStore.getState().doc?.clips[0].speed).toBe(1.5);
  });

  it("Enter でも確定する（欄から離れずに決められる）", () => {
    withBgmClip();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const input = screen.getByLabelText("速さ（倍）");
    fireEvent.change(input, { target: { value: "2" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(useTimelineStore.getState().doc?.clips[0].speed).toBe(2);
  });

  it("範囲の外は範囲へ収める（打っている途中では直さない）", () => {
    withBgmClip();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const input = screen.getByLabelText("速さ（倍）") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "99" } });
    expect(input.value).toBe("99"); // 打っている間は触らない（桁を打ち切る前に直さない）
    fireEvent.blur(input);
    expect(useTimelineStore.getState().doc?.clips[0].speed).toBe(4); // CLIP_SPEED_MAX
  });

  it("書き出し中は編集の入口を押せなくして理由を出す（押してから断らない）", () => {
    withBgmClip();
    useTimelineStore.setState({ exportRun: { phase: "rendering", percent: 10, message: null, cancelling: false } });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const speed = screen.getByLabelText("速さ（倍）");
    expect(speed).toBeDisabled();
    expect(speed.title).toBe("いま動画を書き出しています。終わってから編集してください");
    const del = screen.getByRole("button", { name: "削除" });
    expect(del).toBeDisabled();
    expect(del.title).toBe("いま動画を書き出しています。終わってから編集してください");
    expect(screen.getByRole("button", { name: "複製" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "映像の列を足す" })).toBeDisabled();
  });

  it("固定した列のほうを先に出す（直せる順に理由を出す）", () => {
    withBgmClip({ tracks: [{ id: "track_002", kind: TRACK_KIND.audio, locked: true }] });
    useTimelineStore.setState({ exportRun: { phase: "rendering", percent: 10, message: null, cancelling: false } });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getByLabelText("速さ（倍）").title).toBe(lockedTrackMessage("content"));
  });
});

// レビューで見つかった「押してから断る」の残り（#703）と、下書き欄の扱い（#706）。
describe("TimelineProjectScreen: 押す前に断る・下書きは即時（レビュー指摘）", () => {
  const withBgm = () => {
    open({
      tracks: [{ id: "track_002", kind: TRACK_KIND.audio }],
      clips: [
        { id: "clip_001", kind: TIMELINE_CLIP_KIND.audio, trackId: "track_002", startSec: 0, durationSec: 10, bundledBgmId: "found-new-hope" },
      ],
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_001"], playheadSec: 2 });
  };
  const exporting = () =>
    useTimelineStore.setState({ exportRun: { phase: "rendering", percent: 10, message: null, cancelling: false } });

  it("音量の点は、打った値でそのまま置ける（確定を待たせない）", () => {
    withBgm();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("この位置の音量"), { target: { value: "0.4" } });
    // 打った直後に押せる＝下書きの欄は確定を待たない（待たせると1回目が必ず落ちる）。
    const place = screen.getAllByRole("button", { name: "この位置に置く" })[0];
    expect(place).not.toBeDisabled();
    fireEvent.click(place);
    expect(useTimelineStore.getState().doc?.clips[0].volumePoints).toEqual([{ timeSec: 2, volume: 0.4 }]);
  });

  // #771(b)：素材・文字・図形の欄だけ「置く列」が無く、**暗黙にどこかの列**へ入っていた
  //（なぜそこに入ったのか読めない）。他の欄（見た目パターン・音・読み上げ）には元から在った。
  it("素材・文字・図形の欄でも「置く列」を選べる（暗黙にどこかへ入れない・#771(b)）", () => {
    open({
      tracks: [
        { id: "track_001", kind: TRACK_KIND.visual },
        { id: "track_002", kind: TRACK_KIND.visual },
      ],
    });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const place = document.querySelector('[data-panel-id="place"]') as HTMLElement;
    const select = within(place).getByLabelText("置く列") as HTMLSelectElement;

    // 既定は**いちばん手前の置ける列**＝欄に出ている列が実際に置く列（表示と結果を割らない）。
    fireEvent.click(within(place).getByRole("button", { name: "文字を置く" }));
    expect(lastClip().trackId).toBe(select.value);

    // 選び直すと、その列へ入る。
    // ⚠️ **塞がらない所で確かめる**（#1252）＝文字・図形は塞がっていると**手前に列を足して重ねる**ので、
    //   同じ時刻へ2回続けて置くと「選んだ列へ入ったか」が見えない。再生位置を空いている所へ移す。
    const other = [...select.options].map((o) => o.value).find((v) => v !== select.value)!;
    fireEvent.change(select, { target: { value: other } });
    useTimelineStore.setState({ playheadSec: 30 });
    fireEvent.click(within(place).getByRole("button", { name: "図形を置く" }));
    expect(lastClip().trackId).toBe(other);
  });

  it("書き出し中は「置く列」も列の操作も押せない（押してから断らない）", () => {
    withBgm();
    exporting();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    // 「置く列」は欄ごとにあるので**どの欄のものか**で絞る（#724 で音・読み上げにも増えた）。
    // ⚠️ 塞ぐのは**文書を変える**方だけ＝「選んだ部品」の置く列は `moveSelectedClip` を撃つので押せなくする。
    // 置く側（見た目パターン／音／読み上げ）の置く列は**次にどこへ置くかの下書き**で、変えても文書は
    // 動かない＝押せなくすると「触っても何も起きないのに押せない」になる（§2-5 は押してから断るのを禁じる
    // のであって、断られようのない操作まで塞げとは言っていない）。
    const inSelected = document.querySelector('[data-panel-id="selected"]') as HTMLElement;
    expect(within(inSelected).getByLabelText("載っている列")).toBeDisabled();
    fireEvent.click(screen.getByLabelText("音1の操作"));
    const items = screen.getAllByRole("menuitem");
    // ⚠️ **ソロだけは押せる**（ADR-0067 決定2）＝文書を変えない聞き方（書き出しに効かない）。塞ぐと「書き出しを待つ間に声だけ聞く」ができない。
    const isSolo = (el: HTMLElement): boolean => /ソロ/.test(el.textContent ?? "");
    expect(items.filter((el) => !isSolo(el)).every((el) => el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true")).toBe(true);
    expect(items.filter(isSolo)).toHaveLength(1);
    expect(items.filter(isSolo)[0]!.hasAttribute("disabled")).toBe(false);
  });

  it("書き出し中は取り消す／やり直すも押せない（場面形式と同じ）", () => {
    withBgm();
    useTimelineStore.getState().moveSelectedClip({ startSec: 1 }); // 履歴を作る
    exporting();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getByRole("button", { name: "取り消す" })).toBeDisabled();
  });

  it("確認を出したあとに書き出しが始まったら、確認を閉じる（答えさせてから断らない）", () => {
    open({
      tracks: [
        { id: "track_001", kind: TRACK_KIND.visual },
        { id: "track_003", kind: TRACK_KIND.visual },
      ],
      clips: [
        { id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 5, x: 0, y: 0, w: 10, h: 10, text: "あ" },
      ],
    });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByLabelText("映像2の操作"));
    fireEvent.click(screen.getByRole("menuitem", { name: "削除" }));
    expect(screen.getByRole("button", { name: "削除する" })).toBeInTheDocument();
    // ⚠️ **始まった書き出しの後片づけを、アプリの外でも失敗させない**（負荷・耐久の点検 2026-10-22）＝ここでは
    //   本物の置き場が無いので、片づけが「捕まえていない失敗」になり、走っている別のテストのせいに見えていた。
    vi.spyOn(ffmpegMod, "clearExportFramesStage").mockResolvedValue();
    // 確認を出したまま「動画を書き出す」を押す＝答えを求める確認は閉じてから始める。
    fireEvent.click(screen.getByRole("button", { name: "動画を書き出す" }));
    expect(screen.queryByRole("button", { name: "削除する" })).not.toBeInTheDocument(); // 答えさせない
    expect(useTimelineStore.getState().doc!.tracks).toHaveLength(2);
  });
});

// レビューで見つかった「押してから断る」の取りこぼし（#709）。選択に依る／依らないの取り違え。
describe("TimelineProjectScreen: 固定の見方（#709 レビュー）", () => {
  it("まとめて消すも、固定した列の部品が混ざっていたら押せない", () => {
    open({
      tracks: [
        { id: "track_001", kind: TRACK_KIND.visual, locked: true },
        { id: "track_003", kind: TRACK_KIND.visual },
      ],
      clips: [
        { id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 5, x: 0, y: 0, w: 10, h: 10, text: "あ" },
        { id: "clip_002", kind: TIMELINE_CLIP_KIND.text, trackId: "track_003", startSec: 0, durationSec: 5, x: 0, y: 0, w: 10, h: 10, text: "い" },
      ],
    });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.keyDown(window, { key: "a", ctrlKey: true }); // 全部選ぶ＝固定列のものが混ざる
    const del = screen.getByRole("button", { name: "選んだ2個を削除" });
    expect(del).toBeDisabled(); // 1つだけ選んだときだけ見る、では取りこぼす
    expect(del.title).toBe("固定された列の部品が選ばれています。固定を外すか、選び直してください");
  });

  it("字幕を置くのは、選んだ読み上げの列が固定でも押せる（別の列へ置くので関係ない）", () => {
    open({
      tracks: [
        { id: "track_001", kind: TRACK_KIND.visual },
        { id: "track_002", kind: TRACK_KIND.audio, locked: true },
      ],
      clips: [
        { id: "clip_001", kind: TIMELINE_CLIP_KIND.voice, trackId: "track_002", startSec: 0, durationSec: 5, voice: { text: "よろしく", status: "none" } },
      ],
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getByRole("button", { name: "この読み上げの字幕を置く" })).not.toBeDisabled();
  });

  it("まとまりの動きは、別のメンバーの列が固定でも押せない（domain と同じ見方をする）", () => {
    open({
      tracks: [
        { id: "track_001", kind: TRACK_KIND.visual },
        { id: "track_003", kind: TRACK_KIND.visual, locked: true },
      ],
      groups: [{ id: "group_001", members: ["clip_001", "clip_002"], transform: { x: 0, y: 0, rotation: 0, scale: 1 } }],
      clips: [
        { id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 5, x: 0, y: 0, w: 10, h: 10, text: "あ" },
        { id: "clip_002", kind: TIMELINE_CLIP_KIND.text, trackId: "track_003", startSec: 0, durationSec: 5, x: 0, y: 0, w: 10, h: 10, text: "い" },
      ],
      animations: [{ id: "anim_001", targetId: "group_001", keyframes: [{ timeSec: 0, opacity: 0 }, { timeSec: 1, opacity: 1 }] }],
    });
    // 選んでいるのは**固定していない列**の部品（選んだ部品だけを見ると押せてしまう）。
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getByRole("button", { name: "グループの動きを外す" })).toBeDisabled();
  });
});

// 文字を打つ欄は「1文字＝1履歴」になっていた（#708）。上限（50）を文字入力で食い潰すと、
// それ以前の編集（バラすなど＝取り消しでしか戻らない）が戻せなくなる。
describe("TimelineProjectScreen: 文字を打つ間は1つの取り消しにまとめる（#708）", () => {
  const withVoice = () => {
    open({
      tracks: [{ id: "track_002", kind: TRACK_KIND.audio }],
      clips: [
        { id: "clip_001", kind: TIMELINE_CLIP_KIND.voice, trackId: "track_002", startSec: 0, durationSec: 5, voice: { text: "", status: "none" } },
      ],
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
  };

  it("打っている間は1つ、離れたら次は別の1つ", () => {
    withVoice();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const input = screen.getByLabelText("読み上げる文");
    const before = useTimelineStore.getState().history.past.length;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "こ" } });
    fireEvent.change(input, { target: { value: "こん" } });
    fireEvent.change(input, { target: { value: "こんにちは" } });
    expect(useTimelineStore.getState().history.past.length).toBe(before + 1); // 5文字でも1つ
    expect(useTimelineStore.getState().doc?.clips[0].voice?.text).toBe("こんにちは"); // 文書は毎回追いつく
    fireEvent.blur(input);
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "こんにちは。" } });
    expect(useTimelineStore.getState().history.past.length).toBe(before + 2); // 入り直したら別の1つ
  });

  it("取り消すと、打つ前まで一度に戻る（1文字ずつ戻らない）", () => {
    withVoice();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const input = screen.getByLabelText("読み上げる文");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "あ" } });
    fireEvent.change(input, { target: { value: "あい" } });
    fireEvent.blur(input);
    act(() => useTimelineStore.getState().undo());
    expect(useTimelineStore.getState().doc?.clips[0].voice?.text).toBe("");
  });

  it("欄に入っただけでは取り消しを消費しない（触っただけで履歴が減らない）", () => {
    withVoice();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const input = screen.getByLabelText("読み上げる文");
    const before = useTimelineStore.getState().history.past.length;
    fireEvent.focus(input);
    fireEvent.blur(input);
    expect(useTimelineStore.getState().history.past.length).toBe(before);
  });

  it("欄がフォーカス中に消えても、まとめは開きっぱなしにならない（以後の取り消しが積まれる）", () => {
    open({
      tracks: [
        { id: "track_002", kind: TRACK_KIND.audio },
        { id: "track_004", kind: TRACK_KIND.audio },
      ],
      clips: [
        { id: "clip_001", kind: TIMELINE_CLIP_KIND.voice, trackId: "track_002", startSec: 0, durationSec: 5, voice: { text: "", status: "none" } },
        { id: "clip_002", kind: TIMELINE_CLIP_KIND.voice, trackId: "track_004", startSec: 0, durationSec: 5, voice: { text: "", status: "none" } },
      ],
    });
    useTimelineStore.setState({ selectedClipIds: ["clip_001"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const input = screen.getByLabelText("読み上げる文");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "あ" } }); // ここで「編集前」を1回記録＝まとめは記録済みになる
    // 別の部品を選ぶ＝欄が入れ替わる。`blur` は来ないので、ここで畳まないと**開きっぱなし**になり、
    // 記録済みのまま以後の編集が1つも積まれなくなる。
    act(() => useTimelineStore.getState().selectClip("clip_002"));
    const before = useTimelineStore.getState().history.past.length;
    act(() => useTimelineStore.getState().moveSelectedClip({ startSec: 2 }));
    expect(useTimelineStore.getState().history.past.length).toBe(before + 1); // 以後の取り消しが積まれる
  });

  it("打っている間もプレビューは追いつく（見えているものがそのまま出る）", () => {
    // 連動する字幕は、自分の文が無ければ読み上げの文をそのまま描く（ADR-0032 決定24）。
    // 下書きに溜める形にすると、打っている間プレビューが古いままになる。
    withVoice();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const input = screen.getByLabelText("読み上げる文");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "とちゅう" } });
    expect(useTimelineStore.getState().doc?.clips[0].voice?.text).toBe("とちゅう"); // 確定を待たない
  });
});

// 写真1枚すら置けなかった（#684・ADR-0034 段階1）。置く手段と、置いた直後に直せることを固定する。
describe("TimelineProjectScreen: 素材・文字・図形を置く（#684）", () => {
  const withAsset = (over: Record<string, unknown> = {}) => {
    open({
      tracks: [{ id: "track_001", kind: TRACK_KIND.visual }],
      clips: [],
      assets: [
        { assetId: "asset_001", assetType: "image", displayName: "会社の外観", filePath: "a.png" },
        { assetId: "asset_002", assetType: "bgm", displayName: "曲", filePath: "b.mp3" },
        // 動画も一覧に出す＝直接置けば映り、元の音も鳴る（#512 段1・段2）。下の「動画も置ける」で見る。
        { assetId: "asset_003", assetType: "video", displayName: "紹介ムービー", filePath: "c.mp4" },
      ],
      ...over,
    });
  };

  // **使っていない素材を片づける**（#1480）＝件数つきで出し、確かめてから外す（ファイルはごみ箱）。
  it("使っていない素材を片づける（件数・確かめてから・取り消しでは戻らないと言う）", async () => {
    const trash = vi.spyOn(await import("../../infrastructure/assetFs"), "trashProjectFiles").mockResolvedValue(1);
    withAsset({ clips: [{ id: "clip_001", kind: TIMELINE_CLIP_KIND.slot, trackId: "track_001", startSec: 0, durationSec: 3, x: 0, y: 0, w: 10, h: 10, assetId: "asset_003" }] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "使っていない素材を片づける（2件）" }));
    expect(screen.getByText(/「会社の外観」「曲」を一覧から外し、ファイルをごみ箱へ移します/)).toBeInTheDocument();
    expect(screen.getByText(/「取り消す」では戻りません/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "片づける" }));
    expect(useTimelineStore.getState().doc!.assets.map((a) => a.assetId)).toEqual(["asset_003"]);
    expect(trash).toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /使っていない素材を片づける/ }), "無くなったのに出ている").toBeNull();
  });

  it("文字を置ける（置いたら選ばれていて、すぐ直せる）", () => {
    withAsset();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "文字を置く" }));
    const doc = useTimelineStore.getState().doc!;
    expect(doc.clips).toHaveLength(1);
    expect(doc.clips[0].kind).toBe(TIMELINE_CLIP_KIND.text);
    expect(useTimelineStore.getState().selectedClipIds).toEqual([doc.clips[0].id]); // 置いたら選ぶ
    // 選ばれているので、そのまま中身（文字）を直せる＝「置けるのに直せない」を作らない。
    expect(screen.getByLabelText("文字")).toBeInTheDocument();
  });

  it("図形も置ける", () => {
    withAsset();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "図形を置く" }));
    expect(useTimelineStore.getState().doc!.clips[0].kind).toBe(TIMELINE_CLIP_KIND.shape);
  });

  it("写真を置ける（音の素材は絵として出さない）", () => {
    withAsset();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.queryByText("曲")).not.toBeInTheDocument(); // 音は絵の一覧に出さない
    fireEvent.click(screen.getByText("会社の外観"));
    expect(useTimelineStore.getState().doc!.clips[0]).toMatchObject({ kind: "slot", assetId: "asset_001" });
  });

  // ⚠️ **動画も置ける**（#512 段1・利用者判断 2026-08-19）＝以前は「置けても書き出しの手前で断られる」
  // ので一覧から外していたが、直接置いた動画は映るようになった＝外す理由が消えた。
  it("動画も置ける（映るようになったので一覧に出す）", () => {
    withAsset();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByText("紹介ムービー"));
    expect(useTimelineStore.getState().doc!.clips[0]).toMatchObject({ kind: "slot", assetId: "asset_003" });
  });

  it("置ける列が無いときは、何をすれば置けるか出す", () => {
    withAsset({ tracks: [{ id: "track_002", kind: TRACK_KIND.audio }] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getByText(/置ける映像の列がありません/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "文字を置く" })).not.toBeInTheDocument();
  });

  it("写真がまだ無いときは、この画面で取り込める道を出す（行き止まりにしない）", () => {
    // 場面形式の素材画面はこの形式を見ないので、そこを指すと**行き止まりの案内**（ADR-0034 決定5）。
    // #712 でこの画面に取り込みが付いたので、案内はここの導線を指す。
    withAsset({ assets: [] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getByText(/写真がまだありません/)).toBeInTheDocument();
    expect(screen.queryByText(/素材の画面で取り込む/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /写真・動画・音楽を取り込む/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "文字を置く" })).toBeInTheDocument(); // できることは残る
  });

  it("置ける列が無くても取り込める（列を足すまで素材を用意できない、を作らない・#712）", () => {
    withAsset({ tracks: [{ id: "track_002", kind: TRACK_KIND.audio }] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getByText(/置ける映像の列がありません/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /写真・動画・音楽を取り込む/ })).toBeInTheDocument();
  });

  // ⚠️ **素材で確かめる**（#1252）＝写真・動画は**紙芝居**として後ろへ並ぶのが正しい。
  //   文字・図形は塞がっていると**手前に列を足して重ねる**ので、別の検査（「塞がっているときの置き方」）で見る。
  it("素材を続けて置くと、次に空いている時刻へ置く（押しても置けない、を続けない）", () => {
    withAsset();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const 置く = () => fireEvent.click(screen.getAllByRole("button", { name: "会社の外観" })[0]!);
    置く();
    置く(); // 同じ再生位置＝塞がっている
    const clips = useTimelineStore.getState().doc!.clips;
    expect(clips).toHaveLength(2);
    // 1つ目の終わりから続けて置く（重ねない・黙って何もしない、もしない）。
    expect(clips[1].startSec).toBe(clips[0].startSec + clips[0].durationSec);
    expect(clips[1].trackId, "列が増えている（紙芝居にならない）").toBe(clips[0].trackId);
    expect(useTimelineStore.getState().editBlocked).toBeNull();
  });

  // ── つかんで置く（#684・ADR-0034 決定2） ────────────────────────────────
  // jsdom は要素の大きさを持たないので、落とし先の箱だけ与える（当て方＝`pointInRect` は純粋関数で別途固定）。
  const stubRect = (el: Element, r: { left: number; top: number; width: number; height: number }) => {
    (el as HTMLElement).getBoundingClientRect = () =>
      ({ left: r.left, top: r.top, width: r.width, height: r.height, right: r.left + r.width, bottom: r.top + r.height, x: r.left, y: r.top, toJSON: () => ({}) }) as DOMRect;
  };
  const grab = (el: Element) => fireEvent.pointerDown(el, { pointerId: 1, button: 0, clientX: 0, clientY: 0 });
  const moveTo = (x: number, y: number) => fireEvent.pointerMove(window, { buttons: 1, pointerId: 1, clientX: x, clientY: y });
  const dropAt = (x: number, y: number) => fireEvent.pointerUp(window, { pointerId: 1, clientX: x, clientY: y });

  it("つかんで列へ落とすと、その列のその時刻へ置く（探さない・寄せない）", () => {
    withAsset({ tracks: [{ id: "track_001", kind: TRACK_KIND.visual }, { id: "track_003", kind: TRACK_KIND.visual }] });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    // 先に1つ置いて並びを出す（列は部品が無いと描かれない）。
    fireEvent.click(screen.getByRole("button", { name: "文字を置く" }));
    const lanes = container.querySelectorAll(".timeline-lane");
    stubRect(lanes[0], { left: 200, top: 400, width: 800, height: 40 }); // 手前＝track_003
    stubRect(lanes[1], { left: 200, top: 440, width: 800, height: 40 }); // 奥＝track_001
    // ⚠️ 倍率は**段の既定**（36 px/秒・#686）＝以前の「尺から自動」は表示倍率の導入で無くなった。
    // 幅を測れない環境（jsdom）では全体表示に合わせられないので、ここに落ち着く。
    // 左端 200 から 5秒＝200 + 5×36 = 380px。
    grab(screen.getByRole("button", { name: "図形を置く" }));
    moveTo(380, 460); // 奥の列の 5秒
    dropAt(380, 460);
    const placed = useTimelineStore.getState().doc!.clips.find((c) => c.kind === TIMELINE_CLIP_KIND.shape)!;
    expect(placed).toMatchObject({ trackId: "track_001", startSec: 5 });
  });

  it("つかんで仕上がり確認へ落とすと、落とした場所へ置く", () => {
    withAsset();
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    stubRect(container.querySelector(".preview-stage")!, { left: 0, top: 0, width: 640, height: 360 });
    grab(screen.getByText("会社の外観"));
    moveTo(160, 90); // 枠の左上寄り＝動画の (480, 270)
    dropAt(160, 90);
    const c = useTimelineStore.getState().doc!.clips[0];
    // 箱の**中心**が落とした場所（1920x1080 の 1/4 の位置）。箱は画面いっぱいなので端で収められる。
    expect(c.kind).toBe(TIMELINE_CLIP_KIND.slot);
    expect(c.assetId).toBe("asset_001");
  });

  // #512 段1＝**直接置いた動画は絵が映る**（書き出しと同じ分割で `video` 要素を挟む）。
  // ⚠️ 音が入っていない動画には元の音の欄を出さず、その場で理由を出す（#512 段2・§2-5）。
  describe("動画の素材（#512 段1）", () => {
    /** @param opts.hasAudio 素材に音が入っているか（#512 段2 の門＝場面形式と同じ規準）。 */
    const withVideo = (opts: { hasAudio?: boolean; useOriginalAudio?: boolean; originalAudioVolume?: number } = {}) => {
      open({
        tracks: [{ id: "track_001", kind: TRACK_KIND.visual }],
        assets: [{
          assetId: "asset_v", assetType: "video", displayName: "紹介ムービー", filePath: "v.mp4",
          ...(opts.hasAudio == null ? {} : { metadata: { hasAudio: opts.hasAudio } }),
        }],
        clips: [{
          id: "clip_001", kind: TIMELINE_CLIP_KIND.slot, trackId: "track_001",
          startSec: 0, durationSec: 5, x: 0, y: 0, w: 1920, h: 1080, assetId: "asset_v",
          ...(opts.useOriginalAudio ? { useOriginalAudio: true } : {}),
          ...(opts.originalAudioVolume == null ? {} : { originalAudioVolume: opts.originalAudioVolume }),
        }],
      });
      // ⚠️ **動画は本体の URL（`videoSrcById`）を見る**（`assetSrcById` は代表フレーム＝静止画）。
      // ここを取り違えると「穴だけ開いて何も映らない」＝レビューで見つかった 🔴 そのもの。
      act(() => {
        useTimelineStore.setState({
          assetSrcById: { asset_v: "blob:thumb_v" },
          videoSrcById: { asset_v: "blob:body_v" },
        });
      });
    };

    it("仕上がり確認に実映像（video 要素）が出る＝**本体**を指す（代表フレームではない）", () => {
      withVideo();
      const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
      const v = container.querySelector(".preview-stage video") as HTMLVideoElement | null;
      expect(v).not.toBeNull();
      expect(v?.getAttribute("src")).toBe("blob:body_v"); // 静止画を指していたら穴が空くだけ
      expect(v?.muted).toBe(true); // 鳴らす設定にしていない動画は消音（#512 段2）
    });

    // ⚠️ **本体の URL が無ければ穴を開けない**（何も映らない窓を作るより、代表フレームのまま見せる）。
    it("本体の URL が無いときは実映像にしない（静止のまま）", () => {
      withVideo();
      act(() => { useTimelineStore.setState({ videoSrcById: {} }); });
      const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
      expect(container.querySelector(".preview-stage video")).toBeNull();
    });

    // ⚠️ **音の入っていない動画には、その場で理由を出す**（#512 段2・§2-5）＝欄だけ出して押せない、
    // でも黙って無反応でもなく、「音を付けるなら音の列へ」という次の行動を出す。
    it("音の入っていない動画では、元の音の欄を出さずに理由を出す", () => {
      withVideo({ hasAudio: false });
      render(<TimelineProjectScreen onNavigate={vi.fn()} />);
      act(() => { useTimelineStore.setState({ selectedClipIds: ["clip_001"] }); });
      expect(screen.getByText(/この動画には音が入っていません/)).toBeInTheDocument();
      expect(screen.queryByText("この動画に入っている音を流す")).toBeNull();
    });

    // ⚠️ **既定は鳴らさない**（場面形式と同じ規準＝ADR-0026②）＝既に作った動画の音が黙って変わらない。
    it("音の入っている動画は欄が出るが、既定では鳴らさない", () => {
      withVideo({ hasAudio: true });
      const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
      act(() => { useTimelineStore.setState({ selectedClipIds: ["clip_001"] }); });
      expect(screen.getByText("この動画に入っている音を流す")).toBeInTheDocument();
      expect(screen.queryByText(/この動画には音が入っていません/)).toBeNull();
      expect((container.querySelector(".preview-stage video") as HTMLVideoElement | null)?.muted).toBe(true);
    });

    // ⚠️ **音が入っているか判らない素材には、断定しない**（レビュー 🟡・§2-5）＝取り込みで調べられて
    // いないだけかもしれないので、次の行動は「取り込み直す」（音の列に音を置く、ではない）。
    it("音が入っているか判らない動画には、断定せず取り込み直しを案内する", () => {
      withVideo(); // metadata 無し＝調べられていない
      render(<TimelineProjectScreen onNavigate={vi.fn()} />);
      act(() => { useTimelineStore.setState({ selectedClipIds: ["clip_001"] }); });
      expect(screen.getByText(/確かめられませんでした/)).toBeInTheDocument();
      expect(screen.queryByText(/この動画には音が入っていません/)).toBeNull();
    });

    // ⚠️ **絵を出せないときも音は鳴らす**（レビュー 🟡・ADR-0001）＝絵を止める理由（合成の仕方が
    // 書き出しと違う）は音には当てはまらない。消すと「聞こえないのに書き出しには入る」になる。
    it("まとまり全体を薄くしている間も、元の音は鳴る（書き出しと一致）", () => {
      open({
        tracks: [{ id: "track_001", kind: TRACK_KIND.visual }],
        assets: [{ assetId: "asset_v", assetType: "video", displayName: "紹介", filePath: "v.mp4", metadata: { hasAudio: true } }],
        clips: [
          { id: "clip_001", kind: TIMELINE_CLIP_KIND.slot, trackId: "track_001", startSec: 0, durationSec: 5, x: 0, y: 0, w: 960, h: 540, assetId: "asset_v", useOriginalAudio: true, originalAudioVolume: 0.6 },
          { id: "clip_002", kind: TIMELINE_CLIP_KIND.shape, trackId: "track_001", startSec: 0, durationSec: 5, x: 960, y: 0, w: 960, h: 540 },
        ],
        groups: [{ id: "group_001", members: ["clip_001", "clip_002"], transform: { x: 0, y: 0, scale: 1, rotation: 0 } }],
        animations: [{ id: "anim_001", targetId: "group_001", keyframes: [{ timeSec: 0, opacity: 0.2 }, { timeSec: 5, opacity: 1 }] }],
      });
      act(() => { useTimelineStore.setState({ assetSrcById: { asset_v: "blob:thumb_v" }, videoSrcById: { asset_v: "blob:body_v" } }); });
      const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
      // 絵の窓（枠の中の video）は出さない＝静止のまま。
      expect(container.querySelector(".preview-stage video")).toBeNull();
      // 音だけの要素が枠の外に居て、指定した音量で鳴る。
      const audible = container.querySelector(".preview-stage-wrap > video") as HTMLVideoElement | null;
      expect(audible).not.toBeNull();
      expect(audible!.muted).toBe(false);
      expect(audible!.volume).toBeCloseTo(0.6, 5);
    });

    // ⚠️ **鳴らす設定にしたら消音が外れ、音量も効く**＝聞こえたものが書き出しにも出る（ADR-0001）。
    it("鳴らす設定にすると消音が外れ、指定した音量が効く", () => {
      withVideo({ hasAudio: true, useOriginalAudio: true, originalAudioVolume: 0.8 });
      const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
      const v = container.querySelector(".preview-stage video") as HTMLVideoElement | null;
      expect(v?.muted).toBe(false);
      expect(v?.volume).toBeCloseTo(0.8, 5);
    });

    // ⚠️ **合成の単位が跨るときは実映像を出さない**（`11 §7.6.4`）＝層ごとに薄さを掛けると
    // 重なった所で下が透け、書き出し（1枚にしてから掛ける）と別の絵になる。理由もその場に出す。
    it("まとまり全体を薄くしている間は実映像にせず、理由を出す", () => {
      open({
        tracks: [{ id: "track_001", kind: TRACK_KIND.visual }],
        assets: [{ assetId: "asset_v", assetType: "video", displayName: "紹介ムービー", filePath: "v.mp4" }],
        clips: [
          { id: "clip_001", kind: TIMELINE_CLIP_KIND.slot, trackId: "track_001", startSec: 0, durationSec: 5, x: 0, y: 0, w: 960, h: 540, assetId: "asset_v" },
          { id: "clip_002", kind: TIMELINE_CLIP_KIND.shape, trackId: "track_001", startSec: 0, durationSec: 5, x: 960, y: 0, w: 960, h: 540 },
        ],
        groups: [{ id: "group_001", members: ["clip_001", "clip_002"], transform: { x: 0, y: 0, scale: 1, rotation: 0 } }],
        // まとまり全体を薄くする動き（焼き出した自由配置の場面が持つ形）。
        animations: [{ id: "anim_001", targetId: "group_001", keyframes: [{ timeSec: 0, opacity: 0.2 }, { timeSec: 5, opacity: 1 }] }],
      });
      act(() => { useTimelineStore.setState({ assetSrcById: { asset_v: "blob:thumb_v" }, videoSrcById: { asset_v: "blob:body_v" }, selectedClipIds: ["clip_001"] }); });
      const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
      expect(container.querySelector(".preview-stage video")).toBeNull(); // 実映像にしない
      expect(screen.getByText(/グループ全体を薄くしている間/)).toBeInTheDocument(); // 理由を出す
    });

    // ⚠️ **回した部品を左右非対称に切り抜いているときも実映像を出さない**（`11 §7.6.4.1`）＝
    // 書き出しは矩形自身の中心、画面は部品の中心で回るので**別の窓**になる。理由もその場に出す。
    it("回した部品を切り抜いている間は実映像にせず、理由を出す", () => {
      open({
        tracks: [{ id: "track_001", kind: TRACK_KIND.visual }],
        assets: [{ assetId: "asset_v", assetType: "video", displayName: "紹介ムービー", filePath: "v.mp4" }],
        clips: [{
          id: "clip_001", kind: TIMELINE_CLIP_KIND.slot, trackId: "track_001",
          startSec: 0, durationSec: 5, x: 0, y: 0, w: 960, h: 540, assetId: "asset_v",
          rotation: 30, crop: { left: 0.5 }, // 左半分を落とす＝切り抜きの中心が箱の中心とずれる
        }],
      });
      act(() => { useTimelineStore.setState({ assetSrcById: { asset_v: "blob:thumb_v" }, videoSrcById: { asset_v: "blob:body_v" }, selectedClipIds: ["clip_001"] }); });
      const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
      expect(container.querySelector(".preview-stage video")).toBeNull();
      expect(screen.getByText(/回した部品を切り抜いている間/)).toBeInTheDocument();
    });

    // ⚠️ 写真では出さない（動画のときだけ＝いつも出ていると読まれなくなる）。
    it("写真の部品では知らせない", () => {
      open({
        tracks: [{ id: "track_001", kind: TRACK_KIND.visual }],
        assets: [{ assetId: "asset_p", assetType: "image", displayName: "写真", filePath: "p.png" }],
        clips: [{
          id: "clip_001", kind: TIMELINE_CLIP_KIND.slot, trackId: "track_001",
          startSec: 0, durationSec: 5, x: 0, y: 0, w: 1920, h: 1080, assetId: "asset_p",
        }],
      });
      // ⚠️ **写真にも src を与える**＝与えないと「src が無いから出ない」で通ってしまい、
      // 種類の判定（動画かどうか）が壊れても落ちない（レビュー指摘）。
      act(() => { useTimelineStore.setState({ assetSrcById: { asset_p: "blob:p" }, videoSrcById: { asset_p: "blob:p" } }); });
      render(<TimelineProjectScreen onNavigate={vi.fn()} />);
      act(() => { useTimelineStore.setState({ selectedClipIds: ["clip_001"] }); });
      expect(screen.queryByText(/この動画には音が入っていません/)).toBeNull();
      expect(document.querySelector(".preview-stage video")).toBeNull();
    });
  });

  // #714 項目2＝**見た目パターン・音・読み上げも掴んで運べる**（以前はボタンだけで、同じ画面の中で
  // 置き方の流儀が割れていた＝ADR-0026②）。落とし先・断り方は絵の部品と同じ道を通る。
  it("読み上げをつかんで音の列へ落とすと、その列のその時刻へ置く", () => {
    withAsset({ tracks: [{ id: "track_001", kind: TRACK_KIND.visual }, { id: "track_002", kind: TRACK_KIND.audio }] });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "文字を置く" })); // 列を描かせる
    const lanes = container.querySelectorAll(".timeline-lane");
    // ⚠️ 列は**手前が上**＝`lanes[0]` は並びの後ろ（track_002＝音の列）。
    stubRect(lanes[0], { left: 200, top: 400, width: 800, height: 40 }); // 音の列
    stubRect(lanes[1], { left: 200, top: 440, width: 800, height: 40 }); // 絵の列
    openPlaceTab("読み上げ");
    grab(screen.getByRole("button", { name: "読み上げを置く" }));
    moveTo(380, 420); // 200 + 5×36 ＝ 5秒
    dropAt(380, 420);
    const placed = useTimelineStore.getState().doc!.clips.find((c) => c.kind === TIMELINE_CLIP_KIND.voice)!;
    expect(placed).toMatchObject({ trackId: "track_002", startSec: 5 });
  });

  // ⚠️ **この PR の本題**＝見た目パターンも掴んで運べる。掴む系のテストが音・読み上げだけだと、
  // 見出しの機能そのものが未検証のまま残る（レビュー指摘）。
  it("見た目パターンをつかんで落とすと、その時刻へ置く（置いた所へ再生位置も動く）", () => {
    useProjectStore.setState({
      templates: [{
        schemaVersion: "1.0", templateId: "tmpl_001", name: "よこ型テンプレ", category: "photo_intro",
        aspectRatio: "16:9", canvas: { width: 1920, height: 1080 },
        layers: [{ id: "background", type: "background", x: 0, y: 0, w: 1920, h: 1080 }],
      } as Template],
    });
    withAsset({ tracks: [{ id: "track_001", kind: TRACK_KIND.visual }, { id: "track_002", kind: TRACK_KIND.audio }] });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "文字を置く" }));
    const lanes = container.querySelectorAll(".timeline-lane");
    stubRect(lanes[0], { left: 200, top: 400, width: 800, height: 40 }); // 音の列（手前が上）
    stubRect(lanes[1], { left: 200, top: 440, width: 800, height: 40 }); // 絵の列
    openPlaceTab("見た目パターン");
    grab(screen.getByText("よこ型テンプレ"));
    moveTo(560, 460); // 200 + 10×36 ＝ 10秒
    dropAt(560, 460);
    const placed = useTimelineStore.getState().doc!.clips.find((c) => c.kind === TIMELINE_CLIP_KIND.template)!;
    expect(placed).toMatchObject({ trackId: "track_001", startSec: 10 });
    // **置いた瞬間に見える**（`06 §12.1`）＝運んだ先へ再生位置も動く（絵の部品と同じ）。
    expect(useTimelineStore.getState().playheadSec).toBe(10);
  });

  it("音（曲）をつかんで落とすと、その時刻へ置く", () => {
    withAsset({ tracks: [{ id: "track_001", kind: TRACK_KIND.visual }, { id: "track_002", kind: TRACK_KIND.audio }] });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "文字を置く" }));
    const lanes = container.querySelectorAll(".timeline-lane");
    stubRect(lanes[0], { left: 200, top: 400, width: 800, height: 40 }); // 音の列（手前が上）
    stubRect(lanes[1], { left: 200, top: 440, width: 800, height: 40 }); // 絵の列
    openPlaceTab("音");
    grab(screen.getByText("曲")); // 素材の音（一覧の名前で掴む）
    moveTo(272, 420); // 200 + 2×36 ＝ 2秒
    dropAt(272, 420);
    const placed = useTimelineStore.getState().doc!.clips.find((c) => c.kind === TIMELINE_CLIP_KIND.audio)!;
    expect(placed).toMatchObject({ trackId: "track_002", startSec: 2, assetId: "asset_002" });
  });

  // ⚠️ **列の種別違いは断る**＝音を絵の列へ落としても置かない（理由を出す）。
  it("音を絵の列へ落としたら置かない（理由を出す）", () => {
    withAsset({ tracks: [{ id: "track_001", kind: TRACK_KIND.visual }, { id: "track_002", kind: TRACK_KIND.audio }] });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "文字を置く" }));
    const lanes = container.querySelectorAll(".timeline-lane");
    stubRect(lanes[0], { left: 200, top: 400, width: 800, height: 40 }); // 音の列
    stubRect(lanes[1], { left: 200, top: 440, width: 800, height: 40 }); // 絵の列
    const before = useTimelineStore.getState().doc!.clips.length;
    openPlaceTab("音");
    grab(screen.getByText("曲"));
    moveTo(380, 460); // 絵の列の上
    dropAt(380, 460);
    expect(useTimelineStore.getState().doc!.clips).toHaveLength(before);
    // ⚠️ **理由まで見る**（レビュー指摘）＝件数だけだと「落とし先の外だった（何も起きない）」と
    // 見分けが付かず、断りを出さなくなる変異も素通りする。
    expect(screen.getByText(/音の部品は音の列に/)).toBeInTheDocument();
  });

  // ⚠️ **仕上がり確認へ落とせるのは絵の部品だけ**＝音・読み上げは動画の中の場所を持たない。
  // 落とし先の外と同じ扱い＝**何も置かない**（勝手に再生位置へ置かない）。
  it("音を仕上がり確認へ落としても置かない（場所を持たない部品）", () => {
    withAsset({ tracks: [{ id: "track_001", kind: TRACK_KIND.visual }, { id: "track_002", kind: TRACK_KIND.audio }] });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    stubRect(container.querySelector(".preview-stage")!, { left: 0, top: 0, width: 640, height: 360 });
    const before = useTimelineStore.getState().doc!.clips.length;
    openPlaceTab("音");
    grab(screen.getByText("曲"));
    moveTo(160, 90);
    dropAt(160, 90);
    expect(useTimelineStore.getState().doc!.clips).toHaveLength(before);
  });

  // ⚠️ **動かさずに離したら、ボタンと同じ結果**（掴めるようにしても押すだけの道を壊さない・決定19）。
  it("読み上げを押しただけ（動かさず離す）なら、欄の列と再生位置へ置く", () => {
    withAsset({ tracks: [{ id: "track_001", kind: TRACK_KIND.visual }, { id: "track_002", kind: TRACK_KIND.audio }] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    openPlaceTab("読み上げ");
    grab(screen.getByRole("button", { name: "読み上げを置く" }));
    dropAt(0, 0); // 動かしていない
    const placed = useTimelineStore.getState().doc!.clips.find((c) => c.kind === TIMELINE_CLIP_KIND.voice)!;
    expect(placed).toMatchObject({ trackId: "track_002", startSec: 0 });
  });

  it("置けない所で離したら置かない（寄せない）＋理由を出す", () => {
    withAsset({ tracks: [{ id: "track_001", kind: TRACK_KIND.visual, locked: true }, { id: "track_003", kind: TRACK_KIND.visual }] });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "文字を置く" })); // track_003 へ1つ
    const lanes = container.querySelectorAll(".timeline-lane");
    stubRect(lanes[0], { left: 200, top: 400, width: 800, height: 40 }); // track_003
    stubRect(lanes[1], { left: 200, top: 440, width: 800, height: 40 }); // track_001（固定）
    const before = useTimelineStore.getState().doc!.clips.length;
    grab(screen.getByRole("button", { name: "図形を置く" }));
    moveTo(840, 460);
    dropAt(840, 460);
    expect(useTimelineStore.getState().doc!.clips).toHaveLength(before); // 置かない
    expect(screen.getByText(/この列は固定されています/)).toBeInTheDocument(); // 離したときに理由
  });

  it("落とし先の外で離したら何もしない（黙って再生位置へ置かない）", () => {
    withAsset();
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    stubRect(container.querySelector(".preview-stage")!, { left: 0, top: 0, width: 640, height: 360 });
    grab(screen.getByRole("button", { name: "文字を置く" }));
    moveTo(2000, 2000);
    dropAt(2000, 2000);
    expect(useTimelineStore.getState().doc!.clips).toHaveLength(0);
    expect(useTimelineStore.getState().editBlocked).toBeNull();
  });

  it("「出さない」列へは落とせない（置いても動画に出ない部品を黙って作らない）", () => {
    withAsset({ tracks: [{ id: "track_001", kind: TRACK_KIND.visual }, { id: "track_003", kind: TRACK_KIND.visual, hidden: true }] });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "文字を置く" })); // 見えている列へ1つ
    const lanes = container.querySelectorAll(".timeline-lane");
    stubRect(lanes[0], { left: 200, top: 400, width: 800, height: 40 }); // 手前＝track_003（出さない）
    stubRect(lanes[1], { left: 200, top: 440, width: 800, height: 40 }); // 奥＝track_001
    const before = useTimelineStore.getState().doc!.clips.length;
    grab(screen.getByRole("button", { name: "図形を置く" }));
    moveTo(840, 420);
    dropAt(840, 420);
    expect(useTimelineStore.getState().doc!.clips).toHaveLength(before);
    expect(screen.getByText(/「出さない」設定なので/)).toBeInTheDocument();
  });

  it("スクロールで欄の外へ出ている列へは落とせない（見えていない所へ入らない）", () => {
    withAsset({ tracks: [{ id: "track_001", kind: TRACK_KIND.visual }] });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "文字を置く" }), { detail: 0 });
    const lane = container.querySelectorAll(".timeline-lane")[0];
    stubRect(lane, { left: 200, top: 400, width: 800, height: 40 });
    // 列を囲う箱が中身を切っていて、列はその外（＝画面では見えていない）。
    const scroll = container.querySelector(".timeline-scroll") as HTMLElement;
    scroll.style.overflow = "auto";
    stubRect(scroll, { left: 200, top: 1000, width: 800, height: 40 });
    const before = useTimelineStore.getState().doc!.clips.length;
    grab(screen.getByRole("button", { name: "図形を置く" }));
    moveTo(840, 420);
    expect(container.querySelector(".timeline-drop-preview")).toBeNull(); // 落とし先として出さない
    dropAt(840, 420);
    expect(useTimelineStore.getState().doc!.clips).toHaveLength(before); // 置かない
  });

  it("列の上では「どこに・何秒ぶん」入るかを実寸で出す（落とす前に結果が分かる）", () => {
    withAsset({ tracks: [{ id: "track_001", kind: TRACK_KIND.visual }] });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "文字を置く" }), { detail: 0 });
    stubRect(container.querySelectorAll(".timeline-lane")[0], { left: 200, top: 400, width: 800, height: 40 });
    grab(screen.getByRole("button", { name: "図形を置く" }));
    moveTo(380, 420); // 5秒（段の既定 36 px/秒）
    const preview = container.querySelector(".timeline-drop-preview") as HTMLElement;
    expect(preview).not.toBeNull();
    expect(preview.style.left).toBe(`${36 * 5}px`);
    expect(preview.style.width).toBe(`${36 * 5}px`); // 置かれる長さ（5秒ぶん）
    dropAt(380, 420);
    expect(container.querySelector(".timeline-drop-preview")).toBeNull(); // 離したら消える
  });

  // ⚠️ **列の無い所＝新しい列**（#1478）＝窓の外からのファイル（ADR-0049）と同じ場所・同じ規則（ADR-0026②）。
  it("いちばん下の列より下へ落とすと、新しい列を作って置く（行き先を先に見せる・取り消し1回）", () => {
    withAsset({ tracks: [{ id: "track_001", kind: TRACK_KIND.visual }] });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    stubRect(container.querySelectorAll(".timeline-lane")[0], { left: 200, top: 400, width: 800, height: 40 });
    stubRect(container.querySelector(".timeline-scroll")!, { left: 76, top: 380, width: 1000, height: 300 });
    const before = useTimelineStore.getState().doc!;
    grab(screen.getByRole("button", { name: "図形を置く" }));
    moveTo(380, 600); // 列の下・5秒
    expect(screen.getByTestId("drag-newrow").textContent).toContain("新しい列");
    dropAt(380, 600);
    const now = useTimelineStore.getState().doc!;
    expect(now.tracks).toHaveLength(2);
    const added = now.tracks.find((t) => t.id !== "track_001")!;
    expect(now.clips.find((c) => c.trackId === added.id)?.startSec).toBe(5);
    act(() => { useTimelineStore.getState().undo(); });
    expect(useTimelineStore.getState().doc!.tracks).toEqual(before.tracks);
    expect(useTimelineStore.getState().doc!.clips).toEqual(before.clips);
  });

  it("帯を掴んでいちばん下の列より下へ運ぶと、新しい列へ移る", () => {
    withAsset({ tracks: [{ id: "track_001", kind: TRACK_KIND.visual }] });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "文字を置く" }), { detail: 0 });
    stubRect(container.querySelectorAll(".timeline-lane")[0], { left: 200, top: 400, width: 800, height: 40 });
    stubRect(container.querySelector(".timeline-scroll")!, { left: 76, top: 380, width: 1000, height: 300 });
    const clip = container.querySelector(".timeline-clip[data-clip-id]") as HTMLElement;
    const clipId = clip.dataset.clipId!;
    fireEvent.pointerDown(clip, { button: 0, pointerId: 1, clientX: 220, clientY: 420 });
    fireEvent.pointerMove(window, { buttons: 1, pointerId: 1, clientX: 240, clientY: 600 });
    expect(screen.getByTestId("drag-newrow")).toBeInTheDocument();
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 240, clientY: 600 });
    const now = useTimelineStore.getState().doc!;
    expect(now.tracks).toHaveLength(2);
    expect(now.clips.find((c) => c.id === clipId)!.trackId).not.toBe("track_001");
  });

  it("置いた所へ再生位置が動く（置いたのに何も見えない、を作らない）", () => {
    withAsset({ tracks: [{ id: "track_001", kind: TRACK_KIND.visual }] });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "文字を置く" }), { detail: 0 });
    stubRect(container.querySelectorAll(".timeline-lane")[0], { left: 200, top: 400, width: 800, height: 40 });
    grab(screen.getByRole("button", { name: "図形を置く" }));
    moveTo(380, 420); // 5秒（段の既定 36 px/秒）
    dropAt(380, 420);
    expect(useTimelineStore.getState().playheadSec).toBe(5);
  });

  it("読み込み中から開けた後も、つかんで置ける（フックの数が回ごとに変わらない）", () => {
    // 早期 return（読み込み中）を通る回と通らない回でフックの数が変われば、React が状態を取り違える。
    // 同じ画面を張ったまま状態を切り替えて、続けて操作できることを見る。
    useTimelineStore.setState({ doc: null, loadError: null, isLoading: true });
    const { container, rerender } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getByText(/動画を開いています/)).toBeInTheDocument();
    withAsset(); // 開けた
    rerender(<TimelineProjectScreen onNavigate={vi.fn()} />);
    stubRect(container.querySelector(".preview-stage")!, { left: 0, top: 0, width: 640, height: 360 });
    grab(screen.getByRole("button", { name: "文字を置く" }));
    moveTo(300, 180);
    expect(container.querySelector(".drag-ghost")).not.toBeNull();
    dropAt(300, 180);
    expect(useTimelineStore.getState().doc!.clips).toHaveLength(1);
  });

  it("掴めるものは、手を出す前に分かる（欄の見出し・帯と同じ見た目）", () => {
    withAsset();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getByRole("button", { name: "文字を置く" })).toHaveClass("grabbable");
    // 素材は絵で並ぶ（#1264）＝名前は枠の中の文字なので、掴む枠（ボタン）を見る。
    expect(screen.getByText("会社の外観").closest("button")).toHaveClass("grabbable");
  });

  it("落とし先の外では、置けない色にしない（赤の意味を薄めない）", () => {
    withAsset();
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    stubRect(container.querySelector(".preview-stage")!, { left: 0, top: 0, width: 640, height: 360 });
    grab(screen.getByRole("button", { name: "文字を置く" }));
    moveTo(2000, 2000); // 落とし先の外
    expect(container.querySelector(".drag-ghost")?.className).not.toContain("blocked");
  });

  it("Escape で運ぶのをやめられる（掴んだまま戻れない、を作らない）", () => {
    withAsset();
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    stubRect(container.querySelector(".preview-stage")!, { left: 0, top: 0, width: 640, height: 360 });
    grab(screen.getByRole("button", { name: "文字を置く" }));
    moveTo(300, 180);
    expect(container.querySelector(".drag-ghost")).not.toBeNull(); // 運んでいる影が出ている
    fireEvent.keyDown(window, { key: "Escape" });
    expect(container.querySelector(".drag-ghost")).toBeNull();
    dropAt(300, 180);
    expect(useTimelineStore.getState().doc!.clips).toHaveLength(0); // 置かれない
  });

  it("押しただけ（動かさずに離す）でも置ける＝運べない人の逃げ道", () => {
    withAsset();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const btn = screen.getByRole("button", { name: "文字を置く" });
    grab(btn);
    dropAt(0, 0); // 動かしていないので、離した場所は関係ない
    expect(useTimelineStore.getState().doc!.clips).toHaveLength(1);
  });

  it("キーボードでも置ける（ドラッグ専用の操作を作らない・決定19）", () => {
    withAsset();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    // キーボードで起こした `click` は押した回数が 0（マウスは 1 以上）。
    fireEvent.click(screen.getByRole("button", { name: "文字を置く" }), { detail: 0 });
    expect(useTimelineStore.getState().doc!.clips).toHaveLength(1);
  });

  it("運んで置いたあと、マウスの click が来ても二重に置かない", () => {
    withAsset();
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    stubRect(container.querySelector(".preview-stage")!, { left: 0, top: 0, width: 640, height: 360 });
    const btn = screen.getByRole("button", { name: "文字を置く" });
    grab(btn);
    moveTo(300, 180);
    dropAt(300, 180);
    fireEvent.click(btn, { detail: 1 }); // 掴んだ指がボタンの上へ戻って離れた場合に来る
    expect(useTimelineStore.getState().doc!.clips).toHaveLength(1);
  });

  it("Escape で中止した直後に click が来ても置かない", () => {
    withAsset();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const btn = screen.getByRole("button", { name: "文字を置く" });
    grab(btn);
    moveTo(300, 180);
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.click(btn, { detail: 1 }); // 中止しても、指を離せば click は来る
    expect(useTimelineStore.getState().doc!.clips).toHaveLength(0);
  });

  it("運んで置いた次も、押す・キーボードのどちらでも置ける（1回効かない、を作らない）", () => {
    withAsset();
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    stubRect(container.querySelector(".preview-stage")!, { left: 0, top: 0, width: 640, height: 360 });
    const btn = screen.getByRole("button", { name: "文字を置く" });
    // 運んで仕上がり確認へ落とす＝ボタンの上では離していないので `click` は来ない。
    grab(btn);
    moveTo(300, 180);
    dropAt(300, 180);
    expect(useTimelineStore.getState().doc!.clips).toHaveLength(1);
    grab(btn); dropAt(0, 0); // 押しただけ
    expect(useTimelineStore.getState().doc!.clips).toHaveLength(2);
    fireEvent.click(btn, { detail: 0 }); // キーボード
    expect(useTimelineStore.getState().doc!.clips).toHaveLength(3);
  });

  it("間の空きを飛び越さない（いちばん後ろの部品の終わりへ飛ばさない・#684 レビュー）", () => {
    // [0,3) と [10,15)。5秒ぶんは [3,10) の空きに収まるので、そこへ置く（15 ではない）。
    // ⚠️ **素材で確かめる**（#1252）＝文字は塞がっていると手前へ重ねるので、この規則を通らない。
    withAsset({
      clips: [
        { id: "clip_001", trackId: "track_001", kind: TIMELINE_CLIP_KIND.text, startSec: 0, durationSec: 3, text: "あ" },
        { id: "clip_002", trackId: "track_001", kind: TIMELINE_CLIP_KIND.text, startSec: 10, durationSec: 5, text: "い" },
      ],
    });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getAllByRole("button", { name: "会社の外観" })[0]!);
    const clips = useTimelineStore.getState().doc!.clips;
    expect(clips).toHaveLength(3);
    expect(clips[2]).toMatchObject({ startSec: 3, durationSec: 5 });
  });

  it("置ける列が固定・非表示だけなら置かない（動画に出ない部品を黙って作らない）", () => {
    withAsset({ tracks: [{ id: "track_001", kind: TRACK_KIND.visual, hidden: true }] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getByText(/置ける映像の列がありません/)).toBeInTheDocument();
  });

  it("隠した列は置き先に選ばない（見えている列へ置く）", () => {
    withAsset({
      tracks: [
        { id: "track_001", kind: TRACK_KIND.visual },          // 奥・見えている
        { id: "track_003", kind: TRACK_KIND.visual, hidden: true }, // 手前だが隠してある
      ],
    });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "文字を置く" }));
    // 手前から探すが、隠した列は飛ばす（置いても動画に出ないため）。
    expect(useTimelineStore.getState().doc!.clips[0].trackId).toBe("track_001");
  });
});
