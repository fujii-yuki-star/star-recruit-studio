// 読み方辞書（ADR-0037・#350）の純粋な部分。
import { describe, expect, it } from 'vitest';
import {
  accentCandidates,
  accentMark,
  defaultAccentType,
  isValidYomi,
  mergeDict,
  normalizeSurface,
  planDictSync,
  replaceEntries,
  splitMorae,
  type EngineWord,
  type ReadingEntry,
} from './readingDict';

const e = (surface: string, yomi: string, accentType = 0): ReadingEntry => ({ surface, yomi, accentType });
const w = (uuid: string, surface: string, yomi: string, accentType = 0): EngineWord => ({ uuid, surface, yomi, accentType });

describe('normalizeSurface', () => {
  it('空白・全角空白を落とす（言葉で突き合わせるため）', () => {
    expect(normalizeSurface(' 株式会社　すたりお ')).toBe('株式会社すたりお');
  });
});

describe('planDictSync：エンジンへ映す計画', () => {
  it('エンジンに無い語は足す', () => {
    const plan = planDictSync([e('宇都宮', 'ウツノミヤ', 4)], []);
    expect(plan.ops).toEqual([{ kind: 'add', entry: e('宇都宮', 'ウツノミヤ', 4) }]);
    expect(plan.conflicts).toEqual([]);
  });

  it('控えが当たって読みも同じなら何も送らない（控えは保つ）', () => {
    const plan = planDictSync([e('宇都宮', 'ウツノミヤ', 4)], [w('u1', '宇都宮', 'ウツノミヤ', 4)], { 宇都宮: 'u1' });
    expect(plan.ops).toEqual([]);
    expect(plan.links).toEqual({ 宇都宮: 'u1' });
  });

  it('控えが当たって読みが違えば直す', () => {
    const plan = planDictSync([e('宇都宮', 'ウツノミヤ', 4)], [w('u1', '宇都宮', 'ウツノミヤ', 0)], { 宇都宮: 'u1' });
    expect(plan.ops).toEqual([{ kind: 'update', uuid: 'u1', entry: e('宇都宮', 'ウツノミヤ', 4) }]);
  });

  /**
   * ⚠️ **実測（ADR-0037 決定3b）＝未知の uuid への `PUT`/`DELETE` は `422`**。別PCへ持ち込む・
   * エンジンを入れ直すと控えは通用しないので、**言葉で引き直す**。
   *
   * ⚠️ **控えが当たらなかった語は「他人の語かもしれない」**（PR #883 再レビュー 🔴）。
   * 覚えは「その言葉について過去に何か作った」ことしか示さず、**いま当たった語が自分のものだ**とは
   * 示さない。実際に起きうる筋道＝アプリが登録 → エンジンを入れ直して控えが消える →
   * その言葉を**別の主体**が独立に登録 → 同期すると言葉で当たるのは**他人の語**。
   */
  it('控えが当たらなければ、覚えがあっても控えを付け替えない（他人の語かもしれない）', () => {
    const plan = planDictSync([e('宇都宮', 'ウツノミヤ', 4)], [w('他人のuuid', '宇都宮', 'ウツノミヤ', 4)], { 宇都宮: '古いuuid' });
    expect(plan.ops).toEqual([]);
    expect(plan.links).toEqual({}); // 消してよい語の名簿に載せない
    expect(plan.adopted).toEqual(['宇都宮']);
  });

  it('控えが当たらず読みも違えば、覚えがあっても上書きしない（知らせて選ばせる）', () => {
    const plan = planDictSync([e('宇都宮', 'ウツノミヤ', 4)], [w('他人のuuid', '宇都宮', 'ウツノミヤ', 0)], { 宇都宮: '古いuuid' });
    expect(plan.ops).toEqual([]);
    expect(plan.conflicts).toEqual([{ entry: e('宇都宮', 'ウツノミヤ', 4), engine: w('他人のuuid', '宇都宮', 'ウツノミヤ', 0) }]);
  });

  /** 控えを付け替えた語を一覧から外しても、他人の語は消さない（上の続き）。 */
  it('付け替えなかった語は、一覧から外しても消す操作を出さない', () => {
    const first = planDictSync([e('宇都宮', 'ウツノミヤ', 4)], [w('他人のuuid', '宇都宮', 'ウツノミヤ', 4)], { 宇都宮: '古いuuid' });
    const second = planDictSync([], [w('他人のuuid', '宇都宮', 'ウツノミヤ', 4)], first.links);
    expect(second.ops).toEqual([]);
  });

  /**
   * ⚠️ **決定3＝控えは「消してよい語の名簿」でもある**。言葉で引いて同じ読みだっただけの語を
   * 控えへ入れると、アプリの一覧から外したときに**利用者が VOICEVOX 本体で入れた語を消してしまう**
   *（辞書は OS 上の共有ファイル＝取り戻せない）。
   */
  it('覚えの無い語は、同じ読みで既にあっても控えに入れない（本体の語を消す名簿に載せない）', () => {
    const plan = planDictSync([e('宇都宮', 'ウツノミヤ', 4)], [w('本体のuuid', '宇都宮', 'ウツノミヤ', 4)]);
    expect(plan.ops).toEqual([]);
    expect(plan.links).toEqual({});
    expect(plan.adopted).toEqual(['宇都宮']);
  });

  it('覚えの無い語をアプリの一覧から外しても、本体の語は消さない（上のケースの続き）', () => {
    // 1回目：同じ読みで既にあった＝控えに入らない。
    const first = planDictSync([e('宇都宮', 'ウツノミヤ', 4)], [w('本体のuuid', '宇都宮', 'ウツノミヤ', 4)]);
    // 2回目：一覧から外した。控えが空なので消す操作は出ない。
    const second = planDictSync([], [w('本体のuuid', '宇都宮', 'ウツノミヤ', 4)], first.links);
    expect(second.ops).toEqual([]);
  });

  /** ⚠️ 自分の語と見るのは**控えた uuid に実際に当たったとき**だけ（安全側の縮小）。 */
  it('控えが当たれば自分の語＝読みが違えば直す', () => {
    const plan = planDictSync([e('宇都宮', 'ウツノミヤ', 4)], [w('u1', '宇都宮', 'ウツノミヤ', 0)], { 宇都宮: 'u1' });
    expect(plan.ops).toEqual([{ kind: 'update', uuid: 'u1', entry: e('宇都宮', 'ウツノミヤ', 4) }]);
    expect(plan.conflicts).toEqual([]);
  });

  /** ⚠️ 決定3b＝利用者が VOICEVOX 本体で入れた読みを、アプリが勝手に書き換えない。 */
  it('言葉は同じで読みが違い、アプリが入れた覚えが無ければ黙って上書きしない', () => {
    const plan = planDictSync([e('宇都宮', 'ウツノミヤ', 4)], [w('u1', '宇都宮', 'ウツノミヤ', 1)]);
    expect(plan.ops).toEqual([]);
    expect(plan.conflicts).toEqual([{ entry: e('宇都宮', 'ウツノミヤ', 4), engine: w('u1', '宇都宮', 'ウツノミヤ', 1) }]);
  });

  /** ⚠️ 決定3＝他の VOICEVOX の辞書を壊さない（丸ごと入れ替えない・知らない語に触らない）。 */
  it('エンジンにしか無い語は消さない（利用者が本体で入れた語を壊さない）', () => {
    const plan = planDictSync([], [w('他', 'ずんだ', 'ズンダ', 1)]);
    expect(plan.ops).toEqual([]);
  });

  it('アプリが入れた語が辞書から消えたら、エンジンからも消す', () => {
    const plan = planDictSync([], [w('u1', '宇都宮', 'ウツノミヤ', 4)], { 宇都宮: 'u1' });
    expect(plan.ops).toEqual([{ kind: 'remove', uuid: 'u1', surface: '宇都宮' }]);
  });

  it('控えはあるがエンジンにも無いなら、消す操作は出さない（することが無い）', () => {
    expect(planDictSync([], [], { 宇都宮: 'u1' }).ops).toEqual([]);
  });

  it('空の言葉は送らない（登録できない）', () => {
    expect(planDictSync([e('  ', 'ウツノミヤ')], []).ops).toEqual([]);
  });

  it('同じ言葉が2つあっても1回しか送らない（重複を作らない）', () => {
    const plan = planDictSync([e('宇都宮', 'ウツノミヤ', 4), e('宇都宮', 'ウツノミヤ', 4)], []);
    expect(plan.ops).toHaveLength(1);
  });

  it('言葉は空白を落としてから突き合わせる（見た目が違うだけの語を二重登録しない）', () => {
    const plan = planDictSync([e(' 宇都宮 ', 'ウツノミヤ', 4)], [w('u1', '宇都宮', 'ウツノミヤ', 4)], { 宇都宮: 'u1' });
    expect(plan.ops).toEqual([]);
  });
});

