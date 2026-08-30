// タイムライン形式（ADR-0032）の書き出しの並べ方（#631）。純粋関数（副作用なし・§7 テスト対象）。
//
// **タイムラインの書き出しは常に全フレーム描画**（ADR-0032 決定22＝決定10「迷ったら全フレーム描画」の適用）。
// 場面形式のような「単純な区間は FFmpeg 合成」へは倒さない。理由は `11 §7.6.5`：
//   ① 帯分割（`videoSceneSplit`）は**合成の単位を跨いで切る**ので、クリップ全体の不透明度（決定19 の
//      前提＝1枚に合成してから α）が分割時だけ崩れる。
//   ② 判定条件（重なり・アニメ・速度・クロップの有無）を増やすほど、**プレビューと書き出しで別経路**が
//      増えてパリティ（ADR-0001）の検査点が増える。
// ここは「何フレーム描くか」と「音をどこへ置くか」だけを決め、描くのは renderer・混ぜるのは FFmpeg。
import { audioCuesAt, audioLoops, audioSourceKey, audioSourceKeyOfClip, clipBaseVolume, clipFadeSec, isAudioClip, normalizedVolumePoints, volumeExpr } from './audio';
import { FPS, VOLUME_POINTS_MAX } from '../constants';
import { applyDucking, duckingFactorPoints, fitSpeechSpans, resolveAudioAuto } from '../voice/audioAuto';
import { TIMELINE_CLIP_KIND, isFreeSlotAssetType, ASSET_USE_KIND, LAYER_TYPE } from '../enums';
import { bgmById } from '../bgm/bgmCatalog';
import { danglingSubtitleLinks } from './subtitleLink';
import { fileExtension } from '../asset/assetFile';
import { usedTimelineUserFontIds } from '../font/usedFonts';
import { effectiveFps, timelineFrameCount } from './playback';
import { clipEndSec } from './validateTimelineDoc';
import { isDrawnClip, placementOriginalAudio, videoAssetIds, videoPlacementsOf, videoPlacementsOfClip } from './video';
import { isUnsplittableClipKind } from './clipKind';
import type { Template } from '../template/types';
import type { TimelineClip, TimelineProject } from './types';

/** 書き出す絵の計画（全フレーム描画）。 */
export interface TimelineFramePlan {
  fps: number;
  /** 総フレーム数（0 なら描くものが無い＝書き出せない）。 */
  frameCount: number;
  /** 出力の尺（秒）。フレーム数から導く＝映像と音の長さが一致する。 */
  durationSec: number;
}

/**
 * 何フレーム描くかを決める。**尺はフレーム数から導く**（`frameCount / fps`）＝端数の尺でも
 * 映像と音の長さが食い違わない。
 *
 * 端数は**切り上げ**（`ceil`）＝置いたものが末尾で切れない。四捨五入だと下へ丸まる尺
 * （例 5.505 秒 → 165 フレーム＝5.5 秒）で末尾が黙って落ちる（読み上げの語尾が切れる）。
 * 切り上げても最後のフレームの時刻は必ず尺の中（`ceil(x) - 1 < x`）＝空白のフレームは増えない。
 */
export function timelineFramePlan(doc: TimelineProject): TimelineFramePlan {
  const fps = effectiveFps(doc);
  // 尺 0（何も置いていない）は 0 フレーム＝呼び出し側が「書き出せない」と止める。
  const frameCount = timelineFrameCount(doc); // 規則は `playback.ts` に1つ（プレビューと同じものを見る・#724）
  return { fps, frameCount, durationSec: frameCount / fps };
}

/**
 * n 番目のフレームを描く時刻（秒）。**プレビューと同じ格子**（`quantizeToFrameSec` が返す `k/fps`）に
 * 乗る＝再生で見た絵と書き出したフレームが一致する（ADR-0001）。
 *
 * ここで `quantizeToFrameSec` を**通さない**。格子点をもう一度量子化すると、掛け算の誤差で1つ前の
 * フレームへ落ちることがある（fps=30 の 123 番＝`123/30*30 = 122.99999999999999` → 122 番の時刻）。
 * そうなると同じ絵を2枚焼き、その時刻に始まるクリップが書き出しでだけ1フレーム遅れる。
 */
export function frameTimeAt(index: number, fps: number): number {
  return index / (fps > 0 ? fps : FPS);
}

