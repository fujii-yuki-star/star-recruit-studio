// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { useProjectStore } from "../store/projectStore";
import { sampleTemplates } from "../../infrastructure/sampleData";
import type { Scene } from "../../domain/project/types";
import { TimelineEditScreen } from "./TimelineEditScreen";

// ADR-0023 段階(1)：再生ヘッド＋クリックシーク。時間軸で選んだ瞬間を、その場で絵として確かめられるようにする。
// ここは**静止フレーム**（連続再生は段階(2)）。中身の解決は場面編集・書き出しと同じ共有関数を通すので、
// このテストは「時間軸→場面の橋渡しが画面に配線されているか」を見る（解決そのものは domain 側で担保）。
const scene = (id: string, order: number, over: Partial<Scene> = {}): Scene =>
  ({
    sceneId: id, partId: "part_001", order, sceneType: "photo_intro",
    templateId: "photo_left_text_right_yuko_v1",
    durationSec: 8, assetRefs: {}, character: { enabled: false, characterId: "yuko" },
    texts: {}, narration: { text: "", status: "none" }, warnings: [], ...over,
  }) as Scene;

/** ルーラー（時間の目盛り）＝シークの受け口。 */
const ruler = () => screen.getByRole("slider", { name: "再生位置" });
const playhead = () => screen.getByTestId("timeline-playhead");
/** 仕上がりプレビュー側の文字だけを引く（タイムラインの帯にも同じ文言が出るため）。 */
const previewText = (text: string) => within(screen.getByLabelText("場面の仕上がり")).queryByText(text);

/** ルーラーの左端からの px でクリック（jsdom は幅0なので left=0 とみなせる＝x=px がそのまま秒×倍率）。 */
function seekPx(px: number): void {
  fireEvent.click(ruler(), { clientX: px });
}

