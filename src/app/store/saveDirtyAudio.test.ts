import { beforeEach, describe, expect, it, vi } from "vitest";

// #390：保存時に「新規生成された音声だけ」WAV 書き出しし、孤児キャッシュを剪定することを検証する。
// voiceFs（WAV 書き出し）と projectFs（ディスクI/O）をモックして書き出し回数・保存の完了タイミングを制御する。
const h = vi.hoisted(() => ({
  importVoiceFile: vi.fn(async (_projectId: string, stem: string) => `voices/${stem}.wav`),
  saveProjectDoc: vi.fn(async () => {}),
}));
vi.mock("../../infrastructure/voiceFs", () => ({
  importVoiceFile: h.importVoiceFile,
  readVoiceDataUrl: vi.fn(async () => null),
}));
vi.mock("../../infrastructure/projectFs", () => ({
  saveProjectDoc: h.saveProjectDoc,
  listProjectSummaries: vi.fn(async () => []),
  setLastProjectId: vi.fn(),
  getLastProjectId: vi.fn(() => null),
  clearLastProjectId: vi.fn(),
  deleteProjectDoc: vi.fn(),
  loadProjectDoc: vi.fn(async () => ""),
}));

import { useProjectStore } from "./projectStore";
import { MockVoiceProvider } from "../../infrastructure/voiceProviders/mockVoiceProvider";
import { updateLine } from "../../domain/project/lineEditOps";
import type { Scene } from "../../domain/project/types";

const scene = (id: string, order = 1): Scene => ({
  sceneId: id, partId: "part_001", order, sceneType: "photo_intro", templateId: "t",
  durationSec: 8, assetRefs: {}, character: { enabled: false, characterId: "yuko" },
  texts: {}, narration: { text: "", status: "none" }, warnings: [],
});
const flush = () => new Promise((r) => setTimeout(r, 0)); // 保留中のマイクロタスクを流し、gate された await 手前まで進める

beforeEach(() => {
  vi.restoreAllMocks(); // spyOn(synthesize) を元に戻す（テスト間で漏らさない）
  h.importVoiceFile.mockReset(); // mockImplementationOnce のキュー/履歴も消す
  h.importVoiceFile.mockImplementation(async (_p: string, stem: string) => `voices/${stem}.wav`);
  h.saveProjectDoc.mockReset();
  h.saveProjectDoc.mockImplementation(async () => {});
  useProjectStore.setState({
    parts: [{ partId: "part_001", title: "p", order: 1, sceneIds: ["scene_001"] }],
    scenes: [scene("scene_001")],
    assets: [],
    assetSrcById: {},
    narrationAudioById: {},
    _dirtyAudioKeys: new Set(),
    meta: { ...useProjectStore.getState().meta, projectId: "proj_test" },
    saveStatus: "idle",
    isGeneratingNarration: false,
    past: [], // Undo 履歴を毎テストでクリア（履歴到達性の剪定判定を汚さない）
    future: [],
  });
});

