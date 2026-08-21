// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useProjectStore } from "../store/projectStore";
import { useExportLockStore } from "../store/exportLock";
import { sampleTemplates } from "../../infrastructure/sampleData";
import * as ffmpeg from "../../infrastructure/ffmpegExport";
import * as dialog from "../../infrastructure/dialog";
import type { Scene } from "../../domain/project/types";
import { ExportScreen } from "./ExportScreen";

// #547 P2-5（後続）：書き出し画面へは**サイドバーから直行**もできるため、公開前チェックの主ボタンを止めるだけでは
// 「保存先を選んだ後に §2-5 エラーで落ちる」手戻りが残る。同じ述語（exportBlockingItems）をこの画面でも使い、
// 押す前に止めて理由と次の行動を出す（ADR-0026②＝どちらの入口でも同じ判定／ADR-0026④＝押せるのに必ず失敗を作らない）。
const scene = (over: Partial<Scene> = {}): Scene =>
  ({
    sceneId: "scene_001", partId: "part_001", order: 1, sceneType: "photo_intro",
    templateId: "photo_left_text_right_yuko_v1", durationSec: 8, assetRefs: {},
    character: { enabled: false, characterId: "yuko" }, texts: {},
    narration: { text: "こんにちは", status: "generated" }, warnings: [],
    ...over,
  }) as Scene;

const setup = (scenes: Scene[]) => {
  useProjectStore.setState({
    templates: sampleTemplates,
    parts: [{ partId: "part_001", title: "パート1", order: 1, sceneIds: scenes.map((s) => s.sceneId) }],
    scenes,
    assets: [],
    status: "ready",
    saveStatus: "saved",
    isImporting: false,
    isTemplateMutating: false,
  });
};

const saveBtn = (): HTMLButtonElement => screen.getByText("動画を保存").closest("button") as HTMLButtonElement;