describe('mergeDict：読み込みは足す（決定8）', () => {
  it('無い語は足す', () => {
    const r = mergeDict([e('あ', 'ア')], [e('い', 'イ')]);
    expect(r.merged.map((x) => x.surface)).toEqual(['あ', 'い']);
    expect(r.duplicates).toEqual([]);
  });

  /** ⚠️ 利用者判断（2026-08-26）＝同じ言葉があるとき黙って上書きしない。 */
  it('同じ言葉で読みが違うものは足さず、重なりとして返す（選ばせる）', () => {
    const r = mergeDict([e('宇都宮', 'ウツノミヤ', 0)], [e('宇都宮', 'ウツノミヤ', 4)]);
    expect(r.merged).toEqual([e('宇都宮', 'ウツノミヤ', 0)]);
    expect(r.duplicates).toEqual([{ current: e('宇都宮', 'ウツノミヤ', 0), incoming: e('宇都宮', 'ウツノミヤ', 4) }]);
  });

  it('読みまで同じなら重なりに出さない（選ばせることが無い）', () => {
    const r = mergeDict([e('宇都宮', 'ウツノミヤ', 4)], [e('宇都宮', 'ウツノミヤ', 4)]);
    expect(r.duplicates).toEqual([]);
    expect(r.merged).toHaveLength(1);
  });

  /** ⚠️ 決定3b＝控えは渡した先で通用しない。語の入れ物に uuid が無いので**混ざりようがない**。 */
  it('読み込んだ語は言葉・読み・下がる場所だけになる（余計なものを持ち込まない）', () => {
    const dirty = { surface: 'あ', yomi: 'ア', accentType: 0, engineWordUuid: 'u1' } as unknown as ReadingEntry;
    expect(mergeDict([], [dirty]).merged).toEqual([{ surface: 'あ', yomi: 'ア', accentType: 0 }]);
  });
});

