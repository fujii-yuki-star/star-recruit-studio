import { describe, expect, it } from 'vitest';
import { emptyHistory, recordSnapshot, redoSnapshot, undoSnapshot } from './history';

// Undo/Redo の純粋スタック（ADR-0020・#211）。スナップショットは任意の値（ここでは文字列で代表）。
describe('recordSnapshot', () => {
  it('current を past に積み future を捨てる', () => {
    const h = { past: ['a'], future: ['z'] };
    expect(recordSnapshot(h, 'b')).toEqual({ past: ['a', 'b'], future: [] });
  });

  it('上限を超えたら古い方から落とす', () => {
    const h = { past: ['a', 'b', 'c'], future: [] };
    expect(recordSnapshot(h, 'd', 3)).toEqual({ past: ['b', 'c', 'd'], future: [] });
  });
});

describe('undoSnapshot / redoSnapshot', () => {
  it('undo：past 末尾を復元し current を future へ', () => {
    const h = { past: ['a', 'b'], future: [] };
    const r = undoSnapshot(h, 'cur');
    expect(r).not.toBeNull();
    expect(r!.restored).toBe('b');
    expect(r!.history).toEqual({ past: ['a'], future: ['cur'] });
  });

  it('redo：future 末尾を復元し current を past へ', () => {
    const h = { past: ['a'], future: ['cur'] };
    const r = redoSnapshot(h, 'b');
    expect(r!.restored).toBe('cur');
    expect(r!.history).toEqual({ past: ['a', 'b'], future: [] });
  });

  it('past/future が空なら null（戻せない/やり直せない）', () => {
    expect(undoSnapshot({ past: [], future: ['x'] }, 'cur')).toBeNull();
    expect(redoSnapshot({ past: ['x'], future: [] }, 'cur')).toBeNull();
  });

  it('record→undo→redo の往復で元に戻る（代表シナリオ）', () => {
    let h = emptyHistory<string>();
    h = recordSnapshot(h, 's0'); // s0 を積んで s1 へ編集したと仮定
    const u = undoSnapshot(h, 's1')!; // 現在 s1 → s0 へ戻す
    expect(u.restored).toBe('s0');
    const r = redoSnapshot(u.history, 's0')!; // s0 → s1 へやり直す
    expect(r.restored).toBe('s1');
    expect(r.history.past).toEqual(['s0']); // past は復元
  });

  it('undo 後に新しい記録をすると future（やり直し）は消える', () => {
    let h = { past: ['s0'], future: ['s2'] }; // s2 を undo 済み
    h = recordSnapshot(h, 's1b'); // 別編集 → s2 へのやり直しは消える
    expect(h.future).toEqual([]);
    expect(h.past).toEqual(['s0', 's1b']);
  });
});
