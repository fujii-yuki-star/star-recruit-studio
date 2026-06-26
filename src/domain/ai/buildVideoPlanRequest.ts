// AIへ渡すプロンプト（システムプロンプト＋ユーザーメッセージ）を組み立てる純粋関数。
// 正典: 12_AI_PROMPT_AND_MAPPING §5（システムプロンプト確定版）/ §6（ユーザーメッセージテンプレート）。
// MVP はテキストのみ（素材サムネイルは添付しない＝12§4 更新・ADR-0010 P3 へ繰り延べ）。
// 出力契約（JSON モード／schema 指定）と検証（ajv→transformVideoPlan）は別モジュールが担う。
import { SCENE_MAX_DURATION_SEC, SCENE_MIN_DURATION_SEC } from '../constants';
import { GENERAL_PURPOSES, VIDEO_KIND } from '../enums';
import type { Asset } from '../project/types';
import type { GenerateVideoPlanInput, TemplateSummary } from './aiProvider';
// 12§7 の出力例（few-shot）。AI に ai-video-plan の構造（キー名・入れ子）を厳密に真似させるため、
// 正典 fixture を直接読む（ミラーしない＝検証スキーマと同じ単一参照元。validate:schemas で適合確認済みの有効サンプル）。
// videoKind=general は §7b の発表・説明向けサンプルを使う（章立て→parts・要点→texts/narration の手本＝ADR-0011 #7）。
import aiVideoPlanExample from '../../../docs/yuko_recruit_docs/fixtures/ai-video-plan.sample.json';
import aiVideoPlanGeneralExample from '../../../docs/yuko_recruit_docs/fixtures/ai-video-plan.general.sample.json';

/**
 * 12§5 の確定システムプロンプト（日本語・厳守事項の参照元）。本文は正典 12§5 と一致させる（変更時は両方を揃える）。
 * 出力フォーマットの構造指定（トップレベルキー等）と 12§7 の few-shot 例は buildVideoPlanUserMessage 側に置き、
 * ここの厳守事項を出力直前で補強する（散在ではなく役割分担：本定数=ルール本文／ユーザーメッセージ=構造・例）。
 * 尺の目安（最小〜最大秒）は 11§4 の SCENE_MIN/MAX_DURATION_SEC を埋め込む＝AIへの指示と検証側（P1-B の clamp）の
 * 閾値が黙って矛盾しないようにする（§2-7）。定数値（3/15）は 12§5 本文と一致させる。
 */
export const VIDEO_PLAN_SYSTEM_PROMPT = `あなたは採用動画の構成プランナーです。会社情報・利用可能な素材・利用可能な見た目パターン（テンプレート）をもとに、採用動画の構成案を作成します。

【厳守事項】
- あなたは動画や画像を生成しません。動画の「構成案」だけを作成します。
- 出力は指定スキーマ（ai-video-plan, schemaVersion "1.0"）に厳密準拠したJSONのみ。前後に説明文・見出し・コードフェンスを付けないこと。出力例にあるキー（と、掛け合いに使う任意の narrationLines）だけを使い、それ以外の新しいキーをどの階層にも足さないこと。
- 各シーンに templateId を必ず設定し、「利用可能な見た目パターン一覧」に存在するIDのみ使用する。新しいIDを創作しない。
- assetRefs の値は「利用可能な素材一覧」に存在する assetId のみ。該当が無ければ null にする。
- 値が無い任意項目は null や空配列を入れず、キーごと省略する。narrationText は原則として各シーンに空でない文字列を入れ（掛け合いで narrationLines を使う場面は省略可）、assetRefs は対象スロットが無ければ（キーごと）省略する。
- sceneType は、選んだ templateId の category と同じ値にする（「利用可能な見た目パターン一覧」に無い sceneType は使わず、利用可能な見た目だけで構成する）。
- 各シーンは短く区切る（1シーンで1つの内容）。長い動画はパートに分けて整理する。
- narrationText は会社マスコット「ゆうこ」が話す、自然で親しみやすい日本語にする。各見た目パターンの maxNarrationLength を超えない。
- 掛け合い（複数の声で交互に話す）にしたい場面に限り、narrationText の代わりに narrationLines（[{ text, voiceCharacter, subtitle? }] の配列）で行ごとに分けてよい。voiceCharacter は声のキャラ名（例「ずんだもん」「四国めたん」）。その場面の narrationText は省略してよい。掛け合いが不要なら narrationText（単一）にする。
- texts.subtitle は字幕用に短くする（各見た目パターンの maxSubtitleLength 以内）。ナレーションの要約でよい。
- texts.title / texts.main は画面に出す短い語句にする。
- durationSec は ${SCENE_MIN_DURATION_SEC}〜${SCENE_MAX_DURATION_SEC} 秒を目安にする。見た目パターンに上限（maxDuration）があれば従う。
- 全シーンの合計尺を targetDurationSec に近づける。
- 誇大表現・差別的表現・事実と異なる断定を避ける。
- yukoPoseTag は場面に合う表情タグ（例：smile, guide, bow）を「利用可能なゆうこ表情タグ一覧」から選ぶ。ゆうこを出さない見た目パターンでは null にする。
- 素材に人物・社外秘が含まれそうな場合は reviewNotes に確認を促す一文を入れる。`;

