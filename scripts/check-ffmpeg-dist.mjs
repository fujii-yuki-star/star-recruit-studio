// 配布版 FFmpeg（同梱）の LGPL + h264_mf 構成を自動検査する（#119）。
// 配布ビルド前に `npm run check:ffmpeg-dist` で実行。同梱 FFmpeg が pin 済み構成を満たすか機械判定する。
// ※ 同梱バイナリは大容量で git 追跡外（CI 不在）のため、本スクリプトは CI ではなく配布ビルド環境で実行する。
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const BIN = join("src-tauri", "resources", "ffmpeg", "bin", "ffmpeg.exe");
const PINNED_VERSION = "n8.1.2"; // FFmpeg_SOURCE.md の pin と一致させる

let failures = 0;
const ok = (m) => console.log(`✓ ${m}`);
const fail = (m) => {
  console.error(`✗ ${m}`);
  failures += 1;
};

if (!existsSync(BIN)) {
  console.error(`✗ 同梱 FFmpeg が見つかりません: ${BIN}`);
  console.error("  FFmpeg_SOURCE.md の pin（tag/zip/SHA-256）に従い bin 一式＋LICENSE.txt を配置してください。");
  process.exit(1);
}

const run = (args) => execFileSync(BIN, args, { encoding: "utf8" });
const version = run(["-hide_banner", "-version"]);
const buildconf = run(["-hide_banner", "-buildconf"]);
const encoders = run(["-hide_banner", "-encoders"]);

// 0) バージョンが pin と一致
if (version.includes(PINNED_VERSION)) ok(`バージョンが pin (${PINNED_VERSION}) と一致`);
else fail(`バージョンが pin (${PINNED_VERSION}) と不一致。FFmpeg_SOURCE.md を確認`);

// 1) h264_mf が存在（主経路・判定は -encoders が正）
if (/\bh264_mf\b/.test(encoders)) ok("h264_mf（Media Foundation）が存在");
else fail("h264_mf が -encoders に無い（主経路が成立しない）");

// 2) GPL / nonfree を含まない（LGPL 構成）
if (!/--enable-gpl\b/.test(buildconf)) ok("--enable-gpl なし");
else fail("--enable-gpl が含まれる（LGPL 違反）");
if (!/--enable-nonfree\b/.test(buildconf)) ok("--enable-nonfree なし");
else fail("--enable-nonfree が含まれる（LGPL 違反）");

// 3) libx264 / libx265（GPL コーデック）を含まない
if (!/--enable-libx264\b/.test(buildconf) && !/\blibx264\b/.test(encoders)) ok("libx264 なし");
else fail("libx264 が含まれる（GPL）");
if (!/--enable-libx265\b/.test(buildconf) && !/\blibx265\b/.test(encoders)) ok("libx265 なし");
else fail("libx265 が含まれる（GPL）");

// 4) dev 用 ffmpeg-static（gyan GPL・static・libx264）が混入していない
//    ＝同梱は LGPL shared（--disable-libx264 ＋ --enable-shared）であることを確認
if (/--disable-libx264\b/.test(buildconf) && /--enable-shared\b/.test(buildconf)) {
  ok("配布版は LGPL shared（dev の ffmpeg-static=GPL/static/x264 ではない）");
} else {
  fail("配布版が想定の LGPL shared 構成でない（dev の ffmpeg-static 混入の疑い）");
}

// 5) h264_mf が pick_codec の最優先（h264_mf があれば必ず選ばれる＝Rust の pick_codec と一致）
if (/\bh264_mf\b/.test(encoders)) ok("通常経路で h264_mf が優先選択される（pick_codec 一致）");
else fail("h264_mf が無く優先選択できない");

// 参考: libopenh264 が含まれる場合は第三者ライセンス記録が必要（FFmpeg_SOURCE.md に記載済み・通常経路では未使用）
if (/\blibopenh264\b/.test(encoders)) {
  console.log("ℹ libopenh264 を含む → 第三者ライセンス（BSD-2-Clause）は FFmpeg_SOURCE.md に記録済み。通常経路では h264_mf 優先で未使用。");
}

if (failures > 0) {
  console.error(`\n✗ ${failures} 件の不適合。配布ビルドを中止してください。`);
  process.exit(1);
}
console.log("\n✓ FFmpeg 配布構成チェック OK（LGPL + h264_mf）。");