describe("ExportScreen 書き出せない項目があるときは保存させない（#547 P2-5 後続）", () => {
  beforeEach(() => {
    useProjectStore.getState().setExportRun({ phase: "idle" });
    vi.spyOn(ffmpeg, "canExport").mockReturnValue(true); // jsdom は Tauri 非検出＝canExport false のため真にする
  });
  afterEach(() => {
    vi.restoreAllMocks();
    useProjectStore.getState().setExportRun({ phase: "idle" });
  });

  it("見た目が見つからない場面があると「動画を保存」を押せず、理由と次の行動を出す", () => {
    setup([scene({ templateId: "missing_tmpl" })]);
    render(<ExportScreen onNavigate={vi.fn()} />);
    expect(saveBtn().disabled).toBe(true);
    const note = screen.getByText(/動画を書き出せない項目があります/);
    expect(note.textContent).toContain("場面の見た目"); // どの項目か
    expect(note.textContent).toContain("公開前チェック"); // 次の行動（左の「公開前チェックへ戻る」が導線）
  });

  it("問題が無ければ「動画を保存」は押せる（理由も出さない）", () => {
    setup([scene()]);
    render(<ExportScreen onNavigate={vi.fn()} />);
    expect(saveBtn().disabled).toBe(false);
    expect(screen.queryByText(/動画を書き出せない項目があります/)).toBeNull();
  });

  it("この端末で書き出せない場合も「動画を保存」を押せない（直行経路でも公開前チェックと同じ判定）", async () => {
    vi.spyOn(ffmpeg, "detectH264Capability").mockResolvedValue("unavailable");
    setup([scene()]);
    render(<ExportScreen onNavigate={vi.fn()} />);
    await waitFor(() => expect(saveBtn().disabled).toBe(true)); // 能力検知は非同期
    // 押せないだけでなく**正しい理由**が出る（§2-5＝原因＋次の行動）。文言は正典 EXPORT_CAPABILITY_NOTICE。
    expect(screen.getByText(/この端末では動画を書き出せません/)).toBeTruthy();
    expect(screen.queryByText(/動画を書き出せない項目があります/)).toBeNull(); // 端末要因が優先＝項目側は出さない
  });

  // 抑止条件を phase だけにすると、無関係な失敗が残っている間に blocker ができたとき
  // 「押せないのに理由が出ない（しかも実行できない案内が残る）」になる（レビュー指摘）。
  it("無関係な失敗表示が残っていても、書き出せない項目の理由は出す", () => {
    setup([scene({ templateId: "missing_tmpl" })]);
    useProjectStore.getState().setExportRun({ phase: "error", message: "動画の保存に失敗しました。もう一度お試しください。" });
    render(<ExportScreen onNavigate={vi.fn()} />);
    expect(saveBtn().disabled).toBe(true);
    expect(screen.getByText(/動画を書き出せない項目があります/)).toBeTruthy();
  });

  // ボタンの無効化だけでは beginExport の IPC 往復中に条件が生じた場合を取りこぼす（#570 で作った前後2回チェックの枠組み）。
  it("beginExport の途中で書き出せない状態になっても捕捉して止める（保存先選択後に落とさない）", async () => {
    setup([scene()]);
    vi.spyOn(dialog, "showSaveVideoDialog").mockResolvedValue("/out/movie.mp4");
    let resolveBegin: () => void = () => {};
    const begin = vi.spyOn(ffmpeg, "beginExport").mockReturnValue(new Promise<void>((r) => { resolveBegin = () => r(); }));
    render(<ExportScreen onNavigate={vi.fn()} />);
    fireEvent.click(saveBtn()); // 押した時点では問題なし＝pre チェック通過
    await waitFor(() => expect(begin).toHaveBeenCalled());
    // beginExport 待機中に見た目が解決できなくなる（別画面でマイ見た目を削除した等）。
    useProjectStore.setState({ scenes: [scene({ templateId: "missing_tmpl" })] });
    resolveBegin();
    await waitFor(() => expect(useProjectStore.getState().exportRun.phase).toBe("error"));
    expect(screen.getByText(/動画を書き出せない項目があります/)).toBeTruthy();
    // ⚠️ **走行中の締めを返す**（#817-2）＝この早期 return は `try/finally` の**手前**で抜けるので、
    // 返さないと `owner="scene"` が残り、**タイムライン形式の書き出しが永久に押せなくなる**
    //（「ほかの動画を書き出しています」＝走っていないので終わりようがない案内・§2-5）。
    expect(useExportLockStore.getState().owner).toBeNull();
  });

  // ⚠️ **名乗れなければ始めない**（レビュー ℹ️）＝走行中の判定と名乗りの間に保存先ダイアログの待ちが
  // 挟まるので、その間に相手（タイムライン形式）が先に取りうる。見ないで進むと、共有の一時置き場を
  // 片づける後始末が**相手のフレームを消す**。
  it("名乗れなかったら書き出しを始めない（相手のフレームを消さない）", async () => {
    setup([scene()]);
    vi.spyOn(dialog, "showSaveVideoDialog").mockResolvedValue("/out/movie.mp4");
    const begin = vi.spyOn(ffmpeg, "beginExport").mockResolvedValue(undefined);
    render(<ExportScreen onNavigate={vi.fn()} />);
    // 保存先を選んでいる間に、相手が先に名乗る。
    vi.spyOn(dialog, "showSaveVideoDialog").mockImplementation(async () => {
      useExportLockStore.getState().acquire("timeline");
      return "/out/movie.mp4";
    });
    fireEvent.click(saveBtn());
    await waitFor(() => expect(useProjectStore.getState().exportRun.phase).toBe("error"));
    expect(begin).not.toHaveBeenCalled(); // 始めていない
    expect(useExportLockStore.getState().owner).toBe("timeline"); // 相手の締めを奪っていない
    useExportLockStore.getState().release("timeline");
  });

  // ⚠️ **失敗で抜けるときも返す**＝`beginExport` は IPC なので失敗しうる。返さないと
  // 走っていないのに「ほかの動画を書き出しています」で押せなくなる（終わりようがない案内）。
  it("beginExport が失敗しても、走行中の締めは返す", async () => {
    setup([scene()]);
    vi.spyOn(dialog, "showSaveVideoDialog").mockResolvedValue("/out/movie.mp4");
    vi.spyOn(ffmpeg, "beginExport").mockRejectedValue(new Error("ipc failed"));
    render(<ExportScreen onNavigate={vi.fn()} />);
    fireEvent.click(saveBtn());
    await waitFor(() => expect(useExportLockStore.getState().owner).toBeNull());
    // 黙って終わらない＝理由も出す（失敗が投げっぱなしだと画面は押した直後のまま）。
    expect(useProjectStore.getState().exportRun.phase).toBe("error");
  });
});