/**
 * 書き出しで置く音1本ぶん（FFmpeg の「配置＋切り出し＋音量＋フェード＋ミックス」に対応）。
 * 場面形式の BGM 区間（`BgmRunInput`）と**同じ形**＝混ぜる側を作り直さない。
 *
 * **直接置いた動画の元の音もここに出る**（#512 段2）＝鳴らす設定にした部品だけ（`placementOriginalAudio`）。
 * 音源は**ファイルのパス**で渡す（`assetPath`）＝動画を base64 にしない。差し込み口の動画は段3。
 */
export interface TimelineAudioRun {
  /** どの置き場所の音か（**識別用**＝差し込み口は `<部品 id>/<層 id>`。音源は `sourceKey`/`assetPath` で引く）。 */
  clipId: string;
  /** 音源を見分けるキー（`audioSourceKey` と同じ規則）。 */
  sourceKey: string;
  /**
   * 音源のプロジェクト相対パス（#512 段2＝**動画の元の音**だけが持つ）。
   * ⚠️ これがある run は `audioSrcByKey`（中身）を要らない＝動画を丸ごと文字列にしない。
   */
  assetPath?: string;
  /**
   * 音源ファイルの拡張子（`mp3` など・小文字）。FFmpeg が一時ファイルの形式を判定するのに要る。
   * **音源キーからは復元できない**（同梱BGMの id やクリップの保存先は拡張子を持たない）ので、
   * 誰が読んでも同じ値になるようここで解決しておく＝呼ぶ側で当て推量しない。
   */
  fileExt: string;
  /** 出力の先頭から何秒の位置に置くか。 */
  delaySec: number;
  /** どれだけ鳴らすか（秒）。 */
  playSec: number;
  /** 音源のどこから使うか（秒）。 */
  sourceStartSec: number;
  /** 再生速度（>0）。 */
  speed: number;
  /**
   * 実効音量（0〜1.5・継承解決済み）。**`volumeExpr` があるときはそちらが基準**＝この値は使われない
   * （点が無いクリップだけがここへ落ちる＝再生の `volumeAt(points) ?? clipBaseVolume` と同じ分かれ方）。
   */
  volume: number;
  /**
   * **音量の変化**（#512）を FFmpeg の `volume` フィルタの式にしたもの（`volumeExpr`）。点が無ければ
   * 未指定＝従来どおり `volume` の一定値で出る。**再生と同じ点列・同じ規則**から組む（ADR-0032 追補＝案A）。
   */
  volumeExpr?: string;
  fadeInSec: number;
  fadeOutSec: number;
  /**
   * 素材が短いとき繰り返すか。**BGM だけ true**（読み上げを繰り返すと言葉が二重に鳴る）。
   * 場面形式の BGM 混合は常にループする実装なので、**この区別を渡さないと読み上げが繰り返される**。
   */
  loop: boolean;
}

/**
 * ダッキングで増える点の数（α-6 出口監査 🟡）。**門と実際の式が同じ材料を見る**ための1か所。
 *
 * ⚠️ **1区間＝最大4点**（まとめた後の区間数から数える）。⚠️ **`+1` を足さない**＝`duckingFactorPoints` は
 * 先頭を1へ戻す点を足すことがあるが、**それが足されるのは立ち上がりが0のときだけ**（`from-0` と `from` が
 * 同じ時刻に落ちて1点に畳まれ、先頭が下がった値になる）＝**足す1点と畳んで減る1点が必ず相殺する**ので、
 * 上限は区間数×4 のまま。相殺は自明でないので `export.test.ts` の「ダッキングの点数の見積り」で
 * 実際の点数と突き合わせて固定している（PR #922 レビュー ℹ️）。
 *
 * ⚠️ **多めに見積もらない**＝この数は書き出しを**断る**門に足されるので、上振れさせると
 * 実際には組める式を「点が多すぎる」として拒む（上の門のコメントが避けたい方の失敗）。
 */
export function duckFactorPointCount(
  doc: TimelineProject,
): number {
  const auto = resolveAudioAuto(doc.videoSettings.audioAuto);
  if (!auto.duckBgm) return 0;
  return duckSpansOf(doc, auto).spans.length * 4;
}