describe("保存の効率化：新規生成分だけ書き出す（#390）", () => {
  it("生成→保存で1回だけ書き出し、未変更のまま再保存では書き出さない（dirty がクリアされる）", async () => {
    useProjectStore.setState({
      scenes: [{ ...scene("scene_001"), narration: { text: "こんにちは", status: "none" } }],
    });
    await useProjectStore.getState().generateNarration("scene_001");
    // 生成で dirty に載る。
    expect(useProjectStore.getState()._dirtyAudioKeys.has("scene_001")).toBe(true);

    await useProjectStore.getState().saveProject();
    expect(h.importVoiceFile).toHaveBeenCalledTimes(1); // 新規生成＝1回書く
    const st1 = useProjectStore.getState();
    expect(st1.scenes[0].narration.voicePath).toBe("voices/scene_001.wav");
    expect(st1._dirtyAudioKeys.size).toBe(0); // 書けたら dirty を落とす

    // 音声に無関係な編集で未保存へ戻し、再保存＝音声は書き直さない。
    h.importVoiceFile.mockClear();
    useProjectStore.setState({ saveStatus: "idle" });
    await useProjectStore.getState().saveProject();
    expect(h.importVoiceFile).toHaveBeenCalledTimes(0); // 未変更＝据え置き（保存の効率化）
    // voicePath は保持されたまま。
    expect(useProjectStore.getState().scenes[0].narration.voicePath).toBe("voices/scene_001.wav");
  });

  it("保存時に孤児（現存しない場面）の音声キャッシュ・dirty を剪定する", async () => {
    useProjectStore.setState({
      scenes: [{ ...scene("scene_001"), narration: { text: "やあ", status: "generated" } }],
      narrationAudioById: {
        scene_001: "data:audio/wav;base64,AAAA",
        scene_999: "data:audio/wav;base64,BBBB", // 現存しない場面＝孤児
      },
      _dirtyAudioKeys: new Set(["scene_001", "scene_999"]),
    });
    await useProjectStore.getState().saveProject();
    const st = useProjectStore.getState();
    expect(st.narrationAudioById.scene_999).toBeUndefined(); // 孤児は落とす
    expect(st.narrationAudioById.scene_001).toBeTruthy(); // 生存分は保持
    expect(st._dirtyAudioKeys.size).toBe(0); // 書けた分＋孤児で dirty は空
  });

  it("掛け合い：dirty な行だけ書き出し、未変更（voicePath 済み）の行は据え置く", async () => {
    useProjectStore.setState({
      scenes: [{
        ...scene("scene_001"),
        lines: [
          { lineId: "line_001", text: "やあ", status: "generated", voicePath: "voices/old.wav" },
          { lineId: "line_002", text: "どうも", status: "generated", voicePath: null },
        ],
      }],
      narrationAudioById: {
        "scene_001/line_001": "data:audio/wav;base64,AAAA",
        "scene_001/line_002": "data:audio/wav;base64,BBBB",
      },
      _dirtyAudioKeys: new Set(["scene_001/line_002"]), // line_002 のみ新規
    });
    await useProjectStore.getState().saveProject();
    expect(h.importVoiceFile).toHaveBeenCalledTimes(1); // dirty な line_002 だけ
    const lines = useProjectStore.getState().scenes[0].lines!;
    expect(lines[0].voicePath).toBe("voices/old.wav"); // 未変更＝据え置き
    expect(lines[1].voicePath).toBe("voices/scene_001_line_002.wav"); // 新規＝書けた
  });
});

describe("メモリの効率化：Undo で戻せる間は保持し、履歴から落ちたら解放（#390 レビュー🔴）", () => {
  it("removeScene→undo：削除した場面の音声キャッシュが戻る（作業を失わない）", () => {
    useProjectStore.setState({
      parts: [{ partId: "part_001", title: "p", order: 1, sceneIds: ["scene_001", "scene_002"] }],
      scenes: [scene("scene_001", 1), { ...scene("scene_002", 2), narration: { text: "B", status: "generated" } }],
      narrationAudioById: { scene_002: "b1" }, // 生成済み・未保存（voicePath なし）
      _dirtyAudioKeys: new Set(["scene_002"]),
      past: [],
      future: [],
    });
    useProjectStore.getState().removeScene("scene_002");
    // 削除しても音声キャッシュは即消さない（Undo は音声を戻さないため・データ消失を防ぐ）。
    expect(useProjectStore.getState().narrationAudioById.scene_002).toBe("b1");
    useProjectStore.getState().undo();
    const st = useProjectStore.getState();
    expect(st.scenes.map((s) => s.sceneId)).toContain("scene_002"); // 場面が戻る
    expect(st.narrationAudioById.scene_002).toBe("b1"); // 音声も残っている＝生成済みのまま再生・保存できる
  });

  it("保存時：現在にも Undo/Redo 履歴にも無い場面のキャッシュだけ剪定（履歴にある間は保持）", async () => {
    const base = useProjectStore.getState();
    // scene_002 は現在の scenes には無いが past（Undo で戻せる）には在る。
    const snap = { meta: base.meta, parts: base.parts, scenes: [{ ...scene("scene_002", 1), narration: { text: "B", status: "generated" as const } }] };
    useProjectStore.setState({
      scenes: [{ ...scene("scene_001", 1), narration: { text: "A", status: "generated" } }],
      narrationAudioById: { scene_001: "a1", scene_002: "b1" },
      _dirtyAudioKeys: new Set(),
      past: [snap],
      future: [],
      saveStatus: "idle",
    });
    await useProjectStore.getState().saveProject();
    const st = useProjectStore.getState();
    expect(st.narrationAudioById.scene_002).toBe("b1"); // Undo 履歴で到達可能＝保持
    expect(st.narrationAudioById.scene_001).toBeTruthy();
  });

  it("removeAsset：消した素材の表示用 src を残さない", () => {
    useProjectStore.setState({
      assets: [
        { assetId: "asset_001", assetType: "image", displayName: "a.png", filePath: "a.png" },
        { assetId: "asset_002", assetType: "image", displayName: "b.png", filePath: "b.png" },
      ],
      assetSrcById: { asset_001: "d1", asset_002: "d2" },
    });
    useProjectStore.getState().removeAsset("asset_001");
    const st = useProjectStore.getState();
    expect(st.assetSrcById.asset_001).toBeUndefined();
    expect(st.assetSrcById.asset_002).toBe("d2");
  });
});