describe('replaceEntries：選んだものだけ置き換える', () => {
  it('選んだ語だけ入れ替え、選ばなかった語は触らない', () => {
    const r = replaceEntries([e('あ', 'ア'), e('い', 'イ')], [e('あ', 'アー', 1)]);
    expect(r).toEqual([e('あ', 'アー', 1), e('い', 'イ')]);
  });
});

describe('音の粒と下がる場所（決定6＝用語を画面に出さない）', () => {
  it('小さいカナは直前とひとまとまり、伸ばす・詰まる・はねる音はそれぞれ1つ', () => {
    expect(splitMorae('キョウト')).toEqual(['キョ', 'ウ', 'ト']);
    expect(splitMorae('ラーメン')).toEqual(['ラ', 'ー', 'メ', 'ン']);
    expect(splitMorae('ガッコウ')).toEqual(['ガ', 'ッ', 'コ', 'ウ']);
  });

  it('候補は 0（下がらない）から粒の数まで', () => {
    expect(accentCandidates('ウツノミヤ')).toEqual([0, 1, 2, 3, 4, 5]);
    expect(accentCandidates('')).toEqual([0]);
  });

  it('既定は先頭で下がる形', () => {
    expect(defaultAccentType('ウツノミヤ')).toBe(1);
    expect(defaultAccentType('')).toBe(0);
  });

  it('下がる場所を印で見せる（0＝印なし）', () => {
    expect(accentMark('ウツノミヤ', 0)).toBe('ウツノミヤ');
    expect(accentMark('ウツノミヤ', 1)).toBe('ウ↓ツノミヤ');
    expect(accentMark('ウツノミヤ', 4)).toBe('ウツノミ↓ヤ');
    expect(accentMark('ウツノミヤ', 5)).toBe('ウツノミヤ↓');
    expect(accentMark('キョウト', 1)).toBe('キョ↓ウト'); // 小さいカナは割らない
  });

  it('粒の数を超える指定は印を出さない（壊れたデータで文字を落とさない）', () => {
    expect(accentMark('アイ', 9)).toBe('アイ');
  });

  it('読みはカタカナ（伸ばす音を含む）だけ受け付ける', () => {
    expect(isValidYomi('ウツノミヤ')).toBe(true);
    expect(isValidYomi('ラーメン')).toBe(true);
    expect(isValidYomi('うつのみや')).toBe(false);
    expect(isValidYomi('宇都宮')).toBe(false);
    expect(isValidYomi('')).toBe(false);
  });
});
