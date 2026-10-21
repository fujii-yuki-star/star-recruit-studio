// 拡張パック（`.starpack`・ADR-0060）を作る道具（開発側が使う）。
//
// 使い方: node scripts/make-starpack.mjs <パックのフォルダ> <出力.starpack>
//   フォルダの直下に `manifest.json`（`files` は書かなくてよい＝この道具が全ファイルの SHA-256 で埋める）と中身を置く。
//   例:  my-pack/manifest.json
//        my-pack/templates/intro.json
//        my-pack/assets/logo.png
//
// ⚠️ **依存を増やさない**＝zip は Node の組み込み（`zlib.deflateRawSync`・`zlib.crc32`）で書く。
// ⚠️ **アプリと同じ規則で断る**＝ファイル名は英数字と `- _ .`・`/` 区切りだけ（アプリの `is_safe_rel_path` と schema の `PackPath`）。
//   ここで通しても、アプリは入れるときにもう一度確かめる（道具を信用しない）。
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { crc32, deflateRawSync } from "node:zlib";

const [dir, out] = process.argv.slice(2);
if (!dir || !out) {
  console.error("使い方: node scripts/make-starpack.mjs <パックのフォルダ> <出力.starpack>");
  process.exit(2);
}

const SAFE_PART = /^[A-Za-z0-9_.-]+$/;
/** @param {string} rel */
function assertSafe(rel) {
  const parts = rel.split("/");
  if (parts.some((p) => p === "" || p === "." || p === ".." || !SAFE_PART.test(p))) {
    throw new Error(`ファイル名に使えない文字があります: ${rel}（英数字と - _ . だけ）`);
  }
}

/** @param {string} root @returns {string[]} */
function walk(root) {
  const outList = [];
  for (const name of readdirSync(root)) {
    const p = join(root, name);
    if (statSync(p).isDirectory()) outList.push(...walk(p));
    else outList.push(p);
  }
  return outList;
}

const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
const files = walk(dir)
  .map((p) => relative(dir, p).split(sep).join("/"))
  .filter((rel) => rel !== "manifest.json")
  .sort();
for (const rel of files) assertSafe(rel);
manifest.files = files.map((rel) => ({
  path: rel,
  sha256: createHash("sha256").update(readFileSync(join(dir, rel))).digest("hex"),
}));
/** @type {Array<[string, Buffer]>} */
const entries = [["manifest.json", Buffer.from(JSON.stringify(manifest, null, 2), "utf8")], ...files.map((rel) => /** @type {[string, Buffer]} */ ([rel, readFileSync(join(dir, rel))]))];

// ── zip（deflate・ZIP64 なし＝4GB 未満） ──
const chunks = [];
const central = [];
let offset = 0;
for (const [name, data] of entries) {
  const nameBuf = Buffer.from(name, "utf8");
  const comp = deflateRawSync(data);
  const crc = crc32(data) >>> 0;
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4); // 展開に要る版
  local.writeUInt16LE(0x0800, 6); // 名前は UTF-8
  local.writeUInt16LE(8, 8); // deflate
  local.writeUInt32LE(0, 10); // 時刻（使わない）
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(comp.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameBuf.length, 26);
  local.writeUInt16LE(0, 28);
  chunks.push(local, nameBuf, comp);
  const cd = Buffer.alloc(46);
  cd.writeUInt32LE(0x02014b50, 0);
  cd.writeUInt16LE(20, 4);
  cd.writeUInt16LE(20, 6);
  cd.writeUInt16LE(0x0800, 8);
  cd.writeUInt16LE(8, 10);
  cd.writeUInt32LE(0, 12);
  cd.writeUInt32LE(crc, 16);
  cd.writeUInt32LE(comp.length, 20);
  cd.writeUInt32LE(data.length, 24);
  cd.writeUInt16LE(nameBuf.length, 28);
  cd.writeUInt32LE(offset, 42);
  central.push(cd, nameBuf);
  offset += local.length + nameBuf.length + comp.length;
}
const cdBuf = Buffer.concat(central);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(entries.length, 8);
end.writeUInt16LE(entries.length, 10);
end.writeUInt32LE(cdBuf.length, 12);
end.writeUInt32LE(offset, 16);
writeFileSync(out, Buffer.concat([...chunks, cdBuf, end]));
console.log(`✓ ${out}（${entries.length} ファイル・packId=${manifest.packId}・版 ${manifest.version}）`);