describe("非同期の競合で作業を失わない（#390 レビュー P1）", () => {
  it("保存中に場面を削除しても、保存完了で場面が復活しない（スナップショットを丸ごと戻さない）", async () => {
    useProjectStore.setState({
      parts: [{ partId: "part_001", title: "p", order: 1, sceneIds: ["scene_001", "scene_002"] }],
      scenes: [
        { ...scene("scene_001", 1), narration: { text: "A", status: "generated", voicePath: "voices/scene_001.wav" } },
        { ...scene("scene_002", 2), narration: { text: "B", status: "generated", voicePath: "voices/scene_002.wav" } },
      ],
      narrationAudioById: { scene_001: "a1", scene_002: "b1" },
      _dirtyAudioKeys: new Set(),
      saveStatus: "idle",
    });
    // saveProjectDoc を gate して「保存中」を作る。
    let releaseSave: () => void = () => {};
    h.saveProjectDoc.mockImplementationOnce(() => new Promise<void>((res) => { releaseSave = res; }));
    const savePromise = useProjectStore.getState().saveProject();
    await flush(); // WAV 書き出し後、saveProjectDoc 手前で停止
    // 保存中に scene_002 を削除。
    useProjectStore.getState().removeScene("scene_002");
    expect(useProjectStore.getState().scenes.map((s) => s.sceneId)).toEqual(["scene_001"]);
    releaseSave();
    await savePromise;
    const st = useProjectStore.getState();
    expect(st.scenes.map((s) => s.sceneId)).toEqual(["scene_001"]); // 復活しない（スナップショットで戻さない）
    // scene_002 の音声は残る：removeScene で past に入り Undo で戻せる＝履歴到達性があるうちは剪定しない（#390 レビュー🔴）。
    expect(st.narrationAudioById.scene_002).toBe("b1");
    expect(st.saveStatus).toBe("idle"); // 保存中に変更あり＝自動保存が再度走るよう idle のまま（sentinel）
  });

  it("保存中に同じ場面の音声を作り直すと、新しい音声は dirty のまま（古い書き込みで消えない）", async () => {
    useProjectStore.setState({
      scenes: [{ ...scene("scene_001"), narration: { text: "A", status: "generated", voicePath: "voices/scene_001.wav" } }],
      narrationAudioById: { scene_001: "v1" },
      _dirtyAudioKeys: new Set(["scene_001"]),
      saveStatus: "idle",
    });
    let releaseSave: () => void = () => {};
    h.saveProjectDoc.mockImplementationOnce(() => new Promise<void>((res) => { releaseSave = res; }));
    const savePromise = useProjectStore.getState().saveProject();
    await flush(); // scene_001 の v1 を書き出し済み、saveProjectDoc 手前で停止
    // 保存中に作り直し＝新しい音声 v2 を返す。
    vi.spyOn(MockVoiceProvider.prototype, "synthesize").mockResolvedValue({ audioDataUrl: "v2", durationSec: 1 });
    await useProjectStore.getState().generateNarration("scene_001");
    expect(useProjectStore.getState().narrationAudioById.scene_001).toBe("v2");
    releaseSave();
    await savePromise;
    const st = useProjectStore.getState();
    expect(st.narrationAudioById.scene_001).toBe("v2"); // 新しい音声が live に残る
    expect(st._dirtyAudioKeys.has("scene_001")).toBe(true); // 書き直し分は dirty のまま＝次回保存で書く
    expect(st.saveStatus).toBe("idle");
  });

  it("音声合成の完了が、合成中に削除した場面のキャッシュを作り直さない", async () => {
    useProjectStore.setState({
      scenes: [{ ...scene("scene_001"), narration: { text: "A", status: "none" } }],
      narrationAudioById: {},
      _dirtyAudioKeys: new Set(),
    });
    // synthesize を gate して「合成中」を作る。
    let releaseSynth: (v: { audioDataUrl: string; durationSec: number }) => void = () => {};
    vi.spyOn(MockVoiceProvider.prototype, "synthesize").mockReturnValue(
      new Promise((res) => { releaseSynth = res; }),
    );
    const genPromise = useProjectStore.getState().generateNarration("scene_001");
    await flush(); // pending をセットし synthesize 手前で停止
    // 合成中に場面を削除。
    useProjectStore.getState().removeScene("scene_001");
    releaseSynth({ audioDataUrl: "vX", durationSec: 1 });
    await genPromise;
    const st = useProjectStore.getState();
    expect(st.scenes.length).toBe(0);
    expect(st.narrationAudioById.scene_001).toBeUndefined(); // 遅れて届いた結果でキャッシュを作らない
    expect(st._dirtyAudioKeys.has("scene_001")).toBe(false);
  });

  it("保存済みプロジェクトで声を作り直すだけでも未保存（idle）になり自動保存の対象になる", async () => {
    useProjectStore.setState({
      scenes: [{ ...scene("scene_001"), narration: { text: "A", status: "generated", voicePath: "voices/scene_001.wav" } }],
      narrationAudioById: { scene_001: "v1" },
      _dirtyAudioKeys: new Set(),
      saveStatus: "saved", // ディスクと一致した状態
    });
    await useProjectStore.getState().generateNarration("scene_001");
    const st = useProjectStore.getState();
    expect(st.saveStatus).toBe("idle"); // 生成だけでも未保存＝自動保存が走る
    expect(st._dirtyAudioKeys.has("scene_001")).toBe(true);
  });

  it("単一：合成中に本文を編集すると、旧本文で作った音声結果は反映しない", async () => {
    useProjectStore.setState({
      scenes: [{ ...scene("scene_001"), narration: { text: "こんにちは", status: "none" } }],
      narrationAudioById: {},
      _dirtyAudioKeys: new Set(),
    });
    let releaseSynth: (v: { audioDataUrl: string; durationSec: number }) => void = () => {};
    vi.spyOn(MockVoiceProvider.prototype, "synthesize").mockReturnValue(
      new Promise((res) => { releaseSynth = res; }),
    );
    const genPromise = useProjectStore.getState().generateNarration("scene_001");
    await flush(); // pending・synthesize 手前で停止
    // 合成中に本文を編集（作り直しが必要＝status も none に戻す）。
    useProjectStore.getState().updateScene("scene_001", (s) => ({ ...s, narration: { ...s.narration, text: "さようなら", status: "none" } }));
    releaseSynth({ audioDataUrl: "staleAudio", durationSec: 1 });
    await genPromise;
    const st = useProjectStore.getState();
    expect(st.narrationAudioById.scene_001).toBeUndefined(); // 旧本文の音声を新本文に紐付けない
    expect(st.scenes[0].narration.status).toBe("none"); // 「作り直しが必要」のまま
    expect(st.scenes[0].narration.text).toBe("さようなら");
  });

  it("単一：合成中に全体の話し方（速さ）を変えても pending で固まらず、作り直しできる", async () => {
    const base = useProjectStore.getState();
    useProjectStore.setState({
      scenes: [{ ...scene("scene_001"), narration: { text: "A", status: "none" } }],
      narrationAudioById: {},
      _dirtyAudioKeys: new Set(),
      meta: { ...base.meta, projectId: "proj_test", voiceSettings: { ...base.meta.voiceSettings, speed: 1.0 } },
    });
    let releaseSynth: (v: { audioDataUrl: string; durationSec: number }) => void = () => {};
    vi.spyOn(MockVoiceProvider.prototype, "synthesize").mockReturnValue(
      new Promise((res) => { releaseSynth = res; }),
    );
    const genPromise = useProjectStore.getState().generateNarration("scene_001");
    await flush();
    // 全体設定の速さを変更＝場面 status はリセットされない（ここが pending 固着の原因だった）。
    useProjectStore.getState().updateVoiceSettings({ speed: 1.5 });
    releaseSynth({ audioDataUrl: "staleAudio", durationSec: 1 });
    await genPromise;
    expect(useProjectStore.getState().narrationAudioById.scene_001).toBeUndefined(); // 旧速さの音声は使わない
    expect(useProjectStore.getState().scenes[0].narration.status).toBe("none"); // pending で固まらない＝再試行できる
    // 実際に作り直せる（多重起動ガードに弾かれない）。
    vi.spyOn(MockVoiceProvider.prototype, "synthesize").mockResolvedValue({ audioDataUrl: "newAudio", durationSec: 1 });
    await useProjectStore.getState().generateNarration("scene_001");
    expect(useProjectStore.getState().scenes[0].narration.status).toBe("generated");
    expect(useProjectStore.getState().narrationAudioById.scene_001).toBe("newAudio");
  });

  it("後発の生成が終わった後に先発の完了が届いても、新しい結果を消さない（キー単位の世代番号で保護）", async () => {
    useProjectStore.setState({
      scenes: [{ ...scene("scene_001"), narration: { text: "A", status: "none" } }],
      narrationAudioById: {},
      _dirtyAudioKeys: new Set(),
    });
    let r1: (v: { audioDataUrl: string; durationSec: number }) => void = () => {};
    let r2: (v: { audioDataUrl: string; durationSec: number }) => void = () => {};
    vi.spyOn(MockVoiceProvider.prototype, "synthesize")
      .mockImplementationOnce(() => new Promise((res) => { r1 = res; }))
      .mockImplementationOnce(() => new Promise((res) => { r2 = res; }));
    const g1 = useProjectStore.getState().generateNarration("scene_001"); // 先発（input A）
    await flush();
    // 本文編集で status を none に戻し、2回目の生成（input B）を開始。
    useProjectStore.getState().updateScene("scene_001", (s) => ({ ...s, narration: { ...s.narration, text: "B", status: "none" } }));
    const g2 = useProjectStore.getState().generateNarration("scene_001"); // 後発（input B）
    await flush();
    r2({ audioDataUrl: "audioB", durationSec: 1 }); // 後発を先に完了
    await g2;
    expect(useProjectStore.getState().scenes[0].narration.status).toBe("generated");
    expect(useProjectStore.getState().narrationAudioById.scene_001).toBe("audioB");
    r1({ audioDataUrl: "audioA", durationSec: 1 }); // 先発が遅れて完了
    await g1;
    // token 不一致で先発の完了は何もしない＝後発の結果を none に戻したり audioA で上書きしたりしない。
    expect(useProjectStore.getState().scenes[0].narration.status).toBe("generated");
    expect(useProjectStore.getState().narrationAudioById.scene_001).toBe("audioB");
  });
});

