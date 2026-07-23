import { beforeEach, describe, expect, it, vi } from "vitest";

// #547 P2-6：「全場面の声を作成」の中止。中止は「これ以上作らない」だけで、できた声は取り消さない。
// 合成（VOICEVOX/Mock）を差し替えて開始件数と状態遷移を観測する。voiceFs/projectFs はディスクI/O回避のためモック。
vi.mock("../../infrastructure/voiceFs", () => ({
  importVoiceFile: vi.fn(async (_projectId: string, stem: string) => `voices/${stem}.wav`),
  readVoiceDataUrl: vi.fn(async () => null),
}));
vi.mock("../../infrastructure/projectFs", () => ({
  saveProjectDoc: vi.fn(async () => {}),
  listProjectSummaries: vi.fn(async () => []),
  setLastProjectId: vi.fn(),
  getLastProjectId: vi.fn(() => null),
  clearLastProjectId: vi.fn(),
  deleteProjectDoc: vi.fn(),
  loadProjectDoc: vi.fn(async () => ""),
}));

import { useProjectStore } from "./projectStore";
import { MockVoiceProvider } from "../../infrastructure/voiceProviders/mockVoiceProvider";
import { NARRATION_BULK_CONCURRENCY } from "../../domain/constants";
import { isNarrationGenerating } from "../../domain/voice/narrationProgress";
import * as persistence from "../../domain/project/persistence";
import { PROJECT_SCHEMA_VERSION } from "../../domain/project/persistence";
import type { Scene } from "../../domain/project/types";

const scene = (id: string, order: number): Scene => ({
  sceneId: id, partId: "part_001", order, sceneType: "photo_intro", templateId: "t",
  durationSec: 8, assetRefs: {}, character: { enabled: false, characterId: "yuko" },
  texts: {}, narration: { text: `セリフ${order}`, status: "none" }, warnings: [],
});
/** 保留中のマイクロタスクを流し、gate された await 手前まで進める。 */
const flush = () => new Promise((r) => setTimeout(r, 0));

/** 合成を「呼ばれた回数を数え、手動で解決できる」形にする。 */
function gatedSynth() {
  const resolvers: Array<(v: { audioDataUrl: string; durationSec: number }) => void> = [];
  let started = 0; // 解決済みも数える（resolvers は解決時に空になるので別に持つ）
  vi.spyOn(MockVoiceProvider.prototype, "synthesize").mockImplementation(
    () =>
      new Promise((resolve) => {
        started += 1;
        resolvers.push(resolve);
      }),
  );
  return {
    /** これまでに開始した合成の累計。 */
    get started() { return started; },
    /** 開始済みの合成をすべて成功させる。 */
    resolveAll() {
      const pending = resolvers.splice(0, resolvers.length);
      for (const r of pending) r({ audioDataUrl: "wav", durationSec: 1 });
    },
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  useProjectStore.setState({
    parts: [{ partId: "part_001", title: "p", order: 1, sceneIds: [] }],
    scenes: [scene("scene_001", 1), scene("scene_002", 2), scene("scene_003", 3), scene("scene_004", 4), scene("scene_005", 5)],
    assets: [],
    assetSrcById: {},
    narrationAudioById: {},
    _dirtyAudioKeys: new Set(),
    meta: { ...useProjectStore.getState().meta, projectId: "proj_test" },
    saveStatus: "idle",
    isGeneratingNarration: false,
    narrationCancelled: false,
    exportRun: { ...useProjectStore.getState().exportRun, phase: "idle" },
    past: [],
    future: [],
  });
});

describe("声の一括作成：同時実行を絞る（#547 P2-6）", () => {
  it("全件を一度に投げず、同時に走る合成は上限まで＝待機列が残るので中止が効く", async () => {
    const synth = gatedSynth();
    void useProjectStore.getState().generateAllNarrations();
    await flush();
    // 5場面あっても走るのは上限まで。全件同時だと「まだ始まっていない仕事」が無く中止が効かない（ADR-0026④）。
    expect(synth.started).toBe(NARRATION_BULK_CONCURRENCY);
    expect(synth.started).toBeLessThan(5);
  });
});

