// 配布物の容量を削る計画を立てる（#1384）。**純粋関数**＝ファイルには触らない（触るのは scripts/prune-bundle.mjs）。
//
// ⚠️ **使うものは、アプリの声の一覧から決める**＝手で番号を書くと、声を足したときに**その声のモデルだけ配られない**。
// ⚠️ **規約は残す**＝キャラごとの `policy.md`（そのキャラの利用規約）と `metas.json` は外さない。外すのは声の見本だけ。
import { inflateRawSync } from "node:zlib";

/** 声の一覧（`src/domain/voice/voiceCatalog.ts` の中身）から、アプリで選べる声の番号を取り出す。 */
export function usedSpeakerIds(catalogSource) {
  const ids = [...catalogSource.matchAll(/\bspeaker:\s*(\d+)/g)].map((m) => Number(m[1]));
  return [...new Set(ids)].sort((a, b) => a - b);
}

/**
 * 声のモデル（`.vvm`）ごとの中身から、残すファイルを決める。
 * @param vvms `[{ file, speakers: [{ uuid, styleIds }] }]`
 * @param used アプリで選べる声の番号
 * @returns `{ keep, drop, keepUuids, missing }`＝`missing` は**どのモデルにも無い番号**（あれば削ってはいけない）。
 */
export function planVvm(vvms, used) {
  const usedSet = new Set(used);
  const keep = [];
  const drop = [];
  const keepUuids = new Set();
  const covered = new Set();
  for (const v of vvms) {
    const hits = v.speakers.some((s) => s.styleIds.some((id) => usedSet.has(id)));
    if (hits) {
      keep.push(v.file);
      for (const s of v.speakers) {
        keepUuids.add(s.uuid);
        for (const id of s.styleIds) covered.add(id);
      }
    } else {
      drop.push(v.file);
    }
  }
  const missing = used.filter((id) => !covered.has(id));
  return { keep, drop, keepUuids: [...keepUuids].sort(), missing };
}

/**
 * キャラ情報のフォルダ（`resources/character_info/<uuid>`）で外すものを決める。
 * 残すキャラは**声の見本（`voice_samples`）だけ**外す（規約・立ち絵・一覧の情報は残す）。残さないキャラはフォルダごと外す。
 */
export function planCharacterInfo(dirs, keepUuids) {
  const keep = new Set(keepUuids);
  const drop = [];
  for (const d of dirs) {
    if (keep.has(d)) drop.push(`${d}/voice_samples`);
    else drop.push(d);
  }
  return drop;
}

/** zip（`.vvm`）の中の1ファイルを取り出す（中央ディレクトリを読む・格納と deflate だけ）。無ければ null。 */
export function readZipEntry(buf, name) {
  const EOCD = 0x06054b50;
  let e = buf.length - 22;
  while (e >= 0 && buf.readUInt32LE(e) !== EOCD) e -= 1;
  if (e < 0) return null;
  const count = buf.readUInt16LE(e + 10);
  let p = buf.readUInt32LE(e + 16);
  for (let i = 0; i < count; i += 1) {
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const entry = buf.toString("utf8", p + 46, p + 46 + nameLen);
    if (entry === name) {
      const lNameLen = buf.readUInt16LE(local + 26);
      const lExtraLen = buf.readUInt16LE(local + 28);
      const start = local + 30 + lNameLen + lExtraLen;
      const data = buf.subarray(start, start + size);
      if (method === 0) return Buffer.from(data);
      if (method === 8) return inflateRawSync(data);
      throw new Error(`未対応の圧縮方式 ${method}: ${name}`);
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return null;
}

/** `metas.json` の中身を `{ uuid, styleIds }` の並びへ。 */
export function speakersFromMetas(metas) {
  return metas.map((m) => ({ uuid: m.speaker_uuid, styleIds: m.styles.map((s) => s.id) }));
}
