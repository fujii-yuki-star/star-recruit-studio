// 場面形式 → タイムライン形式の**焼き出し**（片道変換・ADR-0032 決定16/17・#628）。純粋関数（副作用なし）。
//
// 「片道」なので**元の場面形式プロジェクトには一切触れない**（この関数が `Project` を受け取って
// 新しい `TimelineProject` を返すだけ＝構造で担保する。呼び出し側も戻り値を保存するだけでよい）。
// 焼き直しは常に別の新規プロジェクト（差分マージはしない＝決定16）。
//
// 時間軸の組み立ては**書き出しと同じ経路**を共有する（`resolveTransition` + `transitionTimeline`）＝
// 焼く前に場面形式で書き出した尺と、焼いた結果の尺が一致する（ADR-0001 のパリティの入口）。
//
// 素材は**コピーする前提で `doc.assets` に載せる**（自己完結＝ADR-0024 (6)・決定13）。実ファイルのコピーと
// 容量の事前提示は infrastructure/UI の仕事で、ここは「どれを持っていくか」だけを決める。
import { dimsForOrientation } from '../constants';
import {
  FREE_CATEGORY,
  FREE_ELEMENT_KIND,
  PROJECT_FORMAT,
  LAYER_TYPE,
  SUBTITLE_SOURCE_KIND,
  TEXT_KEY,
  TIMELINE_CLIP_KIND,
  TRACK_KIND,
  TRANSITION_DIRECTION,
  TRANSITION_TYPE,
} from '../enums';
import type { TextKey, TransitionDirection } from '../enums';
import type { FontId } from '../font/fontCatalog';
import { composeGroupGeometry, isHiddenByGroup } from '../group/compose';
import { sceneActiveAssetIds } from '../project/assetUsage';
import { groupBgmRuns } from '../project/compileTimeline';
import { lineSegments, resolveLineSubtitle } from '../project/lineTimeline';
import { sceneLines } from '../project/narrationLines';
import { createAnimationId, createClipId, createGroupId, createTrackId } from '../project/persistence';
import { resolveTransition, transitionBoundaryDs, transitionTimeline } from '../project/sceneTransitions';
import type { DrawnTransitionType } from '../project/sceneTransitions';
import { defaultSubtitleSource, freeSubtitleElementTexts } from '../project/subtitleBinding';
import { boxHeightForLines, DEFAULT_TEMPLATE_MAX_LINES, resolveTextStyle } from '../template/textStyle';
import { stackedSubtitleBands } from '../text/subtitleBands';
import { wrapText } from '../text/textWrap';
import type { Asset, FreeElement, Keyframe, NarrationLine, Project, Scene, Texts } from '../project/types';
import type { Group } from '../group/types';
import type { Template } from '../template/types';
import type { ClipAnimation, TimelineClip, TimelineProject, Track } from './types';
import { TIMELINE_SCHEMA_VERSION } from './types';

/** 焼き出す範囲の種別（ADR-0032 決定17）。文字列直書きを避ける（§2-7）。 */
export const BAKE_RANGE_KIND = {
  whole: 'whole',
  part: 'part',
  scenes: 'scenes',
} as const;

/** 焼き出す範囲（全体／パート／範囲＝ADR-0032 決定17）。 */
export type BakeRange =
  | { kind: typeof BAKE_RANGE_KIND.whole }
  | { kind: typeof BAKE_RANGE_KIND.part; partId: string }
  | { kind: typeof BAKE_RANGE_KIND.scenes; sceneIds: readonly string[] };

/**
 * 焼き出しで**持っていけなかったもの**の種別（15 §6）。黙って落とさないための記録（§2-5 / ADR-0026④）。
 * 呼び出し側（UI）はこれを「焼く前の確認」と「焼いた後の案内」に使う。
 */
export const BAKE_NOTE_CODE = {
  /**
   * **自由配置の字幕ボックス**で対象が行に追従するもの（全部／話者）。要素の「対象」の語彙が本形式に
   * 無いため持っていけない。**通常の見た目の字幕層は #633 で焼けるようになった**（行ごとの字幕クリップ）。
   */
  dialogueSubtitle: 'BAKE_DIALOGUE_SUBTITLE_SKIPPED',
  /** 動画の差し込み口の「再生を始めるタイミング」（ADR-0027）。タイムライン形式に置き場が無い。 */
  videoStartTiming: 'BAKE_VIDEO_START_TIMING_SKIPPED',
} as const;

export type BakeNoteCode = (typeof BAKE_NOTE_CODE)[keyof typeof BAKE_NOTE_CODE];

/** 持っていけなかったもの1件（該当する場面の番号つき＝どこを直せばよいか分かるように）。 */
export interface BakeNote {
  code: BakeNoteCode;
  /** 範囲の中での場面番号（1始まり）。 */
  sceneNumbers: number[];
}

export interface BakeOptions {
  range: BakeRange;
  /** 新しいプロジェクトの id（呼び出し側が `createProjectId` で発行＝この関数に時計を持ち込まない）。 */
  projectId: string;
  projectName: string;
  /** `createdAt`/`updatedAt`（ISO 文字列）。同じ理由で外から渡す。 */
  nowIso: string;
  /**
   * 見た目パターンの解決。2か所で使う：
   * - **自由配置の場面かどうかの判定**（`isFreeScene`）＝描画（`layoutScene`）と同じく**見た目の category が正**。
   *   解決できないときだけ場面自身の記録（`scene.sceneType`）へ落ちる。
   * - **素材を絞る**（休眠の割当を持っていかない＝`sceneActiveAssetIds`）。未指定/未解決は絞らず全部持っていく
   *   ＝素材を落とすより多めに持つ側へ倒す（`sceneActiveAssetIds` と同じ方針）。
   */
  templateOf?: (templateId: string) => Template | undefined;
  /** 場面→行ごとの音声長（秒・lineId→秒）。掛け合いの自動逐次で区間尺を決める（書き出しと同じ入力）。 */
  lineDurationsFor?: (scene: Scene) => Record<string, number>;
}

export interface BakeResult {
  doc: TimelineProject;
  /** 持っていけなかったもの（空＝そのまま焼けた）。 */
  notes: BakeNote[];
  /** 焼いた場面（範囲の解決結果・再生順）。呼び出し側の確認表示に使う。 */
  scenes: Scene[];
}

/**
 * 焼く対象の場面を範囲から解決する（再生順＝`project.scenes` の配列順を保つ）。純粋関数。
 * 範囲指定でも並べ替えない＝「この部分だけ」を切り出すだけで、順番は場面形式のまま。
 */
