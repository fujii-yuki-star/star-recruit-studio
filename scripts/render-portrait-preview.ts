/**
 * テンプレの見た目を PNG でプレビューする（B3 目視デザインゲート用・ADR-0012/0001）。
 * テンプレ＋見本内容 → layoutScene → 同一SVG → resvg で PNG（キャンバス実寸）。FFmpeg は使わない。
 * 実行: npx tsx scripts/render-portrait-preview.ts [templateId...]
 *   - 引数なし: 縦型（9:16）テンプレを全部レンダリング
 *   - 引数あり: 指定 templateId のみ
 * 出力: .spike/preview_<templateId>.png（gitignore）。実素材なし＝プレースホルダで配置・安全余白を確認する。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Scene, Texts } from '../src/domain/project/types';
import type { Template } from '../src/domain/template/types';
import { NARRATION_STATUS } from '../src/domain/enums';
import { DEFAULT_CHARACTER_ID } from '../src/domain/constants';
import { layoutScene } from '../src/renderer/layout';
import { layoutToSvg } from '../src/renderer/sceneSvg';
import { sampleTemplates } from '../src/infrastructure/sampleData';

const OUT = '.spike';
const FONT = 'Noto Sans JP';

/** テンプレが使う textKey に見本テキストを当てた Scene を作る（実素材なし＝配置確認用）。 */
function sampleScene(template: Template): Scene {
  const hasCharacter = template.layers.some((l) => l.type === 'character');
  const texts: Texts = {};
  for (const l of template.layers) {
    if (l.textKey === 'title') texts.title = '新卒採用 2026';
    else if (l.textKey === 'subtitle') texts.subtitle = 'ここに字幕が入ります。読みやすさと、画面下の安全余白を確認します。';
    else if (l.textKey === 'main') texts.main = '私たちと一緒に、未来をつくりませんか。新しい仲間を募集しています。';
    else if (l.textKey === 'caption') texts.caption = 'キャプションの例';
    else if (l.textKey === 'url') texts.url = 'example.co.jp';
  }
  return {
    sceneId: `preview_${template.templateId}`,
    partId: '',
    order: 1,
    sceneType: template.category,
    templateId: template.templateId,
    durationSec: template.defaults?.durationSec ?? 8,
    assetRefs: {},
    character: { enabled: hasCharacter, characterId: DEFAULT_CHARACTER_ID, poseAssetId: null },
    texts,
    narration: { text: '', status: NARRATION_STATUS.none },
    warnings: [],
  };
}

async function rasterize(svg: string, width: number): Promise<Buffer> {
  const { Resvg } = await import('@resvg/resvg-js');
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: width }, // キャンバス幅＝実寸（縦型は 1080）。
    font: { loadSystemFonts: true, defaultFontFamily: FONT },
  });
  return Buffer.from(resvg.render().asPng());
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const only = process.argv.slice(2);
  const targets = sampleTemplates.filter((t) =>
    only.length > 0 ? only.includes(t.templateId) : t.aspectRatio === '9:16',
  );
  if (targets.length === 0) {
    console.log('対象テンプレがありません（縦型が未追加、または指定 ID が不一致）。');
    return;
  }
  for (const t of targets) {
    const svg = layoutToSvg(layoutScene(sampleScene(t), t));
    const png = await rasterize(svg, t.canvas.width);
    const path = join(OUT, `preview_${t.templateId}.png`);
    writeFileSync(path, png);
    console.log(`${t.templateId} (${t.aspectRatio} ${t.canvas.width}x${t.canvas.height}) → ${path} (${png.length} bytes)`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
