import { beforeEach, describe, expect, it, vi } from "vitest";

// タイムライン形式でも**声をまとめて作れる**（#1019 ⑥）。
//
// ⚠️ **場面形式には前からあった**（`generateAllNarrations`）のに、こちらは**選んだ読み上げ1件ずつ**
// しか無かった＝同じ動画を作るのに、形式で手間が違う（ADR-0026②）。
//
// 合成（VOICEVOX/Mock）を差し替えて開始件数と状態遷移を観測する。ディスクI/Oはモック。
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

import { useTimelineStore } from "./timelineStore";
import { MockVoiceProvider } from "../../infrastructure/voiceProviders/mockVoiceProvider";
import { timelineVoiceProgress, voiceClipNeedsVoice } from "../../domain/timeline/voice";
import { PROJECT_FORMAT, TIMELINE_CLIP_KIND, TRACK_KIND } from "../../domain/enums";
import { TIMELINE_SCHEMA_VERSION } from "../../domain/timeline/types";
import type { TimelineClip, TimelineProject } from "../../domain/timeline/types";

const voiceClip = (id: string, text: string, status = "none"): TimelineClip =>
  ({
    id, kind: TIMELINE_CLIP_KIND.voice, trackId: "track_002", startSec: 0, durationSec: 3,
    voice: { text, status },
  }) as unknown as TimelineClip;

function doc(clips: TimelineClip[]): TimelineProject {
  return {
    schemaVersion: TIMELINE_SCHEMA_VERSION,
    format: PROJECT_FORMAT.timeline,
    projectId: "proj_20260906_001",
    projectName: "テスト",
    createdAt: "2026-09-06T00:00:00.000Z",
    updatedAt: "2026-09-06T00:00:00.000Z",
    videoSettings: { aspectRatio: "16:9", fps: 30, targetDurationSec: 60, maxDurationSec: 600 },
    voiceSettings: { defaultVoiceId: "voicevox_zundamon" },
    assets: [],
    tracks: [{ id: "track_001", kind: TRACK_KIND.visual }, { id: "track_002", kind: TRACK_KIND.audio }],
    clips,
  };
}

/** 合成を「呼ばれた回数を数え、手動で解決できる」形にする（場面形式の検査と同じ流儀）。 */
function gatedSynth() {
  const resolvers: Array<(v: { audioDataUrl: string; durationSec: number }) => void> = [];
  let started = 0;
  vi.spyOn(MockVoiceProvider.prototype, "synthesize").mockImplementation(
    () => new Promise((resolve) => { started += 1; resolvers.push(resolve); }),
  );
  return {
    get started() { return started; },
    resolveAll(durationSec = 1) {
      const pending = resolvers.splice(0, resolvers.length);
      for (const r of pending) r({ audioDataUrl: "wav", durationSec });
    },
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  vi.restoreAllMocks();
  useTimelineStore.setState({
    // ⚠️ **重ならないように並べる**＝同じ列で時間は重ならない（V24）。前は3つとも 0〜3 秒に
    //   置いており**保存できない形**だったので、「長さを合わせる」が**必ず失敗する**状態だった
    //   （成功したときの振る舞いを、この検査は一度も見ていなかった）。
    doc: doc([
      { ...voiceClip("clip_001", "あ"), startSec: 0 } as TimelineClip,
      { ...voiceClip("clip_002", "い"), startSec: 3 } as TimelineClip,
      { ...voiceClip("clip_003", "う"), startSec: 6 } as TimelineClip,
    ]),
    isGeneratingVoices: false,
    voicesCancelled: false,
    _bulkVoiceRun: 0,
    _voiceRun: null,
    generatingVoiceClipId: null,
    voiceError: null,
    exportRun: { phase: "idle", percent: 0, message: null, cancelling: false },
  } as never);
});