export function scenesForBakeRange(project: Project, range: BakeRange): Scene[] {
  switch (range.kind) {
    case BAKE_RANGE_KIND.whole:
      return [...project.scenes];
    case BAKE_RANGE_KIND.part:
      return project.scenes.filter((s) => s.partId === range.partId);
    case BAKE_RANGE_KIND.scenes: {
      const want = new Set(range.sceneIds);
      return project.scenes.filter((s) => want.has(s.sceneId));
    }
    default: {
      const _exhaustive: never = range;
      return _exhaustive;
    }
  }
}

/**
 * 「ここからここまで」で選んだ2場面の間（両端を含む）の場面 id（再生順）。純粋関数。
 *
 * 端の指定順は問わない（後ろの場面を先に選んでも同じ範囲になる）＝利用者がどちらから選んでも同じ結果。
 * どちらかが見つからないときは空（呼び出し側が「範囲を選び直してください」を出す）。
 */
export function sceneIdsBetween(scenes: readonly Scene[], aSceneId: string, bSceneId: string): string[] {
  const ia = scenes.findIndex((s) => s.sceneId === aSceneId);
  const ib = scenes.findIndex((s) => s.sceneId === bSceneId);
  if (ia < 0 || ib < 0) return [];
  return scenes.slice(Math.min(ia, ib), Math.max(ia, ib) + 1).map((s) => s.sceneId);
}

/**
 * トラックの割り当て（同一トラック内で時間が重ならない＝11 §8 V24 を**構造で**守る）。
 *
 * 1場面ぶんの列は**必ず連続した並び**で取る。こうすると、切り替えで重なる2つの場面は
 * 「片方が丸ごともう片方より手前」に必ずなる（層が互い違いに挟まらない）＝切り替えを場面まるごとの
 * 不透明度で表せる（ADR-0032 決定19）。どちらが手前かは取れた位置で決まるので、
 * **入る側を強制的に上へ置くことはしない**（それをやると切り替えのたびに列が1本ずつ増えて際限が無い）。
 * 空いた列は下から詰め直すので、切り替え続きの動画でも通常は2列で回る。
 */
class TrackAllocator {
  /** 列ごとの「この秒以降なら空いている」。index が重ね順（小さいほど背面）。 */
  private freeAt: number[] = [];

  /**
   * `count` 本の**連続した**列を、`startSec` に空いている最も背面の位置から確保する。
   * 返すのは先頭の index（背面側）＝ `[base, base+count)` を使う。
   */
  take(count: number, startSec: number, endSec: number): number {
    // 端が接するだけ（前の終わり＝次の始まり）は重なりではない（V24）。
    const free = (i: number): boolean => (this.freeAt[i] ?? 0) <= startSec;
    let base = 0;
    for (;;) {
      let k = 0;
      while (k < count && free(base + k)) k += 1;
      if (k === count) break;
      base += k + 1; // 埋まっていた列の次から探し直す
    }
    for (let i = base; i < base + count; i += 1) this.freeAt[i] = endSec;
    return base;
  }
}

/** 場面が占める列の範囲（`[base, base+count)`）。どちらの場面が手前かの比較に使う。 */
interface ColumnBlock {
  base: number;
  count: number;
}

/** 指定キーを持たない `texts`（行ごとに焼いた字幕を、テンプレクリップ側から落とすのに使う）。 */
function withoutKeys(texts: Texts, keys: readonly TextKey[]): Texts {
  if (keys.length === 0) return texts;
  const out = { ...texts };
  for (const k of keys) delete out[k];
  return out;
}

/** 0 の符号を落とす（`-0` を作らないための正規化。保存される JSON に `-0` を混ぜない）。 */
function neg(v: number): number {
  return v === 0 ? 0 : -v;
}

/** 行ごとの窓（同時開始グループのメンバーも含む・0秒は出さない＝ゼロ幅クリップ防止）。 */
interface LineWindow {
  line: NarrationLine;
  startSec: number;
  durationSec: number;
}

/** 行ごとの窓（すべての行）。同時開始グループのメンバーは同じ窓を共有する。 */
function lineWindows(scene: Scene, lineDurations: Record<string, number>): LineWindow[] {
  const lines = sceneLines(scene);
  const segs = lineSegments(scene, lineDurations); // lines と同順・同数
  const out: LineWindow[] = [];
  for (let i = 0; i < segs.length; i += 1) {
    const seg = segs[i];
    if (seg.endSec <= seg.startSec) continue;
    out.push({ line: lines[i], startSec: seg.startSec, durationSec: seg.endSec - seg.startSec });
  }
  return out;
}

/**
 * **声にするのは読み上げ文がある行だけ**＝鳴らない「空の声」を作らない（schema の if/then・`11 §8` V28）。
 * **字幕は別**＝文が空でも字幕は出ていることがあるので、字幕側はすべての行（`lineWindows`）を使う（#633）。
 */
function hasVoiceText(w: LineWindow): boolean {
  return w.line.text.trim().length > 0;
}

/** 切り替えを表すキーフレーム（クリップ先頭からの秒）。`incoming`＝入る場面／`outgoing`＝出ていく場面。 */
interface TransitionKeyframes {
  incoming: Keyframe[];
  outgoing: Keyframe[];
}

/** 対象ごとにキーフレームを溜める（#717）。 */
function addKeyframes(pending: Map<string, Keyframe[]>, targetId: string, keyframes: readonly Keyframe[]): void {
  const cur = pending.get(targetId);
  if (cur) cur.push(...keyframes);
  else pending.set(targetId, [...keyframes]);
}

/**
 * 時刻の昇順に並べ、**同じ時刻には1つ**にする（`11 §7.6.3.1` と同じ規則）。
 * ⚠️ **溜まる順は昇順とは限らない**（短い場面が続くと、退場の開始が入場の終わりより前に来る）ので、
 * 並べ直しも実際に効いている。
 *
 * ⚠️ **同じ時刻はプロパティ単位で重ねる**（丸ごと後勝ちにしない）。場面が短いと入場と退場は**時間が重なり**、
 * 種別が違う（`fade` と `slide` など）と同じ時刻に別のプロパティが来る。
 * 丸ごと置き換えると片方のプロパティが消え、たとえば `opacity` が 0 のままになって**その場面が一度も
 * 映らない**。正典（`11 §7.6.3.1`）の「すでにあれば渡したプロパティだけ差し替え」と同じにする。
 */
