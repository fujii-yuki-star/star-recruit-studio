// 定数の正典は docs/yuko_recruit_docs/11_SCHEMA_REFERENCE.md §4。
// 文字列・数値リテラルの直書きを避け、ここを単一の参照元にする（CLAUDE.md §2-7 / §6）。
import { ORIENTATION } from './enums';
import type { Orientation, SceneCategory } from './enums';

// **AI 生成の“目安”**（#553）。手編集の制約ではない＝利用者が場面の尺を決めるときは縛らない（動画全体の
// 上限 VIDEO_HARD_MAX_SEC だけで縛る）。AI にはテンポの良いたたき台を作らせたいので、生成側だけこの範囲を
// 目安として渡し（buildVideoPlanRequest）、返ってきた値もこの範囲へ寄せる（transformPlan）。
// ※ 旧 SCENE_MIN/MAX_DURATION_SEC。「場面の最大尺」という名前で手編集にもハード適用されていたのを #553 で
//   用途別に分離した（根拠は AI のペース配分の目安のみで、技術要件でも schema 制約でもなかった）。
export const AI_SCENE_MIN_DURATION_SEC = 3;
export const AI_SCENE_MAX_DURATION_SEC = 15;
export const SCENE_DEFAULT_DURATION_SEC = 8;
// プロジェクト名の最大文字数。schemas/project.schema.json の projectName maxLength(80) と一致させる
//（§5・全入力口で共有する上限＝入力防御 #411／検証ネット #416 の prevention 側）。
export const PROJECT_NAME_MAX_LENGTH = 80;
export const TRANSITION_DEFAULT_SEC = 0.5;
// 「1回に再生する窓」の下限（秒）。**再生側だけの下限**で schema/正典の値ではない（#547 P3-15 で二重管理を1本化）。
// 必要な理由＝正典は `scene.durationSec > 0`（11 §7・schema `exclusiveMinimum:0`＝#586）だが、**読込時検証は範囲違反を
// 警告のみで拒否しない**（#416）ため、旧/手書きの不正データに 0（や 0.3 秒未満の極短）が残り得る。#553 で手編集の下限も
// 撤めたので短い場面自体は正当。これらで再生窓が 0 になると即時送り・0 長のアニメ窓になるため下限を噛ませる。
// （場面編集の確定入力自体は `clampSceneDuration` が別途クランプ済み＝ここは読み込みデータ・極短場面向けの防御。）
// 使用箇所は3つ：仕上がり確認の場面送りタイマー／仕上がり確認のアニメ窓／場面編集の動きプレビュー窓。
// 用途が分かれたら名前を分けて別値にする（そのとき3か所とも見直す）。
// **書き出しでは使わない**：MP4 は実際の表示時間で焼く（下限を混ぜるとプレビュー=書き出しが崩れる・ADR-0001/ADR-0026③）。
export const PREVIEW_MIN_PLAY_SEC = 0.3;

export const VIDEO_TARGET_MAX_SEC_MVP = 300;
export const VIDEO_HARD_MAX_SEC = 600;
export const MAX_SCENES_PER_VIDEO = 80;
export const DEFAULT_TARGET_DURATION_SEC = 60;

export const FPS = 30;
// 切り替え（xfade）が場面から食ってはいけない最小の「残り」＝1フレーム（1/FPS）。ADR-0009 の strict `<`
// （`0 ≤ D < 隣接場面尺`）を、出力のフレーム格子の上で「各場面が最低1フレームは残る」よう実装するための ε。
// 出力はフレームに量子化されるため、これ未満の残りは0フレーム＝実質不可視になる（比率 ε だと短尺場面で守れない）。
// D=場面尺（＝場面丸ごと消滅＋FFmpeg xfade の duration≥入力尺で未定義動作）を構造的に防ぐ（#547 P3-4／ADR-0009 未解決#4）。
export const TRANSITION_MIN_TAIL_SEC = 1 / FPS;
export const WIDTH = 1920;
export const HEIGHT = 1080;
// 縦型（9:16・ADR-0012）。SoT は videoSettings.aspectRatio で、寸法はここから導出する。
export const PORTRAIT_WIDTH = 1080;
export const PORTRAIT_HEIGHT = 1920;

/** 向き → フル出力寸法（aspectRatio を単一の真実とし寸法を導出する＝ADR-0012）。
 *  switch + never で網羅性を担保（将来 Orientation に値を追加したらコンパイルエラーで検知）。 */
