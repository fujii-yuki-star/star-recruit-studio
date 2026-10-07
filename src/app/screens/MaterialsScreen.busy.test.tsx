// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { useProjectStore } from "../store/projectStore";
import { sampleTemplates } from "../../infrastructure/sampleData";
import type { Asset } from "../../domain/project/types";
import { MaterialsScreen } from "./MaterialsScreen";

// #547 P2-1：書き出し中は素材の追加/編集/削除をロックする（store も同 PR でガード＝ここは無言 no-op を避ける表示側・ADR-0026④）。
// pickPanelAsset は先頭素材を自動選択するので、render 直後に右パネル（編集控え）が出る前提でテストする。
const asset = (id: string): Asset => ({ assetId: id, assetType: "image", displayName: id, filePath: `assets/${id}.png` });

const setup = (phase: "idle" | "rendering") => {
  useProjectStore.setState({
    templates: sampleTemplates,
    assets: [asset("asset_001")],
    assetSrcById: { asset_001: "data:image/png;base64,x" },
    scenes: [],
    // 「素材を追加」は**入れる先がある**ときだけ押せる（差分再監査 6巡目）＝動画を開いた状態にしておく。
    status: "ready",
    exportRun: { phase, progress: { done: 0, total: 0 }, resultPath: "", message: "", bgmWarning: "", duckMerged: false, cancelling: false, resultUnseen: false },
  });
};

describe("MaterialsScreen 書き出し中は編集をロック（#547 P2-1・ADR-0026④）", () => {
  afterEach(() => vi.restoreAllMocks());

  it("書き出し中：共通バナー（進捗つき）を出し「素材を追加」を無効化する", () => {
    setup("rendering");
    render(<MaterialsScreen onNavigate={vi.fn()} />);
    expect(screen.getByText(/動画を書き出し中です/)).toBeTruthy();
    const add = screen.getByText("素材を追加").closest("label") as HTMLElement;
    expect(add.getAttribute("aria-disabled")).toBe("true");
  });

  it("書き出し中：選択素材の編集控え（名前欄・削除ボタン）を出さず、代わりに理由を示す", () => {
    setup("rendering");
    render(<MaterialsScreen onNavigate={vi.fn()} />);
    // 右パネルは出る（自動選択）が、編集控えは隠れる＝押しても効かないボタンを残さない（無言 no-op 回避）。
    // 理由はバナーと重複しない文で示す（同じ画面に同じ案内を二度出さない・#547 P2-1 レビュー）。
    expect(screen.getByText("書き出しが終わると、ここで編集できます。")).toBeTruthy();
    expect(screen.getAllByText(/動画を書き出し中です/)).toHaveLength(1); // バナーは1つだけ
    expect(screen.queryByLabelText("名前")).toBeNull();
    expect(screen.queryByText("この素材を削除")).toBeNull();
    // 使用場面は編集ではないので出したまま（情報は見られる）。
    expect(screen.getByText("使用場面")).toBeTruthy();
  });

  it("idle（書き出しでない）：編集控えは通常どおり出る・バナーは無い（対照）", () => {
    setup("idle");
    render(<MaterialsScreen onNavigate={vi.fn()} />);
    expect(screen.queryByText(/動画を書き出し中です/)).toBeNull();
    expect(screen.getByLabelText("名前")).toBeTruthy();
    expect(screen.getByText("この素材を削除")).toBeTruthy();
    expect((screen.getByText("素材を追加").closest("label") as HTMLElement).getAttribute("aria-disabled")).toBe("false");
  });
});

// ⚠️ **入れる先が無いときも押せない**（差分再監査 6巡目 🟡）＝棚からの取り込みだけ塞ぐと、
// 同じ「取り込み」で断り方が2通りになる（ADR-0026②）。判定は共有の1つから採る。
describe("MaterialsScreen 動画を開いていないとき", () => {
  it("「素材を追加」は押せず、理由が出る", () => {
    useProjectStore.setState({
      templates: sampleTemplates, assets: [], assetSrcById: {}, scenes: [], status: "idle",
      meta: { projectId: "", projectName: "" },
      exportRun: { phase: "idle", progress: { done: 0, total: 0 }, resultPath: "", message: "", bgmWarning: "", duckMerged: false, cancelling: false, resultUnseen: false },
    } as never);
    render(<MaterialsScreen onNavigate={vi.fn()} />);
    const label = screen.getByText("素材を追加").closest("label") as HTMLElement;
    expect(label.getAttribute("aria-disabled")).toBe("true");
    expect(label.title).toContain("先に動画を開いてください");
    // ⚠️ **押せないボタンを案内しない**（差分再監査 7巡目 🟡）＝理由はホバーにしか無いので、
    // 空の一覧の案内は**次の行動**（先に動画を開く／新しく作る）を出す。
    expect(screen.getByText(/先に動画を開くか、新しく作ってください/)).toBeInTheDocument();
    expect(screen.queryByText(/「素材を追加」から、写真・動画・ゆうこの素材を登録できます/)).toBeNull();
  });

  it("白紙から作った直後（番号なし・場面なし）は押せる", () => {
    useProjectStore.setState({
      templates: sampleTemplates, assets: [], assetSrcById: {}, scenes: [], status: "ready",
      meta: { projectId: "", projectName: "" },
      exportRun: { phase: "idle", progress: { done: 0, total: 0 }, resultPath: "", message: "", bgmWarning: "", duckMerged: false, cancelling: false, resultUnseen: false },
    } as never);
    render(<MaterialsScreen onNavigate={vi.fn()} />);
    const label = screen.getByText("素材を追加").closest("label") as HTMLElement;
    expect(label.getAttribute("aria-disabled")).toBe("false");
    expect(screen.getByText(/「素材を追加」から、写真・動画・ゆうこの素材を登録できます/)).toBeInTheDocument();
  });
});
