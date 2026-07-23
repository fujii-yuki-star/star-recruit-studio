import { describe, expect, it } from 'vitest';
import type { Asset } from '../project/types';
import { assetSentText } from './assetSendText';

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