export function dimsForOrientation(aspectRatio: Orientation): { width: number; height: number } {
  switch (aspectRatio) {
    case ORIENTATION.portrait:
      return { width: PORTRAIT_WIDTH, height: PORTRAIT_HEIGHT };
    case ORIENTATION.landscape:
      return { width: WIDTH, height: HEIGHT };
    default: {
      const _exhaustive: never = aspectRatio;
      return _exhaustive;
    }
  }
}

// 書き出しの軽量(HD相当)で揃える短辺(px)。短辺をこの値に等比縮小する（横16:9→1280×720 / 縦9:16→720×1280）。
// HD 短辺の単一参照元（旧 HD_WIDTH/HD_HEIGHT は exportDimsForOrientation に統合・§2-7）。
export const HD_SHORT = 720;

/** 書き出しの出力寸法（向き＋画質）。hd=true は短辺を HD_SHORT に等比縮小（向きによらず安全）。
 *  full は dimsForOrientation 経由なので Orientation の網羅性は型で保証される（1:1 追加時もそこで検知）。 */
export function exportDimsForOrientation(
  aspectRatio: Orientation,
  hd: boolean,
): { width: number; height: number } {
  const full = dimsForOrientation(aspectRatio);
  if (!hd) return full;
  const scale = HD_SHORT / Math.min(full.width, full.height);
  return { width: Math.round(full.width * scale), height: Math.round(full.height * scale) };
}

export const NARRATION_VOLUME = 1.0;
export const BGM_VOLUME = 0.25;
export const ORIGINAL_AUDIO_VOLUME = 0.2;
// 場面ごとBGMで曲が変わる境界のクロスフェード長（秒・ADR-0018 ③(7)）。前後を half ずつ重ねる。単一の参照元（§2-7）。
export const BGM_CROSSFADE_SEC = 1.0;
// 音量の値域（§4：0.0〜1.5、1.0=原音）。
export const VOLUME_MIN = 0.0;
export const VOLUME_MAX = 1.5;
// 原音量（100%・等倍）。プレビュー再生で「これ以下は HTMLMediaElement.volume で厳密／超過は Web Audio GainNode で増幅」
// を分ける境界であり、要素の .volume 物理上限でもある（単一の参照元＝§2-7・直書き禁止）。
export const UNITY_VOLUME = 1.0;
// 音量スライダーの刻み（UI）。
export const VOLUME_STEP = 0.05;

// 動画クリップの再生速度（§4：atempo 1段の範囲 0.5〜2.0、1.0=等速）。尺は不変（ADR-0007 Phase 3b）。
export const SPEED_MIN = 0.5;
export const SPEED_MAX = 2.0;
export const SPEED_DEFAULT = 1.0;
export const SPEED_STEP = 0.25;

// 取り込み時にメモリへ展開（data URL/生バイト）してよい素材サイズの上限（#48・A3）。
// これを超えるファイルは base64/バイトを JS に載せず、ネイティブ「開く」のパス0コピー取り込みへ誘導する（OOM 保険）。
// schema/データには影響しない実装上の保険のため 11§4 定数カタログには載せない（HD_SHORT 等と同じ扱い）。
export const MAX_INLINE_ASSET_BYTES = 50 * 1024 * 1024; // 50 MB

// 「全場面の声を作成」で同時に走らせる合成の数（#547 P2-6）。
// 全件を一度に投げると**待機列が空になり中止が効かない**（始まっていない仕事が無い）ため上限を設ける。
// 小さくするほど中止が速く効き進捗も細かく進むが、そのぶん全体は遅くなる。3 は「1件あたり数秒の合成でも
// 中止がおおむね1件ぶんの待ちで効く」ことを狙った実装上の値。schema/データには影響しないため
// 11§4 定数カタログには載せない（MAX_INLINE_ASSET_BYTES と同じ扱い）。
export const NARRATION_BULK_CONCURRENCY = 3;

export const MAX_NARRATION_LEN_DEFAULT = 120;
export const MAX_SUBTITLE_LEN_DEFAULT = 60;
// 自由記述「その他」(トップレベル additionalNotes・両用途共通・ADR-0011) の上限。schemas/project.schema.json の maxLength と一致させる。
export const ADDITIONAL_NOTES_MAX_LEN = 1000;

// generalBrief（一般・社内発表の入力）の上限（ADR-0011 #4）。schemas/project.schema.json の maxLength/maxItems と一致させる。
export const GENERAL_TITLE_MAX_LEN = 100;        // テーマ・タイトル
export const GENERAL_TARGET_AUDIENCE_MAX_LEN = 100; // 対象視聴者
export const GENERAL_LIST_ITEM_MAX_LEN = 100;    // agenda / keyPoints の1項目
export const GENERAL_LIST_MAX_ITEMS = 20;        // agenda / keyPoints の要素数上限