/** 下げる区間（まとめた後）。門と書き出しが同じ材料を見るための1か所。 */
function duckSpansOf(doc: TimelineProject, auto: ReturnType<typeof resolveAudioAuto>) {
  return fitSpeechSpans(
    doc.clips
      .filter((c) => c.kind === TIMELINE_CLIP_KIND.voice && !!c.voice?.voicePath)
      .filter((c) => audioCuesAt(doc, c.startSec + c.durationSec / 2).some((q) => q.clipId === c.id))
      .map((c) => ({ startSec: c.startSec, endSec: clipEndSec(c) })),
    auto,
    VOLUME_POINTS_MAX,
  );
}

/**
 * 音の並べ方を決める（#631）。**再生（`audioCuesAt`）と同じ値を使う**＝聞いた音と書き出した音が一致する。
 *
 * **音量の変化（`volumePoints`・#512）も渡す**（段3）＝再生と**同じ点列**から `volumeExpr` で式を組み、
 * FFmpeg 側は受け取った式を `volume` フィルタへ差し込むだけ（ADR-0032 追補＝案A）。式を Rust で組み直すと
 * 規則が2か所になるので、**組むのはここ（純粋関数）だけ**にしてずれを「式の書き方」に閉じ込める。
 *
 * 音量とフェードは**再生と同じ関数**（`clipBaseVolume` / `clipFadeSec`）から採る。フェードは FFmpeg 側で
 * `afade` として掛けるので、ここでは**素の音量**と**フェードの秒数（切り詰め済み）**を渡す
 * ＝フェード込みの値から割り戻すような当て推量をしない。
 */
export function timelineAudioRuns(
  doc: TimelineProject,
  templateOf?: (templateId: string) => Template | undefined,
): { runs: TimelineAudioRun[]; duckMerged: boolean } {
  const runs: TimelineAudioRun[] = [];
  // 声が鳴っている区間（#257）＝**作成済みの読み上げ**だけ（鳴らない声のために下げない）。
  // 隠した列・隠したクリップも数えない＝`audioCuesAt` と同じ「聞こえるもの」の見方に合わせる。
  const auto = resolveAudioAuto(doc.videoSettings.audioAuto);
  // ⚠️ **まとめたかどうかを捨てない**（α-6 出口監査 🟡・ADR-0032 追補4）＝まとめると
  // 「セリフとセリフの間でも BGM が下がったまま」になるので、黙ってやると設定した意味と違う音になる。
  // 場面形式は書き出しの完了時に知らせている（`ExportScreen`）＝形式で割らない。
  const fitted = auto.duckBgm ? duckSpansOf(doc, auto) : { spans: [], merged: false };
  const duckSpans = fitted.spans;
  for (const clip of doc.clips) {
    const sourceKey = audioSourceKeyOfClip(clip);
    if (!sourceKey) continue; // 音源が無い（読み上げ未作成など）＝置くものが無い
    // 鳴るかどうかの判定（隠した列・隠したクリップ）は再生と同じ関数に委ねる＝規則を2か所に書かない。
    // クリップの真ん中の時刻で見る（区間の端は半開なので、0秒に近いクリップでも必ず入る）。
    const midSec = clip.startSec + clip.durationSec / 2;
    const cue = audioCuesAt(doc, midSec).find((c) => c.clipId === clip.id);
    if (!cue) continue;
    const volume = clipBaseVolume(clip, doc);
    // 声が鳴っている区間だけ BGM を下げる（#257・ADR-0032 追補4＝両形式に効く）。
    // ⚠️ **読み上げそのものは下げない**（自分で自分を下げることになる）。動画の元の音は下の段で扱う。
    const factor =
      clip.kind === TIMELINE_CLIP_KIND.voice
        ? []
        : duckingFactorPoints(duckSpans, { startSec: clip.startSec, endSec: clipEndSec(clip) }, auto);
    // 点が無ければキーごと落とす（`undefined` を持たせない）＝渡す側・受ける側とも「未指定＝一定値」で揃う。
    const expr =
      factor.length > 0
        ? volumeExpr(applyDucking(normalizedVolumePoints(clip.volumePoints), volume, factor))
        : volumeExpr(clip.volumePoints);
    runs.push({
      clipId: clip.id,
      sourceKey,
      fileExt: audioFileExtOf(clip, doc),
      delaySec: clip.startSec,
      playSec: clipEndSec(clip) - clip.startSec,
      sourceStartSec: clip.sourceStartSec ?? 0,
      speed: cue.speed,
      volume,
      ...(expr ? { volumeExpr: expr } : {}),
      ...clipFadeSec(clip),
      loop: audioLoops(clip),
    });
  }
  // 動画の**元の音**（#512 段2＝直接置き／段3b＝差し込み口）。鳴るかどうかの判定は
  // `placementOriginalAudio` の1か所＝仕上がり確認で聞こえたものだけが書き出しに出る。
  // ⚠️ **付けないものは渡さない**＝音量の変化・前後のフェードは対象外なので 0/未指定で送る
  //（受け側の既定と同じ＝欄が無いのに値だけ効く、を作らない）。
  // ⚠️ **繰り返さない**＝置いた長さより素材が短ければそこで終わる（絵も終わっている）。
  for (const placement of videoPlacementsOf(doc, templateOf)) {
    const org = placementOriginalAudio(doc, placement);
    if (!org) continue;
    const path = doc.assets.find((a) => a.assetId === org.assetId)?.filePath;
    if (!path) continue; // 保存先が判らない＝渡すものが無い（ファイルの欠けは Rust 側が理由つきで断る）
    const clip = placement.clip;
    runs.push({
      // ⚠️ **置き場所ごとに別の音**（段3b）＝1つの部品に差し込み口ぶんの動画がありうるので、
      // 部品 id だけだと同じ id の run が並び、鳴らす側で見分けられない。
      clipId: placement.layerId == null ? clip.id : `${clip.id}/${placement.layerId}`,
      sourceKey: audioSourceKey({ clipId: clip.id, assetId: org.assetId }),
      assetPath: path,
      fileExt: extOf(path),
      delaySec: clip.startSec,
      // ⚠️ **使える長さで頭打ち**＝「ここまで」で切った動画の音が、その先まで鳴り続けない
      //（絵は最後のコマで凍るので、音だけ流れると食い違う）。
      playSec: Math.min(clipEndSec(clip) - clip.startSec, placement.durationSec),
      sourceStartSec: org.sourceStartSec,
      speed: org.speed,
      volume: org.volume,
      fadeInSec: 0,
      fadeOutSec: 0,
      loop: false,
    });
  }
  return { runs, duckMerged: fitted.merged };
}

