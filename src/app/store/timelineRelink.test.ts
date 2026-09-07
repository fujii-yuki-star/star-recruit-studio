import { beforeEach, describe, expect, it, vi } from "vitest";

// タイムライン形式でも**素材のファイルを選び直せる**（#1019 ⑤）。
//
// ⚠️ 前は「取り込み直すか置き直してください」だけで、どちらも**新しい番号になる**＝
// **切り抜き・動き・連動する字幕まで作り直し**だった。
vi.mock("../../infrastructure/assetFs", async (orig) => ({
  ...(await orig<typeof import("../../infrastructure/assetFs")>()),
  // 実物と同じく**渡された名前で保存する**（名前の導出が壊れても気づけるように、echo にする）。
  importAssetByPath: vi.fn(async (_projectId: string, fileName: string) => `assets/${fileName}`),
  assetDisplayUrl: vi.fn(async () => "asset://asset_001.mp4"),
  probeVideo: vi.fn(async () => ({ durationSec: 30, hasAudio: true, width: 1920, height: 1080 })),
  readAssetDataUrl: vi.fn(async () => "data:audio/mp3;base64,NEW"),
  extractVideoThumbnail: vi.fn(async () => "assets/asset_001.png"),
  missingAssetFiles: vi.fn(async () => []),
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

import { importAssetByPath, missingAssetFiles, probeVideo } from "../../infrastructure/assetFs";
import { useTimelineStore } from "./timelineStore";
import { PROJECT_FORMAT, TIMELINE_CLIP_KIND, TRACK_KIND } from "../../domain/enums";
import { TIMELINE_SCHEMA_VERSION } from "../../domain/timeline/types";
import type { Asset } from "../../domain/project/types";
import type { TimelineClip, TimelineProject } from "../../domain/timeline/types";

const video = (over: Partial<Asset> = {}): Asset =>
  ({ assetId: "asset_001", assetType: "video", displayName: "紹介", filePath: "assets/asset_001.mp4",
    metadata: { durationSec: 10, hasAudio: true, width: 1280, height: 720 }, ...over }) as Asset;

function doc(assets: Asset[], clips: TimelineClip[]): TimelineProject {
  return {
    schemaVersion: TIMELINE_SCHEMA_VERSION,
    format: PROJECT_FORMAT.timeline,
    projectId: "proj_20260906_001",
    projectName: "テスト",
    createdAt: "2026-09-06T00:00:00.000Z",
    updatedAt: "2026-09-06T00:00:00.000Z",
    videoSettings: { aspectRatio: "16:9", fps: 30, targetDurationSec: 60, maxDurationSec: 600 },
    voiceSettings: { defaultVoiceId: "voicevox_zundamon" },
    assets,
    tracks: [{ id: "track_001", kind: TRACK_KIND.visual }],
    clips,
  };
}

const slot = (over: Partial<TimelineClip> = {}): TimelineClip =>
  ({ id: "clip_001", kind: TIMELINE_CLIP_KIND.slot, trackId: "track_001", startSec: 0, durationSec: 5,
     x: 0, y: 0, w: 1920, h: 1080, assetId: "asset_001", ...over }) as TimelineClip;

beforeEach(() => {
  vi.clearAllMocks();
  useTimelineStore.setState({
    doc: doc([video()], [slot({ sourceStartSec: 3 })]),
    isImporting: false,
    importError: null,
    assetSrcById: {},
    videoSrcById: {},
    exportRun: { phase: "idle", percent: 0, message: null, cancelling: false },
  } as never);
});

describe("素材のファイルを選び直す（#1019 ⑤）", () => {
  // ⚠️ **番号を変えない**＝置いた場所も紐づけも構造的に残る。
  it("ファイルだけ差し替え、番号と置いた部品はそのまま", async () => {
    await useTimelineStore.getState().relinkAssetByPath("asset_001", "D:/new/紹介.mp4");
    const d = useTimelineStore.getState().doc!;
    expect(d.assets[0].assetId).toBe("asset_001");
    expect(d.clips[0].assetId, "置いた部品の指す先が変わった").toBe("asset_001");
    expect(d.clips[0].sourceStartSec, "使い始めが消えた").toBe(3);
    // ⚠️ **同じファイル名へ入れる**ので `filePath` は変わらない＝**中身が入れ替わったか**は
    //    測り直した長さで見る（`filePath` を見ても、差し替えても差し替えなくても同じ値になる）。
    expect(d.assets[0].metadata?.durationSec, "新しいファイルを測り直していない").toBe(30);
  });

  // ⚠️ **種類の違うファイルへは差し替えない**＝黙って別の結果にしない。
  it("動画を写真へは差し替えない（理由を出す）", async () => {
    await useTimelineStore.getState().relinkAssetByPath("asset_001", "D:/new/外観.png");
    const msg = useTimelineStore.getState().importError;
    expect(msg).toBeTruthy();
    expect(useTimelineStore.getState().doc!.assets[0].filePath).toBe("assets/asset_001.mp4");
    // ⚠️ **この形式に「場面」は無い**（ADR-0032＝場面の区切りを持たない）＝場面形式の言い方を
    //    そのまま出すと**存在しない行き先**へ案内する（§2-5）。
    expect(msg, "この形式に無い行き先を案内している").not.toContain("場面");
  });

  // ⚠️ **収め直したら知らせる**（黙って別の絵にしない）＋**見に行く先もこの形式のもの**。
  it("短いファイルへ差し替えたら、収め直したことを知らせる", async () => {
    vi.mocked(probeVideo).mockResolvedValueOnce({ durationSec: 1, hasAudio: true, width: 1920, height: 1080 });
    await useTimelineStore.getState().relinkAssetByPath("asset_001", "D:/new/紹介.mp4");
    const msg = useTimelineStore.getState().importError ?? "";
    expect(msg, "収め直したのに黙っている").toContain("新しい長さに合わせました");
    expect(msg, "この形式に無い行き先を案内している").not.toContain("場面");
    expect(useTimelineStore.getState().doc!.clips[0].sourceStartSec, "使い始めが新しい長さの外のまま").not.toBe(3);
  });

  // ⚠️ **ファイルを運ぶ前に断る**＝後ろの突き合わせでも文書は変わらないが、
  //   それだと**要らないファイルがディスクに残る**（次に同じ番号を採ったときそれが出る）。
  it("無い素材を指したら、運びもしない", async () => {
    const before = useTimelineStore.getState().doc;
    await useTimelineStore.getState().relinkAssetByPath("asset_999", "D:/new/紹介.mp4");
    expect(useTimelineStore.getState().doc).toBe(before);
    expect(vi.mocked(importAssetByPath), "無い素材なのにファイルを運んだ").not.toHaveBeenCalled();
  });

  // ⚠️ **書き出し中は差し替えない**（取り込みと**同じ経路**で断る＝断り方を2つ持たない）。
  //    その経路は `importError` ではなく `editBlocked` を立てる（画面はそこから帯・欄へ出す）。
  it("書き出し中は断る", async () => {
    useTimelineStore.setState({ exportRun: { phase: "encoding", percent: 5, message: null, cancelling: false } } as never);
    await useTimelineStore.getState().relinkAssetByPath("asset_001", "D:/new/紹介.mp4");
    expect(useTimelineStore.getState().doc!.assets[0].filePath).toBe("assets/asset_001.mp4");
    expect(useTimelineStore.getState().editBlocked?.reason, "断りが出ていない").toBeTruthy();
  });

  // ⚠️ **取り込み中も断る**（二重に走らせない＝同じ経路）。
  it("取り込み中は断る", async () => {
    useTimelineStore.setState({ isImporting: true } as never);
    await useTimelineStore.getState().relinkAssetByPath("asset_001", "D:/new/紹介.mp4");
    expect(useTimelineStore.getState().doc!.assets[0].filePath).toBe("assets/asset_001.mp4");
    expect(useTimelineStore.getState().importError).toBeTruthy();
  });

  // ⚠️ **保存名の導出は `newAssetFrom` に1つ**（場面形式と同じ＝ADR-0026②）＝古い拡張子のまま
  //    中身だけ差し替えると、表示・書き出しの種類は拡張子から決まるので**名前と中身が食い違う**。
  it("新しいファイルの種類に名前を合わせる（番号は変えない）", async () => {
    await useTimelineStore.getState().relinkAssetByPath("asset_001", "D:/new/紹介.mov");
    const a = useTimelineStore.getState().doc!.assets[0];
    expect(a.assetId, "番号が変わった").toBe("asset_001");
    expect(a.filePath, "古い拡張子のまま中身だけ差し替わった").toBe("assets/asset_001.mov");
  });

  // ⚠️ **帯のコマ列・波形はパス基準のキャッシュ**＝落とさないと前のファイルの絵が残り続ける
  //   （`ensureClipAnalysis` は「もうある」だけで打ち切る）。
  it("差し替えたら、帯のコマ列・波形の下書きを捨てる", async () => {
    useTimelineStore.setState({
      analysisByPath: { "assets/asset_001.mp4#0-5": null, "assets/other.mp4#0-5": null },
    } as never);
    await useTimelineStore.getState().relinkAssetByPath("asset_001", "D:/new/紹介.mp4");
    const keys = Object.keys(useTimelineStore.getState().analysisByPath);
    expect(keys, "前のファイルの下書きが残った").not.toContain("assets/asset_001.mp4#0-5");
    expect(keys, "関係ない素材の下書きまで捨てた").toContain("assets/other.mp4#0-5");
  });

  // ⚠️ **表示用の URL では「見つからない」が分からない**（組むだけでディスクを見ない）＝
  //    実在を調べないと、実機で選び直す入口が**一度も出ない**。
  it("ファイルが見つからない素材を、実在で調べて覚える", async () => {
    vi.mocked(missingAssetFiles).mockResolvedValueOnce(["assets/asset_001.mp4"]);
    await useTimelineStore.getState().refreshMissingAssets();
    expect(useTimelineStore.getState().missingAssetIds).toEqual(["asset_001"]);
  });

  // ⚠️ **鳴らす側も読み直す**（#1050）＝音源の鍵は**素材の番号**なので、選び直しても鍵は変わらない
  //    ＝読み直さないと**前の音が鳴り続ける**（絵の側で `?t=` を付けているのと同じ話）。
  it("音の素材を差し替えたら、鳴らす側も読み直す", async () => {
    useTimelineStore.setState({
      doc: {
        ...doc([{ assetId: "asset_002", assetType: "bgm", displayName: "曲", filePath: "assets/asset_002.mp3" } as Asset], []),
        clips: [{ id: "clip_a", kind: TIMELINE_CLIP_KIND.audio, trackId: "track_001", startSec: 0, durationSec: 5, assetId: "asset_002" } as TimelineClip],
      },
      audioSrcByKey: { "asset:asset_002": "data:audio/mp3;base64,OLD" },
    } as never);
    await useTimelineStore.getState().relinkAssetByPath("asset_002", "D:/new/曲.mp3");
    expect(useTimelineStore.getState().audioSrcByKey["asset:asset_002"], "前の音のまま").toBe("data:audio/mp3;base64,NEW");
  });

  // ⚠️ **音と絵は差し替えない**（#1050）＝もとは「音は動画でないもの」に含まれていて、
  //    絵の素材へ音を差し替えても通った（`changesAssetKind` の JSDoc が予告していた穴）。
  it("音の素材を写真へは差し替えない（理由を出す）", async () => {
    useTimelineStore.setState({
      doc: doc([{ assetId: "asset_002", assetType: "bgm", displayName: "曲", filePath: "assets/asset_002.mp3" } as Asset], []),
    } as never);
    await useTimelineStore.getState().relinkAssetByPath("asset_002", "D:/new/外観.png");
    const msg = useTimelineStore.getState().importError ?? "";
    expect(msg, "音だと言っていない").toContain("音");
    expect(useTimelineStore.getState().doc!.assets[0].filePath, "差し替わってしまった").toBe("assets/asset_002.mp3");
  });

  // ⚠️ **取り消しで戻せる**＝文書まるごとの履歴に載る（作った状態を戻せない、を作らない）。
  it("取り消しで元へ戻せる", async () => {
    await useTimelineStore.getState().relinkAssetByPath("asset_001", "D:/new/紹介.mp4");
    expect(useTimelineStore.getState().doc!.assets[0].metadata?.durationSec).toBe(30);
    useTimelineStore.getState().undo();
    expect(useTimelineStore.getState().doc!.assets[0].metadata?.durationSec, "取り消しで戻らない").toBe(10);
  });
});
