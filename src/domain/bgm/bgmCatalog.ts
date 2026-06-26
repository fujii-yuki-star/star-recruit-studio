// 同梱BGMのカタログ（標準BGM選択機能）。すべて CC0（Open Music Academy）＝同梱・再配布・商用可・帰属義務なし（13§8）。
// id は project.bgmSettings.bundledBgmId の enum 値と一致させる（単一の参照元・§2-7）。
// fileName は public/bgm/ のファイル名（書き出し時に /bgm/<fileName> を読み込む）。
// label/note は選択UIに出す日本語、title/artist はクレジット・権利台帳用（About 画面でのみ表示）。

/** 同梱BGMの id。project.schema の bgmSettings.bundledBgmId enum と一致させる（単一参照元・§6 型注釈）。 */
export type BundledBgmId = 'summer-morning' | 'found-new-hope' | 'limousine-cruise';

export interface BundledBgm {
  /** project.bgmSettings.bundledBgmId の値（schema enum と一致）。 */
  id: BundledBgmId;
  /** 選択UIに表示する名前（日本語）。 */
  label: string;
  /** 雰囲気の補足（UIの説明文）。 */
  note: string;
  /** public/bgm/ のファイル名（/bgm/<fileName> で配信）。 */
  fileName: string;
  /** クレジット・権利台帳用：原題。 */
  title: string;
  /** クレジット・権利台帳用：作者。 */
  artist: string;
}

/** 同梱BGM一覧（初期3曲・すべて CC0／Open Music Academy）。段階的に追加予定。 */
export const BGM_CATALOG: readonly BundledBgm[] = [
  {
    id: 'summer-morning',
    label: '爽やかな朝',
    note: '明るく軽快',
    fileName: 'summer-morning.mp3',
    title: 'Summer Morning',
    artist: 'Loic Djoufack',
  },
  {
    id: 'found-new-hope',
    label: '前向きなポップ',
    note: '希望を感じる前向きな曲',
    fileName: 'found-new-hope.mp3',
    title: 'Found New Hope (Pop)',
    artist: 'Florian Simon',
  },
  {
    id: 'limousine-cruise',
    label: '落ち着いたラウンジ',
    note: '上品で落ち着いた雰囲気',
    fileName: 'limousine-cruise.mp3',
    title: 'Limousine Cruise (Pop - Lounge)',
    artist: 'Florian Simon',
  },
];

/** 同梱BGM の入手元・ライセンス（クレジット表示・権利台帳用。全曲共通）。 */
export const BGM_SOURCE = 'Open Music Academy';
export const BGM_SOURCE_URL = 'https://openmusic.academy/';
export const BGM_LICENSE = 'CC0';

/** bundledBgmId → 同梱BGM。未知/未指定/null は undefined（呼び出し側でフォールバック）。 */
export function bgmById(id: string | null | undefined): BundledBgm | undefined {
  return BGM_CATALOG.find((b) => b.id === id);
}

/** 既知の bundledBgmId か（検証・移行時のフォールバック判定用）。 */
export function isKnownBundledBgmId(id: unknown): boolean {
  return typeof id === 'string' && BGM_CATALOG.some((b) => b.id === id);
}