/**
 * その音源ファイルの拡張子（小文字）。同梱BGMは目録から、持ち込みは素材の保存先から、読み上げは
 * 音声の保存先から採る＝**実際のファイルに合わせる**（決め打ちにしない）。判らないときだけ `mp3`
 * （FFmpeg は中身でも判定できるので、拡張子は手がかりに過ぎない）。
 */
function audioFileExtOf(clip: TimelineClip, doc: TimelineProject): string {
  if (clip.kind === TIMELINE_CLIP_KIND.voice) return extOf(clip.voice?.voicePath);
  if (clip.bundledBgmId) return extOf(bgmById(clip.bundledBgmId)?.fileName);
  return extOf(doc.assets.find((a) => a.assetId === clip.assetId)?.filePath);
}

function extOf(path: string | null | undefined): string {
  // 拡張子の切り出しは既に domain に1つある（`fileExtension`）＝同じ規則を書き直さない（§6）。
  return (path ? fileExtension(path) : '') || DEFAULT_AUDIO_FILE_EXT;
}

/** 拡張子が判らないときの既定。 */
const DEFAULT_AUDIO_FILE_EXT = 'mp3';

/** 書き出しを止める理由（`15 §6` の `TIMELINE_EXPORT_*` と対）。 */
export const TIMELINE_EXPORT_BLOCK = {
  /** 動画に出るものが1つも無い（尺 0）。 */
  empty: 'TIMELINE_EXPORT_EMPTY',
  /** 見た目パターンが見つからない部品がある＝そこが丸ごと絵から消えるので、書き出さずに断る。 */
  templateUnresolved: 'TIMELINE_EXPORT_TEMPLATE_UNRESOLVED',
  /** 連動先が見つからない字幕で、自分の文も無い＝**何も出ない**ので、書き出さずに断る（#633）。 */
  subtitleLinkBroken: 'TIMELINE_EXPORT_SUBTITLE_LINK_BROKEN',
  /** 音量の変化の点が多すぎる＝FFmpeg が式を解析できない（#512）ので、書き出さずに断る。 */
  volumePointsTooMany: 'TIMELINE_EXPORT_VOLUME_POINTS_TOO_MANY',
  /**
   * 使っている素材のファイルが読めない（#716 レビュー）＝そこだけ**灰色の枠**が焼き込まれる。
   * プレビューでは（開いた時点の表示先で）写真が出たままなので、**見えていたものと違う動画**が
   * 成功として出る。描く前に断る（ADR-0026④・見た目未解決と同じ流儀）。
   */
  assetUnreadable: 'TIMELINE_EXPORT_ASSET_UNREADABLE',
  /**
   * 使っている**持ち込みフォント**が手元に無い（α-6 差分再監査）＝描画は既定の字体へ倒れるので、
   * そのまま出すと**黙って別の字体の動画**が成功として返る（ADR-0038・§2-5）。
   * ⚠️ **場面形式には同じ門がある**（公開前チェックの `missingFont`）＝形式で挙動を割らない（ADR-0026②）。
   */
  userFontMissing: 'TIMELINE_EXPORT_USER_FONT_MISSING',
  /**
   * 使っている**持ち込みフォント**が手元にあるか**調べられなかった**（差分再監査 2巡目）。
   *
   * ⚠️ **「見つからない」とは別**＝目録そのものが読めないので待っても埋まらない。
   * ⚠️ **黙って通さない**＝描画は既定の字体へ倒れるので、通すと別の字体の動画が成功として出る。
   * 場面形式は同じ状態を公開前チェックの `unknownFont` で止めている（ADR-0026②）。
   */
  userFontUnreadable: 'TIMELINE_EXPORT_USER_FONT_UNREADABLE',
} as const;