// #547 P2-1：% と説明を共有純粋関数へ委譲したので、**渡し間違え**（progress と encode の取り違え等）は
// ドメイン単体テストでは捕まらない。書き出し画面は一次的な表示面なので、描画まで確認する。
describe("ExportScreen 進捗の配線（#547 P2-1）", () => {
  afterEach(() => useProjectStore.getState().setExportRun({ phase: "idle" }));

  it("共有関数の % と「場面 n / N」を実際に描く（バナーと同じ数字）", () => {
    setup([scene()]);
    useProjectStore.setState({
      exportRun: { phase: "rendering", progress: { done: 2, total: 8 }, resultPath: "", message: "", bgmWarning: "", cancelling: false, resultUnseen: false },
    });
    render(<ExportScreen onNavigate={vi.fn()} />);
    expect(screen.getByText("20%")).toBeTruthy();
    expect(screen.getByText("場面 3 / 8 を処理中")).toBeTruthy();
    expect(screen.getByText("動画を書き出しています")).toBeTruthy(); // 見出しは段階で言い分けない
  });
});

// #547 P3-10：場面ゼロは押しても必ず失敗する（startExport が止める）。設定フォームを出して入力させたうえで断るのでなく、
// 上流へ促す空状態で止める（ADR-0026④・仕上がり確認/公開前チェックと同じ流儀＝#403）。
describe("ExportScreen 場面ゼロは空状態（#547 P3-10）", () => {
  afterEach(() => useProjectStore.getState().setExportRun({ phase: "idle" }));

  it("場面が無ければ設定フォームを出さず、上流へ促す空状態にする", () => {
    setup([]); // 場面ゼロ
    render(<ExportScreen onNavigate={vi.fn()} />);
    expect(screen.getByText("まだ場面がありません")).toBeTruthy();
    expect(screen.queryByText("動画を保存")).toBeNull(); // 押せば必ず失敗するボタンを出さない
    expect(screen.queryByLabelText("ファイル名")).toBeNull(); // 入力させてから断る、をしない
    // 設定フォームが無いのに「設定を確認して」と促さない＝次の行動が空状態と食い違わない（§2-5）。
    expect(screen.queryByText(/設定を確認して/)).toBeNull();
  });

  // 走行中の書き出しを空状態で覆い隠すと、進捗と「書き出しを中止」＝編集ロックの唯一の抜け道（15 §4）が消える。
  it("書き出し中は（場面ゼロでも）空状態にせず進捗を出し続ける＝中止できる道を残す", () => {
    setup([]);
    useProjectStore.setState({
      exportRun: { phase: "rendering", progress: { done: 1, total: 2 }, resultPath: "", message: "", bgmWarning: "", cancelling: false, resultUnseen: false },
    });
    render(<ExportScreen onNavigate={vi.fn()} />);
    expect(screen.queryByText("まだ場面がありません")).toBeNull(); // 空状態で覆わない
    expect(screen.getByText("書き出しを中止")).toBeTruthy(); // 抜け道が残っている
  });

  it("場面があれば従来どおり設定フォームを出す", () => {
    setup([scene()]);
    render(<ExportScreen onNavigate={vi.fn()} />);
    expect(screen.queryByText("まだ場面がありません")).toBeNull();
    expect(screen.getByText("動画を保存")).toBeTruthy();
  });
});
