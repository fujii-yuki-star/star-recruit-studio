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
  SUBTITLE_SOURCE_KIND,
  TIMELINE_CLIP_KIND,
  TRACK_KIND,
  TRANSITION_DIRECTION,
  TRANSITION_TYPE,
} from '../enums';
import type { TransitionDirection } from '../enums';
import { isHiddenByGroup } from '../group/compose';
import { sceneActiveAssetIds } from '../project/assetUsage';
import { groupBgmRuns } from '../project/compileTimeline';
import { lineSegments, resolveLineSubtitle } from '../project/lineTimeline';
import { sceneLines } from '../project/narrationLines';
import { createAnimationId, createClipId, createGroupId, createTrackId } from '../project/persistence';
import { resolveTransition, transitionTimeline } from '../project/sceneTransitions';
import type { DrawnTransitionType } from '../project/sceneTransitions';
import { defaultSubtitleSource, freeSubtitleElementTexts } from '../project/subtitleBinding';
import type { Asset, FreeElement, Keyframe, NarrationLine, Project, Scene } from '../project/types';
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
  /** セリフに追従して切り替わる字幕。時間で変わる字幕はクリップに分ける必要があり、#633 の連動と同時に入れる。 */
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

/** 0 の符号を落とす（`-0` を作らないための正規化。保存される JSON に `-0` を混ぜない）。 */
function neg(v: number): number {
  return v === 0 ? 0 : -v;
}

/** 同時開始グループのメンバーも含めた、行ごとの再生窓（0秒は出さない＝ゼロ幅クリップ防止）。 */
function voiceWindows(scene: Scene, lineDurations: Record<string, number>): Array<{ line: NarrationLine; startSec: number; durationSec: number }> {
  const lines = sceneLines(scene);
  const segs = lineSegments(scene, lineDurations); // lines と同順・同数
  const out: Array<{ line: NarrationLine; startSec: number; durationSec: number }> = [];
  for (let i = 0; i < segs.length; i += 1) {
    const seg = segs[i];
    if (seg.endSec <= seg.startSec) continue;
    // 読み上げ文が空の行はクリップにしない＝鳴らない「空の声」を作らない（schema の if/then・11 §8 V28 と同じ判断）。
    if (lines[i].text.trim().length === 0) continue;
    out.push({ line: lines[i], startSec: seg.startSec, durationSec: seg.endSec - seg.startSec });
  }
  return out;
}

/** 切り替えを表すキーフレーム（クリップ先頭からの秒）。`incoming`＝入る場面／`outgoing`＝出ていく場面。 */
interface TransitionKeyframes {
  incoming: Keyframe[];
  outgoing: Keyframe[];
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
function staticSubtitleText(el: FreeElement, scene: Scene): { text?: string } {
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
function hasTimeVaryingSubtitle(scene: Scene, template: Template | undefined, isFree: boolean): boolean {
  if ((scene.lines?.length ?? 0) > 0) {
    const visibleSubtitleLayers = (template?.layers ?? []).filter(
      (l) => l.type === 'subtitle' && !isHiddenByGroup(l.id, template?.groups ?? []),
    );
    const shown = sceneLines(scene)
      .map((l) => resolveLineSubtitle(l, scene))
      .some((s) => s.enabled && s.text.length > 0);
    if (visibleSubtitleLayers.length > 0 && shown) return true;
  }
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
  const boundaryDs = resolved.map((r, i) => (i === 0 || r.type === TRANSITION_TYPE.none ? 0 : r.durationSec));
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

    // 見た目パターンのクリップは**どの場面にも置く**（最背面）。FREE テンプレも `background` 層などを持ち、
    // それが動画に出ているため（`layoutScene` は category を問わず層を描いてから自由配置を重ねる）。
    const count = 1 + elements.length;
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
      texts: scene.texts,
      ...(scene.textStyles ? { textStyles: scene.textStyles } : {}),
      ...(scene.slotFits ? { slotFits: scene.slotFits } : {}),
      ...(scene.textFontIds ? { textFontIds: scene.textFontIds } : {}),
      ...(scene.character ? { character: scene.character } : {}),
      ...(scene.slotClips ? { slotClips: scene.slotClips } : {}),
      ...(scene.fontId != null ? { fontId: scene.fontId } : {}),
    });
    sceneBlock.push({ base, count });

    if (!isFree) {
      sceneTargetId.push(templateClipId);
    } else {
      const elementClipId = new Map<string, string>();
      elements.forEach((el, k) => {
        const { id: _id, kind, zIndex: _z, subtitleSource: _s, ...spatial } = el;
        const clipId = newClipId();
        elementClipId.set(el.id, clipId);
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
        animations.push({ id: newAnimId(), targetId, keyframes: anim.keyframes });
      }
      sceneTargetId.push(sceneGroupId);
    }

    // 読み上げ：行ごとに1クリップ。同時に流れる行（ADR-0031）は窓が同じなので列が分かれる（決定8）。
    for (const w of voiceWindows(scene, options.lineDurationsFor?.(scene) ?? {})) {
      const startSec = start + w.startSec;
      const endSec = startSec + w.durationSec;
      const column = audio.take(1, startSec, endSec);
      clips.push({
        id: newClipId(),
        kind: TIMELINE_CLIP_KIND.voice,
        trackId: trackIdFor(tracks, column, TRACK_KIND.audio),
        startSec,
        durationSec: w.durationSec,
        voice: voiceFromLine(w.line),
        ...(scene.audioMix?.narrationVolume != null ? { volume: scene.audioMix.narrationVolume } : {}),
      });
    }

    // 持っていけなかったもの（黙って落とさない・§2-5）。
    // 判定は**実際に表示されている字幕**で行う（`sceneHasTimeVaryingSubtitle`＝描画と同じ解決規則）。
    // 掛け合いの行数だけを見ると、1行だけの `lines` 場面（テンプレ字幕層が行の字幕へ差し替わる）や
    // FREE の字幕ボックスを取りこぼす。
    if (hasTimeVaryingSubtitle(scene, template, isFree)) {
      dialogueSubtitleScenes.push(i + 1);
    }
    if (scene.slotVideoStart != null && Object.keys(scene.slotVideoStart).length > 0) {
      videoStartTimingScenes.push(i + 1);
    }
  });

  // 切り替え（決定19）。実効の切り替え＝`resolveTransition` の結果を、入る側／出ていく側のキーフレームへ落とす。
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
    if (kf.incoming.length > 0) animations.push({ id: newAnimId(), targetId: incomingTarget, keyframes: kf.incoming });
    if (kf.outgoing.length > 0) animations.push({ id: newAnimId(), targetId: outgoingTarget, keyframes: kf.outgoing });
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