export type TimelineExportBlockCode = (typeof TIMELINE_EXPORT_BLOCK)[keyof typeof TIMELINE_EXPORT_BLOCK];

export interface TimelineExportCheckOptions {
  /**
   * いま読み込めている見た目パターンの id。**渡さないと見た目の未解決は見ない**（判定材料が無いのに
   * 「見つからない」と断らない＝読み込み前の一瞬で嘘の理由を出さないため）。
   */
  knownTemplateIds?: ReadonlySet<string>;
  /**
   * いま手元にある**持ち込みフォント**の id。**渡さないと見ない**（`knownTemplateIds` と同じ流儀＝
   * 「調べていない」と「そろっている」を分ける・`15 §6` `USER_FONT_MISSING`）。
   */
  availableUserFontIds?: ReadonlySet<string>;
  /**
   * 目録が**読めなかった**か（差分再監査 2巡目）。**「まだ調べていない」とは別**＝待っても
   * 埋まらないので、使っているフォントがあるなら**そう言って止める**（場面形式の `unknownFont`）。
   */
  userFontsUnreadable?: boolean;
}

export interface TimelineExportBlocker {
  code: TimelineExportBlockCode;
  /** どの部品のことか（画面で示す）。理由によっては空。 */
  clipIds: string[];
}

/**
 * 書き出す前に止める理由を返す（空なら書き出せる）。**§2-5**＝画面はここから「次の行動」を出す。
 *
 * **立ち絵に入れた動画だけは、まだ動かせない**（`layoutTimelineAt` は1枚の絵として描き、元の音も出ない）。
 * 黙って静止画の動画を成功として出さないため、**その使い方のときだけ**書き出しを止める
 *（ADR-0026④・場面形式の `videoSlotUnplaceable` と同じ流儀）。
 * **直接置いた動画は映り（#512 段1）、元の音も鳴る（段2）／差し込み口も映って鳴る（段3・段3b）**ので止めない。
 */