describe("TimelineEditScreen 再生ヘッド（ADR-0023 (1)・#329）", () => {
  beforeEach(() => {
    useProjectStore.getState().setExportRun({ phase: "idle" });
    useProjectStore.setState({
      templates: sampleTemplates,
      parts: [{ partId: "part_001", title: "パート1", order: 1, sceneIds: ["scene_001", "scene_002"] }],
      // 場面1（0-8秒）＝見出し「まえ」／場面2（8-16秒）＝見出し「あと」。どちらが映っているかで判別する。
      scenes: [
        scene("scene_001", 1, { texts: { title: "まえ" } }),
        scene("scene_002", 2, { texts: { title: "あと" } }),
      ],
      assets: [],
      meta: { ...useProjectStore.getState().meta, timelineOverlay: undefined },
      past: [], future: [], _historyGroupDepth: 0, status: "ready", saveStatus: "saved",
    });
  });

  it("最初は先頭（0秒）を指し、その場面の仕上がりが出る", () => {
    render(<TimelineEditScreen onNavigate={vi.fn()} />);
    expect(playhead()).toHaveStyle({ left: "calc(var(--timeline-label-w) + 0px)" });
    expect(previewText("まえ")).toBeInTheDocument();
    expect(previewText("あと")).toBeNull();
  });

  it("目盛りを押すとヘッドがそこへ移り、その時間の場面に切り替わる", () => {
    render(<TimelineEditScreen onNavigate={vi.fn()} />);
    // 既定ズーム 36px/秒。360px＝10秒＝場面2（8-16秒）の2秒目。
    seekPx(360);
    expect(playhead()).toHaveStyle({ left: "calc(var(--timeline-label-w) + 360px)" });
    expect(previewText("あと")).toBeInTheDocument();
    expect(previewText("まえ")).toBeNull();
  });

  it("動画の範囲の外を押しても端で止まる（負・尺超え）", () => {
    render(<TimelineEditScreen onNavigate={vi.fn()} />);
    seekPx(-100);
    expect(playhead()).toHaveStyle({ left: "calc(var(--timeline-label-w) + 0px)" });
    seekPx(99999);
    // 合計16秒＝576px で頭打ち（尺を超えた位置に線が飛び出さない）。
    expect(playhead()).toHaveStyle({ left: "calc(var(--timeline-label-w) + 576px)" });
    expect(previewText("あと")).toBeInTheDocument();
  });

  // 動画が短くなったら、ヘッドも時計もその中に収まる（PR #624 レビュー 🟡）。
  // この画面の「取り消す」は ADR-0020 の履歴（meta/parts/**scenes**）を丸ごと戻すので、別画面で伸ばした場面尺を
  // ここから取り消すと合計尺が縮む。画面は再マウントされないため、ヘッドだけ**存在しない時刻**に残り得た。
  it("動画が短くなったら、ヘッドと時計は新しい末尾へ収まる", () => {
    render(<TimelineEditScreen onNavigate={vi.fn()} />);
    seekPx(504); // 14秒＝場面2の中
    expect(screen.getByText("14秒")).toBeInTheDocument();

    // 場面2が消える（＝場面追加の取り消し相当）。合計 16秒 → 8秒。
    act(() => {
      useProjectStore.setState({
        parts: [{ partId: "part_001", title: "パート1", order: 1, sceneIds: ["scene_001"] }],
        scenes: [scene("scene_001", 1, { texts: { title: "まえ" } })],
      });
    });
    expect(playhead()).toHaveStyle({ left: "calc(var(--timeline-label-w) + 288px)" }); // 8秒＝288px
    expect(screen.getByText("8秒")).toBeInTheDocument(); // 存在しない時刻を出し続けない
    expect(previewText("まえ")).toBeInTheDocument();
  });

  it("選んだ時間を時計表示で示す（どこを見ているかが分かる）", () => {
    render(<TimelineEditScreen onNavigate={vi.fn()} />);
    seekPx(360);
    expect(screen.getByText("10秒")).toBeInTheDocument();
  });

  // マウスが使えなくてもヘッドを動かせる（PR #624 レビュー ℹ️）。位置を持つ操作なので役割は slider＝
  // 読み上げに現在位置が伝わり、矢印キーが効く。
  it("キーボードでもヘッドを動かせる（←→ で1秒・Home/End で端へ）", () => {
    render(<TimelineEditScreen onNavigate={vi.fn()} />);
    expect(ruler()).toHaveAttribute("aria-valuemax", "16");
    expect(ruler()).toHaveAttribute("aria-valuenow", "0");

    fireEvent.keyDown(ruler(), { key: "ArrowRight" });
    expect(ruler()).toHaveAttribute("aria-valuenow", "1");
    expect(ruler()).toHaveAttribute("aria-valuetext", "0:01");

    fireEvent.keyDown(ruler(), { key: "ArrowLeft" });
    fireEvent.keyDown(ruler(), { key: "ArrowLeft" }); // 0 より手前へは行かない
    expect(ruler()).toHaveAttribute("aria-valuenow", "0");

    fireEvent.keyDown(ruler(), { key: "End" });
    expect(ruler()).toHaveAttribute("aria-valuenow", "16");
    expect(previewText("あと")).toBeInTheDocument(); // 末尾＝場面2

    fireEvent.keyDown(ruler(), { key: "Home" });
    expect(ruler()).toHaveAttribute("aria-valuenow", "0");
    expect(previewText("まえ")).toBeInTheDocument();
  });

  // 場面が切り替わるだけなら「場面の頭を出しているだけ」でも通ってしまう。
  // **場面の中のどの瞬間か**まで渡っていることを、掛け合いの字幕が時間で入れ替わることで固定する
  // （字幕の解決は書き出しと同じ `sceneSegmentSpecs` 経由＝#563/ADR-0029）。
  it("場面の中でも、その時間のセリフの字幕が出る（頭出しではない）", () => {
    useProjectStore.setState({
      parts: [{ partId: "part_001", title: "パート1", order: 1, sceneIds: ["scene_001"] }],
      scenes: [
        scene("scene_001", 1, {
          texts: {},
          lines: [
            { lineId: "line_001", text: "いちばん", subtitleText: "いちばん", status: "none" },
            { lineId: "line_002", text: "にばんめ", subtitleText: "にばんめ", startSec: 4, status: "none" },
          ],
        } as Partial<Scene>),
      ],
    });
    render(<TimelineEditScreen onNavigate={vi.fn()} />);
    // 先頭（0秒）＝1行目の字幕。
    expect(previewText("いちばん")).toBeInTheDocument();
    expect(previewText("にばんめ")).toBeNull();
    // 5秒（180px）＝2行目の区間へ入る＝字幕が入れ替わる。
    seekPx(180);
    expect(previewText("にばんめ")).toBeInTheDocument();
    expect(previewText("いちばん")).toBeNull();
  });

  // 上のケースは「有効行」の配線を見る。**字幕の区間**（`sceneSegmentSpecs` 由来＝書き出しと同じ経路・ADR-0029）は
  // 自由配置の字幕要素で効くので、そちらも時間で入れ替わることを別に固定する（片方だけ渡し忘れても気づけるように）。
  it("自由配置の字幕も、その時間の区間で入れ替わる（書き出しと同じ経路）", () => {
    useProjectStore.setState({
      parts: [{ partId: "part_001", title: "パート1", order: 1, sceneIds: ["scene_001"] }],
      scenes: [
        scene("scene_001", 1, {
          sceneType: "free",
          templateId: "free_canvas_v1",
          texts: {},
          freeLayout: [{ id: "free_001", kind: "subtitle", x: 100, y: 800, w: 1000, h: 120, fontSize: 48 }],
          lines: [
            { lineId: "line_001", text: "まえのせりふ", subtitleText: "まえの字幕", status: "none" },
            { lineId: "line_002", text: "あとのせりふ", subtitleText: "あとの字幕", startSec: 4, status: "none" },
          ],
        } as unknown as Partial<Scene>),
      ],
    });
    render(<TimelineEditScreen onNavigate={vi.fn()} />);
    expect(previewText("まえの字幕")).toBeInTheDocument();
    seekPx(180); // 5秒＝2行目の区間
    expect(previewText("あとの字幕")).toBeInTheDocument();
    expect(previewText("まえの字幕")).toBeNull();
  });

  // タイムラインに置いたテロップも、その表示時間のあいだだけ絵に出る（＝ヘッドで出方を確かめられる）。
  it("テロップは表示時間のあいだだけ仕上がりに出る", () => {
    useProjectStore.setState({
      meta: {
        ...useProjectStore.getState().meta,
        timelineOverlay: { clips: [{ id: "ovclip_001", track: "telop", startSec: 2, durationSec: 3, text: "ここがポイント" }] },
      },
    });
    render(<TimelineEditScreen onNavigate={vi.fn()} />);
    expect(previewText("ここがポイント")).toBeNull(); // 0秒＝まだ出ない
    seekPx(108); // 3秒＝表示時間の中
    expect(previewText("ここがポイント")).toBeInTheDocument();
    seekPx(288); // 8秒＝表示時間の外
    expect(previewText("ここがポイント")).toBeNull();
  });

  // 3つ目の配線＝**動き（キーフレーム）の時刻**。ここが渡っていないと、動きのある場面は
  // どの時間を選んでも同じ絵（0秒の姿）になる。ヘッドの意味が消えるので別に固定する。
  it("動きのある要素は、その時間の位置で描かれる（0秒の姿で固まらない）", () => {
    useProjectStore.setState({
      parts: [{ partId: "part_001", title: "パート1", order: 1, sceneIds: ["scene_001"] }],
      scenes: [
        scene("scene_001", 1, {
          sceneType: "free",
          templateId: "free_canvas_v1",
          texts: {},
          freeLayout: [{ id: "free_001", kind: "shape", x: 100, y: 100, w: 200, h: 200, shapeType: "rect", fillColor: "#ff0000" }],
        } as unknown as Partial<Scene>),
      ],
      meta: {
        ...useProjectStore.getState().meta,
        timelineOverlay: {
          animations: [{
            id: "anim_001", sceneId: "scene_001", targetId: "free_001",
            keyframes: [{ timeSec: 0, x: 0 }, { timeSec: 4, x: 200 }],
          }],
        },
      },
    });
    render(<TimelineEditScreen onNavigate={vi.fn()} />);
    const svg = () => (screen.getByLabelText("場面の仕上がり") as HTMLElement).innerHTML;
    expect(svg()).toContain('x="100"'); // 0秒＝本来の位置
    seekPx(144); // 4秒＝+200 動いた先
    expect(svg()).toContain('x="300"');
    expect(svg()).not.toContain('x="100"');
  });
});
