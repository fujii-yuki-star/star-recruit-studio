// 拡張パックの声（ADR-0060 段階3）＝読むと声の一覧へ足し、声のファイルの組が変わったときだけ声を作るソフトを起こし直す。
import { beforeEach, describe, expect, it, vi } from "vitest";

const fx = vi.hoisted(() => ({ manifests: [] as string[], restarts: 0, failRestart: false, rejected: [] as string[], planFails: false }));
vi.mock("../../infrastructure/packFs", () => ({
  listPackManifests: vi.fn(async () => fx.manifests),
  readPackText: vi.fn(async () => { throw new Error("無い"); }),
  readPackDataUrl: vi.fn(async () => "data:x;base64,AA"),
  copyPackFileToProject: vi.fn(),
  // 採否は Rust が決める（`pack_voice_plan`）＝ここでは書かれた声を全部採り、`fx.rejected` の packId だけ断る。
  packVoicePlan: vi.fn(async () => {
    if (fx.planFails) throw new Error("boom");
    const all = fx.manifests.flatMap((m) => {
      const j = JSON.parse(m);
      return (j.contents.voices ?? []).map((v: { voiceId: string }) => ({ packId: j.packId as string, voiceId: v.voiceId }));
    });
    return { accepted: all.filter((v) => !fx.rejected.includes(v.packId)), rejected: all.filter((v) => fx.rejected.includes(v.packId)) };
  }),
  restartVoiceEngine: vi.fn(async () => {
    fx.restarts++;
    if (fx.failRestart) throw new Error("boom");
  }),
}));

import { resetPackVoiceKeyForTest, useProjectStore } from "./projectStore";
import { characterForSpeaker, setExtraVoiceCharacters } from "../../domain/voice/voiceCatalog";
import { VOICE_ENGINE_RESTART_FAILED_MESSAGE } from "../uiLabels";

const voicePack = (packId: string, speaker: number, sha = "a") => JSON.stringify({
  schemaVersion: "1.0", packId, name: `声${packId}`, version: "1.0.0", publisher: "社内", minAppVersion: "0.5.0",
  contents: { voices: [{ voiceId: "aoi", file: "v/aoi.vvm", character: `あおい${packId}`, styles: [{ speaker, label: "ノーマル" }] }] },
  files: [{ path: "v/aoi.vvm", sha256: sha.repeat(64) }],
  licenses: [{ target: "voices", license: "キャラの規約" }],
});

beforeEach(() => {
  fx.manifests = [];
  fx.restarts = 0;
  fx.failRestart = false;
  fx.rejected = [];
  fx.planFails = false;
  resetPackVoiceKeyForTest();
  setExtraVoiceCharacters([]);
  useProjectStore.setState({ packs: [], packVoicesSkipped: [], voiceEngineRestartError: null } as never);
});

describe("拡張パックの声", () => {
  it("起動時の1回目は起こし直さず、声は一覧とクレジットに出る", async () => {
    fx.manifests = [voicePack("office", 9001)];
    await useProjectStore.getState().loadPacks();
    expect(fx.restarts).toBe(0);
    expect(characterForSpeaker(9001)).toBe("あおいoffice");
  });

  it("声を入れた・外した・中身が変わったときだけ起こし直す（声と関係ない読み直しでは起こし直さない）", async () => {
    await useProjectStore.getState().loadPacks(); // 起動時（声なし）
    fx.manifests = [voicePack("office", 9001)];
    await useProjectStore.getState().loadPacks(); // 入れた
    expect(fx.restarts).toBe(1);
    await useProjectStore.getState().loadPacks(); // 変わらない
    expect(fx.restarts).toBe(1);
    fx.manifests = [voicePack("office", 9001, "b")];
    await useProjectStore.getState().loadPacks(); // 新しい版（中身が違う）
    expect(fx.restarts).toBe(2);
    fx.manifests = [];
    await useProjectStore.getState().loadPacks(); // 外した
    expect(fx.restarts).toBe(3);
    expect(characterForSpeaker(9001)).toBeNull();
  });

  it("起こし直せなければ知らせる（次に成功したら消す）", async () => {
    await useProjectStore.getState().loadPacks();
    fx.failRestart = true;
    fx.manifests = [voicePack("office", 9001)];
    await useProjectStore.getState().loadPacks();
    expect(useProjectStore.getState().voiceEngineRestartError).toBe(VOICE_ENGINE_RESTART_FAILED_MESSAGE);
    fx.failRestart = false;
    fx.manifests = [];
    await useProjectStore.getState().loadPacks();
    expect(useProjectStore.getState().voiceEngineRestartError).toBeNull();
  });

  it("Rust が採らなかった声は一覧にもクレジットにも足さず、パックの名前を知らせる", async () => {
    fx.manifests = [voicePack("a", 9001), voicePack("b", 9002)];
    fx.rejected = ["b"];
    await useProjectStore.getState().loadPacks();
    expect(useProjectStore.getState().packVoicesSkipped).toEqual(["声b"]);
    expect(characterForSpeaker(9001)).toBe("あおいa");
    expect(characterForSpeaker(9002)).toBeNull();
  });

  it("採否を調べられなければ声は足さない（読ませているか分からない声を出さない）", async () => {
    fx.planFails = true;
    fx.manifests = [voicePack("a", 9001)];
    await useProjectStore.getState().loadPacks();
    expect(characterForSpeaker(9001)).toBeNull();
  });
});