export function timelineExportBlockers(doc: TimelineProject, opts: TimelineExportCheckOptions = {}): TimelineExportBlocker[] {
  const blockers: TimelineExportBlocker[] = [];
  if (timelineFramePlan(doc).frameCount <= 0) {
    blockers.push({ code: TIMELINE_EXPORT_BLOCK.empty, clipIds: [] });
  }
  // 見た目が解決できないクリップは描かれない（`layoutTimelineAt`）＝置いたものが丸ごと絵から消える。
  // 警告だけで通すと、作り込みが化けた動画を成功として出すことになる（ADR-0026④・場面形式と同じ扱い）。
  if (opts.knownTemplateIds) {
    const unresolved = doc.clips
      .filter((c) => c.templateId != null && !opts.knownTemplateIds?.has(c.templateId))
      .map((c) => c.id);
    if (unresolved.length > 0) {
      blockers.push({ code: TIMELINE_EXPORT_BLOCK.templateUnresolved, clipIds: unresolved });
    }
  }
  // 連動先が見つからない字幕は、自分の文があればそれで描かれる。**文も無いものは何も出ない**＝
  // 置いたはずの字幕が消えた動画を成功として出さない（`11 §8` V29 の警告より一段強い＝ADR-0026④）。
  // ⚠️ **「何も描かれない字幕」全部には広げない**（#787 で試して取り下げ）＝焼き出しが普通に作る
  // 「元から空の字幕の箱」まで止めてしまい、焼いた直後の動画が書き出せなくなる（`subtitleLink.ts` に理由）。
  const brokenSubtitles = danglingSubtitleLinks(doc).filter((c) => !c.text).map((c) => c.id);
  if (brokenSubtitles.length > 0) {
    blockers.push({ code: TIMELINE_EXPORT_BLOCK.subtitleLinkBroken, clipIds: brokenSubtitles });
  }
  // 音量の変化（#512）は点の数だけ式の項が増え、**点 95 個までは通り 96 個で FFmpeg が式を解析できなくなる**（実測）。
  // そのまま渡すとフィルタの組み立てごと失敗し、出せるのは「もう一度お試しください」＝**何度やっても
  // 成功しない案内**になる。押す前にここで断る（§2-5・#631 の流儀）。数えるのは**正規化した後**＝
  // 同じ時刻の重複は式に出ないので、それで上限に当てない。
  // 見るのは**鳴る音を持つ部品だけ**（`isAudioClip`＝再生・編集と同じ述語）。絵の部品に点が入っていても
  // 式は組まれない（`timelineAudioRuns` に出ない）ので、数えると**書き出せるものを断る**ことになる。
  // ⚠️ **実効の点数で数える**（α-6 出口監査 🟡）＝式へ渡るのは**保存の点とダッキングの点の和集合**
  // （`applyDucking`）なので、保存の点だけを見ると**合わせて上限を超える**組み合わせを素通しする＝
  // フィルタの組み立てごと失敗し、出るのは「もう一度お試しください」＝この門が防ぐはずのもの。
  const duckPointsForGate = duckFactorPointCount(doc);
  const tooManyPoints = doc.clips
    .filter((c) => isAudioClip(c)
      && normalizedVolumePoints(c.volumePoints).length + duckPointsForGate > VOLUME_POINTS_MAX)
    .map((c) => c.id);
  if (tooManyPoints.length > 0) {
    blockers.push({ code: TIMELINE_EXPORT_BLOCK.volumePointsTooMany, clipIds: tooManyPoints });
  }
  // ⚠️ **直接置いた動画（#512 段1・段2）と差し込み口の動画（段3）は映る**＝断るのは**まだ映らない
  // 使い方**だけ＝**立ち絵に入れた動画**（`character.poseAssetId`）。置いたのに静止画で出る、を
  // 成功として出さない（ADR-0026④）。
  // ⚠️ **描かれないものは数えない**＝隠した部品は静止画で出ることも無いので、断る理由が無い
  // （隠したのに書き出せない、を作らない）。
  // ⚠️ **立ち絵に入れた動画も映って音が鳴るようになった**（#809）＝断る理由が無くなったので、
  // ここでの関門は**外した**。#512 の段1〜段3b（直接置き・差し込み口）と同じく
  // `videoPlacementsOfClip` が置き場所として数え、コマの焼き出しと元の音が通る。
  // ⚠️ **見た目パターンが解けないときは置き場所にならない**（静止画の側へ倒れる）＝
  // そのケースは `templateUnresolved` が別に断っているので、ここで二重に見ない。
  // 使っている持ち込みフォントが手元に無いときは断る（α-6 差分再監査）＝描画は既定の字体へ倒れるので、
  // 通すと**黙って別の字体の動画**が成功として出る（ADR-0038）。**場面形式と同じ門**（ADR-0026②）。
  // ⚠️ **調べていないときは見ない**（`availableUserFontIds` 未指定＝判定材料が無い）。
  // 調べられなかったときは「見つからない」に倒さず、そう言って止める（場面形式と同じ3状態）。
  if (opts.userFontsUnreadable && usedTimelineUserFontIds(doc).length > 0) {
    blockers.push({ code: TIMELINE_EXPORT_BLOCK.userFontUnreadable, clipIds: [] });
  }
  if (opts.availableUserFontIds) {
    const missingFonts = usedTimelineUserFontIds(doc).filter((id) => !opts.availableUserFontIds?.has(id));
    if (missingFonts.length > 0) {
      // 部品ではなく**動画全体**の話なので、指す部品は挙げない（動画全体の指定でも起きる）。
      blockers.push({ code: TIMELINE_EXPORT_BLOCK.userFontMissing, clipIds: [] });
    }
  }
  return blockers;
}

