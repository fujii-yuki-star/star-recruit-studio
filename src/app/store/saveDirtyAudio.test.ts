import { beforeEach, describe, expect, it, vi } from "vitest";

// #390：保存時に「新規生成された音声だけ」WAV 書き出しし、孤児キャッシュを剪定することを検証する。
// voiceFs（WAV 書き出し）と projectFs（ディスクI/O）をモックして書き出し回数を数える。
const h = vi.hoisted(() => ({
  importVoiceFile: vi.fn(async (_projectId: string, stem: string) => `voices/${stem}.wav`),
}));
vi.mock("../../infrastructure/voiceFs", () => ({
  importVoiceFile: h.importVoiceFile,
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
import type { Scene } from "../../domain/project/types";

const scene = (id: string, order = 1): Scene => ({
  sceneId: id, partId: "part_001", order, sceneType: "photo_intro", templateId: "t",
  durationSec: 8, assetRefs: {}, character: { enabled: false, characterId: "yuko" },
  texts: {}, narration: { text: "", status: "none" }, warnings: [],
});

beforeEach(() => {
  h.importVoiceFile.mockClear();
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
