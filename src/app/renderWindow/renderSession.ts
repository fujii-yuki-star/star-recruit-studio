// 書き出しのコマを描く窓（ADR-0070）＝本体と描く窓が**同じものを同じように描く**ための取り決め。
//
// ⚠️ **描く材料の組み立ては、本体も窓もここを通す**（`sessionDrawOptions`）＝別々に書くと、片方だけ設定が漏れて
//   違う絵になる（それを md5 で見つけるより、作りで割れないようにする）。
// ⚠️ **窓は本体と JS の状態を共有しない**＝窓が要るものは全部ここで受け渡す形にする（文書・見た目パターン・
//   既定素材・実寸・大きさ・字体・名乗り・パックの字体）。素材の絵は窓が自分で読む（本体と同じ関数＝同じ文字列）。
import { buildTimelineFrames } from '../../renderer/export/buildTimelineFrames';
import type { BuildTimelineFramesOptions, StagedVideoRef } from '../../renderer/export/buildTimelineFrames';
import { timelineImageAssetIds, timelineFramePlan } from '../../domain/timeline/export';
import type { TimelineProject } from '../../domain/timeline/types';
import type { Template } from '../../domain/template/types';
import type { SourceSize } from '../../domain/timeline/cropFill';

/** 本体が窓へ渡す、1回の書き出しの材料。 */
export interface RenderSessionPayload {
  sessionId: string;
  doc: TimelineProject;
  /** 文書が使っている見た目パターンだけ。 */
  templates: Template[];
  /** 使っている見た目パターンの既定素材（ADR-0021）だけ。 */
  templateAssetSrcById: Record<string, string>;
  /** 本体が絵を引ける素材の id（窓で引けなければ、黙って違う絵にせず失敗にする）。 */
  knownSrcIds: string[];
  assetSizes: Record<string, SourceSize>;
  outputSize: { width: number; height: number };
  fontFamily: string;
  fallbackCredit: string;
  /** 入っているパックの字体の置き場（`setPackFontSources` へ渡す）。 */
  packFonts: { id: string; packId: string; file: string; sha256: string }[];
  /** 本体と窓が同じ絵を描けるかを確かめる1コマ（動画の頭から数えた番号）。 */
  probeFrame: number;
}

/** 窓に頼む1つの範囲。 */
export interface RenderJob {
  jobId: number;
  framesDirName: string;
  fromFrame: number;
  toFrame: number;
  stageIndexBase: number;
  stagedVideos: StagedVideoRef[];
}

/** 本体→窓。 */
export type MainToRender =
  | { type: 'session'; session: RenderSessionPayload }
  | { type: 'job'; sessionId: string; job: RenderJob }
  | { type: 'cancel'; sessionId: string };

/** 窓→本体。`frames`/`bytes` はその範囲で置いたコマの数と PNG の大きさの合計（空きの見張りに数える）。 */
export type RenderToMain =
  | { type: 'ready'; label: string }
  | { type: 'session-ready'; label: string; sessionId: string; probe: string }
  | { type: 'session-failed'; label: string; sessionId: string; error: string }
  | { type: 'progress'; label: string; sessionId: string; jobId: number; done: number; frames: number; bytes: number }
  | { type: 'job-done'; label: string; sessionId: string; jobId: number; frames: number; bytes: number; error?: string };

/**
 * 窓へ渡す既定素材を選ぶ＝**使っている見た目パターンが指す素材**と、描くのに使う素材の id に当たるもの。
 * ⚠️ 全部は渡さない（パック込みで数十 MB になりうる）。漏れたら窓は「引けない」で失敗する（`knownSrcIds`）。
 */
export function sessionTemplateAssets(
  doc: TimelineProject,
  templates: readonly Template[],
  templateAssetSrcById: Record<string, string>,
): { templates: Template[]; templateAssetSrcById: Record<string, string> } {
  // ⚠️ **文書のどこに書かれた見た目パターンも拾う**（部品の欄に限らない）＝漏れると窓だけパターン無しで描く。
  const used = new Set<string>();
  collectStrings(doc, /^templateId$/, used);
  const usedTemplates = templates.filter((t) => used.has(t.templateId));
  const ids = new Set<string>(timelineImageAssetIds(doc, (id) => usedTemplates.find((t) => t.templateId === id)));
  collectStrings(usedTemplates, /assetId$/i, ids);
  const subset: Record<string, string> = {};
  for (const id of ids) if (templateAssetSrcById[id]) subset[id] = templateAssetSrcById[id];
  return { templates: usedTemplates, templateAssetSrcById: subset };
}

