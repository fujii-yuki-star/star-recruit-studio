/**
 * ADR-0001 描画スパイク（出力側＝製品の核を実証）。
 * Mock(ai-video-plan) → 変換(内部Scene) → 共有レイアウト → SVG → resvgでPNG → FFmpegで実MP4 → 全シーン連結。
 * 「同一SVG＋同一ラスタライザ＝一致」というパリティ戦略と、SVG→PNG→実MP4の出力経路を実証する。
 * FFmpegは ffmpeg-static バイナリを使用。コーデックは本番(ADR-0002)がLGPL+OpenH264、
 * spike用staticビルドはlibx264のみのため自動判定して代替する（どちらもH.264/AVCを生成）。
 * 実行: npx tsx scripts/adr0001-spike.ts  （または npm run spike:export）
 * 出力: .spike/ 配下（gitignore）。final.mp4 が最終成果物。
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import ffmpegPath from 'ffmpeg-static';
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

function ffmpegBin(): string {
  if (!ffmpegPath) throw new Error('ffmpeg-static のバイナリを解決できませんでした');
  return ffmpegPath;
}

function runFfmpeg(args: string[]): { ok: boolean; stderr: string } {
  const r = spawnSync(ffmpegBin(), args, { encoding: 'utf8' });
  return { ok: r.status === 0, stderr: r.stderr ?? '' };
}

// このビルドで使えるH264エンコーダを選ぶ。本番(ADR-0002)はLGPL+OpenH264想定、
// spike用staticビルド(ffmpeg-static=gyan.dev GPL)はlibx264のみ → 自動で代替する。
function detectH264Encoder(): { name: string; note: string } {
  const out = spawnSync(ffmpegBin(), ['-hide_banner', '-encoders'], { encoding: 'utf8' }).stdout ?? '';
  if (/\blibopenh264\b/.test(out)) return { name: 'libopenh264', note: 'ADR-0002準拠 LGPL+OpenH264' };
  if (/\blibx264\b/.test(out)) return { name: 'libx264', note: 'spike代替 GPL/x264・本番はlibopenh264へ差し替え' };
  throw new Error('利用可能なH264エンコーダが見つかりません');
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

  const rendered: { sceneId: string; durationSec: number; pngPath: string }[] = [];

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
      rendered.push({ sceneId: scene.sceneId, durationSec: scene.durationSec, pngPath });
    }
  }

  // FFmpeg 合成：各シーンPNG → 実MP4 → 連結して1本に（ADR-0001の出力側＝製品の核を実証）
  console.log('\n=== FFmpeg 合成（SVG→PNG→実MP4） ===');
  if (rendered.length === 0) {
    console.log('ラスタライズ済みシーンが無いため合成をスキップします。');
    return;
  }
  const enc = detectH264Encoder();
  console.log(`使用バイナリ: ${ffmpegBin()}`);
  console.log(`H264エンコーダ: ${enc.name}（${enc.note}）`);

  const clips: string[] = [];
  for (const r of rendered) {
    const mp4 = join(OUT, `${r.sceneId}.mp4`);
    // 静止PNGを尺ぶん保持して動画化。yuv420pは偶数サイズ前提（キャンバス1920x1080）。
    const args = ['-y', '-loop', '1', '-t', String(r.durationSec), '-i', r.pngPath,
      '-r', '30', '-pix_fmt', 'yuv420p', '-c:v', enc.name, mp4];
    const res = runFfmpeg(args);
    if (res.ok) {
      console.log(`  [${r.sceneId}] ${r.durationSec}s → ${mp4} ✓`);
      clips.push(`${r.sceneId}.mp4`);
    } else {
      console.log(`  [${r.sceneId}] 失敗: ${res.stderr.slice(-300)}`);
    }
  }

  // 連結（concat demuxer）。全クリップ同一パラメータなので -c copy で無劣化結合。
  if (clips.length > 0) {
    const listPath = join(OUT, 'concat.txt');
    writeFileSync(listPath, clips.map((f) => `file '${f}'`).join('\n'), 'utf8');
    const finalMp4 = join(OUT, 'final.mp4');
    const res = runFfmpeg(['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', finalMp4]);
    if (res.ok) {
      const kb = (statSync(finalMp4).size / 1024).toFixed(1);
      console.log(`\n最終MP4: ${finalMp4} (${kb} KB / ${clips.length}シーン連結) ✓`);
      const probe = spawnSync(ffmpegBin(), ['-hide_banner', '-i', finalMp4], { encoding: 'utf8' }).stderr ?? '';
      console.log(`  ${probe.match(/Duration: [^,]+/)?.[0] ?? 'Duration: ?'}`);
      console.log(`  ${probe.match(/Stream #\d+:\d+[^\n]*Video:[^\n]*/)?.[0]?.trim() ?? 'Video stream: ?'}`);
    } else {
      console.log(`連結失敗: ${res.stderr.slice(-300)}`);
    }
  }

  console.log('\n完了。.spike/final.mp4 が実出力。SVGをブラウザで開けばプレビュー相当を確認できます。');
  console.log('※動画素材ありシーン（下PNG→動画→上PNG重ね）はサンプル素材導入後に実証予定（overlayフィルタ）。');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