// 掛け合い（scene.lines）経路は単一 narration と同型だが別実装。同じ P1 修正が入っているので競合も同様に検証する（#390 レビュー🟡）。
describe("掛け合い（行ごと）でも非同期の競合で作業を失わない（#390 レビュー）", () => {
  const dialogueScene = (id: string, statuses: Array<"none" | "generated">): Scene => ({
    ...scene(id),
    lines: statuses.map((status, i) => ({
      lineId: `line_00${i + 1}`,
      text: `せりふ${i + 1}`,
      status,
      voicePath: status === "generated" ? `voices/${id}_line_00${i + 1}.wav` : null,
    })),
  });

  it("合成中に対象の場面を削除すると、遅れて届く行の合成結果でキャッシュを作らない", async () => {
    useProjectStore.setState({
      scenes: [dialogueScene("scene_001", ["none", "none"])],
      narrationAudioById: {},
      _dirtyAudioKeys: new Set(),
      isGeneratingNarration: false,
    });
    let releaseSynth: (v: { audioDataUrl: string; durationSec: number }) => void = () => {};
    vi.spyOn(MockVoiceProvider.prototype, "synthesize").mockReturnValue(
      new Promise((res) => { releaseSynth = res; }),
    );
    const genPromise = useProjectStore.getState().generateNarration("scene_001");
    await flush(); // 各行 pending・1行目の synthesize 手前で停止
    useProjectStore.getState().removeScene("scene_001"); // 合成中に場面削除
    releaseSynth({ audioDataUrl: "vX", durationSec: 1 });
    await genPromise;
    const st = useProjectStore.getState();
    expect(st.narrationAudioById["scene_001/line_001"]).toBeUndefined();
    expect(st.narrationAudioById["scene_001/line_002"]).toBeUndefined();
    expect(st._dirtyAudioKeys.size).toBe(0);
  });

  it("保存中に同じ行を作り直すと、新しい音声は dirty のまま（古い書き込みで消えない）", async () => {
    useProjectStore.setState({
      scenes: [dialogueScene("scene_001", ["generated"])],
      narrationAudioById: { "scene_001/line_001": "v1" },
      _dirtyAudioKeys: new Set(["scene_001/line_001"]),
      saveStatus: "idle",
    });
    let releaseSave: () => void = () => {};
    h.saveProjectDoc.mockImplementationOnce(() => new Promise<void>((res) => { releaseSave = res; }));
    const savePromise = useProjectStore.getState().saveProject();
    await flush(); // line_001 の v1 を書き出し済み、saveProjectDoc 手前で停止
    vi.spyOn(MockVoiceProvider.prototype, "synthesize").mockResolvedValue({ audioDataUrl: "v2", durationSec: 1 });
    await useProjectStore.getState().generateNarration("scene_001"); // 保存中に作り直し
    releaseSave();
    await savePromise;
    const st = useProjectStore.getState();
    expect(st.narrationAudioById["scene_001/line_001"]).toBe("v2");
    expect(st._dirtyAudioKeys.has("scene_001/line_001")).toBe(true);
  });

  it("保存済みで行を作り直すだけでも未保存（idle）になる", async () => {
    useProjectStore.setState({
      scenes: [dialogueScene("scene_001", ["generated"])],
      narrationAudioById: { "scene_001/line_001": "v1" },
      _dirtyAudioKeys: new Set(),
      saveStatus: "saved",
    });
    await useProjectStore.getState().generateNarration("scene_001");
    const st = useProjectStore.getState();
    expect(st.saveStatus).toBe("idle");
    expect(st._dirtyAudioKeys.has("scene_001/line_001")).toBe(true);
  });

  it("合成中に行の本文を編集すると、旧本文で作った音声結果は反映しない", async () => {
    useProjectStore.setState({
      scenes: [dialogueScene("scene_001", ["none"])], // line_001＝text 'せりふ1'・none
      narrationAudioById: {},
      _dirtyAudioKeys: new Set(),
      isGeneratingNarration: false,
    });
    let releaseSynth: (v: { audioDataUrl: string; durationSec: number }) => void = () => {};
    vi.spyOn(MockVoiceProvider.prototype, "synthesize").mockReturnValue(
      new Promise((res) => { releaseSynth = res; }),
    );
    const genPromise = useProjectStore.getState().generateNarration("scene_001");
    await flush(); // 行 pending・synthesize 手前で停止
    // 合成中に line_001 の本文を編集（updateLine が status を none に戻す）。
    useProjectStore.getState().updateScene("scene_001", (s) => updateLine(s, "line_001", { text: "べつのせりふ" }));
    releaseSynth({ audioDataUrl: "staleAudio", durationSec: 1 });
    await genPromise;
    const st = useProjectStore.getState();
    expect(st.narrationAudioById["scene_001/line_001"]).toBeUndefined(); // 旧本文の音声を新本文に紐付けない
    expect(st.scenes[0].lines?.[0].status).toBe("none"); // 作り直しが必要のまま
    expect(st.scenes[0].lines?.[0].text).toBe("べつのせりふ");
  });

  it("合成中に全体の話し方（速さ）を変えても行が pending で固まらず none に戻る", async () => {
    const base = useProjectStore.getState();
    useProjectStore.setState({
      scenes: [dialogueScene("scene_001", ["none"])],
      narrationAudioById: {},
      _dirtyAudioKeys: new Set(),
      isGeneratingNarration: false,
      meta: { ...base.meta, projectId: "proj_test", voiceSettings: { ...base.meta.voiceSettings, speed: 1.0 } },
    });
    let releaseSynth: (v: { audioDataUrl: string; durationSec: number }) => void = () => {};
    vi.spyOn(MockVoiceProvider.prototype, "synthesize").mockReturnValue(
      new Promise((res) => { releaseSynth = res; }),
    );
    const genPromise = useProjectStore.getState().generateNarration("scene_001");
    await flush();
    useProjectStore.getState().updateVoiceSettings({ speed: 1.5 }); // 行 status はリセットされない
    releaseSynth({ audioDataUrl: "staleAudio", durationSec: 1 });
    await genPromise;
    const st = useProjectStore.getState();
    expect(st.narrationAudioById["scene_001/line_001"]).toBeUndefined();
    expect(st.scenes[0].lines?.[0].status).toBe("none"); // pending で固まらない＝再試行できる
  });
});
