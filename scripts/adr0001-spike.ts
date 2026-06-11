/**
 * ADR-0001 描画スパイク。
 * Mock(ai-video-plan) → 変換(内部Scene) → 共有レイアウト → SVG → (resvgでPNG) → (FFmpeg合成コマンド) を通し、
 * 「同一SVG＋同一ラスタライザ＝一致」というパリティ戦略を実証する。
 * 実行: npx tsx scripts/adr0001-spike.ts
 * 出力: .spike/ 配下（gitignore）。
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Asset } from '../src/domain/project/types';
import type { Template } from '../src/domain/template/types';
import { transformVideoPlan } from '../src/domain/ai/transformPlan';
import type { TransformContext } from '../src/domain/ai/transformPlan';
import { layoutScene } from '../src/renderer/layout';
import { layoutToSvg } from '../src/renderer/sceneSvg';
import { MockAiProvider } from '../src/infrastructure/aiProviders/mockAiProvider';

const OUT = '.spike';
const FONT = 'Noto Sans JP';

const templates: Template[] = [
  {
    schemaVersion: '1.0', templateId: 'opening_yuko_right_v1', name: 'オープニング・ゆうこ右',
    category: 'opening', aspectRatio: '16:9', canvas: { width: 1920, height: 1080 },
    aiHint: { maxDurationSec: 12, maxNarrationLength: 120, maxSubtitleLength: 60 },
    defaults: { transitionIn: 'fade', transitionOut: 'fade', backgroundColor: '#ffffff' },
    layers: [
      { id: 'background', type: 'background', x: 0, y: 0, w: 1920, h: 1080, zIndex: 0 },
      { id: 'title', type: 'text', textKey: 'title', x: 160, y: 360, w: 1100, h: 140, zIndex: 30, fontSize: 72, fontWeight: 'bold', color: '#1a1a1a' },
      { id: 'main', type: 'text', textKey: 'main', x: 160, y: 520, w: 1000, h: 90, zIndex: 30, fontSize: 40, color: '#333333', maxLines: 1 },
      { id: 'subtitle', type: 'subtitle', textKey: 'subtitle', x: 240, y: 920, w: 1440, h: 90, zIndex: 50, fontSize: 38, background: { enabled: true, color: '#000000', opacity: 0.55, radius: 16 } },
      { id: 'logo', type: 'logo', x: 1640, y: 60, w: 220, h: 120, zIndex: 60 },
      { id: 'yuko', type: 'character', x: 1450, y: 600, w: 360, h: 420, zIndex: 40 },
    ],
  },
  {
    schemaVersion: '1.0', templateId: 'photo_left_text_right_yuko_v1', name: '写真左・説明右・ゆうこ',
    category: 'photo_intro', aspectRatio: '16:9', canvas: { width: 1920, height: 1080 },
    aiHint: { maxDurationSec: 15, maxNarrationLength: 120, maxSubtitleLength: 60 },
    defaults: { transitionIn: 'fade', transitionOut: 'fade', backgroundColor: '#f5f5f5' },
    layers: [
      { id: 'background', type: 'background', x: 0, y: 0, w: 1920, h: 1080, zIndex: 0, fillColor: '#f5f5f5' },
      { id: 'mainVisual', type: 'slot', slotType: 'image_or_video', required: true, x: 80, y: 140, w: 1040, h: 800, zIndex: 10, fit: 'cover' },
      { id: 'textPanel', type: 'shape', shapeType: 'rect', x: 1180, y: 200, w: 660, h: 520, zIndex: 20, fillColor: '#ffffff', opacity: 0.9, radius: 24 },
      { id: 'title', type: 'text', textKey: 'title', x: 1230, y: 250, w: 560, h: 110, zIndex: 30, fontSize: 52, fontWeight: 'bold', color: '#1a1a1a' },
      { id: 'main', type: 'text', textKey: 'main', x: 1230, y: 390, w: 560, h: 200, zIndex: 30, fontSize: 34, color: '#333333', maxLines: 4 },
      { id: 'subtitle', type: 'subtitle', textKey: 'subtitle', x: 240, y: 960, w: 1440, h: 90, zIndex: 50, fontSize: 38, background: { enabled: true, color: '#000000', opacity: 0.55, radius: 16 } },
      { id: 'yuko', type: 'character', x: 1500, y: 640, w: 340, h: 400, zIndex: 40 },
    ],
  },
];

const assets: Asset[] = [
  { assetId: 'asset_entrance_001', assetType: 'image', displayName: '会社入口の写真', filePath: 'assets/images/entrance_001.jpg' },
  { assetId: 'asset_office_001', assetType: 'image', displayName: 'オフィス写真', filePath: 'assets/images/office_001.jpg' },
  { assetId: 'asset_logo_001', assetType: 'logo', displayName: '会社ロゴ', filePath: 'assets/images/logo.png' },
  { assetId: 'yuko_smile_001', assetType: 'yuko', displayName: 'ゆうこ_笑顔', filePath: 'assets/yuko/yuko_smile.png', tags: ['smile', 'opening'], isDefaultYuko: true },
  { assetId: 'yuko_guide_001', assetType: 'yuko', displayName: 'ゆうこ_案内', filePath: 'assets/yuko/yuko_guide.png', tags: ['guide', 'point'] },
  { assetId: 'bgm_bright_001', assetType: 'bgm', displayName: '明るいBGM', filePath: 'assets/bgm/bright_001.mp3' },
];

function hasFfmpeg(): boolean {
  try {
    return spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;
  } catch {
    return false;
  }
}

async function rasterize(svg: string): Promise<Buffer | null> {
  try {
    const { Resvg } = await import('@resvg/resvg-js');
    const resvg = new Resvg(svg, {
      fitTo: { mode: 'width', value: 1920 },
      font: { loadSystemFonts: true, defaultFontFamily: FONT },
    });
    return Buffer.from(resvg.render().asPng());
  } catch (e) {
    console.log(`  [resvg] スキップ（未導入か失敗）: ${(e as Error).message}`);
    return null;
  }
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const templateById = new Map(templates.map((t) => [t.templateId, t] as const));

  const plan = await new MockAiProvider().generateVideoPlan({
    companyInfo: { companyName: '株式会社サンプル' },
    purpose: 'new_graduate', targetDurationSec: 60, templates: [], assets: [], yukoPoseTags: ['smile', 'guide'],
  });
  const ctx: TransformContext = { templates, assets };
  const { scenes } = transformVideoPlan(plan, ctx);
  console.log(`Mock→変換: ${scenes.length} シーン`);

  let firstPng: { sceneId: string; durationSec: number } | null = null;

  for (const scene of scenes) {
    const template = templateById.get(scene.templateId);
    if (!template) continue;
    const svg = layoutToSvg(layoutScene(scene, template));
    const svgPath = join(OUT, `${scene.sceneId}.svg`);
    writeFileSync(svgPath, svg, 'utf8');
    console.log(`\n[${scene.sceneId}] SVG出力: ${svgPath} (${svg.length} bytes)`);

    const png = await rasterize(svg);
    if (png) {
      const pngPath = join(OUT, `${scene.sceneId}.png`);
      writeFileSync(pngPath, png);
      console.log(`  PNG出力: ${pngPath} (${png.length} bytes)`);
      // パリティ検証：同じSVGを再ラスタライズして一致するか
      const png2 = await rasterize(svg);
      if (png2) {
        console.log(`  パリティ（同一SVG＋同一ラスタライザ）: ${png.equals(png2) ? '一致 (byte-identical) ✓' : '不一致 ✗'}`);
      }
      if (!firstPng) firstPng = { sceneId: scene.sceneId, durationSec: scene.durationSec };
    }
  }

  // FFmpeg 合成
  console.log('\n=== FFmpeg 合成 ===');
  const ff = hasFfmpeg();
  if (ff && firstPng) {
    const png = join(OUT, `${firstPng.sceneId}.png`);
    const mp4 = join(OUT, `${firstPng.sceneId}.mp4`);
    const args = ['-y', '-loop', '1', '-t', String(firstPng.durationSec), '-i', png, '-r', '30', '-pix_fmt', 'yuv420p', '-c:v', 'libopenh264', mp4];
    console.log(`実行: ffmpeg ${args.join(' ')}`);
    const r = spawnSync('ffmpeg', args, { encoding: 'utf8' });
    console.log(r.status === 0 ? `  MP4出力: ${mp4} ✓` : `  失敗: ${r.stderr?.slice(-400)}`);
  } else {
    console.log('ffmpeg 未導入のためスキップ（バイナリ導入後に下記を実行）:');
    console.log('  # 動画なしシーン（静止PNGを尺ぶん保持）');
    console.log('  ffmpeg -y -loop 1 -t <dur> -i <scene>.png -r 30 -pix_fmt yuv420p -c:v libopenh264 <scene>.mp4');
    console.log('  # 動画ありシーン（下PNG → 動画 → 上PNG を重ねる）');
    console.log('  ffmpeg -y -loop 1 -t <dur> -i below.png -i clip.mp4 -loop 1 -t <dur> -i above.png \\');
    console.log('    -filter_complex "[1:v]scale=W:H[v];[0:v][v]overlay=X:Y[t];[t][2:v]overlay=0:0,format=yuv420p[o]" \\');
    console.log('    -map "[o]" -r 30 -c:v libopenh264 <scene>.mp4');
  }
  console.log('\n完了。SVGをブラウザで開けばプレビュー相当が確認できます。');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