/**
 * 12§5b の確定システムプロンプト（一般・社内発表 general・日本語）。videoKind=general のとき §5 の代わりに使う。
 * 本文は正典 12§5b と一致させる（変更時は両方を揃える）。尺の目安は §5 同様 SCENE_MIN/MAX_DURATION_SEC を、
 * 一般 purpose の列挙は GENERAL_PURPOSES（11§3.1 由来の定数）を埋め込む＝enum/閾値の二重管理を避ける（§2-7）。
 */
export const VIDEO_PLAN_SYSTEM_PROMPT_GENERAL = `あなたは社内向け・一般向け動画の構成プランナーです。動画のテーマ・構成（章立て）・伝えたい要点・利用可能な素材・利用可能な見た目パターン（テンプレート）をもとに、発表・説明動画の構成案を作成します。

【厳守事項】
- あなたは動画や画像を生成しません。動画の「構成案」だけを作成します。
- 出力は指定スキーマ（ai-video-plan, schemaVersion "1.0"）に厳密準拠したJSONのみ。前後に説明文・見出し・コードフェンスを付けないこと。出力例にあるキー（と、掛け合いに使う任意の narrationLines）だけを使い、それ以外の新しいキーをどの階層にも足さないこと。
- 各シーンに templateId を必ず設定し、「利用可能な見た目パターン一覧」に存在するIDのみ使用する。新しいIDを創作しない。
- assetRefs の値は「利用可能な素材一覧」に存在する assetId のみ。該当が無ければ null にする。
- 値が無い任意項目は null や空配列を入れず、キーごと省略する。narrationText は原則として各シーンに空でない文字列を入れ（掛け合いで narrationLines を使う場面は省略可）、assetRefs は対象スロットが無ければ（キーごと）省略する。
- sceneType は、選んだ templateId の category と同じ値にする（一覧に無い sceneType は使わず、利用可能な見た目だけで構成する）。
- 「構成（章立て）」をパート（parts）に対応させ、各章を短いシーンに分ける（1シーンで1つの内容）。
- 「伝えたい要点」を各シーンの texts や narrationText に反映し、要点が漏れないようにする。
- narrationText は会社マスコット「ゆうこ」が話す、対象視聴者に合った自然な日本語にする。各見た目パターンの maxNarrationLength を超えない。
- 掛け合い（複数の声で交互に話す）にしたい場面に限り、narrationText の代わりに narrationLines（[{ text, voiceCharacter, subtitle? }] の配列）で行ごとに分けてよい。voiceCharacter は声のキャラ名（例「ずんだもん」「四国めたん」）。その場面の narrationText は省略してよい。掛け合いが不要なら narrationText（単一）にする。
- texts.subtitle は字幕用に短くする（maxSubtitleLength 以内）。texts.title / texts.main は画面に出す短い語句にする。
- durationSec は ${SCENE_MIN_DURATION_SEC}〜${SCENE_MAX_DURATION_SEC} 秒を目安にする。見た目パターンに上限があれば従う。全シーンの合計尺を targetDurationSec に近づける。
- 誇大表現・差別的表現・事実と異なる断定を避ける。社外秘・個人情報が含まれそうな場合は reviewNotes に確認を促す一文を入れる。
- yukoPoseTag は場面に合う表情タグを「利用可能なゆうこ表情タグ一覧」から選ぶ。ゆうこを出さない見た目パターンでは null にする。
- purpose は一般の種別（${GENERAL_PURPOSES.join(' / ')}）に沿った内容にする。`;

/** 任意項目が空のときにプロンプトへ出す既定表記（AI に「未提供」と伝えるため）。 */
const NOT_PROVIDED = '（未入力）';

