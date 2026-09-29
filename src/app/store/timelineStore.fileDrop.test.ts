// 窓の外から落としたファイルを取り込んで置く（ADR-0049・store の入口）。
// 取り込み（`addAssets`）は差し替え、置く規則は本物（domain の `placeDroppedAssets`）を通す。
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useTimelineStore } from "./timelineStore";
import { ASSET_TYPE, PROJECT_FORMAT, TRACK_KIND } from "../../domain/enums";
import { EDIT_BLOCKED } from "../../domain/timeline/edit";
import { TIMELINE_SCHEMA_VERSION } from "../../domain/timeline/types";
import type { TimelineProject } from "../../domain/timeline/types";

const base: TimelineProject = {
  schemaVersion: TIMELINE_SCHEMA_VERSION,
  format: PROJECT_FORMAT.timeline,
  projectId: "proj_20260929_001",
  projectName: "テスト",
  createdAt: "2026-09-29T00:00:00.000Z",
  updatedAt: "2026-09-29T00:00:00.000Z",
  videoSettings: { aspectRatio: "16:9", fps: 30, targetDurationSec: 60, maxDurationSec: 600 },
  voiceSettings: { defaultVoiceId: "voicevox_zundamon" },
  assets: [],
  tracks: [{ id: "track_001", kind: TRACK_KIND.visual }],
  clips: [],
};

/** 取り込みの代役＝渡された順に素材を足す（名前はファイル名）。取り込んだ順を控える。 */
let imported: string[];
beforeEach(() => {
  imported = [];
  useTimelineStore.setState({
    doc: structuredClone(base),
    history: { past: [], future: [] },
    selectedClipIds: [],
    editBlocked: null,
    exportRun: { phase: "idle", percent: 0, message: null, cancelling: false },
    addAssets: vi.fn(async (items: File[] | string[]) => {
      const d = useTimelineStore.getState().doc!;
      const paths = items as string[];
      imported.push(...paths);
      const added = paths.map((p, i) => ({
        assetId: `asset_${String(d.assets.length + i + 1).padStart(3, "0")}`,
        assetType: p.endsWith(".mp3") ? ASSET_TYPE.bgm : ASSET_TYPE.image,
        displayName: p.split("/").pop()!,
        filePath: `assets/${p.split("/").pop()}`,
      }));
      useTimelineStore.setState({ doc: { ...d, assets: [...d.assets, ...added] } });
    }) as never,
  });
});

describe("placeDroppedFiles（ADR-0049）", () => {
  it("ファイル名の順に取り込み、その順で落とした所から並べる", async () => {
    await useTimelineStore.getState().placeDroppedFiles(["C:/x/b.png", "C:/x/a.png"], { trackId: "track_001", startSec: 2 });
    expect(imported, "名前の順に取り込んでいない").toEqual(["C:/x/a.png", "C:/x/b.png"]);
    const d = useTimelineStore.getState().doc!;
    const clips = [...d.clips].sort((p, q) => p.startSec - q.startSec);
    expect(clips.map((c) => d.assets.find((a) => a.assetId === c.assetId)?.displayName)).toEqual(["a.png", "b.png"]);
    expect(clips[0].startSec).toBe(2);
    expect(useTimelineStore.getState().selectedClipIds, "置いたものが選ばれていない").toEqual(clips.map((c) => c.id));
  });

  // ⚠️ **1回の取り消しで全部戻る**（列を足した分も）。素材は取り消しの対象外（ADR-0020）。
  it("取り消し1回で、置いた部品と足した列が全部戻る", async () => {
    await useTimelineStore.getState().placeDroppedFiles(["C:/x/a.png", "C:/x/c.mp3"], { trackId: "track_001", startSec: 0 });
    expect(useTimelineStore.getState().doc!.tracks.length).toBe(2);
    useTimelineStore.getState().undo();
    const d = useTimelineStore.getState().doc!;
    expect(d.clips).toEqual([]);
    expect(d.tracks.length).toBe(1);
    expect(d.assets.length, "取り込んだ素材まで消えた").toBe(2);
  });

  it("置き先 null（並びの外）は取り込むだけ", async () => {
    await useTimelineStore.getState().placeDroppedFiles(["C:/x/a.png"], null);
    const d = useTimelineStore.getState().doc!;
    expect(d.assets.length).toBe(1);
    expect(d.clips).toEqual([]);
  });

  it("置けないときは理由を出し、取り込んだ素材は残す", async () => {
    useTimelineStore.setState({ doc: { ...structuredClone(base), tracks: [{ id: "track_001", kind: TRACK_KIND.visual, locked: true }] } });
    await useTimelineStore.getState().placeDroppedFiles(["C:/x/a.png"], { trackId: "track_001", startSec: 0 });
    const s = useTimelineStore.getState();
    expect(s.doc!.clips).toEqual([]);
    expect(s.doc!.assets.length).toBe(1);
    expect(s.editBlocked?.reason).toBe(EDIT_BLOCKED.locked);
  });
});
