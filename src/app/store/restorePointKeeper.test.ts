import { afterEach, describe, expect, it, vi } from "vitest";
import * as projectFs from "../../infrastructure/projectFs";
import { RESTORE_POINT_MAX, RESTORE_POINT_MIN_INTERVAL_MS } from "../../domain/project/restorePoints";
import { keepRestorePoints, loadRestorePoints, restoreToPoint } from "./restorePointKeeper";
import { assembleProject, defaultVideoSettings, defaultVoiceSettings } from "../../domain/project/persistence";
import type { Scene } from "../../domain/project/types";

const at = (savedAt: number) => ({ name: `p-${savedAt}.json`, savedAt });

describe("keepRestorePoints（#263 段階2）", () => {
  afterEach(() => vi.restoreAllMocks());

  it("1つも無ければ作る", async () => {
    vi.spyOn(projectFs, "listRestorePoints").mockResolvedValue([]);
    const take = vi.spyOn(projectFs, "takeRestorePoint").mockResolvedValue(undefined);
    await keepRestorePoints("proj_001", 1000);
    expect(take).toHaveBeenCalledWith("proj_001", 1000);
  });

  it("最短の間隔より近い保存では作らない（自動保存のたびに溜めない）", async () => {
    const now = 10_000_000;
    vi.spyOn(projectFs, "listRestorePoints").mockResolvedValue([at(now - 1000)]);
    const take = vi.spyOn(projectFs, "takeRestorePoint").mockResolvedValue(undefined);
    const drop = vi.spyOn(projectFs, "dropRestorePoint").mockResolvedValue(undefined);
    await keepRestorePoints("proj_001", now);
    expect(take).not.toHaveBeenCalled();
    expect(drop).not.toHaveBeenCalled(); // 作らないときは片づけもしない
  });

  it("上限を超えたら、古いほうから落としてから作る", async () => {
    const now = 10_000_000;
    const points = Array.from({ length: RESTORE_POINT_MAX }, (_, i) => at(i * 1000));
    vi.spyOn(projectFs, "listRestorePoints").mockResolvedValue(points);
    const drop = vi.spyOn(projectFs, "dropRestorePoint").mockResolvedValue(undefined);
    const take = vi.spyOn(projectFs, "takeRestorePoint").mockResolvedValue(undefined);
    await keepRestorePoints("proj_001", now);
    expect(drop).toHaveBeenCalledWith("proj_001", "p-0.json"); // いちばん古いもの
    // ⚠️ **落としてから作る**（作ってから消すと一瞬だけ上限を超える）。
    expect(drop.mock.invocationCallOrder[0]).toBeLessThan(take.mock.invocationCallOrder[0]);
  });

  it("控えられなくても保存は止めない（投げない）", async () => {
    vi.spyOn(projectFs, "listRestorePoints").mockRejectedValue(new Error("むり"));
    await expect(keepRestorePoints("proj_001", 1000)).resolves.toBeUndefined();
  });

  it("間隔ちょうどでは作る（境界）", async () => {
    const now = 10_000_000;
    vi.spyOn(projectFs, "listRestorePoints").mockResolvedValue([at(now - RESTORE_POINT_MIN_INTERVAL_MS)]);
    const take = vi.spyOn(projectFs, "takeRestorePoint").mockResolvedValue(undefined);
    await keepRestorePoints("proj_001", now);
    expect(take).toHaveBeenCalled();
  });
});

describe("loadRestorePoints", () => {
  afterEach(() => vi.restoreAllMocks());

  it("新しい順で返す（戻りたいのはたいてい直前の状態）", async () => {
    vi.spyOn(projectFs, "listRestorePoints").mockResolvedValue([at(1), at(3), at(2)]);
    expect((await loadRestorePoints("proj_001")).map((p) => p.savedAt)).toEqual([3, 2, 1]);
  });
});

