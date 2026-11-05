// タイムライン形式（ADR-0032）の書き出し：**全フレームを描いて PNG にする**（決定22・#631）。
//
// 場面形式の `buildExportScenes` と違い、場面の区切りが無いので**動画まるごとが1本のフレーム列**になる。
// 描くのは `layoutTimelineAt`＝**プレビューと同じ関数**（ADR-0001 パリティ）。ここは
// 「どの時刻を何枚描くか」を `timelineFramePlan`/`frameTimeAt` に委ね、SVG→PNG→ステージングを回すだけ。
import { frameTimeAt, timelineFramePlan } from '../../domain/timeline/export';
import { isItemOfPlacement } from '../timelineLayout';
import { videoPlacementsOf, videoFrameIndexInWindow, videoStagePlan, videoStageWindow } from '../../domain/timeline/video';
import type { VideoPlacement } from '../../domain/timeline/video';
import { creditTextAt } from '../../domain/timeline/credit';
import type { TimelineProject } from '../../domain/timeline/types';
import type { Template } from '../../domain/template/types';
import type { SourceSize } from '../../domain/timeline/cropFill';
import { layoutTimelineAt } from '../timelineLayout';
import { layoutToSvg } from '../sceneSvg';
import { svgToPngDataUrl, svgToPngLater } from './rasterize';
import { ExportCancelledError } from './buildExportScenes';

/**
 * 同じ絵が続くとき、まとめて写す枚数の上限（書き出しの高速化・2026-10-23）＝10秒（30fps）。
 * まとめすぎると、その間は進み具合が止まって見え、中止も1回ぶん遅れる。
 */
export const COPY_RUN_MAX = 300;

/** 置き場へ運ぶのを重ねる枚数（PNG にする別スレッドの数と合わせる・1枚ぶん多め）。 */
export const STAGING_IN_FLIGHT = 4;

/** ステージ先のディレクトリ名（`stage_export_frame` の検証を通る名前）。 */
export const TIMELINE_FRAMES_DIR = 'timeline_frames';

