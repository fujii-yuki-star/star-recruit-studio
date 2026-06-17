/**
 * schemas/*.schema.json と fixtures の整合を機械検証する CI ゲート（14_TEST_STRATEGY.md §3）。
 * 実行: npm run validate:schemas
 *  - 各スキーマを ajv(draft 2020-12) でコンパイル
 *  - fixtures を対応スキーマで検証
 *  - project.sample は相互参照（assetRefs→assets / templateId→pack / poseAssetId→yuko / part↔scene / bgm→assets）も検査
 */
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const base = join(root, 'docs', 'yuko_recruit_docs');
const load = (p) => JSON.parse(readFileSync(p, 'utf8'));

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);

const vProject = ajv.compile(load(join(base, 'schemas/project.schema.json')));
const vTemplate = ajv.compile(load(join(base, 'schemas/template.schema.json')));
const vPlan = ajv.compile(load(join(base, 'schemas/ai-video-plan.schema.json')));

const fx = (p) => join(base, 'fixtures', p);
const cases = [
  ['project.sample.json', vProject, fx('project.sample.json')],
  ['ai-video-plan.sample.json', vPlan, fx('ai-video-plan.sample.json')],
  ['ai-video-plan.general.sample.json', vPlan, fx('ai-video-plan.general.sample.json')],
  ['template-pack/opening_yuko_right_v1', vTemplate, fx('template-pack/opening_yuko_right_v1/template.json')],
  ['template-pack/photo_left_text_right_yuko_v1', vTemplate, fx('template-pack/photo_left_text_right_yuko_v1/template.json')],
];

let ok = true;
for (const [name, validate, path] of cases) {
  const valid = validate(load(path));
  if (valid) {
    console.log(`PASS  schema    ${name}`);
  } else {
    ok = false;
    console.log(`FAIL  schema    ${name}`);
    for (const e of validate.errors ?? []) {
      console.log(`   ${e.instancePath || '(root)'} ${e.message} ${JSON.stringify(e.params)}`);
    }
  }
}

// 相互参照（schema では表せない横断条件）
const project = load(fx('project.sample.json'));
const assetIds = new Set(project.assets.map((a) => a.assetId));
const yukoIds = new Set(project.assets.filter((a) => a.assetType === 'yuko').map((a) => a.assetId));
const templateIds = new Set(['opening_yuko_right_v1', 'photo_left_text_right_yuko_v1']);
let sem = true;
const fail = (m) => { sem = false; console.log(`   SEM  ${m}`); };
for (const s of project.scenes) {
  if (!templateIds.has(s.templateId)) fail(`${s.sceneId}: templateId ${s.templateId} not in pack`);
  for (const [k, v] of Object.entries(s.assetRefs)) {
    if (v !== null && !assetIds.has(v)) fail(`${s.sceneId}: assetRef ${k}=${v} missing`);
  }
  if (s.character.poseAssetId && !yukoIds.has(s.character.poseAssetId)) fail(`${s.sceneId}: poseAssetId ${s.character.poseAssetId} not a yuko asset`);
}
const sceneById = new Map(project.scenes.map((s) => [s.sceneId, s]));
for (const p of project.parts) {
  for (const sid of p.sceneIds) {
    const sc = sceneById.get(sid);
    if (!sc) fail(`part ${p.partId}: scene ${sid} missing`);
    else if (sc.partId !== p.partId) fail(`scene ${sid}.partId=${sc.partId} != ${p.partId}`);
  }
}
if (project.bgmSettings?.assetId && !assetIds.has(project.bgmSettings.assetId)) fail(`bgm assetId ${project.bgmSettings.assetId} missing`);
console.log(sem ? 'PASS  semantic  project.sample cross-refs' : 'FAIL  semantic  project.sample cross-refs');
ok = ok && sem;

console.log(ok ? '\nALL OK' : '\nHAS FAILURES');
process.exit(ok ? 0 : 1);