function sortedKeyframes(keyframes: readonly Keyframe[]): Keyframe[] {
  const byTime = new Map<number, Keyframe>();
  for (const k of keyframes) byTime.set(k.timeSec, { ...byTime.get(k.timeSec), ...k });
  return [...byTime.values()].sort((a, b) => a.timeSec - b.timeSec);
}

/**
 * 実効の切り替え（`resolveTransition` の結果）をキーフレームへ分解する（ADR-0032 決定19）。純粋関数。
 *
 * - `fade`＝**手前にある側**の不透明度を動かす。入る側が手前なら 0→1（重ねながら現れる）、
 *   出ていく側が手前なら 1→0（薄れて下の新しい絵が出る）。**どちらも FFmpeg の xfade=fade
 *   （線形ブレンド `(1-a)·A + a·B`）と同値**＝不透明な全画面どうしなら同じ絵になる。
 *   「入る側を必ず手前」に固定しないのは、そうすると切り替えのたびに列が増えるため（`TrackAllocator`）。
 *   端の値が 0/1 でよいのは、付け先が**通常＝テンプレクリップ（自前の不透明度を持たない）／FREE＝場面グループ
 *   （グループの不透明度はメンバーへ乗算・ADR-0019 (3)）**のどちらかだから＝要素の不透明度を潰さない。
 * - `slide`＝**両方が一緒に動く**。FFmpeg の `slideleft` 等は A が出ていき B が入ってくる形で2枚とも移動するので、
 *   入る側だけ動かすと絵が変わる。x/y キーフレームは**本来位置からの相対**（`interpolateKeyframes` の適用規則）。
 * - `none`＝キーフレーム無し（ハードカット）。
 *
 * `default` の `never` チェックは**意図的な仕掛け**：`DrawnTransitionType`（＝`sceneTransitions` の丸め表）に
 * wipe が加わった瞬間ここがコンパイルエラーになり、黙って fade として焼き続けることができなくなる（決定19）。
 *
 * @param outgoingStartSec 出ていく側のクリップ先頭から見た、重なりが始まる秒。
 */
function transitionKeyframes(
  type: DrawnTransitionType,
  direction: TransitionDirection,
  durationSec: number,
  outgoingStartSec: number,
  canvas: { width: number; height: number },
  /** 入る側が出ていく側より手前の列にあるか（`fade` をどちらへ付けるかが決まる）。 */
  incomingIsAbove: boolean,
): TransitionKeyframes {
  switch (type) {
    case TRANSITION_TYPE.none:
      return { incoming: [], outgoing: [] };
    case TRANSITION_TYPE.fade:
      return incomingIsAbove
        ? {
            incoming: [
              { timeSec: 0, opacity: 0 },
              { timeSec: durationSec, opacity: 1 },
            ],
            outgoing: [],
          }
        : {
            incoming: [],
            outgoing: [
              { timeSec: outgoingStartSec, opacity: 1 },
              { timeSec: outgoingStartSec + durationSec, opacity: 0 },
            ],
          };
    case TRANSITION_TYPE.slide: {
      // 進行方向（画面がどちらへ流れるか）。出ていく側はこの向きへ抜け、入る側は逆側から入ってくる。
      const move = slideVector(direction, canvas);
      return {
        incoming: [
          { timeSec: 0, x: neg(move.x), y: neg(move.y) },
          { timeSec: durationSec, x: 0, y: 0 },
        ],
        outgoing: [
          { timeSec: outgoingStartSec, x: 0, y: 0 },
          { timeSec: outgoingStartSec + durationSec, x: move.x, y: move.y },
        ],
      };
    }
    default: {
      const _exhaustive: never = type;
      return _exhaustive;
    }
  }
}

/** スライドの進行ベクトル（画面1枚ぶん）。`slideleft` は画面が左へ流れる＝出ていく側が左へ抜ける。 */
function slideVector(direction: TransitionDirection, canvas: { width: number; height: number }): { x: number; y: number } {
  switch (direction) {
    case TRANSITION_DIRECTION.right:
      return { x: canvas.width, y: 0 };
    case TRANSITION_DIRECTION.up:
      return { x: 0, y: -canvas.height };
    case TRANSITION_DIRECTION.down:
      return { x: 0, y: canvas.height };
    case TRANSITION_DIRECTION.left:
      return { x: -canvas.width, y: 0 };
    default: {
      const _exhaustive: never = direction;
      return _exhaustive;
    }
  }
}

/** FREE 要素の重ね順（描画と同じ＝未指定は 0 として昇順・安定ソート）。 */
function byZIndex<T extends { zIndex?: number }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0));
}

/**
 * この場面を自由配置（要素ごとに焼く）として扱うか。純粋関数。
 *
 * **見た目が解決できるなら、その category が正**＝描画（`layoutScene`）と同じ規則にする。
 * 解決できないときだけ**場面自身の記録（`scene.sceneType`）**へ落ちる（`switchSceneTemplate` が
 * 見た目のカテゴリに追従させている）。見た目だけを見て決めると、**見た目が見つからない場面の
 * `freeLayout`・グループ・場面内アニメが黙って落ちる**（§2-5／ADR-0030 系の「多く持つ側へ倒す」に反する）。
 */
export function isFreeScene(scene: Scene, template: Template | undefined): boolean {
  return (template?.category ?? scene.sceneType) === FREE_CATEGORY;
}

/**
 * 字幕ボックス（`kind:'subtitle'`）のうち、**時間で変わらないもの**の表示文。純粋関数。
 *
 * FREE の字幕ボックスは表示文を「対象（`subtitleSource`）」から解く（ADR-0029）が、タイムライン形式に
 * 対象の語彙は無い（連動は #633）。**対象＝読み上げ（`narration`）だけは静的**＝`texts.subtitle` を出すので、
 * いま出ている文をそのまま焼き付けられる。これをしないと単独ナレーションの字幕が黙って消える（§2-5）。
 * 行に追従する対象（全部／話者）は焼けないので何も付けず、`BakeNote` で知らせる。
 * 字幕 OFF・文が空（`freeSubtitleElementTexts` が空）のときも何も付けない＝元から出ていない。
 */
export function staticSubtitleText(el: FreeElement, scene: Scene): { text?: string } {
  if (el.kind !== FREE_ELEMENT_KIND.subtitle) return {};
  const source = el.subtitleSource ?? defaultSubtitleSource(scene);
  if (source.kind !== SUBTITLE_SOURCE_KIND.narration) return {};
  const [text] = freeSubtitleElementTexts(el, scene);
  return text != null ? { text } : {};
}