/**
 * 音量の点が多すぎる部品のうち、**分けられる種類が1つでもあるか**（#831）。
 *
 * ⚠️ 「1つの部品に置けるのは…いらない点を外すか、部品を分けてください」は**読み上げの部品には
 * できない**（`isUnsplittableClipKind`＝`splitClipIssue` と同じ関門）。挙げた部品が読み上げだけの
 * ときに「分けてください」を添えると、従っても分けられない＝実行できない行動を名指しすることになる
 * （§2-5・#812 と同型）。「分けられる」の定義は**書き直さず**、分割の関門と同じ述語を通す。
 *
 * ⚠️ **共有しているのは「種類の関門」だけ**（#844-2）＝`splitClipIssue` はもう1つ「音量の点が
 * 多すぎると切れない」（`volumePointsFull`）を持つので、`audio` でも点が概ね120個以上あると
 * **どの位置でも切れず**、それでもここは `true` を返す＝「分けてください」が実行できない行動のまま残る。
 * 到達は狭い（画面は上限60で止めるので**手編集・旧文書**でしか作れない）ため据え置くが、
 * 「関門をまるごと共有している」と読める書き方はしないこと。
 */
export function volumePointsTooManyHasSplittable(doc: TimelineProject, clipIds: string[]): boolean {
  return clipIds.some((id) => {
    const clip = doc.clips.find((c) => c.id === id);
    return clip != null && !isUnsplittableClipKind(clip);
  });
}

/**
 * 書き出しで**絵として描く素材**の id（#716）。
 *
 * 全部の素材ではなく**実際に使っているものだけ**を返す＝呼び出し側は data URL をまとめて持つので、
 * 使っていない素材まで載せると記憶を無駄に食う。音だけの素材は絵として描かないので含めない。
 * 出どころは `clipImageAssetIds` に1つ（**書き出しを断るかを数える側**と同じものを見る）。
 */
export function timelineImageAssetIds(
  doc: TimelineProject,
  templateOf?: (templateId: string) => Template | undefined,
): string[] {
  const ids = new Set<string>();
  // 絵として置ける種別かは `isFreeSlotAssetType` に1つ（ADR-0030 追補で一本化）＝音の種別を数え直さない。
  const audioIds = new Set(doc.assets.filter((a) => !isFreeSlotAssetType(a.assetType)).map((a) => a.assetId));
  for (const c of doc.clips) for (const id of clipImageAssetIds(c)) ids.add(id);
  // ⚠️ **直接置いた動画は静止画を要らない**（#512 段1・レビュー 🟡）＝実フレームを焼いて描くので、
  // 代表フレームが読めなくても書き出せる。ここへ入れると「実フレームで描けるのに
  // **素材が読めませんで永久に書き出せない**」組み合わせができる（代表フレームの生成は失敗しうる）。
  // ⚠️ ほかの使い方（差し込み口・立ち絵）で同じ素材を使っていれば、そちらは静止画で描くので残す。
  // ⚠️ **動画の素材を要求するのは「静止画として描く部品」があるときだけ**（レビュー 🔴）。
  // 実フレームで描く部品（直接置き）と、**そもそも描かれない部品**（隠した部品・列・まとまり）は
  // 代表フレームを要らない＝要求すると、代表フレームが作れなかった動画で**書き出し全体が止まる**
  // （描かれもしないものを理由に断る）。⚠️ 動画以外の素材はこの引き算の対象にしない。
  const videoIds = videoAssetIds(doc);
  // ⚠️ **要否は置き場所ごと**（#512 段3）＝1つの部品でも、実フレームで描く差し込み口と
  // 静止画で描く差し込み口が混じる。部品まるごとで判じると、静止画で描く枠の代表フレームを
  // 落としてしまう（灰色の枠が焼き込まれる）。
  const stillOnly = new Set<string>();
  for (const c of doc.clips) {
    if (!isDrawnClip(doc, c)) continue;
    // ⚠️ **使い方まで込みで見分ける**（レビュー由来の変異チェックで判明）＝直接置きと立ち絵はどちらも
    // 層を持たないので、層 id だけで突き合わせると**別の使い方どうしが同じ鍵になる**
    //（直接置きの動画がある部品では、立ち絵の代表フレームまで要らない扱いになり灰色の枠が焼き込まれる）。
    const asVideo = new Set(videoPlacementsOfClip(doc, c, { ids: videoIds, ...(templateOf ? { templateOf } : {}) })
      .map((p) => assetUseKey(p.use, p.layerId)));
    for (const u of clipImageAssetUses(c, templateOf)) {
      if (asVideo.has(assetUseKey(u.kind, u.layerId))) continue; // 実フレームで描く＝代表フレームは要らない
      stillOnly.add(u.assetId);
    }
  }
  return [...ids].filter((id) => !audioIds.has(id) && (!videoIds.has(id) || stillOnly.has(id)));
}