describe("声の一括作成：中止（#547 P2-6）", () => {
  it("中止すると残りの合成を始めない（開始済みのぶんだけで止まる）", async () => {
    const synth = gatedSynth();
    const run = useProjectStore.getState().generateAllNarrations();
    await flush();
    const startedBeforeCancel = synth.started;

    useProjectStore.getState().cancelNarrationGeneration();
    synth.resolveAll(); // 開始済みは完了させる
    await run;
    await flush();

    expect(synth.started).toBe(startedBeforeCancel); // 中止後に新しい合成は始まっていない
    expect(startedBeforeCancel).toBeLessThan(5);
  });

  it("中止しても、できあがった声は残る（作った音声を捨てない）", async () => {
    const synth = gatedSynth();
    const run = useProjectStore.getState().generateAllNarrations();
    await flush();
    // 期待値は「中止までに始まった数」で持つ。定数と突き合わせると、同時実行数を場面数以上に変えたときに
    // 「中止で失う物が無い」構成になっても数字だけ一致して緑のままになる（構成頼みのテストにしない）。
    const startedBeforeCancel = synth.started;
    expect(startedBeforeCancel).toBeGreaterThan(0);

    useProjectStore.getState().cancelNarrationGeneration();
    synth.resolveAll();
    await run;
    await flush();

    const generated = useProjectStore.getState().scenes.filter((s) => s.narration.status === "generated");
    expect(generated.length).toBe(startedBeforeCancel);
    // 生成した音声はメモリにも残る（次の保存で書き出される）。
    expect(Object.keys(useProjectStore.getState().narrationAudioById).length).toBe(startedBeforeCancel);
  });

  it("中止で「準備中」が残らない＝進捗が固まらず、書き出しのブロックも解ける", async () => {
    const synth = gatedSynth();
    const run = useProjectStore.getState().generateAllNarrations();
    await flush();

    useProjectStore.getState().cancelNarrationGeneration();
    // 中止した直後に、待機列に残っていた場面が pending のまま残っていない。
    expect(useProjectStore.getState().scenes.some((s) => s.narration.status === "pending")).toBe(false);

    synth.resolveAll();
    await run;
    await flush();
    expect(useProjectStore.getState().scenes.some((s) => s.narration.status === "pending")).toBe(false);
  });

  it("中止すると作成中フラグが下り、もう一度作成できる（続きから作れる）", async () => {
    const first = gatedSynth();
    const run = useProjectStore.getState().generateAllNarrations();
    await flush();
    useProjectStore.getState().cancelNarrationGeneration();

    expect(useProjectStore.getState().isGeneratingNarration).toBe(false);
    expect(useProjectStore.getState().narrationCancelled).toBe(true);

    first.resolveAll();
    await run;
    await flush();

    // 再開：残りの場面から作り直せる（中止の印も消える）。
    const second = gatedSynth();
    void useProjectStore.getState().generateAllNarrations();
    await flush();
    expect(useProjectStore.getState().narrationCancelled).toBe(false);
    expect(second.started).toBeGreaterThan(0);
  });

  it("掛け合いの場面でも、中止した時点から先の行は合成しない", async () => {
    const dialogue = {
      ...scene("scene_dlg", 1),
      lines: [
        { lineId: "line_001", text: "やあ", status: "none" },
        { lineId: "line_002", text: "どうも", status: "none" },
        { lineId: "line_003", text: "またね", status: "none" },
      ],
    } as unknown as Scene;
    useProjectStore.setState({ scenes: [dialogue] });

    const synth = gatedSynth();
    const run = useProjectStore.getState().generateAllNarrations();
    await flush();
    expect(synth.started).toBe(1); // 行は順に合成する（1行目の合成中）

    useProjectStore.getState().cancelNarrationGeneration();
    synth.resolveAll();
    await run;
    await flush();

    expect(synth.started).toBe(1); // 2行目以降は始めない
    const lines = useProjectStore.getState().scenes[0].lines ?? [];
    expect(lines.map((l) => l.status)).toEqual(["generated", "none", "none"]); // 1行目の声は残る
  });

  it("作成中に新しい文書を作っても「作成中…」で固まらない（打ち切った実行がフラグを持ち去らない）", async () => {
    const synth = gatedSynth();
    const run = useProjectStore.getState().generateAllNarrations();
    await flush();
    expect(useProjectStore.getState().isGeneratingNarration).toBe(true);

    useProjectStore.getState().newProject(); // 文書切替＝実行中の一括作成は打ち切られる
    expect(useProjectStore.getState().isGeneratingNarration).toBe(false);

    synth.resolveAll();
    await run;
    await flush();
    expect(useProjectStore.getState().isGeneratingNarration).toBe(false);
  });

  it("作成中でなければ中止は何もしない（状態を触らない）", () => {
    const before = useProjectStore.getState().scenes;
    useProjectStore.getState().cancelNarrationGeneration();
    expect(useProjectStore.getState().narrationCancelled).toBe(false);
    expect(useProjectStore.getState().scenes).toBe(before);
  });

  it("中止したあとに合成が失敗しても、失敗表示は出さない（頼んでいない失敗を見せない）", async () => {
    const rejects: Array<(e: unknown) => void> = [];
    vi.spyOn(MockVoiceProvider.prototype, "synthesize").mockImplementation(
      () => new Promise((_resolve, reject) => rejects.push(reject)),
    );
    const run = useProjectStore.getState().generateAllNarrations();
    await flush();

    useProjectStore.getState().cancelNarrationGeneration();
    for (const r of rejects) r("合成に失敗しました");
    await run;
    await flush();

    expect(useProjectStore.getState().narrationError).toBeNull();
    // 中止で未作成へ戻した行を「失敗」に書き戻さない（15 §2.1 に無い「未作成→失敗」を作らない）。
    expect(useProjectStore.getState().scenes.some((s) => s.narration.status === "failed")).toBe(false);
  });
});