/**
 * 焼くと出なくなる「時間で変わる字幕」がこの場面にあるか。純粋関数。**実際に表示されているものだけ**数える
 * （非表示・OFF・空は失われるものが無い＝`freeContentHiddenBySwitch` と同じ流儀）。
 *
 * 2経路ある：
 * - **テンプレの字幕層**は、セリフ列（`scene.lines`）がある場面では**行ごとに文言が差し替わる**
 *   （`layout` の `opts.subtitleText` 上書き）。焼くとテンプレクリップの `texts` しか残らないので出なくなる。
 *   **1行だけの `lines` でも同じ**＝行数で判定すると取りこぼす。
 * - **FREE の字幕ボックス**のうち、対象が行に追従するもの（全部／話者）。対象＝読み上げは静的なので焼ける
 *   （`staticSubtitleText`）。
 */
function hasTimeVaryingSubtitle(scene: Scene, isFree: boolean): boolean {
  // 通常の見た目の**テンプレ字幕層**は #633 で焼けるようになった（行ごとの字幕クリップ＋連動）。
  // 残るのは**自由配置の字幕ボックスで対象が行に追従するもの**（全部／話者）＝要素の対象の語彙が
  // タイムライン形式に無いため、まだ持っていけない。
  if (isFree) {
    for (const el of scene.freeLayout ?? []) {
      if (el.kind !== FREE_ELEMENT_KIND.subtitle) continue;
      if (el.hidden || isHiddenByGroup(el.id, scene.groups ?? [])) continue; // 描かれない＝失われない
      const source = el.subtitleSource ?? defaultSubtitleSource(scene);
      if (source.kind === SUBTITLE_SOURCE_KIND.narration) continue; // 静的＝焼ける
      if (freeSubtitleElementTexts(el, scene).length > 0) return true;
    }
  }
  return false;
}

/** 焼いた「行ごとの字幕」1つぶん（時間はセリフの窓・文言は焼き付け・連動先は同じ行の読み上げ）。 */
export interface BakedLineSubtitle {
  /** 連動させる読み上げの行 id（呼び出し側がクリップ id へ解決する）。 */
  lineId: string;
  /** 焼いた元の字幕層の `textKey`（どの層から来たかの記録）。 */
  textKey: TextKey;
  /** 場面ローカルの開始秒（読み上げの窓と同じ）。 */
  startSec: number;
  durationSec: number;
  /** 空間・体裁（`FreeElement` の語彙＝そのままクリップへ載る）。 */
  spatial: Omit<FreeElement, 'id' | 'kind' | 'zIndex' | 'subtitleSource'> & { text: string };
}

/**
 * 掛け合い（セリフ列）の字幕を**行ごとの字幕クリップ**へ焼く（#633）。純粋関数。
 *
 * 場面形式は「1つのテンプレ字幕層の文言が行ごとに差し替わる」ので、1つのクリップでは表せない
 * （だから #628 では落として `BakeNote` で知らせていた）。タイムライン形式は**行ごとに別のクリップ**にでき、
 * それぞれが読み上げクリップへ連動する（決定24）＝時間も文言も追従する。
 *
 * 位置は**描画と同じ規則**で決める：
 * - 同時に流れる行（ADR-0031）は `stackedSubtitleBands` で下から積む（**描画と同じ関数**＝焼く前と後で
 *   字幕の位置が変わらない）。
 * - テンプレ字幕層は**下端基準**（行が増えると上へ伸びる）だが、タイムラインの字幕クリップは**上端起点**
 *   （自由配置と同じ語彙）。そこで帯の**上端**（`stackedSubtitleBands` の `top`）を y に使う＝
 *   アンカーの違いを座標へ翻訳する（`freeLayoutFromPlacedContent` の `subtitleTopY` と同じ考え方だが、
 *   **行ごとに文が決まっている**ので最大行数へ寄せる必要がなく、実際の折返し行数で正確に置ける）。
 * - 体裁（大きさ・色・縁取り・帯）は場面の上書きを解決した実効値（`resolveTextStyle`）＝描画と同じ。
 */
export function bakeLineSubtitles(
  scene: Scene,
  template: Template | undefined,
  windows: ReadonlyArray<{ line: NarrationLine; startSec: number; durationSec: number }>,
): BakedLineSubtitle[] {
  if (!hasExplicitLines(scene) || !template) return [];
  const groups = template.groups ?? [];
  const layerGeom = composeGroupGeometry(template.layers, groups);
  const out: BakedLineSubtitle[] = [];
  for (const layer of template.layers) {
    if (layer.type !== LAYER_TYPE.subtitle || isHiddenByGroup(layer.id, groups)) continue; // 描かれない層は焼かない
    const cg = layerGeom.get(layer.id) ?? { x: layer.x, y: layer.y, w: layer.w, h: layer.h, rotation: layer.rotation };
    const style = resolveTextStyle(layer, layer.textKey ? scene.textStyles?.[layer.textKey] : undefined);
    const maxLines = layer.maxLines ?? DEFAULT_TEMPLATE_MAX_LINES;
    // 同時に流れる行は1つの窓を共有する＝窓ごとにまとめて段積みする（描画と同じ積み方）。
    const byWindow = new Map<string, typeof windows[number][]>();
    for (const w of windows) {
      const key = `${w.startSec}/${w.durationSec}`;
      byWindow.set(key, [...(byWindow.get(key) ?? []), w]);
    }
    for (const members of byWindow.values()) {
      // 出ている字幕だけを積む（OFF・空は元から出ていない＝帯の位置もずらさない）。
      const shown = members
        .map((w) => ({ w, sub: resolveLineSubtitle(w.line, scene) }))
        .filter((x) => x.sub.enabled && x.sub.text.length > 0);
      if (shown.length === 0) continue;
      const bands = stackedSubtitleBands(shown.map((x) => x.sub.text), cg.y, cg.w, style.fontSize, maxLines);
      shown.forEach((x, k) => {
        const lines = wrapText(x.sub.text, cg.w, style.fontSize, maxLines).length;
        const boxH = boxHeightForLines(lines, style.fontSize);
        // 旧箱の中心（アンカー y ＋ 層の高さ）と新箱の中心（帯の上端＋この行数の高さ）の差。
        const shift = rotationShift(cg.rotation ?? 0, (bands[k].y + cg.h / 2) - (bands[k].top + boxH / 2));
        out.push({
          lineId: x.w.line.lineId,
          textKey: layer.textKey ?? TEXT_KEY.subtitle, // 既定束縛は描画（`layoutScene`）と同じ
          startSec: x.w.startSec,
          durationSec: x.w.durationSec,
          spatial: {
            // 回転がある層は、**箱が変わると回転の軸（箱の中心）も動く**（`sceneSvg` は箱の中心で回す）。
            // 中身が同じ場所に来るよう、軸の移動ぶんを平行移動で打ち消す＝焼く前と同じ位置に出る。
            x: cg.x + shift.dx,
            // 帯の**上端**へ置き換える（下端基準→上端起点の翻訳）。
            y: bands[k].top + shift.dy,
            w: cg.w,
            // 受け側は枠高から表示行数を導く（FREE 字幕）。層の高さを残すと**テンプレの上限より多く折り返す**
            // ので、その行数がちょうど入る高さへ翻訳する（`textStyle` の規定どおり）。
            h: boxH,
            ...(cg.rotation ? { rotation: normalizeDeg(cg.rotation) } : {}),
            text: x.sub.text,
            fontSize: style.fontSize,
            color: style.color,
            fontWeight: style.fontWeight,
            // フォントは**テンプレクリップと同じ解決**（種別ごと→場面）。渡さないと同じ場面で本文と字幕の
            // 字体が割れる（1フレームに複数クリップが混ざる本形式では、クリップが受け皿・§7.6.4）。
            ...(fontIdFor(scene, layer.textKey) != null ? { fontId: fontIdFor(scene, layer.textKey) } : {}),
            ...(style.strokeColor != null ? { strokeColor: style.strokeColor } : {}),
            ...(style.strokeWidth != null ? { strokeWidth: style.strokeWidth } : {}),
            ...(layer.background != null ? { background: layer.background } : {}),
          },
        });
      });
    }
  }
  return out;
}

