import { describe, expect, it } from 'vitest';
import type { Scene } from '../project/types';
import { clearPendingNarrations, isNarrationGenerating, narrationProgress } from './narrationProgress';

function scene(id: string, text: string, status: Scene['narration']['status']): Scene {
  return {
    sceneId: id, partId: 'part_001', order: 1, sceneType: 'opening', templateId: 't',
    durationSec: 8, assetRefs: {}, character: { enabled: false, characterId: 'yuko' },
    texts: {}, narration: { text, status }, warnings: [],
  };
}

describe('narrationProgress', () => {
  it('対象＝本文非空の場面、done＝生成済み数', () => {
    const scenes = [
      scene('s1', 'あ', 'generated'),
      scene('s2', 'い', 'pending'),
      scene('s3', '', 'none'), // 本文空＝対象外
      scene('s4', 'え', 'failed'),
    ];
    expect(narrationProgress(scenes)).toEqual({ done: 1, total: 3 });
  });

  it('空白のみの本文は対象外', () => {
    expect(narrationProgress([scene('s1', '   ', 'none')])).toEqual({ done: 0, total: 0 });
  });

  it('空配列は 0/0', () => {
    expect(narrationProgress([])).toEqual({ done: 0, total: 0 });
  });

  it('掛け合い：lines は行ごとに集計（本文非空の行のみ・narration は無視）', () => {
    const s: Scene = {
      ...scene('s1', 'ignored', 'none'),
      lines: [
        { lineId: 'line_001', text: 'やあ', status: 'generated' },
        { lineId: 'line_002', text: 'どうも', status: 'pending' },
        { lineId: 'line_003', text: '', status: 'none' }, // 本文空＝対象外
      ],
    };
    expect(narrationProgress([s])).toEqual({ done: 1, total: 2 });
  });
});

describe('isNarrationGenerating（書き出し開始のブロック判定・#570 P1 レビュー・#547 P2-6）', () => {
  it('pending の場面があれば true（生成中）', () => {
    expect(isNarrationGenerating([scene('s1', 'あ', 'generated'), scene('s2', 'い', 'pending')])).toBe(true);
  });
  it('pending が無ければ false（none/generated/failed）', () => {
    expect(isNarrationGenerating([scene('s1', 'あ', 'generated'), scene('s2', 'い', 'none'), scene('s3', 'う', 'failed')])).toBe(false);
  });
  it('掛け合いは行の pending を見る（sceneLines・pending 行を取りこぼさない）', () => {
    const dlg = {
      ...scene('d', '', 'none'),
      lines: [{ lineId: 'l1', text: 'A', status: 'generated' }, { lineId: 'l2', text: 'B', status: 'pending' }],
    } as Scene;
    expect(isNarrationGenerating([dlg])).toBe(true);
  });
  it('掛け合いで pending 行が無ければ false（生成完了/未生成のみ）', () => {
    const dlg = {
      ...scene('d', '', 'none'),
      lines: [{ lineId: 'l1', text: 'A', status: 'generated' }, { lineId: 'l2', text: 'B', status: 'none' }],
    } as Scene;
    expect(isNarrationGenerating([dlg])).toBe(false);
  });
});

describe('clearPendingNarrations（一括作成の中止・#547 P2-6）', () => {
  it('単一 narration の準備中を未作成へ戻す（他の状態は触らない）', () => {
    const out = clearPendingNarrations([
      scene('s1', 'あ', 'pending'),
      scene('s2', 'い', 'generated'),
      scene('s3', 'う', 'failed'),
    ]);
    expect(out.map((s) => s.narration.status)).toEqual(['none', 'generated', 'failed']);
  });

  it('掛け合いは準備中の行だけ戻す（生成済みの声は残る）', () => {
    const dlg = {
      ...scene('d', '', 'none'),
      lines: [
        { lineId: 'l1', text: 'A', status: 'generated' },
        { lineId: 'l2', text: 'B', status: 'pending' },
        { lineId: 'l3', text: 'C', status: 'pending' },
      ],
    } as Scene;
    const out = clearPendingNarrations([dlg]);
    expect(out[0].lines?.map((l) => l.status)).toEqual(['generated', 'none', 'none']);
  });

  it('戻したあとは「生成中」でなくなる＝書き出しのブロックが解ける', () => {
    const scenes = [scene('s1', 'あ', 'pending')];
    expect(isNarrationGenerating(scenes)).toBe(true);
    expect(isNarrationGenerating(clearPendingNarrations(scenes))).toBe(false);
  });

  it('進捗の done は減らない（作成済みを取り消さない）', () => {
    const scenes = [scene('s1', 'あ', 'generated'), scene('s2', 'い', 'pending')];
    expect(narrationProgress(clearPendingNarrations(scenes))).toEqual({ done: 1, total: 2 });
  });

  it('準備中が無ければ同一参照を返す（無用な未保存を作らない）', () => {
    const scenes = [scene('s1', 'あ', 'generated'), scene('s2', 'い', 'none')];
    expect(clearPendingNarrations(scenes)).toBe(scenes);
  });

  it('掛け合いで準備中が無ければ場面オブジェクトも同一参照', () => {
    const dlg = {
      ...scene('d', '', 'none'),
      lines: [{ lineId: 'l1', text: 'A', status: 'generated' }],
    } as Scene;
    const scenes = [dlg];
    expect(clearPendingNarrations(scenes)).toBe(scenes);
  });
});