describe("まとめて声を作る（#1019 ⑥）", () => {
  it("文のある読み上げをぜんぶ作る", async () => {
    const synth = gatedSynth();
    const run = useTimelineStore.getState().generateAllVoices();
    await flush();
    // ⚠️ **1件ずつ順に回す**＝1件ぶんの経路が `_voiceRun` という1つしかない枠で守られているので、
    //   並列に投げると2件目以降が黙って return する。
    expect(synth.started, "一度に投げている（2件目以降が黙って落ちる）").toBe(1);
    for (let i = 0; i < 4; i += 1) { synth.resolveAll(); await flush(); }
    await run;
    expect(synth.started).toBe(3);
    expect(useTimelineStore.getState().isGeneratingVoices).toBe(false);
    // ⚠️ **ぜんぶ収まったら何も言わない**＝成功に警告を添えない（#1045）。
    expect(useTimelineStore.getState().voiceError, "収まったのに案内を出した").toBeNull();
  });

  // ⚠️ **長さを合わせられなかったぶんの案内は、相手が誰か分かる形で出す**（#1045）＝
  //    1件ずつのときの断りは「選んだ部品」の欄に出すので相手＝いま選んでいる部品だが、
  //    まとめて作ると**選んでいない部品**が相手になる（欄を指すだけでは読めない・§2-5）。
  it("まとめて作って長さを合わせられなかったら、部品の名前を出す", async () => {
    // 後ろに部品を置いて、伸ばすと重なるようにする（V24＝同じ列で時間は重ならない）。
    // ⚠️ **合わせられない部品を「最後に作るもの」にする**＝`commit` は毎回 `editBlocked` を空にするので、
    //   途中の部品で試すと**次の1件が消してしまい**、間違った欄へ出しても緑のまま通る。
    //   いちばん後ろ（`clip_003`）は**作成済み**にして、作る対象から外す（＝重なる相手として置くだけ）。
    useTimelineStore.setState({
      doc: doc([
        { ...voiceClip("clip_001", "あいさつ"), startSec: 0, durationSec: 3 } as TimelineClip,
        { ...voiceClip("clip_002", "しめ"), startSec: 3, durationSec: 3 } as TimelineClip,
        { ...voiceClip("clip_003", "あと", "generated"), startSec: 6, durationSec: 3,
          voice: { text: "あと", status: "generated", voicePath: "voices/clip_003.wav" } } as unknown as TimelineClip,
      ]),
    } as never);
    const synth = gatedSynth();
    const run = useTimelineStore.getState().generateAllVoices();
    await flush();
    synth.resolveAll(1); // 1件目＝収まる
    await flush();
    synth.resolveAll(5); // 2件目＝伸ばすと後ろの部品と重なる
    await flush();
    await run;
    const msg = useTimelineStore.getState().voiceError ?? "";
    expect(msg, "どの部品の話か分からない").toContain("しめ");
    expect(msg, "収まったぶんまで名指しした").not.toContain("あいさつ");
    expect(useTimelineStore.getState().editBlocked, "相手の違う欄へ出した").toBeNull();
  });

  // ⚠️ **文書が入れ替わったら、そちらへは出さない**（PR #1049 レビュー 🔴）＝文書切替は `break` する
  //    だけで世代番号を進めないので、世代だけ見ていると**別の動画へ前の動画の部品名が出る**。
  it("途中で別の動画を開いたら、そちらへ案内を出さない", async () => {
    useTimelineStore.setState({
      doc: doc([
        { ...voiceClip("clip_001", "あいさつ"), startSec: 0, durationSec: 3 } as TimelineClip,
        { ...voiceClip("clip_002", "しめ"), startSec: 3, durationSec: 3 } as TimelineClip,
        { ...voiceClip("clip_003", "あと", "generated"), startSec: 6, durationSec: 3,
          voice: { text: "あと", status: "generated", voicePath: "voices/clip_003.wav" } } as unknown as TimelineClip,
      ]),
    } as never);
    const synth = gatedSynth();
    const run = useTimelineStore.getState().generateAllVoices();
    await flush();
    synth.resolveAll(9); // 1件目＝伸ばすと後ろの部品と重なる（積まれる）
    await flush();
    // 2件目を待っている間に別の動画を開く。
    useTimelineStore.setState({ doc: { ...doc([]), projectId: "proj_20260906_002" } } as never);
    synth.resolveAll(1);
    await flush();
    await run;
    expect(useTimelineStore.getState().voiceError, "別の動画へ前の動画の案内を出した").toBeNull();
  });

  // ⚠️ **1件ずつのときは今までどおり**＝相手＝いま選んでいる部品なので、その欄へ出すのが正しい。
  it("1件ずつのときは「選んだ部品」の欄へ出す", async () => {
    useTimelineStore.setState({
      doc: doc([
        { ...voiceClip("clip_001", "あいさつ"), startSec: 0, durationSec: 3 } as TimelineClip,
        { ...voiceClip("clip_002", "しめ"), startSec: 3, durationSec: 3 } as TimelineClip,
      ]),
      selectedClipIds: ["clip_001"],
    } as never);
    const synth = gatedSynth();
    const run = useTimelineStore.getState().generateSelectedVoice();
    await flush();
    synth.resolveAll(5);
    await flush();
    await run;
    expect(useTimelineStore.getState().editBlocked, "断りが出ていない").not.toBeNull();
    expect(useTimelineStore.getState().voiceError, "1件ずつなのに、まとめての案内を出した").toBeNull();
  });

  // ⚠️ **中止は「これ以上作らない」だけ**＝できた声は取り消さない。
  it("中止すると、次の1件へ進まない", async () => {
    const synth = gatedSynth();
    const run = useTimelineStore.getState().generateAllVoices();
    await flush();
    synth.resolveAll();
    await flush();
    useTimelineStore.getState().cancelVoiceGeneration();
    synth.resolveAll();
    await flush();
    await run;
    expect(synth.started, "中止したのに次の1件を始めた").toBe(2);
    expect(useTimelineStore.getState().voicesCancelled).toBe(true);
    expect(useTimelineStore.getState().isGeneratingVoices).toBe(false);
  });

  it("走っていないときの中止は何もしない", () => {
    useTimelineStore.getState().cancelVoiceGeneration();
    expect(useTimelineStore.getState().voicesCancelled).toBe(false);
  });

  it("連打しても二重に回さない", async () => {
    const synth = gatedSynth();
    const a = useTimelineStore.getState().generateAllVoices();
    const b = useTimelineStore.getState().generateAllVoices();
    await flush();
    expect(synth.started).toBe(1);
    for (let i = 0; i < 4; i += 1) { synth.resolveAll(); await flush(); }
    await Promise.all([a, b]);
    expect(synth.started).toBe(3);
  });

  // ⚠️ **書き出し中は始めない**（作れても文書へ入れられない＝作った声を捨てることになる）。
  it("書き出し中は始めず、理由を出す", async () => {
    const synth = gatedSynth();
    useTimelineStore.setState({ exportRun: { phase: "encoding", percent: 10, message: null, cancelling: false } } as never);
    await useTimelineStore.getState().generateAllVoices();
    expect(synth.started).toBe(0);
    expect(useTimelineStore.getState().voiceError).toBeTruthy();
    // ⚠️ **回そうとしてもいない**ことまで見る＝1件ぶんの経路にも同じ関門があるので、
    //   `started === 0` だけだと**外側の関門を外しても緑**になる（変異チェックで生き残った）。
    expect(useTimelineStore.getState()._bulkVoiceRun, "書き出し中なのに回し始めている").toBe(0);
  });

  // ⚠️ **別の動画の読み上げを作りにいかない**＝作っている間に文書が入れ替わることがある
  //   （一覧から別の動画を開く）。
  it("文書が入れ替わったら止める", async () => {
    const synth = gatedSynth();
    const run = useTimelineStore.getState().generateAllVoices();
    await flush();
    synth.resolveAll();
    await flush();
    // 別の動画を開いた（`projectId` が変わる）。
    // ⚠️ **同じ id の読み上げを持たせる**＝別物の文書にすると、1件ぶんの経路が「その部品が無い」で
    //   早期 return するので、**関門を外しても同じ結果**になる（変異チェックで生き残った）。
    //   番号は文書ごとに採るので、同じ id が別の文書にも居るのが実際の姿。
    useTimelineStore.setState({
      doc: {
        ...doc([voiceClip("clip_001", "あ"), voiceClip("clip_002", "い"), voiceClip("clip_003", "う")]),
        projectId: "proj_20260906_002",
      },
    } as never);
    synth.resolveAll();
    await flush();
    await run;
    expect(synth.started, "別の動画になったのに作り続けた").toBe(2);
  });

  // ⚠️ **始めると前回の中止の印を下ろす**（前の案内を持ち越さない）。
  it("次に始めると、中止の印は下りる", async () => {
    useTimelineStore.setState({ voicesCancelled: true } as never);
    const synth = gatedSynth();
    const run = useTimelineStore.getState().generateAllVoices();
    await flush();
    expect(useTimelineStore.getState().voicesCancelled).toBe(false);
    for (let i = 0; i < 4; i += 1) { synth.resolveAll(); await flush(); }
    await run;
  });
});