/**
 * テンプレクリップから落とす `textKey`＝**場面形式で静的字幕が描かれない**字幕層のもの。
 *
 * 落とす基準は「行ごとに焼けたか」ではなく「**元は描かれていたか**」。
 * - セリフ列があって窓が立つ場面は、字幕層が**行の字幕で上書きされる**（`layoutScene` の `overrideSub`）＝
 *   静的 `texts.subtitle` は元から描かれない。行の字幕が全部 OFF でも同じ（＝焼いた本数は 0 でも落とす）。
 * - 字幕トグルが OFF の場面も静的字幕は描かれない（`staticSubtitleOff`）。
 * - どちらでもない（セリフ列が無い／窓が全部 0 秒＝場面まるごと1区間へ落ちる）ときは**残す**＝
 *   静的字幕が出ている場面の字幕を黙って消さない（§2-5）。
 */
/**
 * **明示のセリフ列**があるか。字幕の上書きは `scene.lines` があるときだけ効く（`sceneLines()` は
 * 単独ナレーションから1行を合成して返すので、そちらで判定すると単独場面まで上書き扱いになる）。
 * 判定の規則は `staticSubtitleFor`（`subtitleBinding`）と同じ。
 */
function hasExplicitLines(scene: Scene): boolean {
  return (scene.lines?.length ?? 0) > 0;
}

export function subtitleTextKeysNotDrawn(
  scene: Scene,
  template: Template | undefined,
  hasLineWindows: boolean,
): TextKey[] {
  if (!template) return [];
  if (!hasLineWindows && scene.subtitleEnabledDefault !== false) return [];
  const groups = template.groups ?? [];
  return template.layers
    .filter((l) => l.type === LAYER_TYPE.subtitle && !isHiddenByGroup(l.id, groups))
    .map((l) => l.textKey ?? TEXT_KEY.subtitle);
}

/** 字幕クリップに載せるフォント（種別ごと→場面。動画全体は受け側が持つ）。 */
function fontIdFor(scene: Scene, textKey: TextKey | undefined): FontId | null | undefined {
  return (textKey ? scene.textFontIds?.[textKey] : undefined) ?? scene.fontId;
}

/**
 * 回転の軸が動いたぶんを打ち消す平行移動。軸が `dy` だけ上（正）へ動いたとき、回転後の中身を元の位置へ
 * 戻すには `(I − R)·(0, dy)` を足す＝`(sinθ·dy, (1−cosθ)·dy)`。回転が無ければ 0。
 */
function rotationShift(deg: number, dy: number): { dx: number; dy: number } {
  if (deg === 0 || dy === 0) return { dx: 0, dy: 0 };
  const rad = (deg * Math.PI) / 180;
  return { dx: Math.sin(rad) * dy, dy: (1 - Math.cos(rad)) * dy };
}

