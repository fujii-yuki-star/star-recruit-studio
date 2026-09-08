// 落とされたファイルのふるい（#1026 ②）。**受け口の場所は画面ごとでも、ふるいは1つ**（§6）。
//
// ⚠️ **「開く」の絞り込みと同じ一覧を見る**（`useAssetPicker` の `accept`・`infrastructure/dialog` の
// filters）＝落とすときだけ通る/通らない形式があると、同じ画面の同じ枠で挙動が割れる（ADR-0026②）。
// ⚠️ **落とせないものは黙って捨てない**（§2-5）＝何が通らなかったかを返し、画面が次の行動を出す。
import { AUDIO_FILE_EXTENSIONS, IMAGE_FILE_EXTENSIONS, VIDEO_FILE_EXTENSIONS, fileExtension, fileNameOf } from './assetFile';

/** 取り込める拡張子（音を含めるかは入口が決める＝場面形式は写真・動画のまま）。 */
export function droppableExtensions(withAudio: boolean): readonly string[] {
  return withAudio
    ? [...IMAGE_FILE_EXTENSIONS, ...VIDEO_FILE_EXTENSIONS, ...AUDIO_FILE_EXTENSIONS]
    : [...IMAGE_FILE_EXTENSIONS, ...VIDEO_FILE_EXTENSIONS];
}

export interface DropTriage<T> {
  /** 取り込むもの（落とされた順のまま）。 */
  accepted: T[];
  /** 取り込めなかったものの**表示名**（画面が次の行動を出すのに使う）。 */
  rejectedNames: string[];
}

/**
 * 落とされたものを「取り込める／取り込めない」に分ける。
 *
 * `nameOf` を受けるのは、アプリの中では**絶対パスの文字列**・ブラウザでは `File` が来るため
 * （どちらも同じふるいを通す＝片方だけ緩い、を作らない）。
 */
export function triageDroppedFiles<T>(
  items: readonly T[],
  nameOf: (item: T) => string,
  withAudio: boolean,
): DropTriage<T> {
  const ok = droppableExtensions(withAudio);
  const accepted: T[] = [];
  const rejectedNames: string[] = [];
  for (const item of items) {
    const name = nameOf(item);
    if (ok.includes(fileExtension(name))) accepted.push(item);
    else rejectedNames.push(fileNameOf(name));
  }
  return { accepted, rejectedNames };
}

/**
 * 物理座標（OS の点）を CSS の点へ直す。**落とした場所がどの枠の上か**を見るのに使う。
 *
 * ⚠️ **拡大率で割る**＝高解像度の画面（`devicePixelRatio > 1`）では物理座標が CSS の何倍にもなる。
 * 割らずに比べると、枠の上に落としても「外」と判定される（＝落としても無反応に戻る）。
 */
export function cssPointOf(physical: { x: number; y: number }, scale: number): { x: number; y: number } {
  const s = scale > 0 ? scale : 1; // 0 や負の拡大率は無い＝来たら等倍として扱う（0 除算で NaN にしない）
  return { x: physical.x / s, y: physical.y / s };
}

/** その点が枠の中か（境界は含む＝端に落としたときに取りこぼさない）。 */
export function isPointInRect(
  p: { x: number; y: number },
  r: { left: number; top: number; right: number; bottom: number },
): boolean {
  return p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom;
}