export interface BuildTimelineFramesOptions {
  /** 見た目パターンの解決（未解決のクリップは描かれない＝画面が先に知らせる）。 */
  templateOf: (templateId: string) => Template | undefined;
  /**
   * 素材の絵。**書き出しで描ける形（data URL）に解いたものを渡す**（`11 §7.6.5`・#716）。
   * ⚠️ プレビューが使う**表示用の URL（`asset://`）を渡してはいけない**＝ここは SVG を Blob → `<img>` →
   * canvas で焼くので外部参照は**取りに行かずに黙って落ちる**（`rasterize.ts` の前提）。
   * プレビューと同じ絵になる根拠は「同じ id 集合・同じ元ファイル」であって、同じ URL ではない。
   */
  assetSrc: (assetId: string | null) => string | undefined;
  /** 素材の実寸（#634）。プレビューと同じものを渡す＝「枠いっぱいに映す」が書き出しでも同じ絵になる。 */
  assetSizeOf?: (assetId: string) => SourceSize | undefined;
  /** 出力の実寸（省略時はレイアウトの寸法＝キャンバス実寸）。 */
  outputSize?: { width: number; height: number };
  /** 誰もしゃべっていない時刻に出すクレジット（動画の既定の声）。 */
  fallbackCredit: string;
  /** 動画全体のフォント（部品ごとの指定が無いときの受け皿＝11 §6 継承）。 */
  fontFamily?: string;
  /** 1フレームをディスクへ逃がす（数千フレームの base64 を配列に溜めない）。 */
  stageFrame?: (dirName: string, frameIndex: number, dataBase64: string) => Promise<void>;
  /**
   * 1フレームを**PNG のバイトのまま**ディスクへ逃がす（書き出しの高速化・2026-10-23）。渡せば `stageFrame` より優先する。
   * PNG にするのは別スレッド（`svgToPngLater`）＝主スレッドはその間に次のコマを描く・base64 の文字にしない。
   * 同じ PNG の画素なので絵は変わらない。
   */
  stageFramePng?: (dirName: string, frameIndex: number, png: Uint8Array) => Promise<void>;
  /**
   * **前のコマと同じ絵**のコマを、置き場の前のコマから作る（書き出しの高速化・2026-10-22）。
   * `fromIndex` のファイルを `toIndex` から `count` 枚ぶん写す＝**同じ絵が続くぶんをまとめて1回で頼む**
   * （2026-10-23＝1枚ずつ頼むと、講座の動画では主スレッドの半分が待ちだった）。
   * 未指定なら、同じ PNG をもう一度置く（描き直しと PNG 化だけ省く）。
   * `pngBytes` は写す元の PNG の大きさ（空きの見張りに1枚ずつ数えるため）。
   */
  copyFrames?: (dirName: string, fromIndex: number, toIndex: number, count: number, pngBytes: number) => Promise<void>;
  /** 進捗（描いた枚数 / 総数）。 */
  onProgress?: (done: number, total: number) => void;
  /** 中止要求。フレームごとに見る＝長い動画でも押した中止がすぐ効く。 */
  shouldCancel?: () => boolean;
  /**
   * 動画の部品を**コマへ焼き出す**（#512 段1）。返すのは実際に焼けた枚数。
   * ⚠️ **渡さないと灰色の枠が焼き込まれる**（#512 段1）＝直接置いた動画は静止画（代表フレーム）を
   * 要求しないので、`assetSrc` でも解けない。書き出しの入口は必ず両方を渡すこと（片方だけでも同じ）。
   */
  stageVideo?: (input: {
    clipId: string;
    assetId: string;
    dirName: string;
    sourceStartSec: number;
    durationSec: number;
    speed: number;
    fps: number;
  }) => Promise<number>;
  /**
   * **この区間だけ描く**（#1203）。未指定＝動画まるごと（いままでどおり）。
   *
   * ⚠️ **コマの番号は動画の頭から数えたまま**にする＝区間ごとに 0 から数え直すと、
   * 動画のコマの選び方（`videoFrameIndexAt`）が**区間の頭からになってずれる**。
   */
  window?: { fromFrame: number; toFrame: number };
  /** コマの置き場の名前（#1203＝区間ごとに分ける）。未指定＝`timeline_frames`。 */
  framesDirName?: string;
  /**
   * 置き場の中の番号を、どのコマから数えるか（ADR-0070＝区間を窓で分けて描く）。未指定＝描く範囲の頭（`window.fromFrame`）。
   * ⚠️ 区間の一部だけを描くときは**区間の頭**を渡す＝同じ置き場に、区間の頭から数えた番号で置く（FFmpeg は1本の連番で読む）。
   */
  stageIndexBase?: number;
  /**
   * 動画の部品のコマを**焼き出し済み**で渡す（ADR-0070）。渡すと、ここでは焼き出さない（`stageVideo` を呼ばない）。
   * ⚠️ 区間を窓で分けて描くとき、窓どうしが同じ置き場へ焼き出して取り合わないよう、本体が先に1回だけ焼く。
   */
  stagedVideos?: readonly StagedVideoRef[];
  /** 焼き出したコマを1枚読む（data URL）。`stageVideo` と対で渡す。 */
  readVideoFrame?: (dirName: string, frameIndex: number) => Promise<string>;
}

/** その部品のコマを置く場所（部品ごとに分ける＝同じ動画を2つ置いても混ざらない）。 */
export function videoFramesDirOf(clipId: string, layerId: string | null = null): string {
  // ⚠️ **置き場所ごとに別のフォルダ**（#512 段3）＝1つの部品に差し込み口ぶんの動画がありうるので、
  // 部品 id だけで名づけると**後の1つが前の1つを上書きする**（別の絵が同じコマで出る）。
  return layerId == null
    ? `${TIMELINE_FRAMES_DIR}_v_${clipId}`
    : `${TIMELINE_FRAMES_DIR}_v_${clipId}_${layerId}`;
}

/** 書き出しに渡す1本ぶん（`ExportSceneInput` と同じ形）。 */
export interface TimelineFramesResult {
  framesDir?: string;
  framesBase64?: string[];
  fps: number;
  durationSec: number;
}

/** 焼き出し済みの動画のコマ（窓へ渡せる形＝部品は id で指す）。 */
export interface StagedVideoRef {
  clipId: string;
  layerId: string | null;
  dirName: string;
  count: number;
  offset: number;
}

/**
 * 描く範囲に映る動画の部品を、コマへ焼き出す（#512 段1・#1203）。`buildTimelineFrames` の中から切り出した（ADR-0070）。
 * 焼けた枚数を覚えておき、置いた長さより素材が短いときは**最後のコマで止める**（無い番号を読まない）。
 */