/** 角度を 0〜360 未満へ（グループの回転は加算されるだけなので合成値が 360 以上になりうる＝schema が拒む）。 */
function normalizeDeg(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/**
 * 場面形式プロジェクトからタイムラインプロジェクトを焼き出す（片道・ADR-0032）。純粋関数。
 *
 * - **どの場面も、まず見た目パターンのクリップ（`kind:'template'`）を最背面に置く。** 差し込み口
 *   （素材・文字・体裁・立ち絵・動画のトリム）はクリップが持ったままなので、焼いた後も写真の差し替えや
 *   文字の変更ができる（決定5）。**FREE でもこれを置く**のは、FREE テンプレも `background` 層などを持ち
 *   それが動画に出ているため（`layoutScene` は category を問わず層を描いてから自由配置を重ねる）。
 * - **通常テンプレの場面はそれだけ＝1場面1クリップ。**
 * - **FREE の場面はその上に要素ごとのクリップを重ね、1場面=1グループにまとめる**（決定・#628）。
 *   FREE はもともと枠が無いので焼いた時点で「バラした」状態にし、まとめて動かすのはグループが担う。
 * - **読み上げは `kind:'voice'` のクリップ**（決定7）。同時に流れるセリフ（ADR-0031）は列を分ける＝
 *   タイムライン形式では「音声トラックを分けるだけ」で表せる（決定8）。
 * - **BGM は鳴っている区間ごとに1クリップ**（場面ごとの実効BGM＝`groupBgmRuns` と共有）。
 * - **切り替えはキーフレーム**（決定19・`transitionKeyframes`）。
 */
export function bakeTimelineProject(project: Project, options: BakeOptions): BakeResult {
  const scenes = scenesForBakeRange(project, options.range);
  const canvas = dimsForOrientation(project.videoSettings.aspectRatio);

  const tracks: Track[] = [];
  const clips: TimelineClip[] = [];
  const groups: Group[] = [];
  const animations: ClipAnimation[] = [];
  // 動きは**対象ごとに溜めてから1本にする**（#717）＝読む側（描画・キーフレーム編集・バラす）は
  // `targetId` で `find` して1本しか見ないので、2本あると片方が黙って無視される（V31）。
  const pending = new Map<string, Keyframe[]>();
  const notes: BakeNote[] = [];

  const newClipId = (): string => createClipId(clips.map((c) => c.id));
  const newGroupId = (): string => createGroupId(groups.map((g) => g.id));
  const newAnimId = (): string => createAnimationId(animations.map((a) => a.id));

  const doc = (): TimelineProject => ({
    schemaVersion: TIMELINE_SCHEMA_VERSION,
    format: PROJECT_FORMAT.timeline,
    projectId: options.projectId,
    projectName: options.projectName,
    createdAt: options.nowIso,
    updatedAt: options.nowIso,
    sourceProjectId: project.projectId,
    videoSettings: project.videoSettings,
    voiceSettings: project.voiceSettings,
    assets: bakedAssets(project, scenes, options.templateOf),
    tracks,
    clips,
    ...(groups.length > 0 ? { groups } : {}),
    ...(animations.length > 0 ? { animations } : {}),
  });

  if (scenes.length === 0) return { doc: doc(), notes, scenes };

  // 時間軸は書き出し（buildExportScenes）と同じ経路で組む＝焼く前と後で尺が一致する。
  // 範囲の**先頭場面の入場切り替えは落とす**（切り替え元が範囲の外＝`compileTimeline` と同じ boundaryDs[0]=0）。
  const durations = scenes.map((s) => s.durationSec);
  const resolved = scenes.map((s) => resolveTransition(s.transition));
  const boundaryDs = transitionBoundaryDs(scenes); // 組み方は共有（写さない・#727 レビュー）
  const { steps } = transitionTimeline(durations, boundaryDs);
  const starts = scenes.map((_s, i) => (i === 0 ? 0 : steps[i - 1].offsetSec));
  const ends = starts.map((start, i) => start + durations[i]);

  const visual = new TrackAllocator();
  const audio = new TrackAllocator();

  // 場面ごとの「切り替えを付ける対象」（通常＝テンプレクリップ／FREE＝場面グループ）と、占めた列の範囲。
  const sceneTargetId: string[] = [];
  const sceneBlock: ColumnBlock[] = [];
  const dialogueSubtitleScenes: number[] = [];
  const videoStartTimingScenes: number[] = [];

  scenes.forEach((scene, i) => {
    const start = starts[i];
    const end = ends[i];
    const template = options.templateOf?.(scene.templateId);
    const isFree = isFreeScene(scene, template);
    // 自由配置の要素は**FREE の場面のときだけ**焼く（通常の見た目では休眠＝ADR-0030・描画と同じゲート）。
    const elements = isFree ? byZIndex(scene.freeLayout ?? []) : [];

    // 行ごとの窓。**字幕はすべての行**（読み上げ文が空でも字幕は出ていることがある）、**声は文がある行だけ**。
    const durations = options.lineDurationsFor?.(scene) ?? {};
    const allWindows = lineWindows(scene, durations);
    const windows = allWindows.filter(hasVoiceText);
    // 掛け合いの字幕は**行ごとの字幕クリップ**へ焼く（#633）。**自由配置の場面でも焼く**＝テンプレの層は
    // category を問わず描かれる（`layoutScene`）ので、外すと FREE テンプレの字幕層が黙って消える。
    const lineSubtitles = bakeLineSubtitles(scene, template, allWindows);
    // この場面で、見た目パターンのクリップ以外に作ったクリップ（切り替えの付け先＝場面グループに入れる）。
    // **id は先に採る**＝グループのメンバーを決めるのが、クリップを作るより先に来るため。
    const extraClipIds: string[] = [];

    // 見た目パターンのクリップは**どの場面にも置く**（最背面）。FREE テンプレも `background` 層などを持ち、
    // それが動画に出ているため（`layoutScene` は category を問わず層を描いてから自由配置を重ねる）。
    const count = 1 + elements.length + lineSubtitles.length;
    const base = visual.take(count, start, end);
    const templateClipId = newClipId();
    clips.push({
      id: templateClipId,
      kind: TIMELINE_CLIP_KIND.template,
      trackId: trackIdFor(tracks, base, TRACK_KIND.visual),
      startSec: start,
      durationSec: scene.durationSec,
      templateId: scene.templateId,
      assetRefs: scene.assetRefs,
      // 行ごとに焼いた字幕は別のクリップで出す＝**テンプレクリップからはそのキーを落とす**
      // （残すと場面の静的字幕が場面いっぱいに出て、行ごとの字幕と二重になる）。
      texts: withoutKeys(scene.texts, subtitleTextKeysNotDrawn(scene, template, hasExplicitLines(scene) && allWindows.length > 0)),
      ...(scene.textStyles ? { textStyles: scene.textStyles } : {}),
      ...(scene.slotFits ? { slotFits: scene.slotFits } : {}),
      ...(scene.textFontIds ? { textFontIds: scene.textFontIds } : {}),
      ...(scene.character ? { character: scene.character } : {}),
      ...(scene.slotClips ? { slotClips: scene.slotClips } : {}),
      ...(scene.fontId != null ? { fontId: scene.fontId } : {}),
    });
    sceneBlock.push({ base, count });

    // 読み上げ：行ごとに1クリップ。同時に流れる行（ADR-0031）は窓が同じなので列が分かれる（決定8）。
    const voiceClipIdByLine = new Map<string, string>();
    for (const w of windows) {
      const startSec = start + w.startSec;
      const endSec = startSec + w.durationSec;
      const column = audio.take(1, startSec, endSec);
      const voiceClipId = newClipId();
      voiceClipIdByLine.set(w.line.lineId, voiceClipId);
      clips.push({
        id: voiceClipId,
        kind: TIMELINE_CLIP_KIND.voice,
        trackId: trackIdFor(tracks, column, TRACK_KIND.audio),
        startSec,
        durationSec: w.durationSec,
        voice: voiceFromLine(w.line),
        ...(scene.audioMix?.narrationVolume != null ? { volume: scene.audioMix.narrationVolume } : {}),
      });
    }

    // 行ごとの字幕クリップ＝**同じ行の読み上げへ連動**させる（決定24）＝時間も文言も追従する。
    lineSubtitles.forEach((sub, k) => {
      const clipId = newClipId();
      extraClipIds.push(clipId);
      clips.push({
        ...sub.spatial,
        id: clipId,
        kind: TIMELINE_CLIP_KIND.subtitle,
        trackId: trackIdFor(tracks, base + 1 + elements.length + k, TRACK_KIND.visual),
        startSec: start + sub.startSec,
        durationSec: sub.durationSec,
        ...(voiceClipIdByLine.has(sub.lineId) ? { voiceClipId: voiceClipIdByLine.get(sub.lineId) } : {}),
      });
    });

    if (!isFree && extraClipIds.length === 0) {
      // 1場面1クリップ（従来）＝切り替えはそのクリップに付ける。
      sceneTargetId.push(templateClipId);
    } else if (!isFree) {
      // 通常の見た目でも、行ごとの字幕クリップができた場面は**1場面が複数クリップ**になる（#633）。
      // 切り替えは**場面まるごと**に掛けたいので、FREE と同じく場面グループを作ってそこへ付ける
      // ＝字幕だけ不透明に残る（切り替え中に字幕が浮く）を防ぐ（決定19 の前提を保つ）。
      const sceneGroupId = newGroupId();
      groups.push({
        id: sceneGroupId,
        members: [templateClipId, ...extraClipIds],
        transform: { x: 0, y: 0, rotation: 0, scale: 1 },
        name: scene.texts.title,
      });
      sceneTargetId.push(sceneGroupId);
    } else {
      const elementClipId = new Map<string, string>();
      elements.forEach((el, k) => {
        const { id: _id, kind, zIndex: _z, subtitleSource: _s, ...spatial } = el;
        const clipId = newClipId();
        elementClipId.set(el.id, clipId);
        extraClipIds.push(clipId);
        clips.push({
          ...spatial,
          id: clipId,
          kind,
          trackId: trackIdFor(tracks, base + 1 + k, TRACK_KIND.visual),
          startSec: start,
          durationSec: scene.durationSec,
          // 字幕ボックスは表示文を「対象」から解くが（ADR-0029）、タイムライン形式に対象の語彙は無い
          // （連動は #633）。**時間で変わらないもの（対象＝読み上げ）だけ、いま出ている文を焼き付ける**＝
          // 単独ナレーションの字幕を黙って消さない（§2-5）。行に追従する対象は下の note で知らせる。
          ...staticSubtitleText(el, scene),
        });
      });
      // 1場面=1グループ（まとめて動かせるようにする）。既存グループは入れ子で残す（メンバー id を差し替え）。
      const nested = (scene.groups ?? []).map((g) => ({
        ...g,
        id: newGroupId(),
        members: g.members.map((m) => elementClipId.get(m) ?? m),
      }));
      // 入れ子グループのメンバーは場面グループの直接メンバーにしない（二重所属を作らない）。
      const nestedMembers = new Set(nested.flatMap((g) => g.members));
      const oldToNewGroupId = new Map((scene.groups ?? []).map((g, k) => [g.id, nested[k].id]));
      for (const g of nested) groups.push(g);
      const sceneGroupId = newGroupId();
      groups.push({
        id: sceneGroupId,
        // 見た目パターンのクリップも入れる＝「まとめて動かす」で背景ごと動く（切り替えの付け先でもある）。
        members: [
          templateClipId,
          ...nested.filter((g) => !nestedMembers.has(g.id)).map((g) => g.id),
          ...[...elementClipId.values()].filter((id) => !nestedMembers.has(id)),
        ],
        transform: { x: 0, y: 0, rotation: 0, scale: 1 },
        name: scene.texts.title,
      });
      // 場面内アニメ（ADR-0019・timelineOverlay に入っている）を持ち込む。**時間の意味は同じ**＝
      // 要素クリップは場面の先頭から始まるので、場面ローカル秒＝クリップローカル秒。
      for (const anim of project.timelineOverlay?.animations ?? []) {
        if (anim.sceneId !== scene.sceneId) continue;
        const targetId = elementClipId.get(anim.targetId) ?? oldToNewGroupId.get(anim.targetId);
        if (targetId == null) continue; // 参照切れは持ち込まない（V26 と同じ扱い）
        // **こちらも同じ入れ物へ溜める**（#717 レビュー）＝元データに同じ対象が2件あっても、
        // 焼き上がりは必ず「1対象に1本」（V31）になる。切り替えと当たることは無いはずだが、
        // 直接 push すると「焼き出しは V31 を満たす」が元データ任せになる。
        addKeyframes(pending, targetId, anim.keyframes);
      }
      sceneTargetId.push(sceneGroupId);
    }

    // 持っていけなかったもの（黙って落とさない・§2-5）。
    // 判定は**実際に表示されている字幕**で行う（`sceneHasTimeVaryingSubtitle`＝描画と同じ解決規則）。
    // 掛け合いの行数だけを見ると、1行だけの `lines` 場面（テンプレ字幕層が行の字幕へ差し替わる）や
    // FREE の字幕ボックスを取りこぼす。
    if (hasTimeVaryingSubtitle(scene, isFree)) {
      dialogueSubtitleScenes.push(i + 1);
    }
    if (scene.slotVideoStart != null && Object.keys(scene.slotVideoStart).length > 0) {
      videoStartTimingScenes.push(i + 1);
    }
  });

  // 切り替え（決定19）。実効の切り替え＝`resolveTransition` の結果を、入る側／出ていく側のキーフレームへ落とす。
  // 入場と退場は**時間で重ならない**（#727）＝`transitionTimeline` が、両側に切り替えがある場面では
  // 使える尺を2つで分け合わせる。以前は片方ずつの上限しか見ておらず重なっており、1本にまとめると
  // **その場面の切り替えだけ短くなって相手側とずれて**いた（窓を共有しているので、上流で縮めれば揃う）。
  // ⚠️ **範囲を選んで焼くと、範囲の先頭場面の入場が落ちる**ぶん、その場面の予算は半分にならない
  // ＝同じ境界でも全体を焼いたときと長さが変わる。焼いた文書の中では「先頭に入場は無い」が正しいので
  // 意図どおり（`§7.6.1` の追補）。全体を焼いたときは場面形式の書き出しと一致する。
  for (let i = 1; i < scenes.length; i += 1) {
    const step = steps[i - 1];
    if (step.durationSec <= 0) continue;
    const incomingTarget = sceneTargetId[i];
    const outgoingTarget = sceneTargetId[i - 1];
    if (incomingTarget == null || outgoingTarget == null) continue; // 描くものが無い場面には切り替えを付けようがない
    const kf = transitionKeyframes(
      resolved[i].type,
      resolved[i].direction,
      step.durationSec,
      starts[i] - starts[i - 1], // 出ていく側のクリップ先頭から見た重なり開始
      canvas,
      // 場面ごとの列は連続した並びなので、片方が丸ごともう片方より手前になる（互い違いに挟まらない）。
      sceneBlock[i].base >= sceneBlock[i - 1].base + sceneBlock[i - 1].count,
    );
    // **同じ対象には1本にまとめる**（#717）。中間の場面は「入る側」と「出ていく側」の両方になるが、
    // 読む側（描画・キーフレーム編集・バラす）は `targetId` で `find` して**1本しか見ない**ので、
    // 2本に分けると退場が丸ごと無視される（＝切り替えがハードカットになる）。
    if (kf.incoming.length > 0) addKeyframes(pending, incomingTarget, kf.incoming);
    if (kf.outgoing.length > 0) addKeyframes(pending, outgoingTarget, kf.outgoing);
  }
  // まとめた結果を**時刻の昇順**で1本ずつ出す（`11 §7.4` の `Keyframe` は昇順）。
  for (const [targetId, keyframes] of pending) {
    animations.push({ id: newAnimId(), targetId, keyframes: sortedKeyframes(keyframes) });
  }

  // BGM：鳴っている区間ごとに1クリップ（実効BGM＝場面 ?? プロジェクトの解決は場面形式と共有）。
  for (const run of groupBgmRuns(scenes, starts, ends, project.bgmSettings)) {
    const column = audio.take(1, run.startSec, run.endSec);
    clips.push({
      id: newClipId(),
      kind: TIMELINE_CLIP_KIND.audio,
      trackId: trackIdFor(tracks, column, TRACK_KIND.audio),
      startSec: run.startSec,
      durationSec: run.endSec - run.startSec,
      // 音の出どころは高々1つ（V25）。同梱BGMが選ばれていればそちらが優先（場面形式の解決と同じ）。
      ...(run.bgm.bundledBgmId != null ? { bundledBgmId: run.bgm.bundledBgmId } : { assetId: run.bgm.assetId }),
      ...(run.bgm.volume != null ? { volume: run.bgm.volume } : {}),
      ...(run.bgm.fadeInSec != null ? { fadeInSec: run.bgm.fadeInSec } : {}),
      ...(run.bgm.fadeOutSec != null ? { fadeOutSec: run.bgm.fadeOutSec } : {}),
    });
  }

  if (dialogueSubtitleScenes.length > 0) notes.push({ code: BAKE_NOTE_CODE.dialogueSubtitle, sceneNumbers: dialogueSubtitleScenes });
  if (videoStartTimingScenes.length > 0) notes.push({ code: BAKE_NOTE_CODE.videoStartTiming, sceneNumbers: videoStartTimingScenes });

  return { doc: doc(), notes, scenes };
}

/**
 * 列 index → トラック。無ければ作る。**映像の列を先に並べる**＝`tracks` の配列順が重ね順（後ろほど手前）
 * なので、映像の列 index と配列の位置を一致させる（音の列は重ね順に関係しないので後ろへ）。
 */
function trackIdFor(tracks: Track[], column: number, kind: (typeof TRACK_KIND)[keyof typeof TRACK_KIND]): string {
  const sameKind = tracks.filter((t) => t.kind === kind);
  const found = sameKind[column];
  if (found) return found.id;
  const created: Track[] = [];
  for (let i = sameKind.length; i <= column; i += 1) {
    created.push({ id: createTrackId([...tracks, ...created].map((t) => t.id)), kind });
  }
  // 映像は先頭側・音は末尾側にまとめる（配列順＝重ね順を映像だけで読めるようにする）。
  if (kind === TRACK_KIND.visual) tracks.splice(sameKind.length, 0, ...created);
  else tracks.push(...created);
  return created[created.length - 1].id;
}

/** セリフ行 → 読み上げクリップの中身（時間・字幕の語彙は落とす＝クリップと字幕クリップが担う・11 §7.6）。 */
function voiceFromLine(line: NarrationLine): NonNullable<TimelineClip['voice']> {
  return {
    text: line.text,
    ...(line.speaker != null ? { speaker: line.speaker } : {}),
    ...(line.speed != null ? { speed: line.speed } : {}),
    ...(line.pitch != null ? { pitch: line.pitch } : {}),
    ...(line.intonation != null ? { intonation: line.intonation } : {}),
    ...(line.voicePath != null ? { voicePath: line.voicePath } : {}),
    status: line.status,
  };
}

/**
 * 焼いた文書が参照する**プロジェクト相対のファイル**の一覧（決定13＝コピーして自己完結・ADR-0024 (6)）。純粋関数。
 *
 * 実ファイルのコピーと容量の提示は infrastructure の仕事で、ここは「どれを運ぶか」だけを決める
 * （素材の本体・動画の代表フレーム・作成済みの読み上げ音声）。重複は畳み、並びは決定的にする。
 * **作成済みの音声も運ぶ**のは、焼いた先で作り直させないため（同じ声を作り直すのは時間もかかる）。
 */
export function bakedFilePaths(doc: TimelineProject): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (p: string | null | undefined): void => {
    if (!p || seen.has(p)) return;
    seen.add(p);
    out.push(p);
  };
  for (const a of doc.assets) {
    add(a.filePath);
    add(a.thumbnailPath);
  }
  for (const c of doc.clips) add(c.voice?.voicePath);
  return out;
}