/** 文字列が空/未定義なら NOT_PROVIDED を返す（前後空白は無視）。 */
function orNotProvided(value: string | undefined | null): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : NOT_PROVIDED;
}

/** 配列が空/未定義なら NOT_PROVIDED、そうでなければ区切り結合。 */
function joinList(items: readonly string[] | undefined, separator = '、'): string {
  if (!items || items.length === 0) return NOT_PROVIDED;
  return items.join(separator);
}

/** 章立て・要点を箇条書き行にする（一般 §6b）。空/未定義は NOT_PROVIDED 1行（空見出し＋空欄の矛盾を避ける）。 */
function bulletList(items: readonly string[] | undefined): string[] {
  if (!items || items.length === 0) return [NOT_PROVIDED];
  return items.map((item) => `- ${item}`);
}

/** 数値が未定義なら NOT_PROVIDED。 */
function orNotProvidedNum(value: number | undefined | null): string {
  return value === undefined || value === null ? NOT_PROVIDED : String(value);
}

/**
 * requiredSlots は「空配列＝スロット不要（意図的に無し）」を「未提供」と区別する
 * （`undefined`→未入力 / `[]`→「なし」）。AI が空配列を「データ欠落」と誤解しないため。
 */
function formatRequiredSlots(slots: readonly string[] | undefined): string {
  if (slots === undefined) return NOT_PROVIDED;
  if (slots.length === 0) return 'なし';
  return slots.join(', ');
}

/** 12§6「利用可能な見た目パターン」1件分の行（templateId のみ使用可をAIに示す）。 */
function templateBlock(t: TemplateSummary): string {
  return [
    `- templateId=${t.templateId} / category=${t.category} / hasYuko=${t.hasYuko}`,
    `  useCase=${orNotProvided(t.useCase)} / requiredSlots=${formatRequiredSlots(t.requiredSlots)}`,
    `  maxNarration=${orNotProvidedNum(t.maxNarrationLength)} / maxSubtitle=${orNotProvidedNum(t.maxSubtitleLength)} / maxDuration=${orNotProvidedNum(t.maxDurationSec)}`,
  ].join('\n');
}

/** 12§6「利用可能な素材」1件分の行（assetId のみ使用可をAIに示す。MVP はテキストのみ）。 */
function assetBlock(a: Asset): string {
  return [
    `- assetId=${a.assetId} / type=${a.assetType} / name=${a.displayName}`,
    `  説明=${orNotProvided(a.description)} / AI解析=${orNotProvided(a.aiDescription)} / tags=${joinList(a.tags, ', ')}`,
  ].join('\n');
}

/** 12§6 の採用ヘッダ（会社情報＋動画の方針）。recruit のとき使う。 */
function recruitHead(input: GenerateVideoPlanInput): string[] {
  const c = input.companyInfo;
  return [
    '# 会社情報',
    `会社名: ${orNotProvided(c?.companyName)}`,
    `業種: ${orNotProvided(c?.industry)}`,
    `事業内容: ${orNotProvided(c?.businessDescription)}`,
    `募集職種: ${orNotProvided(c?.jobType)} / 採用対象: ${orNotProvided(c?.recruitTarget)}`,
    `アピールしたいこと（強み・伝えたい点）: ${joinList(c?.strengths)}`,
    `求める人物像: ${orNotProvided(c?.desiredPerson)}`,
    `採用ページ: ${orNotProvided(c?.recruitUrl)}`,
    '',
    '# 動画の方針',
    `目的(purpose): ${input.purpose}`,
    `ターゲット: ${orNotProvided(input.targetAudience)}`,
    `希望尺(秒): ${input.targetDurationSec}`,
    `トーン: ${orNotProvided(input.tone)}`,
  ];
}

/** 12§6b の一般ヘッダ（テーマ・章立て・要点＋動画の方針）。general のとき会社情報の代わりに使う。 */
function generalHead(input: GenerateVideoPlanInput): string[] {
  const g = input.generalBrief;
  return [
    '# 動画のテーマ',
    `タイトル/テーマ: ${orNotProvided(g?.title)}`,
    '',
    '# 構成（章立て・アジェンダ）',
    ...bulletList(g?.agenda),
    '',
    '# 伝えたい要点',
    ...bulletList(g?.keyPoints),
    '',
    '# 動画の方針',
    `種別(purpose): ${input.purpose}`,
    `対象視聴者: ${orNotProvided(input.targetAudience)}`,
    `希望尺(秒): ${input.targetDurationSec}`,
    `トーン: ${orNotProvided(input.tone)}`,
  ];
}