export async function stageTimelineVideos(
  doc: TimelineProject,
  fromFrame: number,
  toFrame: number,
  opts: Pick<BuildTimelineFramesOptions, 'templateOf' | 'stageVideo' | 'shouldCancel'>,
): Promise<StagedVideoRef[]> {
  const plan = timelineFramePlan(doc);
  const out: StagedVideoRef[] = [];
  if (!opts.stageVideo) return out;
  for (const placement of videoPlacementsOf(doc, opts.templateOf)) {
    if (opts.shouldCancel?.()) throw new ExportCancelledError();
    // ⚠️ **描く範囲に重なるコマだけを焼き出す**（#1203・#352 の45分実測）＝出てこない部品は焼かない、に加えて、
    // 出てくる部品も**範囲の外のコマは焼かない**（頭の3秒のために45分ぶんを取り出していた）。
    const win = videoStageWindow(placement, fromFrame, toFrame, plan.fps);
    if (!win) continue;
    const baseDir = videoFramesDirOf(placement.clip.id, placement.layerId);
    const stage = (w: { sourceStartSec: number; durationSec: number; speed: number }, dirName: string): Promise<number> =>
      opts.stageVideo!({
        clipId: placement.clip.id,
        assetId: placement.assetId,
        dirName,
        sourceStartSec: w.sourceStartSec,
        durationSec: w.durationSec,
        speed: w.speed,
        fps: plan.fps,
      });
    // ⚠️ **始まりの違う焼き出しは別のフォルダへ**（PR #1357 レビュー 🔴）＝置き場は書き出しの頭で1回しか空にならず、
    //   焼き出しは「あるだけ数える」ので、同じフォルダだと前の範囲のコマが残って数えられる（尻の窓に先頭の絵が出る）。
    let dirName = win.offset > 0 ? `${baseDir}_f${win.offset}` : baseDir;
    let offset = win.offset;
    let count: number;
    try {
      count = await stage(win, dirName);
    } catch (e) {
      // ⚠️ **範囲が素材の終わりより後ろ**（素材が置いた長さより短く、最後のコマで止まっている所）は1枚も取れず、
      //   焼き出しは失敗で返す（Rust＝0枚は失敗・PR #1357 レビュー 🔴）。範囲の頭が0なら丸ごとと同じ＝そのまま失敗。
      // ⚠️ **受けるのは焼き出しの口（Rust）の失敗だけ**（PR #1357 再レビュー 🔴）＝口の失敗は文字で返る。
      //   こちら側の例外（`Error`＝空き不足の見張り・中止など）は受けない＝空き不足の直後に丸ごと焼き直すと、
      //   #352 で空き容量を使い切ったのと同じ動きになる。中止のあとに焼き直すと、止めたのに走り続ける。
      if (opts.shouldCancel?.()) throw new ExportCancelledError();
      if (offset === 0 || e instanceof Error) throw e;
      count = 0;
    }
    if (count === 0 && offset > 0) {
      // そのときだけ丸ごと焼き直す（止まったコマ＝素材の最後のコマが要る。素材の長さはここでは分からない）。
      // 本当に読めない素材なら、ここでも失敗して投げる（握りつぶさない）。
      dirName = baseDir;
      offset = 0;
      count = await stage(videoStagePlan(placement), dirName);
    }
    out.push({ clipId: placement.clip.id, layerId: placement.layerId, dirName, count, offset });
  }
  return out;
}

/**
 * 全フレームを描いて PNG にする。**プレビューと同じ `layoutTimelineAt(doc, t)`** を通すので、
 * 見えているものがそのまま出る（ADR-0001）。
 *
 * クレジット（ADR-0003・`13 §4`）の文は見せ方で分かれる（`creditTextAt`・ADR-0025 追補）＝
 * 「最初」「最後」「最初と最後」は**鳴る声を全員、縦に**／「ずっと表示」は**その時刻にしゃべっている声**
 *（場面形式の掛け合い `creditForLine` と同じ挙動＝ADR-0026②）。
 */
