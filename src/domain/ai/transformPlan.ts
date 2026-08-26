// AI出力(ai-video-plan) → 内部 Part[] / Scene[] への変換。正典は 12_AI_PROMPT_AND_MAPPING.md §8、
// 検証/補正ルールは 11_SCHEMA_REFERENCE.md §8,§9、エラーコード語彙は 15_ERROR_STATE_MODEL.md §6。
// 純粋関数（副作用なし）。Date/乱数に依存せず、ID採番は注入する（14 §4）。
import { ASSET_TYPE, LAYER_TYPE, NARRATION_STATUS, isSceneCategory } from '../enums';
import type { Orientation, SceneCategory, WarningSeverity } from '../enums';
import {
  DEFAULT_CHARACTER_ID,
  DEFAULT_SCENE_CATEGORY,
  MAX_NARRATION_LEN_DEFAULT,
  MAX_SCENES_PER_VIDEO,
  MAX_SUBTITLE_LEN_DEFAULT,
  AI_SCENE_MAX_DURATION_SEC,
  AI_SCENE_MIN_DURATION_SEC,
  TRANSITION_DEFAULT_SEC,
  VIDEO_HARD_MAX_SEC,
} from '../constants';
import type {
  Asset, AssetRefs, Character, Narration, NarrationLine, Part, Scene, Texts, Transition, Warning,
} from '../project/types';
import type { Template } from '../template/types';
import { standardTemplateForScene } from '../template/templateSelection';
import { speakerForCharacter } from '../voice/voiceCatalog';
import { createSequentialIdFactory } from './idFactory';
import type { IdFactory } from './idFactory';
import type { AiNarrationLine, AiVideoPlan } from './types';

export interface TransformContext {
  templates: Template[];
  assets: Asset[];
  /** プロジェクトの向き（16:9/9:16）。テンプレはこの向きに一致するものへ補正する（ADR-0012・B4）。 */
  orientation: Orientation;
  /** 省略時は part_001 / scene_001 からの連番。 */
  idFactory?: IdFactory;
}

export interface TransformResult {
  parts: Part[];
  scenes: Scene[];
  /** 全シーンの warnings を平坦化したもの（件数表示などに使う）。 */
  warnings: Warning[];
}

function warn(
  code: string, message: string, field: string, severity: WarningSeverity, autoFixed: boolean,
): Warning {
  return { code, message, field, severity, autoFixed };
}

/**
 * AI の narrationLines → 内部 scene.lines（掛け合い・#180）。voiceCharacter→speaker（未知は既定声＋警告）、subtitle→字幕。
 * 空/未指定は undefined を返し、呼び出し側は単一 narration 経路にフォールバックする。lineId は line_NNN（§2.1）。
 */
function mapNarrationLines(
  aiLines: AiNarrationLine[] | undefined, warnings: Warning[],
): NarrationLine[] | undefined {
  if (!aiLines || aiLines.length === 0) return undefined;
  return aiLines.map((al, i) => {
    const lineId = `line_${String(i + 1).padStart(3, '0')}`;
    let speaker: number | null = null;
    if (al.voiceCharacter) {
      speaker = speakerForCharacter(al.voiceCharacter);
      if (speaker == null) {
        warnings.push(warn('LINE_SPEAKER_UNKNOWN', '選べない声が指定されています。標準の声を使います', `lines.${lineId}`, 'warning', true));
      }
    }
    return {
      lineId,
      text: al.text,
      speaker,
      subtitleText: al.subtitle ?? null,
      subtitleEnabled: al.subtitleEnabled,
      status: NARRATION_STATUS.none,
    };
  });
}

/**
 * AI 生成の表示時間を目安の範囲へ寄せる（11 §9）。
 *
 * **下限が上限を上回るときは上限を優先する**（#607）。下限（`AI_SCENE_MIN_DURATION_SEC`）は**どのテンプレにも
 * 共通の既定**で per-template の上書きが無いのに対し、上限はテンプレ作者が `aiHint.maxDurationSec` で
 * **そのテンプレについて明示**した値だから＝具体的な宣言を一般的な既定より優先する（ADR-0026①：
 * 「最長1秒」と書いたテンプレから3秒の場面を作らない）。どちらも #553 の「生成の目安」で硬い制約ではないので、
 * どちらを採っても `durationSec > 0`（schema）は保たれる（`maxDurationSec` は schema で `exclusiveMinimum: 0`）。
 *
 * 素の `if (value < min)` を先に置くと、`min > max` のとき**評価順で上限を破る**（0.5 が 3 になる＝上限1を超える）。
 */
