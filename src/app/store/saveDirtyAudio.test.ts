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

describe("メモリの効率化：削除で即キャッシュを落とす（#390）", () => {
  it("removeScene：消した場面の音声キャッシュ・dirty を残さない", () => {
    useProjectStore.setState({
      parts: [{ partId: "part_001", title: "p", order: 1, sceneIds: ["scene_001", "scene_002"] }],
      scenes: [scene("scene_001", 1), scene("scene_002", 2)],
      narrationAudioById: { scene_001: "d1", scene_002: "d2" },
      _dirtyAudioKeys: new Set(["scene_002"]),
    });
    useProjectStore.getState().removeScene("scene_002");
    const st = useProjectStore.getState();
    expect(st.narrationAudioById.scene_002).toBeUndefined();
    expect(st.narrationAudioById.scene_001).toBe("d1");
    expect(st._dirtyAudioKeys.has("scene_002")).toBe(false);
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
    expect(st.scenes.map((s) => s.sceneId)).toEqual(["scene_001"]); // 復活しない
    expect(st.narrationAudioById.scene_002).toBeUndefined(); // キャッシュも残らない
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
});