export async function buildTimelineFrames(
  doc: TimelineProject,
  opts: BuildTimelineFramesOptions,
): Promise<TimelineFramesResult> {
  const plan = timelineFramePlan(doc);
  const bail = (): void => {
    if (opts.shouldCancel?.()) throw new ExportCancelledError();
  };
  const framesBase64: string[] = [];
  const framesDir = opts.stageFrame || opts.stageFramePng ? (opts.framesDirName ?? TIMELINE_FRAMES_DIR) : undefined;
  // **描く範囲**（#1203）＝区間の指定が無ければ、いままでどおり動画まるごと。
  const fromFrame = Math.max(0, opts.window?.fromFrame ?? 0);
  const toFrame = Math.min(plan.frameCount, opts.window?.toFrame ?? plan.frameCount);
  const windowCount = Math.max(0, toFrame - fromFrame);

  // **動画は先にコマへ焼き出す**（#512 段1）＝1フレームずつ切り出すと同じ素材を何度も開くことになる。
  // 焼き出し済みを渡されたら（ADR-0070＝窓で分けて描く）それを使う＝ここでは焼き出さない。
  const staged: { placement: VideoPlacement; dirName: string; count: number; offset: number }[] = [];
  if (opts.readVideoFrame) {
    const refs = opts.stagedVideos ?? (opts.stageVideo ? await stageTimelineVideos(doc, fromFrame, toFrame, opts) : []);
    const placements = videoPlacementsOf(doc, opts.templateOf);
    for (const r of refs) {
      const placement = placements.find((p) => p.clip.id === r.clipId && p.layerId === r.layerId);
      if (placement) staged.push({ placement, dirName: r.dirName, count: r.count, offset: r.offset });
    }
  }

  // **前のコマと同じ絵なら描き直さない**（書き出しの高速化・2026-10-22）＝描く材料（SVG）が前のコマと文字まで同じなら、
  // 同じ PNG になる（同じ関数・同じ大きさ）。講座の動画（6491コマ）では 90.5% のコマが前と同じだった
  // （字幕と立ち絵が止まっている間）。⚠️ 比べるのは**描く材料そのもの**＝動画のコマ・クレジット・動きは SVG に入るので、
  // 1つでも違えば描き直す（見た目が変わるのに前の絵を使い回すことは無い）。
  let prevSvg: string | null = null;
  /** 前のコマの PNG（バイトで運ぶときは揃うのを待つ約束・それ以外は data URL）。 */
  let prevPng: Promise<Uint8Array> | string | null = null;
  /** 最後に置いた PNG の大きさ（前のコマから写すとき、空きの見張りに数える）。 */
  let lastPngBytes = 0;
  /** `lastPngBytes` がどのコマのものか＝重ねて運ぶと終わる順が前後するので、いちばん後ろのコマのものだけ覚える。 */
  let lastPngIndex = -1;
  /** 最後に描いて置いたコマの番号（同じ絵が続くときの写す元＝置き終わっているファイル）。 */
  let freshIndex = -1;
  /** まだ頼んでいない「写す」の続き（`runStart` から `runCount` 枚）。 */
  let runStart = -1;
  let runCount = 0;
  // **置き場へ運ぶのと、次のコマを描くのを重ねる**＝前は運び終わるのを待ってから次を描いていた（待ちが約4割）。
  // ⚠️ 重ねるのは `STAGING_IN_FLIGHT` 枚まで（2026-10-23＝PNG にするのが別スレッドになり、1枚だけだと主スレッドが待った）。
  //   写すときは、写す元が書き終わっているよう**全部**待つ（`flush`）。
  const inflight: Promise<void>[] = [];
  const flush = async (): Promise<void> => {
    while (inflight.length > 0) await inflight.shift();
  };
  /** 新しく運び始める前に、重ねすぎないよう古いものから待つ。 */
  const makeRoom = async (): Promise<void> => {
    while (inflight.length >= STAGING_IN_FLIGHT) await inflight.shift();
  };
  /** 置き場へ1コマ置く（バイトならバイトの口・文字なら base64 の口）。置いた PNG の大きさを覚える。 */
  const stagePng = async (dir: string, index: number, png: Promise<Uint8Array> | string): Promise<void> => {
    if (typeof png === 'string') {
      await opts.stageFrame!(dir, index, png);
      if (index >= lastPngIndex) {
        lastPngIndex = index;
        lastPngBytes = Math.floor((png.length * 3) / 4); // base64 の4文字＝3バイト（頭の印のぶん多めに数える）
      }
    } else {
      const bytes = await png;
      await opts.stageFramePng!(dir, index, bytes);
      if (index >= lastPngIndex) {
        lastPngIndex = index;
        lastPngBytes = bytes.byteLength;
      }
    }
  };
  const startStaging = (p: Promise<void>): void => {
    // 中止で抜けたときに「誰も待たない失敗」にしない（失敗は次の flush で投げる）。
    p.catch(() => {});
    inflight.push(p);
  };
  /** ためた「写す」をまとめて頼む（写す元が書き終わってから）。 */
  const flushRun = async (): Promise<void> => {
    if (runCount === 0 || !framesDir || !opts.copyFrames) return;
    const [start, count] = [runStart, runCount];
    runCount = 0;
    await flush(); // 写す元（最後に描いたコマ）が書き終わってから
    startStaging(opts.copyFrames(framesDir, freshIndex, start, count, lastPngBytes));
  };

  try {
  for (let f = fromFrame; f < toFrame; f += 1) {
    bail();
    const timeSec = frameTimeAt(f, plan.fps);
    const creditText = creditTextAt(doc, timeSec, opts.fallbackCredit);
    const layout = layoutTimelineAt(doc, timeSec, { templateOf: opts.templateOf, assetSizeOf: opts.assetSizeOf });
    // そのフレームで映る動画のコマを読み、**その部品のアイテムだけ**差し替える
    // （素材 id で引くと、同じ動画を別の時刻に置いた2つが同じコマになる）。
    const frameSrc: { placement: VideoPlacement; src: string }[] = [];
    for (const s of staged) {
      const idx = videoFrameIndexInWindow(s.placement, f, plan.fps, s.offset, s.count);
      if (idx == null) continue;
      frameSrc.push({ placement: s.placement, src: await opts.readVideoFrame!(s.dirName, idx) });
    }
    const svg = layoutToSvg(layout, {
      assetSrc: opts.assetSrc,
      ...(frameSrc.length > 0
        ? {
            itemSrc: (item) => {
              for (const { placement, src } of frameSrc) if (isItemOfPlacement(item.id, placement)) return src;
              return undefined;
            },
          }
        : {}),
      // ⚠️ **見せ方の区間はプレビューと同じ「呼び口」で決める**（`creditTextAt`・ADR-0025・#359）＝
      // 別々に書くと「プレビューでは出ているのに動画に入っていない」が起きる（ADR-0001）。
      // 出さない時刻は `credit` を渡さない（`layoutToSvg` は未指定なら描かない）。
      ...(creditText != null ? { credit: creditText } : {}),
      ...(opts.fontFamily ? { fontFamily: opts.fontFamily } : {}),
    });
    // ⚠️ **置き場の中では 0 から並べる**＝`image2` は連番で読むので、
    // 区間の頭が 5400 番だからといって 5400 から置くと、1枚も見つからない。
    const stagedIndex = f - (opts.stageIndexBase ?? fromFrame);
    const width = opts.outputSize?.width ?? layout.width;
    const height = opts.outputSize?.height ?? layout.height;
    if (svg === prevSvg && prevPng != null) {
      const png = prevPng;
      if (framesDir && opts.copyFrames) {
        // 続きにためる（絵が変わるか、ためすぎたら頼む）。
        if (runCount === 0) runStart = stagedIndex;
        runCount += 1;
        if (runCount >= COPY_RUN_MAX) await flushRun();
      } else if (framesDir) {
        await makeRoom();
        startStaging(stagePng(framesDir, stagedIndex, png));
      } else framesBase64.push(png as string);
    } else {
      // バイトで運ぶときは、描き終えた時点で次へ進む（PNG にするのは別スレッド・揃ったら置く）。
      const png: Promise<Uint8Array> | string = framesDir && opts.stageFramePng
        ? (await svgToPngLater(svg, width, height)).bytes
        : await svgToPngDataUrl(svg, width, height);
      if (typeof png !== 'string') png.catch(() => {}); // 失敗は置く側（flush）で投げる＝誰も待たない失敗にしない
      if (framesDir) {
        await flushRun(); // 前の絵の続きを先に頼む（写す元は前に描いたコマ）
        await makeRoom();
        startStaging(stagePng(framesDir, stagedIndex, png));
        freshIndex = stagedIndex;
      } else framesBase64.push(png as string);
      prevSvg = svg;
      prevPng = png;
    }
    // 4枚おき＋最後＝進捗が動きつつ通知で埋もれない（場面形式のフレームループと同じ間引き）。
    if (f % 4 === 0 || f === toFrame - 1) opts.onProgress?.(f - fromFrame + 1, windowCount);
  }
  await flushRun();
  await flush();
  } finally {
    // 途中で投げた（中止・失敗）ときも、運んでいる途中のものを置き去りにしない（結果は捨てる）。
    await Promise.all(inflight.map((p) => p.catch(() => {})));
  }
  return {
    ...(framesDir ? { framesDir } : { framesBase64 }),
    fps: plan.fps,
    durationSec: windowCount / plan.fps,
  };
}