function clampDuration(value: number, min: number, max: number): { value: number; clamped: boolean } {
  const lower = Math.min(min, max);
  if (value < lower) return { value: lower, clamped: true };
  if (value > max) return { value: max, clamped: true };
  return { value, clamped: false };
}

/** poseTag → ゆうこ素材の解決（12 §8.3）。 */
function resolveCharacter(
  template: Template | undefined, poseTag: string | null, yukoAssets: Asset[], warnings: Warning[],
): Character {
  const charLayer = template?.layers.find((l) => l.type === LAYER_TYPE.character);
  if (!charLayer || !poseTag) {
    return { enabled: false, characterId: DEFAULT_CHARACTER_ID, poseAssetId: null };
  }
  const matched = yukoAssets.find((a) => (a.tags ?? []).includes(poseTag));
  if (matched) {
    return { enabled: true, characterId: DEFAULT_CHARACTER_ID, poseAssetId: matched.assetId };
  }
  const fallback = yukoAssets.find((a) => a.isDefaultYuko) ?? yukoAssets[0];
  if (fallback) {
    warnings.push(warn('POSE_FALLBACK', 'ゆうこの表情を標準に調整しました', 'character', 'info', true));
    return { enabled: true, characterId: DEFAULT_CHARACTER_ID, poseAssetId: fallback.assetId };
  }
  if (charLayer.required) {
    warnings.push(warn('POSE_FALLBACK', 'ゆうこの素材が見つかりません', 'character', 'warning', false));
  }
  return { enabled: false, characterId: DEFAULT_CHARACTER_ID, poseAssetId: null };
}

/**
 * 長さの助言（V8・自動切詰めはしない）。**掛け合い（narrationLines）があるときは各行が本体**なので、
 * 単一 narrationText だけでなく**行のテキスト/字幕も見る**（#569）。
 *
 * 直す前は `narrationText`（単一）と `texts.subtitle` しか見ておらず、掛け合いでは `aiScene.narrationText` が
 * 空になりうる（`?? ''`）ため**実質ノーチェック**だった＝precheck（`sceneLines` で各行を見る）と対象が非対称で、
 * 「同じ長すぎが掛け合いの有無で生成時だけ静か」になっていた（ADR-0026②）。
 * 閾値の継承順（テンプレ aiHint → 既定定数）は precheck と既に一致（#568）＝**対象を揃えれば判定が完全一致**する。
 *
 * 警告は種類ごとに**1つ**にまとめる（行ごとに出すと1場面で警告が並ぶ）＝precheck の「場面単位で1項目」と同じ流儀。
 */
function checkLengths(
  texts: Texts, narrationText: string, aiLines: AiNarrationLine[] | undefined,
  template: Template | undefined, warnings: Warning[],
): void {
  const maxNarration = template?.aiHint?.maxNarrationLength ?? MAX_NARRATION_LEN_DEFAULT;
  const maxSubtitle = template?.aiHint?.maxSubtitleLength ?? MAX_SUBTITLE_LEN_DEFAULT;
  const hasLines = aiLines != null && aiLines.length > 0;
  // セリフ本体＝掛け合いなら各行、そうでなければ単一 narration（precheck の `sceneLines` と同じ対象）。
  const narrationTexts = hasLines ? aiLines.map((l) => l.text) : [narrationText];
  if (narrationTexts.some((t) => t.length > maxNarration)) {
    warnings.push(warn('TEXT_OVERFLOW', 'セリフが長いため読みづらくなる可能性があります', 'narration', 'warning', false));
  }
  // 字幕は**両方**見る：掛け合いの行字幕（`narrationLines[].subtitle`）と、テンプレ字幕層に載る `texts.subtitle`。
  // どちらが実際に表示されるかは場面のテンプレ/FREE 字幕の対象で決まる（ADR-0029）が、ここは生成直後の**助言**なので
  // 取りこぼさない側に倒す（precheck が表示実体で最終判定する）。
  // **行字幕の未指定は `text` を流用する**（`AiNarrationLine.subtitle` の仕様・`subtitleText: al.subtitle ?? null` →
  // `resolveLineSubtitle` の `subtitleText ?? text`＝null は継承・11 §2.2）。ここで `?? ''` にすると、
  // 字幕を省略した行（AI の通常パターン）で**実際に表示される文字を検査しない**＝precheck とまた食い違う（#569 レビュー）。
  const subtitleTexts = [
    ...(texts.subtitle !== undefined ? [texts.subtitle] : []),
    ...(hasLines ? aiLines.map((l) => l.subtitle ?? l.text) : []),
  ];
  if (subtitleTexts.some((t) => t.length > maxSubtitle)) {
    warnings.push(warn('TEXT_OVERFLOW', '字幕が長いため読みづらくなる可能性があります', 'texts.subtitle', 'warning', false));
  }
}

