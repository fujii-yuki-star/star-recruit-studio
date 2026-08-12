// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useProjectStore } from "../store/projectStore";
import * as ffmpeg from "../../infrastructure/ffmpegExport";
import { sampleTemplates } from "../../infrastructure/sampleData";
import type { Scene } from "../../domain/project/types";
import { PrecheckScreen } from "./PrecheckScreen";

// #547 P2-5：公開前チェックの主ボタンは、**書き出しが必ず失敗する項目**が残っているときは押せないようにする。
// 従来は H.264 非対応のときだけ無効で、見た目欠け・動画配置不可・再生タイミングでも押せてしまい、
// 保存先を選ばせた後に §2-5 エラーで落ちていた（手戻りが大きい・ADR-0026④）。
// 「直せば良くなる」警告（声が未作成・字幕が長い）では止めない＝出せるのに押せない、を作らない。
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
    autoGenerateIfSafe: vi.fn(async () => {}), // 画面 mount の自動生成は本テストの対象外
  });
};

const cta = (): HTMLButtonElement => screen.getByText("このまま書き出す").closest("button") as HTMLButtonElement;

describe("PrecheckScreen 書き出しを止める項目では主ボタンを押せない（#547 P2-5）", () => {
  let origAuto: () => Promise<void>;
  beforeEach(() => {
    origAuto = useProjectStore.getState().autoGenerateIfSafe;
  });
  afterEach(() => {
    useProjectStore.setState({ autoGenerateIfSafe: origAuto });
    vi.restoreAllMocks();
  });

  it("見た目が見つからない場面があると「このまま書き出す」が押せず、理由と次の行動を出す", () => {
    setup([scene({ templateId: "missing_tmpl" })]);
    render(<PrecheckScreen onNavigate={vi.fn()} />);
    expect(cta().disabled).toBe(true);
    // 原因（どの項目か）＋次の行動（上の「直す」から直す）を示す（§2-5）。
    const note = screen.getByText(/動画を書き出せない項目があります/);
    expect(note.textContent).toContain("場面の見た目");
    expect(note.textContent).toContain("直す");
  });

  it("問題が無ければ「このまま書き出す」は押せる（理由も出さない）", () => {
    setup([scene()]);
    render(<PrecheckScreen onNavigate={vi.fn()} />);
    expect(cta().disabled).toBe(false);
    expect(screen.queryByText(/動画を書き出せない項目があります/)).toBeNull();
  });

  // この端末で書き出せない（H.264 非対応）ときは端末要因を優先して出す。jsdom は canExport()=false で
  // capability が null 固定＝この分岐に構造的に到達できないため、明示的にモックして分岐の優先順位を固定する。
  it("この端末で書き出せない場合は端末側の理由を優先し、項目側の文言は重ねて出さない", async () => {
    vi.spyOn(ffmpeg, "canExport").mockReturnValue(true);
    vi.spyOn(ffmpeg, "detectH264Capability").mockResolvedValue("unavailable");
    setup([scene({ templateId: "missing_tmpl" })]); // 項目側の blocker も**同時に**成立させる
    render(<PrecheckScreen onNavigate={vi.fn()} />);
    // ⚠️ 待つのは**端末側の文言そのもの**（#752 で発覚）。「押せない」だけを待つと、項目側の理由で
    // 最初の描画から真なので**届く前に通り抜け**、混んでいるときだけ項目側の文言を読んで落ちる
    //（待っている条件と確かめたいことが別物＝間違った理由で緑になるテスト）。
    expect(await screen.findByText(/この端末では動画を保存できません/)).toBeTruthy();
    expect(cta().disabled).toBe(true);
    expect(screen.queryByText(/動画を書き出せない項目があります/)).toBeNull(); // 二重に出さない
  });

  // #547：見た目が見つからない場面は自動置換しない（黙って中身が減った動画を出さない）。
  // 代わりに「まとめて標準にする」を**利用者の明示操作**として出し、押せば書き出せるようになる。
  it("「まとめて標準にする」で見た目欠けが解消し、書き出せるようになる", () => {
    setup([scene({ templateId: "missing_tmpl" })]);
    render(<PrecheckScreen onNavigate={vi.fn()} />);
    expect(cta().disabled).toBe(true);

    fireEvent.click(screen.getByText("まとめて標準にする"));
    expect(cta().disabled).toBe(false); // 解消＝書き出しへ進める
    expect(screen.queryByText(/動画を書き出せない項目があります/)).toBeNull();
  });

  // 件数だけ出すと、写真が外れた場面に気づけないまま「チェックOK」で書き出せてしまう（#547 が防ぎたい失敗）。
  it("動画に出なくなった中身のある場面を名指しし、元に戻せる", () => {
    setup([scene({ templateId: "missing_tmpl", assetRefs: { layer_001: "asset_001" } })]);
    render(<PrecheckScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByText("まとめて標準にする"));

    const note = screen.getByRole("status");
    expect(note.textContent).toContain("1個の場面を標準の見た目にしました");
    expect(note.textContent).toContain("場面1"); // どの場面か
    expect(note.textContent).toContain("入れ直してください"); // 次の行動（§2-5）

    fireEvent.click(screen.getByText("取り消す")); // 押した画面で取り消せる
    expect(useProjectStore.getState().scenes[0].templateId).toBe("missing_tmpl");
    expect(useProjectStore.getState().scenes[0].assetRefs.layer_001).toBe("asset_001"); // 写真も戻る
  });

  // この画面の「声を作成」は履歴を積まない（narration.status を直接書く）。その後に undo() すると
  // 見た目だけでなく**声の作成まで巻き戻る**ので、場面が変わったら「元に戻す」は引っ込める。
  it("適用後に別の編集が入ったら「取り消す」を出さない（無関係な編集を巻き戻さない）", () => {
    setup([scene({ templateId: "missing_tmpl" })]);
    render(<PrecheckScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByText("まとめて標準にする"));
    expect(screen.getByText("取り消す")).toBeTruthy();

    // 「声を作成」相当＝履歴を積まずに scenes を差し替える。
    const cur = useProjectStore.getState().scenes;
    act(() => {
      useProjectStore.setState({
        scenes: [{ ...cur[0], narration: { ...cur[0].narration, status: "generated" } }],
      });
    });
    expect(screen.queryByText("取り消す")).toBeNull(); // 引っ込む
    expect(screen.getByRole("status")).toBeTruthy(); // 結果の説明自体は残る
  });

  it("割り当てが外れなければ余計な注意は出さない（件数だけ伝える）", () => {
    setup([scene({ templateId: "missing_tmpl" })]);
    render(<PrecheckScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByText("まとめて標準にする"));
    const note = screen.getByRole("status");
    expect(note.textContent).toContain("1個の場面を標準の見た目にしました");
    expect(note.textContent).not.toContain("入れ直してください");
  });

  it("当てる標準が無いときは「まとめて標準にする」を押せない（押しても何も起きない、を作らない）", () => {
    setup([scene({ templateId: "missing_tmpl" })]);
    useProjectStore.setState({ templates: [] }); // 同梱テンプレが無い＝当て先なし
    render(<PrecheckScreen onNavigate={vi.fn()} />);
    expect((screen.getByText("まとめて標準にする").closest("button") as HTMLButtonElement).disabled).toBe(true);
  });

  it("声が未作成（直せば良くなる警告）だけなら押せる＝出せるのに止めない", () => {
    setup([scene({ narration: { text: "こんにちは", status: "none" } } as Partial<Scene>)]);
    render(<PrecheckScreen onNavigate={vi.fn()} />);
    // 警告自体は出ている（出ていないと「止めない」の検証が空振りになる）。
    expect(screen.getByText(/声がまだ作成されていません/)).toBeTruthy();
    expect(cta().disabled).toBe(false);
    expect(screen.queryByText(/動画を書き出せない項目があります/)).toBeNull();
  });
});
