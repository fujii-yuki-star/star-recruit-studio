// 配布物の容量を削る計画（#1384）。⚠️ **声の番号はアプリの声の一覧と同じ**であることを本物の一覧で確かめる。
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { deflateRawSync } from "node:zlib";
import { planCharacterInfo, planVvm, readZipEntry, speakersFromMetas, usedSpeakerIds } from "./pruneBundle.mjs";
import { VOICE_CATALOG } from "../../src/domain/voice/voiceCatalog";

describe("usedSpeakerIds", () => {
  it("アプリの声の一覧（本物）と同じ番号を読む", () => {
    const src = readFileSync(fileURLToPath(new URL("../../src/domain/voice/voiceCatalog.ts", import.meta.url)), "utf8");
    const fromCatalog = [...new Set(VOICE_CATALOG.flatMap((c) => c.styles.map((s) => s.speaker)))].sort((a, b) => a - b);
    expect(usedSpeakerIds(src)).toEqual(fromCatalog);
  });
});

describe("planVvm", () => {
  const vvms = [
    { file: "0.vvm", speakers: [{ uuid: "u1", styleIds: [0, 1] }, { uuid: "u2", styleIds: [10] }] },
    { file: "6.vvm", speakers: [{ uuid: "u3", styleIds: [29] }] },
    { file: "s0.vvm", speakers: [{ uuid: "u1", styleIds: [3000] }] },
  ];
  it("使う声を1つでも含むモデルは残し、それ以外は外す・残すキャラは同じモデルの全員", () => {
    expect(planVvm(vvms, [1])).toEqual({ keep: ["0.vvm"], drop: ["6.vvm", "s0.vvm"], keepUuids: ["u1", "u2"], missing: [] });
  });
  it("どのモデルにも無い番号は missing に出す（削ってはいけない合図）", () => {
    expect(planVvm(vvms, [1, 99]).missing).toEqual([99]);
  });
});

describe("planCharacterInfo", () => {
  it("残すキャラは声の見本だけ・残さないキャラはフォルダごと", () => {
    expect(planCharacterInfo(["u1", "u9"], ["u1"])).toEqual(["u1/voice_samples", "u9"]);
  });
});

describe("readZipEntry", () => {
  // 最小の zip を組み立てて読む（格納・deflate の両方）。
  const zip = (entries) => {
    const locals = [];
    const centrals = [];
    let off = 0;
    for (const { name, data, method } of entries) {
      const body = method === 8 ? deflateRawSync(data) : data;
      const n = Buffer.from(name);
      const l = Buffer.alloc(30);
      l.writeUInt32LE(0x04034b50, 0); l.writeUInt16LE(method, 8); l.writeUInt32LE(body.length, 18); l.writeUInt16LE(n.length, 26);
      const c = Buffer.alloc(46);
      c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(method, 10); c.writeUInt32LE(body.length, 20); c.writeUInt16LE(n.length, 28); c.writeUInt32LE(off, 42);
      locals.push(l, n, body);
      centrals.push(c, n);
      off += 30 + n.length + body.length;
    }
    const cd = Buffer.concat(centrals);
    const e = Buffer.alloc(22);
    e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(entries.length, 10); e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(off, 16);
    return Buffer.concat([...locals, cd, e]);
  };
  it("格納・deflate のどちらも取り出せる／無ければ null", () => {
    const buf = zip([
      { name: "a.txt", data: Buffer.from("plain"), method: 0 },
      { name: "metas.json", data: Buffer.from('[{"speaker_uuid":"u1","styles":[{"id":3}]}]'), method: 8 },
    ]);
    expect(readZipEntry(buf, "a.txt").toString()).toBe("plain");
    expect(speakersFromMetas(JSON.parse(readZipEntry(buf, "metas.json").toString()))).toEqual([{ uuid: "u1", styleIds: [3] }]);
    expect(readZipEntry(buf, "none")).toBeNull();
  });
});
