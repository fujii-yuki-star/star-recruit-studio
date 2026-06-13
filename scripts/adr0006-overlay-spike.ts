/**
 * ADR-0006 動画オーバーレイ・スパイク（動画スロット合成＋元動画音声ミックスの実証）。
 *
 * ADR-0001 の A2ハイブリッド「動画ありシーン」を実FFmpegで検証する:
 *   下PNG(zIndex<slot) → 動画クリップ(slotへスケール/配置) → 上PNG(zIndex>slot・透過) を overlay で重ね、
 *   音声は narration ＋ 元動画音声(§4=0.2) を amix、最後に BGM(§4=0.25) を全体へ重ねる。
 *
 * 下/上PNGは resvg(SVG→PNG・alpha保持＝ADR-0004の検証用ラスタライザ)で生成、
 * 「素材動画」と各音声は ffmpeg lavfi で代用（スパイクは合成チェーンの実証が目的）。
 * FFmpegは ffmpeg-static（spike用＝libx264。本番はADR-0002のlibopenh264へ無改修差し替え）。
 *
 * 実行: npx tsx scripts/adr0006-overlay-spike.ts （または npm run spike:overlay）
 * 出力: .spike/overlay_final.mp4（gitignore）
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import ffmpegPath from 'ffmpeg-static';

const OUT = '.spike';
const W = 1920;
const H = 1080;
const FPS = 30;
const DUR = 4; // 動画シーンの尺(秒)
// スロット矩形（photo_left_text_right_yuko_v1 の mainVisual 相当）。
const SLOT = { x: 80, y: 140, w: 1040, h: 800 };
// 音量（11 §4）。
const NARRATION_VOLUME = 1.0;
const ORIGINAL_AUDIO_VOLUME = 0.2;
const BGM_VOLUME = 0.25;

function bin(): string {
  if (!ffmpegPath) throw new Error('ffmpeg-static のバイナリを解決できませんでした');
  return ffmpegPath;
}
function run(args: string[]): { ok: boolean; stderr: string; stdout: string } {
  const r = spawnSync(bin(), args, { encoding: 'utf8' });
  return { ok: r.status === 0, stderr: r.stderr ?? '', stdout: r.stdout ?? '' };
}
function detectH264(): string {
  const o = run(['-hide_banner', '-encoders']).stdout;
  if (/\blibopenh264\b/.test(o)) return 'libopenh264';
  if (/\blibx264\b/.test(o)) return 'libx264';
  throw new Error('利用可能なH264エンコーダが見つかりません');
}
async function rasterize(svg: string): Promise<Buffer> {
  const { Resvg } = await import('@resvg/resvg-js');
  const r = new Resvg(svg, {
    fitTo: { mode: 'width', value: W },
    font: { loadSystemFonts: true, defaultFontFamily: 'Noto Sans JP' },
  });
  return Buffer.from(r.render().asPng());
}

// 下レイヤー（背景・不透明）。スロット領域も背景で塗るが、動画が上に乗るので隠れる。
const belowSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="#0f1f3a"/>
  <text x="60" y="90" font-family="Noto Sans JP" font-size="40" fill="#88aaff">下レイヤー（背景）</text>
</svg>`;

// 上レイヤー（透過）。スロットより前面の文字・パネル・字幕帯。スロット領域は描かない＝動画が見える。
const aboveSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect x="1180" y="200" width="660" height="520" rx="24" fill="#ffffff" fill-opacity="0.9"/>
  <text x="1230" y="320" font-family="Noto Sans JP" font-size="52" font-weight="bold" fill="#1a1a1a">上レイヤー（文字）</text>
  <text x="1230" y="400" font-family="Noto Sans JP" font-size="34" fill="#333333">テキスト・ゆうこ等はここ</text>
  <rect x="240" y="960" width="1440" height="90" rx="16" fill="#000000" fill-opacity="0.55"/>
  <text x="280" y="1018" font-family="Noto Sans JP" font-size="38" fill="#ffffff">字幕：動画スロットの上に重なる</text>
</svg>`;

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const enc = detectH264();
  console.log(`ffmpeg: ${bin()}`);
  console.log(`H264エンコーダ: ${enc}（本番はADR-0002のlibopenh264へ）`);

  const below = join(OUT, 'below.png');
  writeFileSync(below, await rasterize(belowSvg));
  const above = join(OUT, 'above.png');
  writeFileSync(above, await rasterize(aboveSvg));
  console.log('下/上PNG生成（resvg・上は透過）');

  // 「素材動画」＝動きのある testsrc2 ＋ 元音声(sine 330Hz)。6秒。
  const clip = join(OUT, 'clip.mp4');
  const c = run(['-y', '-f', 'lavfi', '-i', `testsrc2=size=1280x720:rate=${FPS}:duration=6`,
    '-f', 'lavfi', '-i', 'sine=frequency=330:duration=6',
    '-pix_fmt', 'yuv420p', '-c:v', enc, '-c:a', 'aac', '-shortest', clip]);
  if (!c.ok) { console.log('テスト動画生成 失敗:\n' + c.stderr.slice(-600)); process.exit(1); }
  // ナレーション(sine 660Hz) / BGM(sine 220Hz)
  const narr = join(OUT, 'narration.wav');
  run(['-y', '-f', 'lavfi', '-t', String(DUR), '-i', 'sine=frequency=660:sample_rate=44100', narr]);
  const bgm = join(OUT, 'bgm.wav');
  run(['-y', '-f', 'lavfi', '-t', '8', '-i', 'sine=frequency=220:sample_rate=44100', bgm]);
  console.log('テスト動画・ナレーション・BGM 生成');

  // 動画シーン合成：下PNG → クリップ(cover で slot へ) → 上PNG(透過) overlay、
  // 音声＝ narration(1.0) ＋ 元動画音声(0.2) を amix。クリップは startSec=0 から DUR ぶん切り出し。
  const fit = `scale=${SLOT.w}:${SLOT.h}:force_original_aspect_ratio=increase,crop=${SLOT.w}:${SLOT.h},setsar=1`;
  const filter = [
    `[1:v]${fit}[clip]`,
    `[0:v][clip]overlay=${SLOT.x}:${SLOT.y}[bg1]`,
    `[bg1][2:v]overlay=0:0[vout]`,
    `[3:a]volume=${NARRATION_VOLUME}[narr]`,
    `[1:a]volume=${ORIGINAL_AUDIO_VOLUME}[orig]`,
    `[narr][orig]amix=inputs=2:duration=longest:normalize=0[aout]`,
  ].join(';');
  const scene = join(OUT, 'scene_video.mp4');
  const sc = run(['-y',
    '-loop', '1', '-t', String(DUR), '-i', below,
    '-ss', '0', '-t', String(DUR), '-i', clip,
    '-loop', '1', '-t', String(DUR), '-i', above,
    '-i', narr,
    '-filter_complex', filter,
    '-map', '[vout]', '-map', '[aout]',
    '-r', String(FPS), '-pix_fmt', 'yuv420p', '-c:v', enc, '-c:a', 'aac',
    '-ar', '44100', '-ac', '2', '-t', String(DUR), scene]);
  if (!sc.ok) { console.log('動画シーン合成 失敗:\n' + sc.stderr.slice(-900)); process.exit(1); }
  console.log('動画シーン合成 ✓（下PNG→動画(slot,cover)→上PNG overlay ＋ narration+元音声 amix）');

  // BGM を全体へ重ねる（V-C3 と同じ最終ミックス）。
  const finalMp4 = join(OUT, 'overlay_final.mp4');
  const bgmFilter = `[1:a]volume=${BGM_VOLUME}[bg];[0:a][bg]amix=inputs=2:duration=first:normalize=0[a]`;
  const fin = run(['-y', '-i', scene, '-stream_loop', '-1', '-i', bgm,
    '-filter_complex', bgmFilter, '-map', '0:v', '-map', '[a]',
    '-c:v', 'copy', '-c:a', 'aac', '-ar', '44100', '-ac', '2', '-t', String(DUR), finalMp4]);
  if (!fin.ok) { console.log('BGM合成 失敗:\n' + fin.stderr.slice(-900)); process.exit(1); }

  const kb = (statSync(finalMp4).size / 1024).toFixed(1);
  const probe = run(['-hide_banner', '-i', finalMp4]).stderr;
  console.log(`\n最終MP4: ${finalMp4} (${kb} KB)`);
  console.log('  ' + (probe.match(/Duration: [^,]+/)?.[0] ?? 'Duration: ?'));
  for (const m of probe.matchAll(/Stream #\d+:\d+[^\n]*: (?:Video|Audio):[^\n]*/g)) {
    console.log('  ' + m[0].trim());
  }
  console.log('\n完了。動画スロット合成(overlay)＋元動画音声ミックス＋BGM を実FFmpegで実証。');
}

main().catch((e) => { console.error(e); process.exit(1); });