/** `v` の中で、名前が `key` に当たる欄の文字列を全部集める。 */
function collectStrings(v: unknown, key: RegExp, out: Set<string>): void {
  if (Array.isArray(v)) {
    for (const x of v) collectStrings(x, key, out);
    return;
  }
  if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) {
      if (typeof x === 'string' && key.test(k)) out.add(x);
      else collectStrings(x, key, out);
    }
  }
}

/** 本体も窓も通す、描く材料（置く口・読む口は呼ぶ側が渡す）。 */
export function sessionDrawOptions(
  session: Pick<RenderSessionPayload, 'templates' | 'assetSizes' | 'outputSize' | 'fontFamily' | 'fallbackCredit'>,
  assetSrc: (assetId: string | null) => string | undefined,
  strictTemplates = false,
): Pick<BuildTimelineFramesOptions, 'templateOf' | 'assetSrc' | 'assetSizeOf' | 'outputSize' | 'fontFamily' | 'fallbackCredit'> {
  const byId = new Map(session.templates.map((t) => [t.templateId, t]));
  return {
    // ⚠️ **窓では、受け取っていない見た目パターンを引いたら失敗にする**（`strictTemplates`）＝黙って「パターン無し」で
    //   描くと違う絵になる。失敗すれば本体がその範囲を描き直す（ADR-0070 決定7）。
    templateOf: (id) => {
      const t = byId.get(id);
      if (!t && strictTemplates) throw new Error(`template not sent to render window: ${id}`);
      return t;
    },
    assetSrc,
    assetSizeOf: (id) => session.assetSizes[id],
    outputSize: session.outputSize,
    fontFamily: session.fontFamily,
    fallbackCredit: session.fallbackCredit,
  };
}

/** 確かめの1コマ（本体と窓の両方で描いて比べる）。動画の真ん中＝字幕や立ち絵が出ていることが多い。 */
export function probeFrameOf(doc: TimelineProject): number {
  return Math.floor(timelineFramePlan(doc).frameCount / 2);
}

/**
 * 確かめの1コマを描いて、PNG の印（ハッシュ）を返す。⚠️ 置き場へは置かない（data URL で受ける）・動画のコマは使わない
 * （本体と窓で同じ条件）。字体・素材・見た目パターンが窓でも同じに解けているかを見る（ADR-0070 決定6）。
 */
export async function probeHash(
  doc: TimelineProject,
  opts: Pick<BuildTimelineFramesOptions, 'templateOf' | 'assetSrc' | 'assetSizeOf' | 'outputSize' | 'fontFamily' | 'fallbackCredit'>,
  frame: number,
): Promise<string> {
  // ⚠️ **置く口・読む口は渡さない**（材料の欄だけを拾い直す）＝`...opts` で渡すと、確かめの1コマが
  //   **置き場の 0 番へ置かれ、本物のコマを上書きする**。
  const r = await buildTimelineFrames(doc, {
    templateOf: opts.templateOf,
    assetSrc: opts.assetSrc,
    ...(opts.assetSizeOf ? { assetSizeOf: opts.assetSizeOf } : {}),
    ...(opts.outputSize ? { outputSize: opts.outputSize } : {}),
    ...(opts.fontFamily ? { fontFamily: opts.fontFamily } : {}),
    fallbackCredit: opts.fallbackCredit,
    window: { fromFrame: frame, toFrame: frame + 1 },
  });
  return fnv1a(r.framesBase64?.[0] ?? '');
}

/** 文字列の印（FNV-1a・32bit を2本）。同じ文字列なら同じ・違えばほぼ必ず違う。 */
export function fnv1a(s: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ s.length;
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x5bd1e995);
  }
  return `${(a >>> 0).toString(16)}${(b >>> 0).toString(16)}:${s.length}`;
}