// 対象の数え方（純粋関数）。⚠️ **押せるのに何も起きない／終わらない分母**を作らない。
describe("voiceClipNeedsVoice / timelineVoiceProgress（#1019 ⑥）", () => {
  it("文があってまだ作っていないものだけを対象にする", () => {
    expect(voiceClipNeedsVoice(voiceClip("a", "あ"))).toBe(true);
    expect(voiceClipNeedsVoice(voiceClip("a", "あ", "failed")), "失敗は作り直す対象").toBe(true);
    expect(voiceClipNeedsVoice(voiceClip("a", "あ", "generated")), "作成済みを勝手に作り直さない").toBe(false);
    expect(voiceClipNeedsVoice(voiceClip("a", "   ")), "空の文は鳴らない").toBe(false);
  });

  it("読み上げでない部品は対象にしない", () => {
    const text = { id: "t", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 3, text: "あ" } as unknown as TimelineClip;
    expect(voiceClipNeedsVoice(text)).toBe(false);
  });

  // ⚠️ **分母は「文のある読み上げ」**＝空の文を数えると、いつまでも終わらない分母になる。
  it("進み具合は、文のある読み上げだけで数える", () => {
    const clips = [voiceClip("a", "あ", "generated"), voiceClip("b", "い"), voiceClip("c", "   ")];
    expect(timelineVoiceProgress(clips)).toEqual({ done: 1, total: 2 });
  });
});