/**
 * 12§6 のユーザーメッセージを入力から組み立てる（MVP＝テキストのみ・サムネイル添付なし）。
 * videoKind=general のときは §6b（テーマ／章立て／要点）に切り替え、補足・素材・見た目・表情タグ・出力契約は共通。
 * 送信前確認で利用者に提示する「外部AIへ送る内容」の実体でもある（§2-6）。
 */
export function buildVideoPlanUserMessage(input: GenerateVideoPlanInput): string {
  const isGeneral = input.videoKind === VIDEO_KIND.general;
  const head = isGeneral ? generalHead(input) : recruitHead(input);
  const templates = input.templates.map(templateBlock).join('\n');
  const assets = input.assets.map(assetBlock).join('\n');
  // 「値だけ今回の◯◯に合わせて作る」の主語は用途で変える（recruit=会社情報 / general=テーマ・構成・要点）。
  const exampleSubject = isGeneral ? 'テーマ・構成・要点' : '会社情報';
  // few-shot 出力例も用途で切り替える（general は §7b の発表・説明サンプル＝ADR-0011 #7）。
  const example = isGeneral ? aiVideoPlanGeneralExample : aiVideoPlanExample;
  return [
    ...head,
    '',
    // 自由記述（additionalNotes＝トップレベル・両用途共通）があるときだけセクションを出す。
    // 1000 字上限の検証は上流（保存時の schema 検証・入力UI の maxLength=ADDITIONAL_NOTES_MAX_LEN）が担う。
    // ここは送信用の整形のみ＝純粋関数として責務を上流に委ねる（12§4）。
    ...(input.additionalNotes?.trim()
      ? ['# 補足・その他（利用者からの自由記述。動画づくりで特に重視する）', input.additionalNotes.trim(), '']
      : []),
    '# 利用可能な見た目パターン（このIDのみ使用可）',
    templates,
    '',
    '# 利用可能な素材（このassetIdのみ使用可）',
    assets,
    '',
    '# 利用可能なゆうこ表情タグ',
    joinList(input.yukoPoseTags, ', '),
    '',
    '# 出力フォーマット（厳守）',
    'トップレベルのキーは schemaVersion・videoPlan・parts（必須）と reviewNotes（任意）のみ。これ以外のキーをトップレベルに足さない。',
    '**どの階層でも、出力例に無いキーを足さない**（説明・メモ・id・順番・コメント等を勝手に追加しない）。各オブジェクト（videoPlan・part・scene・texts など）は出力例にあるキーだけで構成し、任意項目で値が無いものはキーごと省略する。',
    '説明文・見出し・コードフェンスを付けず、JSON のみを返す。',
    '各シーンに templateId を必ず設定する（省略しない）。templateId は上の「利用可能な見た目パターン」に挙げた templateId のいずれかだけを使う（新しいIDや一覧に無いIDを作らない）。',
    '各シーンの sceneType は、選んだ templateId の category と同じ値にする（利用可能な見た目パターンに無い sceneType は使わない）。利用可能な見た目だけで表現できる構成にする。',
    'enum 項目（videoPlan.purpose・各シーンの sceneType・yukoPoseTag 等）は、上の一覧や出力例に示した値だけを使い、別の語を作らない。yukoPoseTag のように null 可の項目は該当が無ければ null にする。',
    '各フィールドの型は出力例と同じにする（文字列の項目を配列やオブジェクトにしない。targetAudience・tone・title・narrationText・各 texts などは単一の文字列）。',
    `次の例と**同じキー名・同じ入れ子構造・同じ型**で出力し、値だけ今回の${exampleSubject}・素材・見た目パターンに合わせて作る：`,
    JSON.stringify(example, null, 2),
  ].join('\n');
}

/** AIへ渡すメッセージ一式（システム＋ユーザー）。プロバイダがこれを各API（Gemini/OpenAI）の形に詰める。 */
export interface VideoPlanMessages {
  system: string;
  user: string;
}

/**
 * システムプロンプト＋ユーザーメッセージを組み立てる。
 * videoKind=general なら §5b/§6b（発表・説明）、それ以外は §5/§6（採用）を使う（ADR-0011）。
 */
export function buildVideoPlanMessages(input: GenerateVideoPlanInput): VideoPlanMessages {
  const system =
    input.videoKind === VIDEO_KIND.general ? VIDEO_PLAN_SYSTEM_PROMPT_GENERAL : VIDEO_PLAN_SYSTEM_PROMPT;
  return {
    system,
    user: buildVideoPlanUserMessage(input),
  };
}
