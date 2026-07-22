// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
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
    await waitFor(() => expect(cta().disabled).toBe(true)); // capability は非同期に届く
    expect(screen.getByText(/この端末では動画を保存できません/)).toBeTruthy();
    expect(screen.queryByText(/動画を書き出せない項目があります/)).toBeNull(); // 二重に出さない
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
