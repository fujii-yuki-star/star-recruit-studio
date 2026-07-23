// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ConfirmScreen } from "./ConfirmScreen";
import { useProjectStore } from "../store/projectStore";

// #423：送信前確認（ConfirmScreen）の「キャンセル」戻り先を confirmReturnTo で一般化した挙動を検証する（§2-6・ADR-0014）。
describe("ConfirmScreen キャンセルの戻り先（#423・§2-6）", () => {
  beforeEach(() => {
    useProjectStore.getState().setExportRun({ phase: "idle" }); // newProject のガードを外す
    useProjectStore.getState().newProject();
    useProjectStore.getState().setConfirmReturnTo(null); // テスト間の持ち越しを防ぐ
  });

  it("既定（confirmReturnTo 未設定）はキャンセルでウィザードへ戻る", () => {
    const onNavigate = vi.fn();
    render(<ConfirmScreen onNavigate={onNavigate} />);
    fireEvent.click(screen.getByRole("button", { name: "キャンセル" }));
    expect(onNavigate).toHaveBeenCalledWith("wizard");
  });

  it("confirmReturnTo='draft'（作り直す起点）はキャンセルでたたき台へ戻る", () => {
    useProjectStore.getState().setConfirmReturnTo("draft");
    const onNavigate = vi.fn();
    render(<ConfirmScreen onNavigate={onNavigate} />);
    fireEvent.click(screen.getByRole("button", { name: "キャンセル" }));
    expect(onNavigate).toHaveBeenCalledWith("draft");
  });

  it("マウント時に confirmReturnTo を消費して持ち越さない（一度きりのペイロード）", () => {
    useProjectStore.getState().setConfirmReturnTo("draft");
    render(<ConfirmScreen onNavigate={vi.fn()} />);
    expect(useProjectStore.getState().confirmReturnTo).toBeNull();
  });
});

// #547 P2-8：送信前確認は件数だけでなく**実際に送る文字**を見せる（§2-6）。
// 「個人情報が含まれることがあります。確認を」と促す以上、中身を見られないと確認できない。
describe("ConfirmScreen 送る文字情報の確認（#547 P2-8・§2-6）", () => {
  const imageAsset = (over: Record<string, unknown>) =>
    ({ assetId: "asset_001", assetType: "image", displayName: "社屋.jpg", ...over }) as never;

  beforeEach(() => {
    useProjectStore.getState().setExportRun({ phase: "idle" });
    useProjectStore.getState().newProject();
    useProjectStore.getState().setConfirmReturnTo(null);
  });

  it("説明・タグを持つ素材があれば、開いて実際に送る文字を見られる", () => {
    useProjectStore.setState({
      assets: [imageAsset({ description: "受付前で撮影", aiDescription: "人物1名", tags: ["社員", "受付"] })],
    });
    render(<ConfirmScreen onNavigate={vi.fn()} />);

    // 既定は畳んだ状態＝中身はまだ出さない（一覧を最初から膨らませない）。
    expect(screen.queryByText(/受付前で撮影/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "送る文字情報を確認する" }));

    expect(screen.getByText(/受付前で撮影/)).toBeTruthy(); // 説明
    expect(screen.getByText(/人物1名/)).toBeTruthy();       // AI解析（これも送られる）
    expect(screen.getByText(/社員、受付/)).toBeTruthy();     // タグ
    expect(screen.getByText(/社屋\.jpg/)).toBeTruthy();      // 名前
  });

  it("名前しか無い素材でも、その名前（ファイル名）を1件ずつ見せる（人名入りファイル名の確認・§2-6）", () => {
    // 名前しか無い＝説明もタグも空。件数集約にせず**名前を実値で**出す（「田中さん.jpg」を確認できる）。
    useProjectStore.setState({ assets: [imageAsset({ displayName: "田中さん.jpg", description: "", tags: [] })] });
    render(<ConfirmScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "送る文字情報を確認する" }));
    expect(screen.getByText(/写真：田中さん\.jpg/)).toBeTruthy();
  });

  it("種別を実体どおりのラベルで出す（ロゴ等を「写真」に畳まない・§2-3）", () => {
    useProjectStore.setState({ assets: [imageAsset({ assetType: "logo", displayName: "会社ロゴ.png" })] });
    render(<ConfirmScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "送る文字情報を確認する" }));
    expect(screen.getByText(/ロゴ：会社ロゴ\.png/)).toBeTruthy();
  });

  it("種別・内容の違う素材が混ざっても、それぞれ実値で並べる（写真＝説明つき／動画＝タグつき／名前のみ）", () => {
    useProjectStore.setState({
      assets: [
        imageAsset({ assetId: "a1", displayName: "外観.jpg", description: "本社ビル" }),
        imageAsset({ assetId: "a2", assetType: "video", displayName: "紹介.mp4", tags: ["社員", "受付"] }),
        imageAsset({ assetId: "a3", displayName: "田中さん.jpg", description: "", tags: [] }),
      ],
    });
    render(<ConfirmScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "送る文字情報を確認する" }));
    expect(screen.getByText(/写真：外観\.jpg/)).toBeTruthy();
    expect(screen.getByText(/本社ビル/)).toBeTruthy();
    expect(screen.getByText(/動画：紹介\.mp4/)).toBeTruthy(); // 動画ラベル
    expect(screen.getByText(/社員、受付/)).toBeTruthy();
    expect(screen.getByText(/写真：田中さん\.jpg/)).toBeTruthy(); // 名前のみも1行で
  });

  it("素材が無ければ確認ボタンを出さない（送る文字が無い）", () => {
    useProjectStore.setState({ assets: [] });
    render(<ConfirmScreen onNavigate={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "送る文字情報を確認する" })).toBeNull();
  });

  it("ゆうこ等（写真/動画以外）だけでも要約が矛盾しない（「写真0枚」と出さない・§2-6）", () => {
    useProjectStore.setState({ assets: [imageAsset({ assetType: "yuko", displayName: "ゆうこ_笑顔", tags: ["smile"] })] });
    render(<ConfirmScreen onNavigate={vi.fn()} />);
    expect(screen.getByText(/ほか1件ぶんの文字情報/)).toBeTruthy();
    expect(screen.queryByText(/写真0枚/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "送る文字情報を確認する" }));
    expect(screen.getByText(/ゆうこ：ゆうこ_笑顔/)).toBeTruthy(); // 展開一覧の種別も正しい
  });

  it("送信ボタンを押すと生成へ進む（確認 UI を足しても導線は不変）", () => {
    useProjectStore.setState({ assets: [imageAsset({ description: "x" })] });
    const onNavigate = vi.fn();
    render(<ConfirmScreen onNavigate={onNavigate} />);
    fireEvent.click(screen.getByRole("button", { name: /送信して動画案を作る/ }));
    expect(onNavigate).toHaveBeenCalledWith("generating");
  });
});
