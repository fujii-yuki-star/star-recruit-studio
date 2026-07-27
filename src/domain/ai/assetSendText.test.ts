import { describe, expect, it } from 'vitest';
import type { Asset } from '../project/types';
import { AI_ASSET_SEND_MAX } from '../constants';
import { assetSendRichness, assetSentText, selectAssetsForSend } from './assetSendText';

const asset = (over: Partial<Asset>): Asset =>
  ({ assetId: 'asset_001', assetType: 'image', displayName: '社屋.jpg', ...over }) as Asset;

// §2-6：送信前確認で「実際に送るテキスト」を見せるための単一の参照元。
// buildVideoPlanRequest の assetBlock と同じフィールドを返す＝画面と送信内容がズレない。
describe('assetSentText（送信されるテキストの抽出・#547 P2-8）', () => {
  it('送るテキスト（名前・説明・AI解析・タグ）を実値で返す', () => {
    const t = assetSentText(asset({
      displayName: '田中さん.jpg', description: '受付前で撮影', aiDescription: '人物1名・屋内', tags: ['社員', '受付'],
    }));
    expect(t).toEqual({
      assetId: 'asset_001', assetType: 'image', name: '田中さん.jpg',
      description: '受付前で撮影', aiDescription: '人物1名・屋内', tags: ['社員', '受付'],
    });
  });

  it('未入力は空文字・空配列に正規化する（前後空白も除く）', () => {
    const t = assetSentText(asset({ displayName: '  ロゴ  ', description: '   ', aiDescription: undefined, tags: ['  a  ', ''] }));
    expect(t.name).toBe('ロゴ');
    expect(t.description).toBe('');
    expect(t.aiDescription).toBe('');
    expect(t.tags).toEqual(['a']); // 空白だけのタグは落とす
  });

  it('タグが全て空白のみなら空配列にする（送信時に「（未入力）」へ倒れる土台）', () => {
    expect(assetSentText(asset({ tags: ['   ', ' ', ''] })).tags).toEqual([]);
  });
});

// 12§6「素材が多い場合は説明・タグの充実した順に上位 N 件（既定 40）を送信し、超過分は送らない旨を log する」（#585）。
// 選定はプロンプト（buildVideoPlanUserMessage）と送信前確認（ConfirmScreen）が共有する＝画面と送信内容がズレない。
describe('selectAssetsForSend（上位N件の選定・12§6・#585）', () => {
  const many = (n: number, over: (i: number) => Partial<Asset> = () => ({})): Asset[] =>
    Array.from({ length: n }, (_, i) => asset({ assetId: `asset_${String(i + 1).padStart(3, '0')}`, ...over(i) }));

  it('上限以下なら全件送り、並べ替えない（見慣れた順のまま）', () => {
    const assets = many(3, (i) => ({ description: i === 0 ? '' : 'あ'.repeat(i * 10) }));
    const r = selectAssetsForSend(assets, 40);
    expect(r.sent).toEqual(assets); // 参照も順序もそのまま
    expect(r.omitted).toEqual([]);
  });

  it('上限ちょうどでも全件送る（境界）', () => {
    const assets = many(40);
    const r = selectAssetsForSend(assets, 40);
    expect(r.sent).toHaveLength(40);
    expect(r.omitted).toEqual([]);
  });

  it('超過したら「説明・タグの充実した順」に上位N件だけ送る', () => {
    // 41件中、末尾1件だけ説明・タグが充実＝説明なしの1件が押し出される。
    const assets = [
      ...many(40, () => ({ description: '' })),
      asset({ assetId: 'asset_rich', description: '受付前で撮影した明るい写真', tags: ['社員', '受付'] }),
    ];
    const r = selectAssetsForSend(assets, 40);
    expect(r.sent.map((a) => a.assetId)).toContain('asset_rich'); // 充実している方が残る
    expect(r.sent).toHaveLength(40);
    expect(r.omitted).toHaveLength(1);
  });

  it('送る分・送らない分とも元の並び順で返す（一覧の見え方を崩さない）', () => {
    const assets = [
      asset({ assetId: 'asset_001', description: '' }),
      asset({ assetId: 'asset_002', description: '詳しい説明' }),
      asset({ assetId: 'asset_003', description: '' }),
      asset({ assetId: 'asset_004', description: 'これも詳しい説明' }),
    ];
    const r = selectAssetsForSend(assets, 2);
    expect(r.sent.map((a) => a.assetId)).toEqual(['asset_002', 'asset_004']); // 元の並び（002→004）
    expect(r.omitted.map((a) => a.assetId)).toEqual(['asset_001', 'asset_003']);
  });

  it('同点は元の並びを保つ（安定＝同じ入力なら毎回同じ結果）', () => {
    const assets = many(5, () => ({ description: '同じ説明' })); // 全て同点
    const r = selectAssetsForSend(assets, 3);
    expect(r.sent.map((a) => a.assetId)).toEqual(['asset_001', 'asset_002', 'asset_003']);
    expect(r.omitted.map((a) => a.assetId)).toEqual(['asset_004', 'asset_005']);
  });

  it('送る分と送らない分は重複せず、合計が元の件数（取りこぼし・二重送信をしない）', () => {
    const assets = many(50, (i) => ({ description: i % 3 === 0 ? 'せつめい' : '' }));
    const r = selectAssetsForSend(assets, 40);
    expect(r.sent).toHaveLength(40);
    expect(r.omitted).toHaveLength(10);
    expect(new Set([...r.sent, ...r.omitted].map((a) => a.assetId)).size).toBe(50);
  });

  it('既定の上限は AI_ASSET_SEND_MAX（12§6 の N=40・直書きしない）', () => {
    const r = selectAssetsForSend(many(AI_ASSET_SEND_MAX + 5));
    expect(r.sent).toHaveLength(AI_ASSET_SEND_MAX);
    expect(r.omitted).toHaveLength(5);
  });
});

describe('assetSendRichness（充実度＝説明・タグの充実した順・#585）', () => {
  const t = (over: Partial<Asset>) => assetSentText(asset(over));

  it('説明・AI解析・タグが有るほど高い', () => {
    const none = assetSendRichness(t({ description: '', aiDescription: '', tags: [] }));
    const desc = assetSendRichness(t({ description: '説明あり' }));
    const both = assetSendRichness(t({ description: '説明あり', aiDescription: '解析あり' }));
    const withTags = assetSendRichness(t({ description: '説明あり', aiDescription: '解析あり', tags: ['a', 'b'] }));
    expect(none).toBeLessThan(desc);
    expect(desc).toBeLessThan(both);
    expect(both).toBeLessThan(withTags);
  });

  it('名前（ファイル名）では差がつかない＝取り込みで必ず付くので順位に効かせない', () => {
    const short = assetSendRichness(t({ displayName: 'a.jpg' }));
    const long = assetSendRichness(t({ displayName: 'とても長いファイル名'.repeat(10) }));
    expect(short).toBe(long);
  });

  it('長文1件が他を押しのけないよう長さは頭打ちにする', () => {
    const normal = assetSendRichness(t({ description: 'あ'.repeat(100) }));
    const huge = assetSendRichness(t({ description: 'あ'.repeat(10000) }));
    expect(huge).toBe(normal);
  });
});
