// @vitest-environment jsdom
// まとめて取り込みを中止できる（#1024 ③）。
//
// ⚠️ **「やめられるか」が操作で割れていた**＝書き出しと声には中止があるのに、
// 取り込みだけ**打ち切る入口が無かった**（大きな動画を10件入れたら終わるまで待つしかない）。
//
// ⚠️ **入ったものは残す**＝取り消しではない。いま運んでいる1件も止まらない
// （IPC の往復は途中で切れない）ので、そこまでは入る。
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useProjectStore } from "./projectStore";
import { useTimelineStore } from "./timelineStore";
import { importCancelledMessage } from "../uiLabels";
import { resetAssetIdReservations } from "./assetImport";
import { PROJECT_FORMAT, TRACK_KIND } from "../../domain/enums";
import { TIMELINE_SCHEMA_VERSION } from "../../domain/timeline/types";
import type { TimelineProject } from "../../domain/timeline/types";

beforeEach(() => {
  vi.restoreAllMocks();
  resetAssetIdReservations();
  useProjectStore.getState().setExportRun({ phase: "idle" });
  useProjectStore.getState().newProject();
});

/** 1件ずつ取り込む代わりに、呼ばれた回数を数える（実ファイルは触らない）。 */
function stubAddAsset(onEach?: (n: number) => void) {
  let n = 0;
  useProjectStore.setState({
    addAssetByPath: vi.fn(async (path: string) => {
      n += 1;
      onEach?.(n);
      useProjectStore.setState((s) => ({
        assets: [...s.assets, { assetId: `asset_${String(n).padStart(3, "0")}`, assetType: "image", displayName: path, filePath: path } as never],
        importError: null,
      }));
    }),
  } as never);
  return () => n;
}

describe("まとめて取り込みの中止（#1024 ③）", () => {
  it("中止すると、次の1件へ進まない", async () => {
    // 2件目を運んでいる最中に中止する。
    const count = stubAddAsset((n) => {
      if (n === 2) useProjectStore.getState().cancelAssetImport();
    });
    await useProjectStore.getState().addAssets(["a.png", "b.png", "c.png", "d.png"]);
    expect(count(), "中止したのに残りまで取り込んでいる").toBe(2);
  });

  // ⚠️ **入ったものは残す**（§2-5＝途中まで入れた素材を黙って捨てない）。
  it("中止しても、入ったものは残る", async () => {
    stubAddAsset((n) => { if (n === 2) useProjectStore.getState().cancelAssetImport(); });
    await useProjectStore.getState().addAssets(["a.png", "b.png", "c.png"]);
    expect(useProjectStore.getState().assets).toHaveLength(2);
  });

  // ⚠️ **中止は「失敗」ではない**＝何件入ったかと、もう一度できることを言う。
  it("中止したことと、入った件数を知らせる", async () => {
    stubAddAsset((n) => { if (n === 2) useProjectStore.getState().cancelAssetImport(); });
    await useProjectStore.getState().addAssets(["a.png", "b.png", "c.png"]);
    expect(useProjectStore.getState().importError).toBe(importCancelledMessage(2));
  });

  it("中止しなければ、全部取り込む", async () => {
    const count = stubAddAsset();
    await useProjectStore.getState().addAssets(["a.png", "b.png", "c.png"]);
    expect(count()).toBe(3);
    expect(useProjectStore.getState().importError).toBeNull();
  });

  // ⚠️ **前回の中止を持ち越さない**＝次に取り込むと案内は入れ替わる。
  // （中止したことを覚える印は**持たない**＝どの画面も読んでいなかったのに
  //   コメントだけが「UI の案内用」と言っていた＝PR #1034 レビュー ℹ️）。
  it("次に取り込みを始めると、中止の案内は残らない", async () => {
    stubAddAsset((n) => { if (n === 1) useProjectStore.getState().cancelAssetImport(); });
    await useProjectStore.getState().addAssets(["a.png", "b.png"]);
    expect(useProjectStore.getState().importError).toBe(importCancelledMessage(1));
    stubAddAsset();
    await useProjectStore.getState().addAssets(["c.png"]);
    expect(useProjectStore.getState().importError, "前回の中止を持ち越している").toBeNull();
  });
});