/**
 * その部品が**絵として使う素材**の id（#716 レビュー）。
 *
 * 出どころは3つ＝**直接置いた素材**（`kind='slot'`）／**枠の差し込み口**（`assetRefs`）／**立ち絵**
 * （`character.poseAssetId`）。**部品に書かれている**絵の素材はこれで尽きる＝1つ漏らすと、その絵だけ
 * 動画から消える（実際に立ち絵を落としていた）。
 * ⚠️ 描画（`renderer/layout.ts`）はもう1つ、**見た目パターンの既定素材**（層の `assetId`・ADR-0021）も引く。
 * それは部品ではなく見た目パターン側の持ち物なので**ここでは返さず**、呼び出し側が `templateAssetSrcById`
 * で受ける（受け口を外すと、テンプレ既定素材が同じ形で消える）。
 * **数える側（書き出しを断るか）と、読む側（data URL を用意するか）が同じものを見る**ための単一の参照元。
 */
export function clipImageAssetIds(clip: TimelineClip): string[] {
  return clipImageAssetUses(clip).map((u) => u.assetId);
}

/** 素材の使い方を見分ける鍵（種類＋層 id）。⚠️ 層 id だけでは足りない（直接置きと立ち絵が重なる）。 */
function assetUseKey(kind: AssetUseKind, layerId: string | null): string {
  return `${kind}:${layerId ?? ''}`;
}

/** 素材の使い方（`direct`＝直接置き／`slot`＝差し込み口／`character`＝立ち絵）。 */
// 素材の使い方（`ASSET_USE_KIND`）は**中立な置き場**（`domain/enums`）にある＝作る側（`video.ts`）が
// 実行時に読める（ここに置くと `export.ts` → `video.ts` の import と循環する）。既存の読み手のために
// ここからも出す（import 元を散らさない）。
export { ASSET_USE_KIND } from '../enums';
export type { AssetUseKind } from '../enums';
import type { AssetUseKind } from '../enums';

/**
 * 同じものを**置き場所つき**で返す（#512 段3）。
 * ⚠️ **列挙はここ1つ**＝「どの素材を使うか」と「その素材をどこで使うか」を別々に数え直すと、
 * 片方だけ増えたときに黙ってずれる（実際に立ち絵を落としていた＝上の JSDoc の経緯）。
 */
export function clipImageAssetUses(
  clip: TimelineClip,
  /**
   * 見た目パターンの解決（α-6 出口監査 🟡）。⚠️ **立ち絵の層 id をそろえるために要る**＝
   * `videoPlacementsOfClip` は立ち絵を**層 id つき**で返すので、ここで `null` のままだと
   * **同じ立ち絵が別の鍵になり**、実フレームで描くものまで「代表フレームが要る」側に入る
   *（代表フレームを読めないだけで、実際には描ける動画の書き出しを断ってしまう）。
   */
  templateOf?: (templateId: string) => { layers: { id: string; type: string }[] } | undefined,
): { kind: AssetUseKind; layerId: string | null; assetId: string }[] {
  const out: { kind: AssetUseKind; layerId: string | null; assetId: string }[] = [];
  if (clip.assetId) out.push({ kind: ASSET_USE_KIND.direct, layerId: null, assetId: clip.assetId });
  if (clip.character?.poseAssetId) {
    const charLayerId = clip.templateId != null
      ? templateOf?.(clip.templateId)?.layers.find((l) => l.type === LAYER_TYPE.character)?.id ?? null
      : null;
    out.push({ kind: ASSET_USE_KIND.character, layerId: charLayerId, assetId: clip.character.poseAssetId });
  }
  for (const [layerId, id] of Object.entries(clip.assetRefs ?? {})) {
    if (typeof id === 'string') out.push({ kind: ASSET_USE_KIND.slot, layerId, assetId: id });
  }
  return out;
}


