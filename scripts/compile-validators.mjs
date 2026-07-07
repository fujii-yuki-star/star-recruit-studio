// 正典スキーマを ajv で「事前コンパイル」し、実行時 eval（new Function）無しの検証関数を生成する（#156）。
// これにより本番 CSP から script-src 'unsafe-eval' を外せる。生成物は gitignore＝dev/build/test/typecheck の
// pre フックで毎回最新を生成するためドリフトしない（package.json 参照）。
// 対象は「フロントで実行時検証する」3スキーマ（ai-video-plan / template / project・#416 で project を追加）。
// ai-video-plan/template は "format" 不使用・他ファイル $ref なし。project は date-time format を使うが、
// strict:false で未登録 format は no-op（無視）＝ajv-formats 無しでも standalone 自己完結（type:string は効く・#416）。
// いずれも他ファイル $ref なし（$defs は自己内包）。
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import standaloneCode from 'ajv/dist/standalone/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const loadSchema = (rel) => JSON.parse(readFileSync(join(root, rel), 'utf8'));

const aiVideoPlanSchema = loadSchema('docs/yuko_recruit_docs/schemas/ai-video-plan.schema.json');
const templateSchema = loadSchema('docs/yuko_recruit_docs/schemas/template.schema.json');
const projectSchema = loadSchema('docs/yuko_recruit_docs/schemas/project.schema.json');

// validateVideoPlan/templateFs と同設定（draft 2020-12・strict:false・allErrors）。
// code.source/esm で ESM の standalone 検証関数を出力する。project の date-time format は strict:false で無視される
// （読込時の網＝型/必須/enum/範囲を検証・#416。date-time の書式一致は CI の validate-schemas.mjs で担保）。
const ajv = new Ajv2020({ code: { source: true, esm: true }, allErrors: true, strict: false });
ajv.addSchema(aiVideoPlanSchema);
ajv.addSchema(templateSchema);
ajv.addSchema(projectSchema);

const rawCode = standaloneCode(ajv, {
  validateAiVideoPlan: aiVideoPlanSchema.$id,
  validateTemplate: templateSchema.$id,
  validateProject: projectSchema.$id,
});

// ajv standalone は esm:true でも runtime helper を CJS の `require(...)` で出すことがある（例: ucs2length）。
// Vite/ブラウザは require 不可なので、先頭の ESM import へ巻き上げる。default import は Vite の CJS interop
// （__esModule 解決＝vite build も vitest も同じ esbuild 変換）で実体（関数）になる。
const importLines = [];
const esmBody = rawCode.replace(
  /const (\w+) = require\((["'])(.+?)\2\)(\.default)?;/g,
  (_m, name, _q, path) => {
    // 拡張子が無い場合のみ .js を補う（既に .js のとき .js.js になる二重付与を防ぐ＝冪等・ajv 更新耐性）。
    const resolved = path.endsWith('.js') ? path : `${path}.js`;
    importLines.push(`import ${name} from ${JSON.stringify(resolved)};`);
    return '';
  },
);

const outDir = join(root, 'src/domain/validation/generated');
mkdirSync(outDir, { recursive: true });
const banner =
  '// 自動生成（scripts/compile-validators.mjs・#156）。直接編集しない。\n' +
  '// スキーマ変更時は `npm run validators:build`（dev/build/test/typecheck の前段でも自動生成）。\n' +
  '/* eslint-disable */\n';
const code = banner + importLines.join('\n') + (importLines.length ? '\n' : '') + esmBody;
writeFileSync(join(outDir, 'validators.js'), code);
console.log(`✓ 生成: src/domain/validation/generated/validators.js（import 巻き上げ ${importLines.length} 件）`);