describe("importCancelledMessage（#1024 ③）", () => {
  it("入ったものがあれば件数を言い、次の行動を添える", () => {
    expect(importCancelledMessage(3)).toContain("3件は入っています");
    expect(importCancelledMessage(3)).toContain("もう一度");
  });

  // ⚠️ **0件のときに「0件は入っています」と言わない**（数えた結果が嘘に見える）。
  it("1件も入っていなければ、そう言う", () => {
    expect(importCancelledMessage(0)).toContain("まだ何も入っていません");
    expect(importCancelledMessage(0)).not.toMatch(/0件/);
  });
});

// ⚠️ **もう片方の形式でも止まる**（PR #1034 レビュー 🔴）＝画面のボタンは
// **タイムライン形式の store** から取った取り込みを回しながら、中止だけ
// **場面形式の store** を呼んでいた（世代番号はそれぞれの store が自分のものを見るので、
// 別の store の番号を進めても**何も起きない**）。回し方を共有したうえで、ここで固定する。
function timelineDoc(): TimelineProject {
  return {
    schemaVersion: TIMELINE_SCHEMA_VERSION,
    format: PROJECT_FORMAT.timeline,
    projectId: "proj_20260904_001",
    projectName: "テスト動画",
    createdAt: "2026-09-04T00:00:00.000Z",
    updatedAt: "2026-09-04T00:00:00.000Z",
    videoSettings: { aspectRatio: "16:9", fps: 30, targetDurationSec: 60, maxDurationSec: 600 },
    voiceSettings: { defaultVoiceId: "voicevox_zundamon" },
    assets: [],
    tracks: [{ id: "track_001", kind: TRACK_KIND.visual }],
    clips: [],
  };
}

/** タイムライン形式でも1件ずつ取り込む代わりに、呼ばれた回数を数える。 */
function stubTimelineAddAsset(onEach?: (n: number) => void) {
  let n = 0;
  useTimelineStore.setState({
    addAssetByPath: vi.fn(async () => {
      n += 1;
      onEach?.(n);
      useTimelineStore.setState({ importError: null });
    }),
  } as never);
  return () => n;
}

describe("まとめて取り込みの中止（タイムライン形式・PR #1034 レビュー 🔴）", () => {
  beforeEach(() => {
    useTimelineStore.setState({ doc: timelineDoc(), importError: null, isImporting: false, importProgress: null, _importRunSeq: 0 } as never);
  });

  it("中止すると、次の1件へ進まない", async () => {
    const count = stubTimelineAddAsset((n) => {
      if (n === 2) useTimelineStore.getState().cancelAssetImport();
    });
    await useTimelineStore.getState().addAssets(["a.png", "b.png", "c.png", "d.png"]);
    expect(count(), "中止したのに残りまで取り込んでいる").toBe(2);
  });

  it("中止したことと、入った件数を知らせる（場面形式と同じ文言）", async () => {
    stubTimelineAddAsset((n) => { if (n === 2) useTimelineStore.getState().cancelAssetImport(); });
    await useTimelineStore.getState().addAssets(["a.png", "b.png", "c.png"]);
    expect(useTimelineStore.getState().importError).toBe(importCancelledMessage(2));
  });

  // ⚠️ **もう片方の store の中止では止まらない**＝取り違えを固定する
  //   （型は合うので、ここを検査していないと同じ配線ミスがまた通る）。
  it("場面形式の中止では止まらない（取り違えを見つける）", async () => {
    const count = stubTimelineAddAsset((n) => {
      if (n === 2) useProjectStore.getState().cancelAssetImport();
    });
    await useTimelineStore.getState().addAssets(["a.png", "b.png", "c.png"]);
    expect(count(), "別の store の中止で止まっている（世代番号を共有してしまっている）").toBe(3);
  });
});
