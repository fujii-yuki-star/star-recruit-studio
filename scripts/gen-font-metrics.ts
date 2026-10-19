// 同梱の字体の字幅表を作る（ADR-0063）。`npm run gen:font-metrics`
//
// `public/fonts/` の字体ファイル（`BUNDLED_FONT_FILES` の全部）を読み、
// `src/domain/text/generated/bundledFontMetrics.ts` を書く。字体を差し替えたら作り直す
// （作り直し忘れは `fontMetrics.test.ts` の「字体ファイルとずれていない」が赤くする）。
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { BUNDLED_FONT_FILES } from '../src/domain/font/fontCatalog';
import { readFontAdvances } from '../src/domain/font/fontAdvance';
import { buildFontMetrics, type BundledFontMetrics } from '../src/domain/text/fontMetricsBuild';

const files = [...new Set(Object.values(BUNDLED_FONT_FILES).flatMap((f) => [f.regular, f.bold]))].sort();
const out: Record<string, BundledFontMetrics> = {};
for (const file of files) {
  const reader = readFontAdvances(new Uint8Array(readFileSync(`public/fonts/${file}`)));
  if (!reader) throw new Error(`字体を読めませんでした: ${file}`);
  out[file] = buildFontMetrics(reader);
}

const body = `// ⚠️ **作られたファイル**＝手で直さない。\`npm run gen:font-metrics\` で作り直す（ADR-0063）。
// 同梱の字体の字幅表（字体の単位のまま）。作り方は \`src/domain/text/fontMetricsBuild.ts\`。
import type { BundledFontMetrics } from '../fontMetricsBuild';

export const BUNDLED_FONT_METRICS: Readonly<Record<string, BundledFontMetrics>> = ${JSON.stringify(out, null, 1)};
`;
mkdirSync('src/domain/text/generated', { recursive: true });
writeFileSync('src/domain/text/generated/bundledFontMetrics.ts', body);
console.log(`字幅表を作りました（${files.length} ファイル・${body.length.toLocaleString()} 字）`);
