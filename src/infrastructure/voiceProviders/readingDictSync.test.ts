// 声を作る直前の同期（ADR-0037 決定2・決定7）。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../readingDictFs', () => ({
  loadReadingDict: vi.fn(),
  saveReadingDict: vi.fn(async () => {}),
  withLinks: (d: unknown, links: unknown) => ({ ...(d as object), links }),
}));
vi.mock('./userDict', () => ({ syncReadingDict: vi.fn() }));

import { loadReadingDict, saveReadingDict } from '../readingDictFs';
import { syncReadingDict } from './userDict';
import { ensureReadingDictSynced, markReadingDictChanged, readingDictConflicts, resetReadingDictSync } from './readingDictSync';

const entry = { surface: '宇都宮', yomi: 'ウツノミヤ', accentType: 4 };

beforeEach(() => {
  resetReadingDictSync();
  vi.mocked(loadReadingDict).mockResolvedValue({ version: 1, entries: [entry], links: {} });
  vi.mocked(syncReadingDict).mockResolvedValue({ links: { 宇都宮: 'u1' }, conflicts: [], applied: 1 });
});
afterEach(() => vi.clearAllMocks());

describe('ensureReadingDictSynced', () => {
  it('そろえたら控えを書き戻す', async () => {
    await ensureReadingDictSynced();
    expect(syncReadingDict).toHaveBeenCalledWith([entry], {});
    expect(saveReadingDict).toHaveBeenCalledWith(expect.objectContaining({ links: { 宇都宮: 'u1' } }));
  });

  /** ⚠️ 一括作成は行ごとに呼ぶ＝毎回 `GET /user_dict` を叩かない。 */
  it('2回目からは何もしない（そろっている）', async () => {
    await ensureReadingDictSynced();
    await ensureReadingDictSynced();
    expect(syncReadingDict).toHaveBeenCalledTimes(1);
  });

  it('辞書を編集したらそろえ直す', async () => {
    await ensureReadingDictSynced();
    markReadingDictChanged();
    await ensureReadingDictSynced();
    expect(syncReadingDict).toHaveBeenCalledTimes(2);
  });

  it('同時に呼ばれても1回だけ走る', async () => {
    await Promise.all([ensureReadingDictSynced(), ensureReadingDictSynced(), ensureReadingDictSynced()]);
    expect(syncReadingDict).toHaveBeenCalledTimes(1);
  });

  it('控えが動いていなければ書かない（更新時刻を無駄に動かさない）', async () => {
    vi.mocked(loadReadingDict).mockResolvedValue({ version: 1, entries: [entry], links: { 宇都宮: 'u1' } });
    await ensureReadingDictSynced();
    expect(saveReadingDict).not.toHaveBeenCalled();
  });

  /**
   * ⚠️ **この機能を使っていない利用者の書き出しを、新しい検査で止めない**。
   * 反映するものが無いので、送れないエンジンでも声は作れる。
   */
  it('辞書が空で控えも無ければエンジンに触らない', async () => {
    vi.mocked(loadReadingDict).mockResolvedValue({ version: 1, entries: [], links: {} });
    await ensureReadingDictSynced();
    expect(syncReadingDict).not.toHaveBeenCalled();
  });

  it('語は無いが控えが残っていればそろえる（消し残しを片づける）', async () => {
    vi.mocked(loadReadingDict).mockResolvedValue({ version: 1, entries: [], links: { 宇都宮: 'u1' } });
    vi.mocked(syncReadingDict).mockResolvedValue({ links: {}, conflicts: [], applied: 1 });
    await ensureReadingDictSynced();
    expect(syncReadingDict).toHaveBeenCalled();
  });

  /** ⚠️ 決定7＝誤読のまま成功にしない。次の行動を出して断る（§2-5）。 */
  it('反映できなければ投げる（次の行動を含む文言で）', async () => {
    vi.mocked(syncReadingDict).mockRejectedValue(new Error('音声ソフトにつながりません。'));
    await expect(ensureReadingDictSynced()).rejects.toThrow(/を確かめてから、もう一度お試しください/);
  });

  it('失敗したら次に呼んだときもう一度そろえにいく（諦めたままにしない）', async () => {
    vi.mocked(syncReadingDict).mockRejectedValueOnce(new Error('だめ'));
    await expect(ensureReadingDictSynced()).rejects.toThrow();
    await ensureReadingDictSynced();
    expect(syncReadingDict).toHaveBeenCalledTimes(2);
  });

  /** ⚠️ 決定3b＝利用者が VOICEVOX 本体で入れた読みを黙って書き換えない＝画面が知らせる。 */
  it('黙って上書きしなかった語を覚えておく', async () => {
    const conflict = { entry, engine: { uuid: 'u9', surface: '宇都宮', yomi: 'ウツノミヤ', accentType: 0 } };
    vi.mocked(syncReadingDict).mockResolvedValue({ links: {}, conflicts: [conflict], applied: 0 });
    await ensureReadingDictSynced();
    expect(readingDictConflicts()).toEqual([conflict]);
  });
});