describe("誰も作っていない「準備中」を残さない（#547 P2-6）", () => {
  it("取り消すで「準備中」入りの履歴が戻っても、準備中は復活しない", async () => {
    const synth = gatedSynth();
    const run = useProjectStore.getState().generateAllNarrations();
    await flush();
    // 作成中に別の編集をする＝pending 入りのスナップショットが履歴に積まれる。
    useProjectStore.getState().pushHistory();
    useProjectStore.setState({ scenes: useProjectStore.getState().scenes.slice(0, 4) });

    useProjectStore.getState().cancelNarrationGeneration();
    synth.resolveAll();
    await run;
    await flush();

    useProjectStore.getState().undo();
    expect(useProjectStore.getState().scenes.some((s) => s.narration.status === "pending")).toBe(false);
    // 復活しないので書き出しのブロックも解けたまま。
    expect(isNarrationGenerating(useProjectStore.getState().scenes)).toBe(false);
  });

  it("前回の合成中に閉じた文書を読み込んでも、準備中は復元しない", async () => {
    // 保存済みデータに pending が混ざっている状況を projectFs のモックで作る。
    const doc = {
      schemaVersion: PROJECT_SCHEMA_VERSION,
      meta: { projectId: "proj_loaded", projectName: "読込テスト" },
      assets: [],
      parts: [{ partId: "part_001", title: "p", order: 1, sceneIds: ["scene_001", "scene_002"] }],
      scenes: [scene("scene_001", 1), { ...scene("scene_002", 2), narration: { text: "セリフ2", status: "pending" } }],
    };
    vi.spyOn(persistence, "parseProjectDoc").mockReturnValue(doc as never);
    vi.spyOn(persistence, "projectHeaderFromProject").mockReturnValue({
      ...useProjectStore.getState().meta,
      projectId: "proj_loaded",
    });

    await useProjectStore.getState().loadProject("proj_loaded");

    expect(useProjectStore.getState().scenes.some((s) => s.narration.status === "pending")).toBe(false);
    expect(isNarrationGenerating(useProjectStore.getState().scenes)).toBe(false);
  });

  it("中止した実行の後始末が、後から始めた実行の「作成中」を消さない", async () => {
    const first = gatedSynth();
    const run = useProjectStore.getState().generateAllNarrations();
    await flush();
    useProjectStore.getState().cancelNarrationGeneration();

    // 中止直後に作り直す（前の実行はまだ合成待ち）。
    void useProjectStore.getState().generateAllNarrations();
    await flush();
    expect(useProjectStore.getState().isGeneratingNarration).toBe(true);

    first.resolveAll(); // 前の実行がここで終わる
    await run;
    await flush();
    // 前の実行の finally が、後の実行の「作成中」を落としていないこと。
    expect(useProjectStore.getState().isGeneratingNarration).toBe(true);
  });
});