/**
 * 焼いた文書が持っていく素材（決定13＝コピーして自己完結・ADR-0024 (6)）。
 * **焼く範囲で実際に使われているものだけ**を持っていく（`sceneActiveAssetIds`＝休眠の割当は数えない）＋
 * 鳴っている BGM の音源。元の `project.assets` は並び順のまま絞る（id は振り直さない＝どの素材か辿れる）。
 */
export function bakedAssets(
  project: Project,
  scenes: readonly Scene[],
  templateOf?: (templateId: string) => Template | undefined,
): Asset[] {
  const used = new Set<string>();
  for (const scene of scenes) {
    const template = templateOf?.(scene.templateId);
    for (const id of sceneActiveAssetIds(scene, template)) used.add(id);
    // 見た目が解決できないとき `sceneActiveAssetIds` は自由配置を数えない（category で切るため）が、
    // 焼き出しは `isFreeScene`（場面自身の記録）で焼く。**焼いたのに素材が無い**状態にしないよう足す。
    if (template == null && isFreeScene(scene, template)) {
      for (const el of scene.freeLayout ?? []) if (el.assetId) used.add(el.assetId);
    }
    const bgm = scene.bgmSettings ?? project.bgmSettings;
    if (bgm?.enabled && bgm.bundledBgmId == null && bgm.assetId) used.add(bgm.assetId);
  }
  return project.assets.filter((a) => used.has(a.assetId));
}