// 一般動画のトーン候補（toneSettings.tone へ保存する文言・一般ウィザードの選択肢）。ADR-0011 #12。
export const TONE_PRESETS = ['親しみやすい', '丁寧・落ち着いた', 'フォーマル', '明るい・元気'] as const;
// 既定トーン（未選択時・generate のフォールバック）。単一参照元（§2-7）＝二重定義を避ける。
export const DEFAULT_TONE = TONE_PRESETS[0];

export const DEFAULT_VOICE_ID = 'voicevox_zundamon';
export const DEFAULT_CHARACTER_ID = 'yuko';

// スロットの既定フィット（テンプレ・clip 未指定時）。正典(§4)に既定の明記は無く、cover を既定とする（MVP）。
export const DEFAULT_FIT = 'cover' as const;

// AI 出力の場面種別が未知/未指定でテンプレからも解決できないときの既定カテゴリ（transformPlan の補正フォールバック・§2-7）。
export const DEFAULT_SCENE_CATEGORY: SceneCategory = 'photo_intro';

/**
 * **ドラッグ/リサイズ**で矩形（FREE 要素／テンプレ Layer）を潰さないための最小サイズ（canvas px）。
 * 根拠＝**つまみ（角ハンドル）を掴める大きさを残す**という操作上の必然（掴めない要素は復帰しづらい）＝
 * 「目安/開発都合の任意値」ではない。**数値欄はこれに縛られない**（`min=1`＝明示指定なら 1px まで許す・
 * レイヤー一覧/数値欄が逃げ道になる）＝**用途が違うから下限が違う**（#554 で用途別として明文化）。
 */
export const GEOM_MIN_SIZE = 20;

/**
 * グループ拡縮の最小倍率（schema: `scale>0` を UI でも担保）。FREE/テンプレのグループ枠で共有（ADR-0022・§2-7）。
 * #554 で 0.1（10%）→ 0.01（1%）へ緩和：0.1 は根拠のない任意値で「小さなロゴ群を5%に」等の正当な利用を妨げていた。
 * 併せてグループの倍率に**数値入力**を用意した（枠のつまみだけが唯一の手段＝逃げ道なし、を解消）。
 */
export const GROUP_MIN_SCALE = 0.01;

/**
 * タイムライン overlay クリップの最小長（秒）。トリミングで潰さないための下限（schema: `durationSec>0`・ADR-0018・§2-7）。
 *
 * **0.5 は根拠のない任意値**（#554 は 0.1 への緩和を求めている）だが、**下げるにはトリミング経路の修正が先に要る**
 * ため #561 へ切り出した。理由＝この値は「二進で厳密に表せる」ことに偶然依存している：`snappedDelta`
 * （TimelineView）と `editClip`（TimelineEditScreen）が**同じ下限で二重にクランプ**し、その間を**delta（差分）で
 * 受け渡す**ため、`長さ + (clamp済みの端 - 元の端)` が下限へ厳密に戻らない。0.5 では戻る（5-4.5 が厳密）が、
 * 0.1 では `0.09999999999999964`（下限割れ）や `0.10000000000000009`（欄に17桁）になる。
 * delta なのは TimelineView が**グローバル秒**・store が**場面アンカー相対**で、差分だけが両者で不変だから。
 */
export const TIMELINE_MIN_CLIP_SEC = 0.5;

/**
 * 角度（回転）の数値入力の下限/上限（度）。**要素とグループの角度欄で共有する単一の参照元**（§2-7・#554）。
 * 根拠は正典＝schema の `rotation` は `minimum:0` / `exclusiveMaximum:360`（360=0 は重複ゆえ除外）で、
 * 回転ドラッグ（`rotationFromPointer`/`snapAngle`）も整数 0..359 へ正規化する＝**欄とドラッグの到達域が一致**する。
 */
export const ROTATION_DEG_MIN = 0;
export const ROTATION_DEG_MAX = 359;

/**
 * 縁取り/枠線の太さの上限（canvas px）。**FREE・テンプレの両エディタで共有する単一の参照元**（§2-7）。
 * #554 以前は FREE=100／テンプレ=20 と画面ごとに別の任意値で、同概念が編集画面で別挙動だった（ADR-0026②）。
 * schema（`strokeWidth`）は `minimum:0` で上限を持たないため、UI の上限は「極端値でフォームが壊れない」ための
 * 実用上の天井にすぎない＝**広い方（100）に統一**してテンプレ側の不当な制限（21px 以上を作れない）を解く。
 */
export const STROKE_WIDTH_MAX = 100;
