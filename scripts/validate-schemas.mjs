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

// テンプレ Layer の縁取り（strokeColor/strokeWidth・#275・任意・後方互換のマイナーで 1.0 据え置き）
const tplBase = load(fx('template-pack/opening_yuko_right_v1/template.json'));
const withLayer0 = (prop) => ({ ...tplBase, layers: tplBase.layers.map((l, i) => (i === 0 ? { ...l, ...prop } : l)) });
const tplAccept = [
  ['template: 縁取り(strokeColor/strokeWidth)を許容（#275）', withLayer0({ strokeColor: '#ffffff', strokeWidth: 2 })],
  ['template: strokeWidth=0（縁取りなし・境界）を許容', withLayer0({ strokeColor: '#ffffff', strokeWidth: 0 })],
  ['template: layer rotation を許容（#307）', withLayer0({ rotation: 30 })],
];
const tplReject = [
  ['template: strokeColor 非hexは拒否', withLayer0({ strokeColor: 'white' })],
  ['template: strokeWidth 負は拒否', withLayer0({ strokeWidth: -1 })],
  ['template: rotation 範囲外(400)は拒否', withLayer0({ rotation: 400 })],
  ['template: rotation 負(-1)は拒否', withLayer0({ rotation: -1 })],
  ['template: rotation 360（=0と重複）は除外（exclusiveMaximum）', withLayer0({ rotation: 360 })],
];
for (const [desc, data] of tplAccept) {
  if (vTemplate(data)) console.log(`PASS  must-accept  ${desc}`);
  else { ok = false; console.log(`FAIL  must-accept  ${desc}`); for (const e of vTemplate.errors ?? []) console.log(`   ${e.instancePath} ${e.message}`); }
}
for (const [desc, data] of tplReject) {
  if (!vTemplate(data)) console.log(`PASS  must-reject  ${desc}`);
  else { ok = false; console.log(`FAIL  must-reject  ${desc}（スキーマが許容してしまった）`); }
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

// generalBrief の上限（ADR-0011 #4）を代表データ（正常・異常）で常設検証（CLAUDE.md §7）。
const generalBase = {
  schemaVersion: '1.20', projectId: 'proj_20260101_001', projectName: 'check', purpose: 'report',
  videoKind: 'general', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  videoSettings: { aspectRatio: '16:9', fps: 30, targetDurationSec: 60, maxDurationSec: 300 },
  voiceSettings: { defaultVoiceId: 'voicevox_zundamon' }, assets: [], parts: [], scenes: [],
};
const withBrief = (brief) => ({ ...generalBase, generalBrief: { title: '発表', ...brief } });
// 場面フォント（scene.fontId・1.5）の境界値：schema が enum＋null を強制するか（catalog ドリフト検知＝fontCatalog.test とは別観点）。
const sceneBase = {
  sceneId: 'scene_001', partId: 'part_001', order: 1, sceneType: 'opening',
  templateId: 'opening_yuko_right_v1', durationSec: 8, assetRefs: {},
  character: { enabled: false, characterId: 'yuko' }, texts: {},
  narration: { text: 'x', status: 'none' }, warnings: [],
};
const withScene = (extra) => ({ ...withBrief({}), scenes: [{ ...sceneBase, ...extra }] });
const mustAccept = [
  ['general: 上限内（agenda20件/各100字・targetAudience100字）', withBrief({ agenda: Array.from({ length: 20 }, () => 'あ'.repeat(100)), keyPoints: ['要点'], targetAudience: 'あ'.repeat(100) })],
  ['videoSettings: 縦型 9:16（width/height なし）', { ...withBrief({}), videoSettings: { aspectRatio: '9:16', fps: 30, targetDurationSec: 60, maxDurationSec: 300 } }],
  ['scene: fontId=null（継承）を許容', withScene({ fontId: null })],
  ['scene: fontId 既知（kaitou-yokoku-gothic）を許容', withScene({ fontId: 'kaitou-yokoku-gothic' })],
  ['scene: fontId 未指定（継承）を許容', withScene({})],
  ['freeLayout: 新図形(star)＋枠線(stroke)を許容', withScene({ sceneType: 'free', freeLayout: [{ id: 'free_001', kind: 'shape', x: 10, y: 10, w: 100, h: 100, shapeType: 'star', fillColor: '#ff0000', opacity: 1, strokeColor: '#112233', strokeWidth: 3 }] })],
  ['scene: textFontIds（title フォント上書き）を許容', withScene({ textFontIds: { title: 'kaitou-yokoku-gothic' } })],
  ['freeLayout: text の fontId を許容', withScene({ sceneType: 'free', freeLayout: [{ id: 'free_001', kind: 'text', x: 0, y: 0, w: 100, h: 50, text: 'a', fontId: 'gen-interface-jp-display' }] })],
  ['freeLayout: rotation（回転・度）を許容（1.9・#208）', withScene({ sceneType: 'free', freeLayout: [{ id: 'free_001', kind: 'shape', x: 10, y: 10, w: 100, h: 100, rotation: 30 }] })],
  ['freeLayout: text 体裁 lineHeight/textAlign/縁取り を許容（1.10・#209）', withScene({ sceneType: 'free', freeLayout: [{ id: 'free_001', kind: 'text', x: 0, y: 0, w: 100, h: 50, text: 'a', lineHeight: 1.6, textAlign: 'center', strokeColor: '#000000', strokeWidth: 2 }] })],
  ['freeLayout: hidden/locked を許容（1.11・#210）', withScene({ sceneType: 'free', freeLayout: [{ id: 'free_001', kind: 'shape', x: 0, y: 0, w: 100, h: 50, hidden: true, locked: true }] })],
  ['freeLayout: 字幕要素(subtitle)＋対象なしを許容（1.20・ADR-0029）', withScene({ sceneType: 'free', freeLayout: [{ id: 'free_001', kind: 'subtitle', x: 240, y: 900, w: 1440, h: 120 }] })],
  ['freeLayout: 字幕 subtitleSource=読み上げ/全行を許容（1.20）', withScene({ sceneType: 'free', freeLayout: [{ id: 'free_001', kind: 'subtitle', x: 0, y: 0, w: 100, h: 50, subtitleSource: { kind: 'narration' } }, { id: 'free_002', kind: 'subtitle', x: 0, y: 0, w: 100, h: 50, subtitleSource: { kind: 'allLines' } }] })],
  ['freeLayout: 字幕 subtitleSource=話者(catalog/default)を許容（1.20・P1-2）', withScene({ sceneType: 'free', freeLayout: [{ id: 'free_001', kind: 'subtitle', x: 0, y: 0, w: 100, h: 50, subtitleSource: { kind: 'speaker', speaker: { kind: 'catalog', speaker: 3 } } }, { id: 'free_002', kind: 'subtitle', x: 0, y: 0, w: 100, h: 50, subtitleSource: { kind: 'speaker', speaker: { kind: 'default' } } }] })],
  ['scene: lines（掛け合い・行ごと speaker/字幕/開始秒）を許容（1.8・ADR-0015）', withScene({ lines: [{ lineId: 'line_001', text: 'やあ', speaker: 3, status: 'none' }, { lineId: 'line_002', text: 'どうも', speaker: 2, subtitleEnabled: true, startSec: 2, status: 'none' }], subtitleEnabledDefault: true })],
  ['scene: slotFits（場面ごとの収め方上書き）を許容（1.13・④）', withScene({ slotFits: { background: 'contain', mainVisual: 'stretch' } })],
  ['scene: groups（要素のグループ化・ネスト）を許容（1.14・ADR-0022）', withScene({ sceneType: 'free', freeLayout: [{ id: 'free_001', kind: 'shape', x: 0, y: 0, w: 10, h: 10 }], groups: [{ id: 'group_001', members: ['free_001'], transform: { x: 10, y: -5, rotation: 15, scale: 1.5 }, name: 'まとまり', hidden: false, locked: false }, { id: 'group_002', members: ['group_001'], transform: { x: 0, y: 0, rotation: 0, scale: 1 } }] })],
  ['timelineOverlay: 場面アンカー＋絶対のテロップクリップを許容（1.15・ADR-0018）', { ...withBrief({}), timelineOverlay: { clips: [{ id: 'ovclip_001', track: 'telop', anchorSceneId: 'scene_001', startSec: 1, durationSec: 2, text: '補足' }, { id: 'ovclip_002', track: 'telop', startSec: 3, durationSec: 1.5 }] } }],
  ['scene: bgmSettings（場面ごとBGM・曲の上書き）を許容（1.16・ADR-0018 ③(7)）', withScene({ bgmSettings: { enabled: true, bundledBgmId: 'found-new-hope', volume: 0.3, loop: true } })],
  ['scene: bgmSettings（無音＝enabled:false のみ）を許容（1.16・ADR-0018 ③(7)）', withScene({ bgmSettings: { enabled: false } })],
  ['timelineOverlay: animations（キーフレーム）を許容（1.17・ADR-0019 ④）', { ...withBrief({}), timelineOverlay: { animations: [{ id: 'anim_001', sceneId: 'scene_001', targetId: 'free_001', keyframes: [{ timeSec: 0, opacity: 0 }, { timeSec: 2, x: 100, y: 50, scale: 1.5, opacity: 1, rotation: 90, easing: 'ease-in-out' }] }] } }],
  ['scene: slotVideoStart（動画スロット再生開始・3モード）を許容（1.18・ADR-0027）', withScene({ slotVideoStart: { mainVisual: { mode: 'withAnim' }, sub: { mode: 'afterAnim' }, bg: { mode: 'delay', delaySec: 0.6 } } })],
  // 注：slotClips は startSec/endSec を各 minimum:0 でしか縛れない。**意味的な異常（反転レンジ endSec≤startSec・0尺）は
  // JSON Schema の cross-field では弾けない**（base Clip $def も同じ）＝schema が通る＝安全ではない。per-use の部分上書きが
  // 継承値を跨いで作る反転は resolveSlotClip が終端なしへ正規化し、UI がスライダーをクランプして担保する（#472 レビュー P2/P3）。
  ['scene: slotClips（クリップ per-use 上書き・範囲/速度/元音声）を許容（1.19・ADR-0028）', withScene({ slotClips: { mainVisual: { startSec: 1, endSec: 5, speed: 1.5, useOriginalAudio: true, originalAudioVolume: 0.4 }, sub: { speed: 0.5 } } })],
];
const mustReject = [
  ['general: title 101字', withBrief({ title: 'あ'.repeat(101) })],
  ['general: agenda 21件', withBrief({ agenda: Array.from({ length: 21 }, () => 'x') })],
  ['general: agenda 1項目101字', withBrief({ agenda: ['あ'.repeat(101)] })],
  ['general: keyPoints 21件', withBrief({ keyPoints: Array.from({ length: 21 }, () => 'x') })],
  ['general: targetAudience 101字', withBrief({ targetAudience: 'あ'.repeat(101) })],
  ['videoSettings: 旧 width/height 同梱は拒否（1.2 で撤廃）', { ...withBrief({}), videoSettings: { aspectRatio: '16:9', width: 1920, height: 1080, fps: 30, targetDurationSec: 60, maxDurationSec: 300 } }],
  ['videoSettings: 未知の比率 1:1 は拒否', { ...withBrief({}), videoSettings: { aspectRatio: '1:1', fps: 30, targetDurationSec: 60, maxDurationSec: 300 } }],
  ['scene: fontId 未知（old-font）は拒否', withScene({ fontId: 'old-font' })],
  ['scene: slotFits の不正な収め方(zoom)は拒否', withScene({ slotFits: { background: 'zoom' } })],
  ['freeLayout: 未知の図形(hexagon)は拒否', withScene({ sceneType: 'free', freeLayout: [{ id: 'free_001', kind: 'shape', x: 10, y: 10, w: 100, h: 100, shapeType: 'hexagon' }] })],
  ['freeLayout: strokeColor 非hexは拒否', withScene({ sceneType: 'free', freeLayout: [{ id: 'free_001', kind: 'shape', x: 10, y: 10, w: 100, h: 100, strokeColor: 'red' }] })],
  ['freeLayout: strokeWidth 負は拒否', withScene({ sceneType: 'free', freeLayout: [{ id: 'free_001', kind: 'shape', x: 10, y: 10, w: 100, h: 100, strokeWidth: -1 }] })],
  ['freeLayout: rotation 範囲外(400)は拒否', withScene({ sceneType: 'free', freeLayout: [{ id: 'free_001', kind: 'shape', x: 10, y: 10, w: 100, h: 100, rotation: 400 }] })],
  ['freeLayout: rotation 負(-1)は拒否', withScene({ sceneType: 'free', freeLayout: [{ id: 'free_001', kind: 'shape', x: 10, y: 10, w: 100, h: 100, rotation: -1 }] })],
  ['timelineOverlay: 未対応トラック(bgm)は拒否（1.15・ADR-0018）', { ...withBrief({}), timelineOverlay: { clips: [{ id: 'ovclip_001', track: 'bgm', startSec: 0, durationSec: 1 }] } }],
  ['scene: bgmSettings 未知の bundledBgmId は拒否（1.16・ADR-0018 ③(7)）', withScene({ bgmSettings: { enabled: true, bundledBgmId: 'nope' } })],
  ['timelineOverlay: durationSec 0 は拒否', { ...withBrief({}), timelineOverlay: { clips: [{ id: 'ovclip_001', track: 'telop', startSec: 0, durationSec: 0 }] } }],
  ['timelineOverlay: id 形式不正(clip_001)は拒否', { ...withBrief({}), timelineOverlay: { clips: [{ id: 'clip_001', track: 'telop', startSec: 0, durationSec: 1 }] } }],
  ['timelineOverlay: animation id 形式不正(a_001)は拒否（1.17）', { ...withBrief({}), timelineOverlay: { animations: [{ id: 'a_001', sceneId: 'scene_001', targetId: 'free_001', keyframes: [{ timeSec: 0 }] }] } }],
  ['timelineOverlay: keyframe opacity 範囲外(1.5)は拒否（1.17）', { ...withBrief({}), timelineOverlay: { animations: [{ id: 'anim_001', sceneId: 'scene_001', targetId: 'free_001', keyframes: [{ timeSec: 0, opacity: 1.5 }] }] } }],
  ['freeLayout: rotation 360（=0と重複）は除外（exclusiveMaximum）', withScene({ sceneType: 'free', freeLayout: [{ id: 'free_001', kind: 'shape', x: 10, y: 10, w: 100, h: 100, rotation: 360 }] })],
  ['freeLayout: textAlign 未知(middle)は拒否', withScene({ sceneType: 'free', freeLayout: [{ id: 'free_001', kind: 'text', x: 0, y: 0, w: 100, h: 50, text: 'a', textAlign: 'middle' }] })],
  ['freeLayout: lineHeight 範囲外(5)は拒否', withScene({ sceneType: 'free', freeLayout: [{ id: 'free_001', kind: 'text', x: 0, y: 0, w: 100, h: 50, text: 'a', lineHeight: 5 }] })],
  ['freeLayout: hidden 非boolean は拒否', withScene({ sceneType: 'free', freeLayout: [{ id: 'free_001', kind: 'shape', x: 0, y: 0, w: 100, h: 50, hidden: 'yes' }] })],
  ['scene: textFontIds 未知フォントは拒否', withScene({ textFontIds: { title: 'old-font' } })],
  ['freeLayout: text の fontId 未知は拒否', withScene({ sceneType: 'free', freeLayout: [{ id: 'free_001', kind: 'text', x: 0, y: 0, w: 100, h: 50, text: 'a', fontId: 'old-font' }] })],
  ['freeLayout: subtitleSource 未知 kind は拒否（1.20・ADR-0029）', withScene({ sceneType: 'free', freeLayout: [{ id: 'free_001', kind: 'subtitle', x: 0, y: 0, w: 100, h: 50, subtitleSource: { kind: 'lines' } }] })],
  ['freeLayout: subtitleSource=speaker で speaker 欠落は拒否（1.20）', withScene({ sceneType: 'free', freeLayout: [{ id: 'free_001', kind: 'subtitle', x: 0, y: 0, w: 100, h: 50, subtitleSource: { kind: 'speaker' } }] })],
  ['freeLayout: subtitleSource speaker=catalog で speaker 番号欠落は拒否（1.20）', withScene({ sceneType: 'free', freeLayout: [{ id: 'free_001', kind: 'subtitle', x: 0, y: 0, w: 100, h: 50, subtitleSource: { kind: 'speaker', speaker: { kind: 'catalog' } } }] })],
  ['freeLayout: subtitleSource 未知フィールドは拒否（additionalProperties:false・1.20）', withScene({ sceneType: 'free', freeLayout: [{ id: 'free_001', kind: 'subtitle', x: 0, y: 0, w: 100, h: 50, subtitleSource: { kind: 'narration', extra: 1 } }] })],
  ['lines: lineId が不正(line_1)は拒否', withScene({ lines: [{ lineId: 'line_1', text: 'x', status: 'none' }] })],
  ['lines: speaker 非整数は拒否', withScene({ lines: [{ lineId: 'line_001', text: 'x', speaker: 1.5, status: 'none' }] })],
  ['lines: speaker 負数は拒否', withScene({ lines: [{ lineId: 'line_001', text: 'x', speaker: -1, status: 'none' }] })],
  ['lines: 未知フィールド(voiceId)は拒否＝行は speaker（additionalProperties:false）', withScene({ lines: [{ lineId: 'line_001', text: 'x', status: 'none', voiceId: 'voicevox_zundamon' }] })],
  ['groups: id が group_ 形式でないと拒否（g1）', withScene({ groups: [{ id: 'g1', members: [], transform: { x: 0, y: 0, rotation: 0, scale: 1 } }] })],
  ['groups: transform.scale 0 は拒否（exclusiveMinimum）', withScene({ groups: [{ id: 'group_001', members: [], transform: { x: 0, y: 0, rotation: 0, scale: 0 } }] })],
  ['groups: transform.scale 負は拒否', withScene({ groups: [{ id: 'group_001', members: [], transform: { x: 0, y: 0, rotation: 0, scale: -1 } }] })],
  ['groups: transform に必須欠落(scale)は拒否', withScene({ groups: [{ id: 'group_001', members: [], transform: { x: 0, y: 0, rotation: 0 } }] })],
  ['groups: 未知フィールド(color)は拒否（additionalProperties:false）', withScene({ groups: [{ id: 'group_001', members: [], transform: { x: 0, y: 0, rotation: 0, scale: 1 }, color: '#fff' }] })],
  ['scene: slotClips speed 範囲外(3.0)は拒否（1.19・ADR-0028）', withScene({ slotClips: { mainVisual: { speed: 3.0 } } })],
  ['scene: slotClips originalAudioVolume 範囲外(2.0)は拒否', withScene({ slotClips: { mainVisual: { originalAudioVolume: 2.0 } } })],
  ['scene: slotClips startSec 負は拒否', withScene({ slotClips: { mainVisual: { startSec: -1 } } })],
  ['scene: slotClips 未知フィールド(fit)は拒否（additionalProperties:false＝fit は slotFits）', withScene({ slotClips: { mainVisual: { fit: 'cover' } } })],
  ['scene: slotVideoStart 未知モード(afterDelay)は拒否（1.18・ADR-0027）', withScene({ slotVideoStart: { mainVisual: { mode: 'afterDelay' } } })],
  ['scene: slotVideoStart mode 欠落は拒否（required）', withScene({ slotVideoStart: { mainVisual: { delaySec: 1 } } })],
  ['scene: slotVideoStart mode=delay で delaySec 欠落は拒否（if/then＝「途中から」が「同時」に化けない）', withScene({ slotVideoStart: { mainVisual: { mode: 'delay' } } })],
  ['scene: slotVideoStart delaySec 負は拒否', withScene({ slotVideoStart: { mainVisual: { mode: 'delay', delaySec: -1 } } })],
  ['scene: slotVideoStart 未知フィールド(startSec)は拒否（additionalProperties:false）', withScene({ slotVideoStart: { mainVisual: { mode: 'delay', delaySec: 1, startSec: 2 } } })],
];
for (const [desc, data] of mustAccept) {
  if (vProject(data)) console.log(`PASS  must-accept  ${desc}`);
  else { ok = false; console.log(`FAIL  must-accept  ${desc}`); for (const e of vProject.errors ?? []) console.log(`   ${e.instancePath} ${e.message}`); }
}
for (const [desc, data] of mustReject) {
  if (!vProject(data)) console.log(`PASS  must-reject  ${desc}`);
  else { ok = false; console.log(`FAIL  must-reject  ${desc}（スキーマが許容してしまった）`); }
}

// ai-video-plan の掛け合い（narrationLines・#180）を schema レベルで検証（任意追加・1.0 据え置き）。
const aiBase = {
  schemaVersion: '1.0',
  videoPlan: { title: 't', purpose: 'company_intro', targetDurationSec: 30 },
  parts: [{ partTitle: 'p', scenes: [{ sceneType: 'opening', templateId: 'tpl', durationSec: 8, texts: { title: 'x' } }] }],
};
const withAiScene = (extra) => ({ ...aiBase, parts: [{ partTitle: 'p', scenes: [{ ...aiBase.parts[0].scenes[0], ...extra }] }] });
const aiAccept = [
  ['ai: narrationLines（掛け合い・voiceCharacter/subtitle）を許容', withAiScene({ narrationLines: [{ text: 'やあ', voiceCharacter: 'ずんだもん', subtitle: 'やあ' }, { text: 'どうも', subtitleEnabled: false }] })],
];
const aiReject = [
  ['ai: narrationLines の行は text 必須', withAiScene({ narrationLines: [{ voiceCharacter: 'ずんだもん' }] })],
  ['ai: narrationLines の未知フィールド(speaker)は拒否＝行は voiceCharacter（名前）', withAiScene({ narrationLines: [{ text: 'x', speaker: 3 }] })],
];
for (const [desc, data] of aiAccept) {
  if (vPlan(data)) console.log(`PASS  must-accept  ${desc}`);
  else { ok = false; console.log(`FAIL  must-accept  ${desc}`); for (const e of vPlan.errors ?? []) console.log(`   ${e.instancePath} ${e.message}`); }
}
for (const [desc, data] of aiReject) {
  if (!vPlan(data)) console.log(`PASS  must-reject  ${desc}`);
  else { ok = false; console.log(`FAIL  must-reject  ${desc}（スキーマが許容してしまった）`); }
}

console.log(ok ? '\nALL OK' : '\nHAS FAILURES');
process.exit(ok ? 0 : 1);
