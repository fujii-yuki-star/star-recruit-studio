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

const projectSchema = load(join(base, 'schemas/project.schema.json'));
// 版はスキーマから引く（直書きしない・§2-7）。ここに版を書くと、バンプのたびに本ファイルの代表データが
// 全部落ちて「無関係な失敗」を直す作業が毎回発生する（実際 #555 の 1.24 で発生）。
const PROJECT_VERSION = projectSchema.properties.schemaVersion.const;
const vProject = ajv.compile(projectSchema);
const vTemplate = ajv.compile(load(join(base, 'schemas/template.schema.json')));
const vPlan = ajv.compile(load(join(base, 'schemas/ai-video-plan.schema.json')));
// タイムライン形式（ADR-0032・#627）。project の $defs を $ref で共有するので、vProject を先に compile して
// $id を ajv に登録しておく必要がある（上の行順に依存＝入れ替えると $ref が解決できず落ちる）。
const vTimeline = ajv.compile(load(join(base, 'schemas/timeline-project.schema.json')));

const fx = (p) => join(base, 'fixtures', p);
const cases = [
  ['project.sample.json', vProject, fx('project.sample.json')],
  ['ai-video-plan.sample.json', vPlan, fx('ai-video-plan.sample.json')],
  ['ai-video-plan.general.sample.json', vPlan, fx('ai-video-plan.general.sample.json')],
  ['timeline-project.sample.json', vTimeline, fx('timeline-project.sample.json')],
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
  schemaVersion: PROJECT_VERSION, projectId: 'proj_20260101_001', projectName: 'check', purpose: 'report',
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
  // 場面の表示時間は `> 0`（11 §7・schema `exclusiveMinimum:0`＝#586 で正典どうしの矛盾を解消）。
  // 場面ごとの上限/下限は持たない（#553）ので、0 より大きければ極端に短くても許容する。
  ['scene: durationSec 0.1（極短でも >0 なら許容・下限は持たない #553）', withScene({ durationSec: 0.1 })],
  ['scene: fontId=null（継承）を許容', withScene({ fontId: null })],
  ['scene: fontId 既知（kaitou-yokoku-gothic）を許容', withScene({ fontId: 'kaitou-yokoku-gothic' })],
  ['scene: fontId 未指定（継承）を許容', withScene({})],
  ['freeLayout: 新図形(star)＋枠線(stroke)を許容', withScene({ sceneType: 'free', freeLayout: [{ id: 'free_001', kind: 'shape', x: 10, y: 10, w: 100, h: 100, shapeType: 'star', fillColor: '#ff0000', opacity: 1, strokeColor: '#112233', strokeWidth: 3 }] })],
  ['scene: textFontIds（title フォント上書き）を許容', withScene({ textFontIds: { title: 'kaitou-yokoku-gothic' } })],
  // 文字の体裁の場面別上書き（scene.textStyles・1.24・#555）。制約は Layer/FreeElement の同名プロパティと同一。
  ['scene: textStyles（色/サイズ/太さ/縁取り）を許容（1.24・#555）', withScene({ textStyles: { title: { color: '#ff0000', fontSize: 72, fontWeight: 'bold', strokeColor: '#000000', strokeWidth: 4 } } })],
  ['scene: textStyles の一部だけ指定を許容（残りはテンプレ継承）', withScene({ textStyles: { subtitle: { color: '#00ff00' } } })],
  ['scene: textStyles 空オブジェクト（全部継承）を許容', withScene({ textStyles: { main: {} } })],
  ['scene: textStyles strokeWidth=0（縁取りなし・境界）を許容', withScene({ textStyles: { url: { strokeWidth: 0 } } })],
  ['freeLayout: text の fontId を許容', withScene({ sceneType: 'free', freeLayout: [{ id: 'free_001', kind: 'text', x: 0, y: 0, w: 100, h: 50, text: 'a', fontId: 'gen-interface-jp-display' }] })],
  ['freeLayout: rotation（回転・度）を許容（1.9・#208）', withScene({ sceneType: 'free', freeLayout: [{ id: 'free_001', kind: 'shape', x: 10, y: 10, w: 100, h: 100, rotation: 30 }] })],
  ['freeLayout: text 体裁 lineHeight/textAlign/縁取り を許容（1.10・#209）', withScene({ sceneType: 'free', freeLayout: [{ id: 'free_001', kind: 'text', x: 0, y: 0, w: 100, h: 50, text: 'a', lineHeight: 1.6, textAlign: 'center', strokeColor: '#000000', strokeWidth: 2 }] })],
  ['freeLayout: hidden/locked を許容（1.11・#210）', withScene({ sceneType: 'free', freeLayout: [{ id: 'free_001', kind: 'shape', x: 0, y: 0, w: 100, h: 50, hidden: true, locked: true }] })],
  ['freeLayout: 任意の表示名 name を許容（1.22・#525-12）', withScene({ sceneType: 'free', freeLayout: [{ id: 'free_001', kind: 'shape', x: 0, y: 0, w: 100, h: 50, name: 'ロゴ枠' }] })],
  ['freeLayout: text/subtitle の背景帯 background を許容（1.23・#529）', withScene({ sceneType: 'free', freeLayout: [{ id: 'free_001', kind: 'subtitle', x: 0, y: 0, w: 400, h: 80, background: { enabled: true, color: '#000000', opacity: 0.55, radius: 16 } }, { id: 'free_002', kind: 'text', x: 0, y: 0, w: 200, h: 60, text: 'a', background: { enabled: false } }] })],
  ['freeLayout: 字幕要素(subtitle)＋対象なしを許容（1.20・ADR-0029）', withScene({ sceneType: 'free', freeLayout: [{ id: 'free_001', kind: 'subtitle', x: 240, y: 900, w: 1440, h: 120 }] })],
  ['freeLayout: 字幕 subtitleSource=読み上げ/全行を許容（1.20）', withScene({ sceneType: 'free', freeLayout: [{ id: 'free_001', kind: 'subtitle', x: 0, y: 0, w: 100, h: 50, subtitleSource: { kind: 'narration' } }, { id: 'free_002', kind: 'subtitle', x: 0, y: 0, w: 100, h: 50, subtitleSource: { kind: 'allLines' } }] })],
  ['freeLayout: 字幕 subtitleSource=話者(catalog/default)を許容（1.20・P1-2）', withScene({ sceneType: 'free', freeLayout: [{ id: 'free_001', kind: 'subtitle', x: 0, y: 0, w: 100, h: 50, subtitleSource: { kind: 'speaker', speaker: { kind: 'catalog', speaker: 3 } } }, { id: 'free_002', kind: 'subtitle', x: 0, y: 0, w: 100, h: 50, subtitleSource: { kind: 'speaker', speaker: { kind: 'default' } } }] })],
  ['scene: lines（掛け合い・行ごと speaker/字幕/開始秒）を許容（1.8・ADR-0015）', withScene({ lines: [{ lineId: 'line_001', text: 'やあ', speaker: 3, status: 'none' }, { lineId: 'line_002', text: 'どうも', speaker: 2, subtitleEnabled: true, startSec: 2, status: 'none' }], subtitleEnabledDefault: true })],
  ['scene: lines の startWithPrevious（前のセリフと同時開始）を許容（1.21・ADR-0031）', withScene({ lines: [{ lineId: 'line_001', text: 'やあ', speaker: 3, status: 'none' }, { lineId: 'line_002', text: 'どうも', speaker: 2, startWithPrevious: true, status: 'none' }] })],
  ['scene: slotFits（場面ごとの収め方上書き）を許容（1.13・④）', withScene({ slotFits: { background: 'contain', mainVisual: 'stretch' } })],
  ['scene: groups（要素のグループ化・ネスト）を許容（1.14・ADR-0022）', withScene({ sceneType: 'free', freeLayout: [{ id: 'free_001', kind: 'shape', x: 0, y: 0, w: 10, h: 10 }], groups: [{ id: 'group_001', members: ['free_001'], transform: { x: 10, y: -5, rotation: 15, scale: 1.5 }, name: 'まとまり', hidden: false, locked: false }, { id: 'group_002', members: ['group_001'], transform: { x: 0, y: 0, rotation: 0, scale: 1 } }] })],
  ['timelineOverlay: 場面アンカー＋絶対のテロップクリップを許容（1.15・ADR-0018）', { ...withBrief({}), timelineOverlay: { clips: [{ id: 'ovclip_001', track: 'telop', anchorSceneId: 'scene_001', startSec: 1, durationSec: 2, text: '補足' }, { id: 'ovclip_002', track: 'telop', startSec: 3, durationSec: 1.5 }] } }],
  ['scene: bgmSettings（場面ごとBGM・曲の上書き）を許容（1.16・ADR-0018 ③(7)）', withScene({ bgmSettings: { enabled: true, bundledBgmId: 'found-new-hope', volume: 0.3, loop: true } })],
  ['scene: bgmSettings（無音＝enabled:false のみ）を許容（1.16・ADR-0018 ③(7)）', withScene({ bgmSettings: { enabled: false } })],
  ['timelineOverlay: animations（キーフレーム）を許容（1.17・ADR-0019 ④）', { ...withBrief({}), timelineOverlay: { animations: [{ id: 'anim_001', sceneId: 'scene_001', targetId: 'free_001', keyframes: [{ timeSec: 0, opacity: 0 }, { timeSec: 2, x: 100, y: 50, scale: 1.5, opacity: 1, rotation: 90, easing: 'ease-in-out' }] }] } }],
  ['keyframe: 動き方に名前つきの追加を許容（1.25・#262）', { ...withBrief({}), timelineOverlay: { animations: [{ id: 'anim_001', sceneId: 'scene_001', targetId: 'free_001', keyframes: [{ timeSec: 1, x: 10, easing: 'ease-in' }, { timeSec: 1, x: 10, easing: 'ease-out' }] }] } }],
  ['keyframe: 動き方に自由なカーブを許容（1.25・#262）', { ...withBrief({}), timelineOverlay: { animations: [{ id: 'anim_001', sceneId: 'scene_001', targetId: 'free_001', keyframes: [{ timeSec: 1, x: 10, easing: { bezier: [0.25, 1.6, 0.75, -0.6] } }] }] } }],
  ['scene: slotVideoStart（動画スロット再生開始・3モード）を許容（1.18・ADR-0027）', withScene({ slotVideoStart: { mainVisual: { mode: 'withAnim' }, sub: { mode: 'afterAnim' }, bg: { mode: 'delay', delaySec: 0.6 } } })],
  // 注：slotClips は startSec/endSec を各 minimum:0 でしか縛れない。**意味的な異常（反転レンジ endSec≤startSec・0尺）は
  // JSON Schema の cross-field では弾けない**（base Clip $def も同じ）＝schema が通る＝安全ではない。per-use の部分上書きが
  // 継承値を跨いで作る反転は resolveSlotClip が終端なしへ正規化し、UI がスライダーをクランプして担保する（#472 レビュー P2/P3）。
  ['scene: slotClips（クリップ per-use 上書き・範囲/速度/元音声）を許容（1.19・ADR-0028）', withScene({ slotClips: { mainVisual: { startSec: 1, endSec: 5, speed: 1.5, useOriginalAudio: true, originalAudioVolume: 0.4 }, sub: { speed: 0.5 } } })],
];
const mustReject = [
  // 形式の判別（ADR-0032・11 §1）。**場面形式は `format` を書かない**（不在＝場面形式）。`'scene'` は
  // 読込時の解決値であって永続化しない値で、書くとここで落ちる。#627 レビューで挙がった
  // 「後続で保存時に format:'scene' を明示すると壊れる」を、正典の記述ではなく CI で止めるための固定。
  ['project: format:"scene" は拒否＝場面形式は format を書かない（判別は timeline か否か・ADR-0032）', { ...withBrief({}), format: 'scene' }],
  ['project: format:"timeline" も拒否＝タイムライン形式は timeline-project.schema で検証する', { ...withBrief({}), format: 'timeline' }],
  ['general: title 101字', withBrief({ title: 'あ'.repeat(101) })],
  ['general: agenda 21件', withBrief({ agenda: Array.from({ length: 21 }, () => 'x') })],
  ['general: agenda 1項目101字', withBrief({ agenda: ['あ'.repeat(101)] })],
  ['general: keyPoints 21件', withBrief({ keyPoints: Array.from({ length: 21 }, () => 'x') })],
  ['general: targetAudience 101字', withBrief({ targetAudience: 'あ'.repeat(101) })],
  ['videoSettings: 旧 width/height 同梱は拒否（1.2 で撤廃）', { ...withBrief({}), videoSettings: { aspectRatio: '16:9', width: 1920, height: 1080, fps: 30, targetDurationSec: 60, maxDurationSec: 300 } }],
  ['videoSettings: 未知の比率 1:1 は拒否', { ...withBrief({}), videoSettings: { aspectRatio: '1:1', fps: 30, targetDurationSec: 60, maxDurationSec: 300 } }],
  // 0秒の場面は作らない（11 §9 の自動補正が `≤0` を既定 8 秒へ寄せる）＝schema でも弾く（#586）。
  ['scene: durationSec 0 は拒否（exclusiveMinimum・#586）', withScene({ durationSec: 0 })],
  ['scene: durationSec 負は拒否（#586）', withScene({ durationSec: -1 })],
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
  ['keyframe: 未知の動き方は拒否（#262）', { ...withBrief({}), timelineOverlay: { animations: [{ id: 'anim_001', sceneId: 'scene_001', targetId: 'free_001', keyframes: [{ timeSec: 1, x: 10, easing: 'bounce' }] }] } }],
  ['keyframe: カーブの x が範囲外は拒否（時間が戻る・#262）', { ...withBrief({}), timelineOverlay: { animations: [{ id: 'anim_001', sceneId: 'scene_001', targetId: 'free_001', keyframes: [{ timeSec: 1, x: 10, easing: { bezier: [1.5, 0, 0.5, 1] } }] }] } }],
  ['keyframe: カーブの制御点が4つでないものは拒否（#262）', { ...withBrief({}), timelineOverlay: { animations: [{ id: 'anim_001', sceneId: 'scene_001', targetId: 'free_001', keyframes: [{ timeSec: 1, x: 10, easing: { bezier: [0, 0, 1] } }] }] } }],
  ['timelineOverlay: animation id 形式不正(a_001)は拒否（1.17）', { ...withBrief({}), timelineOverlay: { animations: [{ id: 'a_001', sceneId: 'scene_001', targetId: 'free_001', keyframes: [{ timeSec: 0 }] }] } }],
  ['timelineOverlay: keyframe opacity 範囲外(1.5)は拒否（1.17）', { ...withBrief({}), timelineOverlay: { animations: [{ id: 'anim_001', sceneId: 'scene_001', targetId: 'free_001', keyframes: [{ timeSec: 0, opacity: 1.5 }] }] } }],
  ['freeLayout: rotation 360（=0と重複）は除外（exclusiveMaximum）', withScene({ sceneType: 'free', freeLayout: [{ id: 'free_001', kind: 'shape', x: 10, y: 10, w: 100, h: 100, rotation: 360 }] })],
  ['freeLayout: textAlign 未知(middle)は拒否', withScene({ sceneType: 'free', freeLayout: [{ id: 'free_001', kind: 'text', x: 0, y: 0, w: 100, h: 50, text: 'a', textAlign: 'middle' }] })],
  ['freeLayout: lineHeight 範囲外(5)は拒否', withScene({ sceneType: 'free', freeLayout: [{ id: 'free_001', kind: 'text', x: 0, y: 0, w: 100, h: 50, text: 'a', lineHeight: 5 }] })],
  ['freeLayout: hidden 非boolean は拒否', withScene({ sceneType: 'free', freeLayout: [{ id: 'free_001', kind: 'shape', x: 0, y: 0, w: 100, h: 50, hidden: 'yes' }] })],
  ['freeLayout: name 非文字列は拒否（1.22・#525-12）', withScene({ sceneType: 'free', freeLayout: [{ id: 'free_001', kind: 'shape', x: 0, y: 0, w: 100, h: 50, name: 123 }] })],
  ['freeLayout: background.opacity 範囲外(1.5)は拒否（1.23・#529）', withScene({ sceneType: 'free', freeLayout: [{ id: 'free_001', kind: 'subtitle', x: 0, y: 0, w: 100, h: 50, background: { enabled: true, opacity: 1.5 } }] })],
  ['freeLayout: background 未知フィールドは拒否（additionalProperties:false・1.23）', withScene({ sceneType: 'free', freeLayout: [{ id: 'free_001', kind: 'subtitle', x: 0, y: 0, w: 100, h: 50, background: { enabled: true, blur: 2 } }] })],
  ['scene: textFontIds 未知フォントは拒否', withScene({ textFontIds: { title: 'old-font' } })],
  ['scene: textStyles 色が非hexは拒否（1.24）', withScene({ textStyles: { title: { color: 'red' } } })],
  ['scene: textStyles fontSize=0 は拒否（exclusiveMinimum）', withScene({ textStyles: { title: { fontSize: 0 } } })],
  ['scene: textStyles fontSize 負は拒否', withScene({ textStyles: { title: { fontSize: -10 } } })],
  ['scene: textStyles fontWeight 未知は拒否（enum）', withScene({ textStyles: { title: { fontWeight: 'heavy' } } })],
  ['scene: textStyles strokeWidth 負は拒否', withScene({ textStyles: { title: { strokeWidth: -1 } } })],
  ['scene: textStyles 未知の textKey は拒否（additionalProperties:false）', withScene({ textStyles: { heading: { color: '#ffffff' } } })],
  ['scene: textStyles 未知フィールド(lineHeight)は拒否＝配置/行間は開放しない（§2-4）', withScene({ textStyles: { title: { lineHeight: 1.5 } } })],
  ['freeLayout: text の fontId 未知は拒否', withScene({ sceneType: 'free', freeLayout: [{ id: 'free_001', kind: 'text', x: 0, y: 0, w: 100, h: 50, text: 'a', fontId: 'old-font' }] })],
  ['freeLayout: subtitleSource 未知 kind は拒否（1.20・ADR-0029）', withScene({ sceneType: 'free', freeLayout: [{ id: 'free_001', kind: 'subtitle', x: 0, y: 0, w: 100, h: 50, subtitleSource: { kind: 'lines' } }] })],
  ['freeLayout: subtitleSource=speaker で speaker 欠落は拒否（1.20）', withScene({ sceneType: 'free', freeLayout: [{ id: 'free_001', kind: 'subtitle', x: 0, y: 0, w: 100, h: 50, subtitleSource: { kind: 'speaker' } }] })],
  ['freeLayout: subtitleSource speaker=catalog で speaker 番号欠落は拒否（1.20）', withScene({ sceneType: 'free', freeLayout: [{ id: 'free_001', kind: 'subtitle', x: 0, y: 0, w: 100, h: 50, subtitleSource: { kind: 'speaker', speaker: { kind: 'catalog' } } }] })],
  ['freeLayout: subtitleSource 未知フィールドは拒否（additionalProperties:false・1.20）', withScene({ sceneType: 'free', freeLayout: [{ id: 'free_001', kind: 'subtitle', x: 0, y: 0, w: 100, h: 50, subtitleSource: { kind: 'narration', extra: 1 } }] })],
  ['lines: lineId が不正(line_1)は拒否', withScene({ lines: [{ lineId: 'line_1', text: 'x', status: 'none' }] })],
  ['lines: speaker 非整数は拒否', withScene({ lines: [{ lineId: 'line_001', text: 'x', speaker: 1.5, status: 'none' }] })],
  ['lines: startWithPrevious 非真偽は拒否（1.21）', withScene({ lines: [{ lineId: 'line_001', text: 'x', startWithPrevious: 'yes', status: 'none' }] })],
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
// 持ち込みフォント（ADR-0038・#261・schema 1.26）。**enum ではなく形（pattern）で縛る**。
const withFont = (prop) => ({ ...withBrief({}), videoSettings: { ...withBrief({}).videoSettings, ...prop } });
mustAccept.push(
  ['fontId: 同梱フォントを許容（従来どおり）', withFont({ fontId: 'gen-interface-jp' })],
  ['fontId: 持ち込みフォント user_font_001 を許容（1.26）', withFont({ fontId: 'user_font_001' })],
  ['fontId: 桁が増えても許容（user_font_1000）', withFont({ fontId: 'user_font_1000' })],
  ['scene.fontId: 持ち込みフォントを許容', withScene({ fontId: 'user_font_002' })],
  ['scene.fontId: null（継承）は従来どおり許容', withScene({ fontId: null })],
  ['scene.textFontIds: 種別ごとに持ち込みフォントを許容', withScene({ textFontIds: { title: 'user_font_003', subtitle: 'gen-interface-jp' } })],
  ['freeLayout の fontId も持ち込みフォントを許容', withScene({ freeLayout: [{ id: 'free_001', kind: 'text', x: 0, y: 0, w: 10, h: 10, text: 'あ', fontId: 'user_font_004' }] })],
);
mustReject.push(
  ['fontId: 形の違う id は拒否（my-font）', withFont({ fontId: 'my-font' })],
  ['fontId: 桁が足りない user_font_1 は拒否（3桁ゼロ詰め）', withFont({ fontId: 'user_font_1' })],
  ['fontId: 前後に付いた文字は拒否（xuser_font_001）', withFont({ fontId: 'xuser_font_001' })],
  ['fontId: パス区切りを含む id は拒否（user_font_001/../x）', withFont({ fontId: 'user_font_001/../x' })],
  ['fontId: 空文字は拒否', withFont({ fontId: '' })],
  ['videoSettings.fontId: null は拒否（動画全体は継承しない＝既定へ落とす）', withFont({ fontId: null })],
);

for (const [desc, data] of mustAccept) {
  if (vProject(data)) console.log(`PASS  must-accept  ${desc}`);
  else { ok = false; console.log(`FAIL  must-accept  ${desc}`); for (const e of vProject.errors ?? []) console.log(`   ${e.instancePath} ${e.message}`); }
}
for (const [desc, data] of mustReject) {
  if (!vProject(data)) console.log(`PASS  must-reject  ${desc}`);
  else { ok = false; console.log(`FAIL  must-reject  ${desc}（スキーマが許容してしまった）`); }
}

// タイムライン形式（ADR-0032・#627）の代表データ。**schema で表せる範囲だけ**をここで縛る。
// トラック未存在・種別違い・同一トラック内の時間重なり・グループ/アニメの参照切れは cross-field なので
// schema では弾けず、domain の検証（validateTimelineDoc）が終端。下の semantic 節で sample を横断検査する。
const tlBase = load(fx('timeline-project.sample.json'));
const tlWith = (extra) => ({ ...tlBase, ...extra });
const tlClips = (...clips) => tlWith({ clips });
const tlAccept = [
  ['timeline: クリップ0本（作りかけの空プロジェクト）を許容', tlWith({ clips: [], groups: [], animations: [] })],
  ['timeline: sourceProjectId なし（完全新規）を許容', (() => { const { sourceProjectId, ...rest } = tlBase; return rest; })()],
  ['timeline: durationSec 0.1（極短でも >0 なら許容・場面形式と同じ流儀 #553）', tlClips({ id: 'clip_001', kind: 'text', trackId: 'track_002', startSec: 0, durationSec: 0.1 })],
  ['timeline: startSec 0（先頭・境界）を許容', tlClips({ id: 'clip_001', kind: 'text', trackId: 'track_002', startSec: 0, durationSec: 1 })],
  ['timeline: id 4桁以上（clip_1000・上限なし）を許容', tlClips({ id: 'clip_1000', kind: 'text', trackId: 'track_002', startSec: 0, durationSec: 1 })],
  // 文字の体裁（#264・ADR-0032 追補3＝両形式に効く共有の語彙）。
  // ⚠️ **タイムライン側の schema は `$ref` ではなく同じ形を書き写している**（`fontId`・`strokeWidth`・
  // `background` も同様）。書き足したとき**片方だけになりやすい**ので、両方に効いていることを
  // ここで固定する（実際、最初は場面形式にしか足しておらず、この検査で気づいた）。
  ['timeline: 字間（letterSpacing）を許容＝場面形式と同じ語彙（#264）', tlClips({ id: 'clip_001', kind: 'text', trackId: 'track_002', startSec: 0, durationSec: 1, letterSpacing: 0.1 })],
  ['timeline: 影（shadow）を許容＝場面形式と同じ語彙（#264）', tlClips({ id: 'clip_001', kind: 'text', trackId: 'track_002', startSec: 0, durationSec: 1, shadow: { enabled: true, color: '#000000', opacity: 0.5, blur: 6, dx: 2, dy: 2 } })],
  // 読み上げクリップ（1.1・#628）。声は素材ではなく「中身」（読み上げ文＋話者）を持つ。
  ['timeline: 読み上げクリップ（voice）を許容（1.1）', tlClips({ id: 'clip_001', kind: 'voice', trackId: 'track_004', startSec: 0, durationSec: 3, voice: { text: 'やあ', speaker: 3, status: 'none' } })],
  ['timeline: 読み上げは話者/速度なし（既定を継承）でも許容', tlClips({ id: 'clip_001', kind: 'voice', trackId: 'track_004', startSec: 0, durationSec: 3, voice: { text: 'やあ', status: 'none' } })],
  ['timeline: 読み上げの話者/話速/抑揚 null（継承）を許容', tlClips({ id: 'clip_001', kind: 'voice', trackId: 'track_004', startSec: 0, durationSec: 3, voice: { text: 'やあ', speaker: null, speed: null, intonation: null, status: 'generated' } })],
  ['timeline: 動画の元の音（useOriginalAudio・originalAudioVolume）を許容（1.8・#512 段2）', tlClips({ id: 'clip_001', kind: 'slot', trackId: 'track_001', startSec: 0, durationSec: 5, x: 0, y: 0, w: 100, h: 100, assetId: 'asset_001', useOriginalAudio: true, originalAudioVolume: 0.9 })],
  ['timeline: 音量の変化（volumePoints）を許容（1.7・#512）', tlClips({ id: 'clip_001', kind: 'audio', trackId: 'track_002', startSec: 0, durationSec: 5, assetId: 'asset_001', volumePoints: [{ timeSec: 0, volume: 0.2 }, { timeSec: 5, volume: 1 }] })],
  ['timeline: 切り抜きの効かせ方（cropMode）を許容（1.5・#634）', tlClips({ id: 'clip_001', kind: 'slot', trackId: 'track_001', startSec: 0, durationSec: 3, x: 0, y: 0, w: 100, h: 100, assetId: 'asset_001', crop: { left: 0.1 }, cropMode: 'fill' })],
  ['timeline: 素材の寄せ（cropAlign）を許容（1.4・#634）', tlClips({ id: 'clip_001', kind: 'slot', trackId: 'track_001', startSec: 0, durationSec: 3, x: 0, y: 0, w: 100, h: 100, assetId: 'asset_001', cropAlign: { x: 'left', y: 'bottom' } })],
  ['timeline: 切り抜き（crop）を許容（1.3・#634）', tlClips({ id: 'clip_001', kind: 'slot', trackId: 'track_001', startSec: 0, durationSec: 3, x: 0, y: 0, w: 100, h: 100, assetId: 'asset_001', crop: { top: 0.1, bottom: 0.2 } })],
  ['timeline: 字幕の連動先（voiceClipId）を許容（1.2・#633）', tlClips({ id: 'clip_001', kind: 'subtitle', trackId: 'track_003', startSec: 0, durationSec: 3, x: 0, y: 900, w: 1920, h: 120, voiceClipId: 'clip_007' })],
  ['timeline: 連動先と自分の文の両方（言い換え）を許容（1.2・#633）', tlClips({ id: 'clip_001', kind: 'subtitle', trackId: 'track_003', startSec: 0, durationSec: 3, x: 0, y: 900, w: 1920, h: 120, voiceClipId: 'clip_007', text: '言い換えた字幕' })],
  ['timeline: テンプレクリップの textFontIds/character/slotClips を許容（1.1）', tlClips({ id: 'clip_001', kind: 'template', trackId: 'track_001', startSec: 0, durationSec: 3, templateId: 'opening_yuko_right_v1', textFontIds: { title: 'kaitou-yokoku-gothic' }, character: { enabled: true, characterId: 'yuko', poseAssetId: 'yuko_smile_001' }, slotClips: { background: { startSec: 1, endSec: 5, speed: 1.5 } } })],
];
const tlReject = [
  ['timeline: 元の音の音量が範囲外(2.0)は拒否（値域は場面形式と共有＝$ref・#512 段2）', tlClips({ id: 'clip_001', kind: 'slot', trackId: 'track_001', startSec: 0, durationSec: 5, x: 0, y: 0, w: 100, h: 100, assetId: 'asset_001', originalAudioVolume: 2.0 })],
  ['timeline: 元の音を鳴らすかが真偽でないのは拒否（#512 段2）', tlClips({ id: 'clip_001', kind: 'slot', trackId: 'track_001', startSec: 0, durationSec: 5, x: 0, y: 0, w: 100, h: 100, assetId: 'asset_001', useOriginalAudio: 'yes' })],
  ['timeline: 音量の変化が空配列は拒否（#512）', tlClips({ id: 'clip_001', kind: 'audio', trackId: 'track_002', startSec: 0, durationSec: 5, assetId: 'asset_001', volumePoints: [] })],
  ['timeline: 音量の変化の音量が範囲外は拒否（#512）', tlClips({ id: 'clip_001', kind: 'audio', trackId: 'track_002', startSec: 0, durationSec: 5, assetId: 'asset_001', volumePoints: [{ timeSec: 0, volume: 2 }] })],
  ['timeline: 未知の切り抜きの効かせ方は拒否', tlClips({ id: 'clip_001', kind: 'slot', trackId: 'track_001', startSec: 0, durationSec: 3, x: 0, y: 0, w: 100, h: 100, cropMode: 'stretch' })],
  ['timeline: 寄せの未知の値は拒否', tlClips({ id: 'clip_001', kind: 'slot', trackId: 'track_001', startSec: 0, durationSec: 3, x: 0, y: 0, w: 100, h: 100, cropAlign: { x: 'middle' } })],
  ['timeline: 切り抜きが 1 以上（全部隠れる）は拒否', tlClips({ id: 'clip_001', kind: 'slot', trackId: 'track_001', startSec: 0, durationSec: 3, x: 0, y: 0, w: 100, h: 100, crop: { top: 1 } })],
  ['timeline: format="scene" は拒否（場面形式は project.schema で検証する）', tlWith({ format: 'scene' })],
  ['timeline: format 欠落は拒否（形式の判別ができない）', (() => { const { format, ...rest } = tlBase; return rest; })()],
  ['timeline: schemaVersion 未知(2.0)は拒否', tlWith({ schemaVersion: '2.0' })],
  ['timeline: tracks 欠落は拒否（required）', (() => { const { tracks, ...rest } = tlBase; return rest; })()],
  ['timeline: projectId が場面形式と同じ採番でないと拒否（tl_...）', tlWith({ projectId: 'tl_20260728_001' })],
  ['timeline: track id 形式不正(track_1)は拒否', tlWith({ tracks: [{ id: 'track_1', kind: 'visual' }] })],
  ['timeline: track kind 未知(telop)は拒否＝トラックは映像か音声（enum）', tlWith({ tracks: [{ id: 'track_001', kind: 'telop' }] })],
  ['timeline: clip id 形式不正(ovclip_001)は拒否', tlClips({ id: 'ovclip_001', kind: 'text', trackId: 'track_002', startSec: 0, durationSec: 1 })],
  ['timeline: clip kind 未知(character)は拒否', tlClips({ id: 'clip_001', kind: 'character', trackId: 'track_002', startSec: 0, durationSec: 1 })],
  ['timeline: durationSec 0 は拒否（exclusiveMinimum・0尺クリップを作らない）', tlClips({ id: 'clip_001', kind: 'text', trackId: 'track_002', startSec: 0, durationSec: 0 })],
  ['timeline: durationSec 負は拒否', tlClips({ id: 'clip_001', kind: 'text', trackId: 'track_002', startSec: 0, durationSec: -1 })],
  ['timeline: startSec 負は拒否（時間 0 より前は無い）', tlClips({ id: 'clip_001', kind: 'text', trackId: 'track_002', startSec: -1, durationSec: 1 })],
  ['timeline: trackId 欠落は拒否（どのトラックか決まらない）', tlClips({ id: 'clip_001', kind: 'text', startSec: 0, durationSec: 1 })],
  ['timeline: sourceStartSec 負は拒否（素材の先頭より前は無い）', tlClips({ id: 'clip_001', kind: 'slot', trackId: 'track_001', startSec: 0, durationSec: 1, sourceStartSec: -1 })],
  ['timeline: speed 0 は拒否（exclusiveMinimum＝止まった素材にしない）', tlClips({ id: 'clip_001', kind: 'audio', trackId: 'track_004', startSec: 0, durationSec: 1, speed: 0 })],
  ['timeline: bundledBgmId 未知は拒否（曲の一覧は場面形式と共有＝$ref）', tlClips({ id: 'clip_001', kind: 'audio', trackId: 'track_005', startSec: 0, durationSec: 1, bundledBgmId: 'nope' })],
  ['timeline: fontId 未知は拒否（フォント一覧は場面形式と共有＝$ref）', tlClips({ id: 'clip_001', kind: 'text', trackId: 'track_002', startSec: 0, durationSec: 1, fontId: 'old-font' })],
  ['timeline: 字間の範囲外（3em）は拒否＝制約も場面形式と同じ（#264）', tlClips({ id: 'clip_001', kind: 'text', trackId: 'track_002', startSec: 0, durationSec: 1, letterSpacing: 3 })],
  ['timeline: 影の未知フィールド(spread)は拒否＝同じ形（#264）', tlClips({ id: 'clip_001', kind: 'text', trackId: 'track_002', startSec: 0, durationSec: 1, shadow: { enabled: true, spread: 4 } })],
  ['timeline: 影の色が非hexは拒否（場面形式と同じ制約・#264）', tlClips({ id: 'clip_001', kind: 'text', trackId: 'track_002', startSec: 0, durationSec: 1, shadow: { enabled: true, color: 'black' } })],
  ['timeline: rotation 360（=0と重複）は除外（exclusiveMaximum・場面形式と同じ）', tlClips({ id: 'clip_001', kind: 'shape', trackId: 'track_002', startSec: 0, durationSec: 1, rotation: 360 })],
  ['timeline: 未知の図形(hexagon)は拒否', tlClips({ id: 'clip_001', kind: 'shape', trackId: 'track_002', startSec: 0, durationSec: 1, shapeType: 'hexagon' })],
  ['timeline: color 非hexは拒否', tlClips({ id: 'clip_001', kind: 'text', trackId: 'track_002', startSec: 0, durationSec: 1, color: 'white' })],
  ['timeline: 未知フィールド(sceneId)は拒否＝タイムラインに場面は無い（additionalProperties:false）', tlClips({ id: 'clip_001', kind: 'text', trackId: 'track_002', startSec: 0, durationSec: 1, sceneId: 'scene_001' })],
  ['timeline: トップレベルに scenes は拒否＝場面形式のフィールドを混ぜない', tlWith({ scenes: [] })],
  ['timeline: トップレベルに timelineOverlay は拒否＝旧2モデルは持ち込まない（ADR-0018 Superseded）', tlWith({ timelineOverlay: { clips: [] } })],
  ['timeline: animation id 形式不正(a_001)は拒否', tlWith({ animations: [{ id: 'a_001', targetId: 'clip_003', keyframes: [{ timeSec: 0 }] }] })],
  ['timeline: animation keyframe opacity 範囲外(1.5)は拒否', tlWith({ animations: [{ id: 'anim_001', targetId: 'clip_003', keyframes: [{ timeSec: 0, opacity: 1.5 }] }] })],
  // 読み上げクリップ（1.1・#628）。「中身の無い声」を作らせない（if/then）。
  ['timeline: kind=voice で voice 欠落は拒否（if/then＝空の声を作らせない）', tlClips({ id: 'clip_001', kind: 'voice', trackId: 'track_004', startSec: 0, durationSec: 3 })],
  ['timeline: voice.text 欠落は拒否（required）', tlClips({ id: 'clip_001', kind: 'voice', trackId: 'track_004', startSec: 0, durationSec: 3, voice: { status: 'none' } })],
  ['timeline: voice.status 欠落は拒否（required）', tlClips({ id: 'clip_001', kind: 'voice', trackId: 'track_004', startSec: 0, durationSec: 3, voice: { text: 'やあ' } })],
  ['timeline: voice.status 未知は拒否（enum は場面形式と共有＝$ref）', tlClips({ id: 'clip_001', kind: 'voice', trackId: 'track_004', startSec: 0, durationSec: 3, voice: { text: 'やあ', status: 'done' } })],
  ['timeline: voice.speaker 非整数は拒否（$ref 共有）', tlClips({ id: 'clip_001', kind: 'voice', trackId: 'track_004', startSec: 0, durationSec: 3, voice: { text: 'やあ', speaker: 1.5, status: 'none' } })],
  ['timeline: voice に時間の語彙(startSec)は拒否＝時間はクリップが持つ（additionalProperties:false）', tlClips({ id: 'clip_001', kind: 'voice', trackId: 'track_004', startSec: 0, durationSec: 3, voice: { text: 'やあ', status: 'none', startSec: 1 } })],
  ['timeline: voice に字幕の語彙(subtitleText)は拒否＝字幕は字幕クリップが持つ', tlClips({ id: 'clip_001', kind: 'voice', trackId: 'track_004', startSec: 0, durationSec: 3, voice: { text: 'やあ', status: 'none', subtitleText: 'やあ' } })],
  ['timeline: textFontIds 未知フォントは拒否（一覧は場面形式と共有＝$ref）', tlClips({ id: 'clip_001', kind: 'template', trackId: 'track_001', startSec: 0, durationSec: 3, textFontIds: { title: 'old-font' } })],
  ['timeline: character に必須欠落(characterId)は拒否（$ref 共有）', tlClips({ id: 'clip_001', kind: 'template', trackId: 'track_001', startSec: 0, durationSec: 3, character: { enabled: true } })],
  ['timeline: slotClips speed 範囲外(3.0)は拒否（$ref 共有）', tlClips({ id: 'clip_001', kind: 'template', trackId: 'track_001', startSec: 0, durationSec: 3, slotClips: { background: { speed: 3.0 } } })],
];
for (const [desc, data] of tlAccept) {
  if (vTimeline(data)) console.log(`PASS  must-accept  ${desc}`);
  else { ok = false; console.log(`FAIL  must-accept  ${desc}`); for (const e of vTimeline.errors ?? []) console.log(`   ${e.instancePath} ${e.message}`); }
}
for (const [desc, data] of tlReject) {
  if (!vTimeline(data)) console.log(`PASS  must-reject  ${desc}`);
  else { ok = false; console.log(`FAIL  must-reject  ${desc}（スキーマが許容してしまった）`); }
}

// タイムライン sample の相互参照（schema では表せない横断条件・domain の validateTimelineDoc と同じ規則）
const tl = load(fx('timeline-project.sample.json'));
const tlAssetIds = new Set(tl.assets.map((a) => a.assetId));
const trackById = new Map(tl.tracks.map((t) => [t.id, t]));
let tlSem = true;
const tlFail = (m) => { tlSem = false; console.log(`   SEM  ${m}`); };
const kindOfTrack = { slot: 'visual', text: 'visual', shape: 'visual', subtitle: 'visual', template: 'visual', audio: 'audio', voice: 'audio' };
const tlYukoIds = new Set(tl.assets.filter((a) => a.assetType === 'yuko').map((a) => a.assetId));
const byTrack = new Map();
for (const c of tl.clips) {
  const t = trackById.get(c.trackId);
  if (!t) { tlFail(`${c.id}: trackId ${c.trackId} missing`); continue; }
  if (t.kind !== kindOfTrack[c.kind]) tlFail(`${c.id}: kind ${c.kind} は ${t.kind} トラックに置けない`);
  if (c.assetId != null && !tlAssetIds.has(c.assetId)) tlFail(`${c.id}: assetId ${c.assetId} missing`);
  const sources = [c.assetId != null, c.bundledBgmId != null, c.kind === 'voice'].filter(Boolean).length;
  if (sources > 1) tlFail(`${c.id}: 音の出どころが2つ以上（素材/同梱BGM/読み上げ）`);
  if (c.character?.poseAssetId && !tlYukoIds.has(c.character.poseAssetId)) tlFail(`${c.id}: poseAssetId ${c.character.poseAssetId} not a yuko asset`);
  if (c.voice != null && c.kind !== 'voice') tlFail(`${c.id}: voice は読み上げクリップにだけ置ける`);
  if (!byTrack.has(c.trackId)) byTrack.set(c.trackId, []);
  byTrack.get(c.trackId).push(c);
}
// 同一トラック内で時間は重ならない（重ね順がトラック順だけで一意に決まる＝ADR-0032）
for (const [tid, list] of byTrack) {
  const sorted = [...list].sort((a, b) => a.startSec - b.startSec);
  for (let i = 1; i < sorted.length; i += 1) {
    const prev = sorted[i - 1];
    if (prev.startSec + prev.durationSec > sorted[i].startSec) tlFail(`${tid}: ${prev.id} と ${sorted[i].id} が時間で重なっている`);
  }
}
const tlClipIds = new Set(tl.clips.map((c) => c.id));
const tlGroupIds = new Set((tl.groups ?? []).map((g) => g.id));
for (const g of tl.groups ?? []) {
  for (const m of g.members) if (!tlClipIds.has(m) && !tlGroupIds.has(m)) tlFail(`group ${g.id}: member ${m} missing`);
}
for (const a of tl.animations ?? []) {
  if (!tlClipIds.has(a.targetId) && !tlGroupIds.has(a.targetId)) tlFail(`animation ${a.id}: targetId ${a.targetId} missing`);
}
console.log(tlSem ? 'PASS  semantic  timeline-project.sample cross-refs' : 'FAIL  semantic  timeline-project.sample cross-refs');
ok = ok && tlSem;

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