/**
 * ai-video-plan を検証・補正しながら内部 Part/Scene へ変換する。
 * スキーマ適合（型/必須/enum/範囲＝V1,V2）は別途 ajv 等で検証済みである前提（14 §3）。
 * 本関数は相互参照・補正（V3–V11 / 11 §9）を担い、結果を warnings に記録する。
 */
export function transformVideoPlan(plan: AiVideoPlan, ctx: TransformContext): TransformResult {
  const idFactory = ctx.idFactory ?? createSequentialIdFactory();
  const assetById = new Map(ctx.assets.map((a) => [a.assetId, a] as const));
  const templateById = new Map(ctx.templates.map((t) => [t.templateId, t] as const));
  const yukoAssets = ctx.assets.filter((a) => a.assetType === ASSET_TYPE.yuko);

  const parts: Part[] = [];
  const scenes: Scene[] = [];
  const allWarnings: Warning[] = [];

  for (const aiPart of plan.parts) {
    const partId = idFactory.nextPartId();
    const part: Part = {
      partId,
      title: aiPart.partTitle,
      description: aiPart.summary,
      order: parts.length + 1,
      sceneIds: [],
      targetDurationSec: aiPart.targetDurationSec,
    };

    for (const aiScene of aiPart.scenes) {
      const w: Warning[] = [];
      const sceneId = idFactory.nextSceneId();

      // テンプレ解決（V3 / 補正）
      let templateId = aiScene.templateId;
      let template = templateById.get(templateId);

      // 場面種別（enum検証）
      const validSceneType = isSceneCategory(aiScene.sceneType);
      const sceneType: SceneCategory = validSceneType
        ? aiScene.sceneType
        : (template?.category ?? DEFAULT_SCENE_CATEGORY);
      if (!validSceneType) {
        w.push(warn('SCENE_TYPE_FALLBACK', '不明な場面種別を調整しました', 'sceneType', 'info', true));
      }

      // テンプレ解決＋向き整合（B4・ADR-0012）。見つからない、またはプロジェクトの向きと一致しない場合は、
      // 同カテゴリ・同じ向きの見た目へ補正する（AI出力は向き非依存＝12§8 / 向きはプロジェクト側の正典）。
      if (!template || template.aspectRatio !== ctx.orientation) {
        // 当て先は「標準の見た目」＝マイ見た目を除く（`standardTemplateForScene` に一本化・#547）。
        // ADR-0017「マイ見た目は AI 入力から除外」と揃える（AI は提案できないのに補正では当たる、を作らない）。
        const alt = standardTemplateForScene(ctx.templates, sceneType, ctx.orientation);
        if (alt) {
          w.push(
            template
              ? warn('TEMPLATE_ORIENTATION_MISMATCH', '動画の向きに合う見た目に調整しました', 'templateId', 'info', true)
              : warn('TEMPLATE_NOT_FOUND', 'この場面の見た目パターンが見つからないため、標準を使います', 'templateId', 'warning', true),
          );
          templateId = alt.templateId;
          template = alt;
        } else if (!template) {
          w.push(warn('TEMPLATE_NOT_FOUND', 'この場面の見た目パターンが見つかりません。見た目パターンを手動で選んでください', 'templateId', 'warning', false));
        } else {
          // 当該カテゴリ・当該向きの代替が無い（その向きが未整備）。原状維持で向き不一致を明示する。
          w.push(warn('TEMPLATE_ORIENTATION_MISMATCH', '動画の向きに合う見た目が見つかりませんでした。見た目パターンを手動で選んでください', 'templateId', 'warning', false));
        }
      }

      // 表示時間 clamp（11 §4,§9）
      const maxDuration = template?.aiHint?.maxDurationSec ?? AI_SCENE_MAX_DURATION_SEC;
      const clamped = clampDuration(aiScene.durationSec, AI_SCENE_MIN_DURATION_SEC, maxDuration);
      if (clamped.clamped) {
        w.push(warn('DURATION_CLAMPED', '表示時間を見やすい長さに調整しました', 'durationSec', 'info', true));
      }

      // assetRefs 解決（V4 / バインディングは 11 §5）
      const assetRefs: AssetRefs = {};
      for (const [key, value] of Object.entries(aiScene.assetRefs ?? {})) {
        if (value === null) {
          assetRefs[key] = null;
        } else if (assetById.has(value)) {
          assetRefs[key] = value;
        } else {
          assetRefs[key] = null;
          w.push(warn('ASSET_NOT_FOUND', '使う写真・動画が見つかりません。選び直してください', `assetRefs.${key}`, 'warning', true));
        }
      }

      // 必須スロット未設定チェック（V6）
      if (template) {
        for (const layer of template.layers) {
          const bearsAsset = layer.type === LAYER_TYPE.slot || layer.type === LAYER_TYPE.background || layer.type === LAYER_TYPE.logo;
          if (bearsAsset && layer.required && !assetRefs[layer.id]) {
            w.push(warn('REQUIRED_SLOT_EMPTY', 'この場面に必要な素材が未設定です', `assetRefs.${layer.id}`, 'warning', false));
          }
        }
      }

      // ゆうこ（12 §8.3）
      const character = resolveCharacter(template, aiScene.yukoPoseTag ?? null, yukoAssets, w);

      // テキスト（長さチェック V8。自動切詰めはしない）
      const texts: Texts = { ...aiScene.texts };
      // narrationText は AI が空のとき null/省略しうる（自動リトライせず1回で通すための許容）。空文字に整え、
      // 無音シーンとして成立させる（ナレーションは後から場面編集で追加可。§9 補正）。
      const narrationText = aiScene.narrationText ?? '';
      // 掛け合い（narrationLines）があるときは各行が本体なので、行のテキスト/字幕も長さ助言の対象にする（#569）。
      checkLengths(texts, narrationText, aiScene.narrationLines, template, w);

      // 掛け合い（#180）：narrationLines があれば scene.lines を作る（無ければ単一 narration のまま）。
      const lines = mapNarrationLines(aiScene.narrationLines, w);
      // ナレーション初期化（12 §8.4）。掛け合い時は narration.text を lines[0] に mirror する
      // （narration.text を直読みする台本/precheck の後方可読性＝ADR-0015。AI が narrationText を省略しても空にしない）。
      const narration: Narration = {
        text: lines ? lines[0]?.text ?? '' : narrationText,
        voiceId: null,
        speed: null,
        pitch: null,
        intonation: null,
        voicePath: null,
        status: NARRATION_STATUS.none,
      };

      // トランジション既定（12 §8.5）
      const transition: Transition = {
        in: template?.defaults?.transitionIn ?? 'fade',
        out: template?.defaults?.transitionOut ?? 'fade',
        durationSec: TRANSITION_DEFAULT_SEC,
      };

      const scene: Scene = {
        sceneId,
        partId,
        order: scenes.length + 1,
        sceneType,
        templateId,
        durationSec: clamped.value,
        assetRefs,
        character,
        texts,
        narration,
        ...(lines ? { lines } : {}),
        transition,
        warnings: w,
      };

      scenes.push(scene);
      part.sceneIds.push(sceneId);
      allWarnings.push(...w);
    }

    parts.push(part);
  }

  // 全体チェック（V9 / V10）
  const totalDuration = scenes.reduce((sum, s) => sum + s.durationSec, 0);
  if (totalDuration > VIDEO_HARD_MAX_SEC) {
    allWarnings.push(warn('TOTAL_DURATION_EXCEEDED', '動画が長すぎます。場面を減らすか短くしてください', 'scenes', 'warning', false));
  }
  if (scenes.length > MAX_SCENES_PER_VIDEO) {
    allWarnings.push(warn('TOO_MANY_SCENES', '場面が多すぎます。整理をおすすめします', 'scenes', 'warning', false));
  }

  return { parts, scenes, warnings: allWarnings };
}