describe("restoreToPoint（#967 レビュー 🟡2・🟡4）", () => {
  afterEach(() => vi.restoreAllMocks());

  // ⚠️ **正典どおりの文書を作る**（`assembleProject`）＝手で並べると必須の取りこぼしで
  // `parseProjectDoc` が断り、**比べられないまま素通り**して検査が空振りする（実際にそうなった）。
  const doc = (scenes: Scene[]) =>
    JSON.stringify(
      assembleProject(
        {
          projectId: "proj_20260901_001", projectName: "テスト", purpose: "new_graduate",
          createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z",
          videoSettings: defaultVideoSettings(), companyInfo: { companyName: "テスト" },
          voiceSettings: defaultVoiceSettings(),
        },
        [],
        [{ partId: "part_001", order: 1, title: "本編", sceneIds: scenes.map((x) => x.sceneId) }],
        scenes,
      ),
    );
  const sc = (text: string) =>
    ({
      sceneId: "scene_001", partId: "part_001", order: 1, sceneType: "opening",
      templateId: "tmpl_opening_01", durationSec: 5,
      assetRefs: {}, character: { enabled: false, characterId: "yuko" }, texts: {}, warnings: [],
      narration: { text, status: "generated", voicePath: "voices/scene_001.wav" },
    }) as unknown as Scene;

  it("いまの音と食い違う読み上げを「作成前」に戻してから書く（文と声が違う動画を出さない）", async () => {
    vi.spyOn(projectFs, "readRestorePoint").mockResolvedValue(doc([sc("古い文")]));
    vi.spyOn(projectFs, "loadProjectDoc").mockResolvedValue(doc([sc("新しい文")]));
    vi.spyOn(projectFs, "listRestorePoints").mockResolvedValue([]);
    const write = vi.spyOn(projectFs, "restoreProjectText").mockResolvedValue(undefined);
    const cleared = await restoreToPoint("proj_20260901_001", "p-1.json");
    expect(cleared).toBe(1);
    const written = JSON.parse(write.mock.calls[0][1]) as { scenes: { narration: { status: string; voicePath: unknown } }[] };
    expect(written.scenes[0].narration.status).toBe("none");
    expect(written.scenes[0].narration.voicePath).toBeNull();
  });

  it("文が同じなら触らない（戻すたびに全部作り直させない）", async () => {
    vi.spyOn(projectFs, "readRestorePoint").mockResolvedValue(doc([sc("同じ文")]));
    vi.spyOn(projectFs, "loadProjectDoc").mockResolvedValue(doc([sc("同じ文")]));
    vi.spyOn(projectFs, "listRestorePoints").mockResolvedValue([]);
    const write = vi.spyOn(projectFs, "restoreProjectText").mockResolvedValue(undefined);
    expect(await restoreToPoint("proj_20260901_001", "p-1.json")).toBe(0);
    const written = JSON.parse(write.mock.calls[0][1]) as { scenes: { narration: { status: string } }[] };
    expect(written.scenes[0].narration.status).toBe("generated");
  });

  it("比べられないときは、戻す内容をそのまま書く（壊れた文書から戻れなくしない）", async () => {
    vi.spyOn(projectFs, "readRestorePoint").mockResolvedValue(doc([sc("戻す文")]));
    vi.spyOn(projectFs, "loadProjectDoc").mockResolvedValue("{こわれ");
    vi.spyOn(projectFs, "listRestorePoints").mockResolvedValue([]);
    const write = vi.spyOn(projectFs, "restoreProjectText").mockResolvedValue(undefined);
    expect(await restoreToPoint("proj_20260901_001", "p-1.json")).toBe(0);
    expect(write.mock.calls[0][1]).toContain("戻す文");
  });

  it("戻すときも上限を効かせる（何度も戻すと溜まり続ける、を作らない）", async () => {
    const points = Array.from({ length: RESTORE_POINT_MAX }, (_, i) => at(i * 1000));
    vi.spyOn(projectFs, "readRestorePoint").mockResolvedValue(doc([]));
    vi.spyOn(projectFs, "loadProjectDoc").mockResolvedValue(doc([]));
    vi.spyOn(projectFs, "listRestorePoints").mockResolvedValue(points);
    const drop = vi.spyOn(projectFs, "dropRestorePoint").mockResolvedValue(undefined);
    const write = vi.spyOn(projectFs, "restoreProjectText").mockResolvedValue(undefined);
    await restoreToPoint("proj_20260901_001", "p-1.json");
    expect(drop).toHaveBeenCalledWith("proj_20260901_001", "p-0.json"); // いちばん古いもの
    // ⚠️ **書いてから落とす**（α-7 再監査 🟡で**順番を逆にした**）＝
    // もとは「落としてから書く（書いてから消すと、一瞬だけ上限を超える）」だったが、
    // それだと**書き込みに失敗したとき、戻れていないのに世代だけ減る**（次の手が1つ減る）。
    // 一瞬1つ多いのは見た目だけの話で、戻せずに減るほうが重い。
    expect(write.mock.invocationCallOrder[0]).toBeLessThan(drop.mock.invocationCallOrder[0]);
  });

  it("戻せなかったら、古い世代を落とさない（戻れていないのに手が減る、を作らない）", async () => {
    const points = Array.from({ length: RESTORE_POINT_MAX }, (_, i) => at(i * 1000));
    vi.spyOn(projectFs, "readRestorePoint").mockResolvedValue(doc([]));
    vi.spyOn(projectFs, "loadProjectDoc").mockResolvedValue(doc([]));
    vi.spyOn(projectFs, "listRestorePoints").mockResolvedValue(points);
    const drop = vi.spyOn(projectFs, "dropRestorePoint").mockResolvedValue(undefined);
    vi.spyOn(projectFs, "restoreProjectText").mockRejectedValue(new Error("書けない"));
    await expect(restoreToPoint("proj_20260901_001", "p-1.json")).rejects.toThrow();
    expect(drop).not.toHaveBeenCalled();
  });

  it("刈り取りに失敗しても、戻す操作は失敗にしない（あると助かる後始末）", async () => {
    vi.spyOn(projectFs, "readRestorePoint").mockResolvedValue(doc([]));
    vi.spyOn(projectFs, "loadProjectDoc").mockResolvedValue(doc([]));
    vi.spyOn(projectFs, "listRestorePoints").mockRejectedValue(new Error("一覧が読めない"));
    vi.spyOn(projectFs, "restoreProjectText").mockResolvedValue(undefined);
    await expect(restoreToPoint("proj_20260901_001", "p-1.json")).resolves.toBe(0);
  });
});
