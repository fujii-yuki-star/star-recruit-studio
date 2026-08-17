import { describe, expect, it, vi } from 'vitest';
import { emitProjectDeleted, onProjectDeleted } from './projectDeletion';

// #763-4：知らせるだけでは足りない。受け手が「もう書かない」状態になっても、**すでに発行済みの
// 書き込み**はバックエンドで走っており、消した**後**に着地しうる＝`save_project` がフォルダごと
// 作り直して「素材と声だけ消えた動画が一覧へ戻る」。受け手の約束を集めて待つのがここの仕事。

describe('emitProjectDeleted（消える前に全員が手放し、書き込みの着地を待つ・#763-4）', () => {
  it('受け手が返した「進行中の書き込み」の着地を待つ', async () => {
    let land = (): void => { /* 着地させる前は何もしない */ };
    const off = onProjectDeleted(() => ({ pending: new Promise<void>((resolve) => { land = (): void => resolve(); }) }));
    try {
      let done = false;
      const emitting = emitProjectDeleted('proj_20260101_001').then(() => { done = true; });
      await new Promise((r) => setTimeout(r, 0));
      expect(done).toBe(false); // まだ待っている＝この間に消してはいけない

      land();
      await emitting;
      expect(done).toBe(true);
    } finally {
      land();
      off();
    }
  });

  it('何も返さない受け手は待たない（待つものが無ければすぐ戻る）', async () => {
    const off = onProjectDeleted(() => { /* 同期で片づけるだけ */ });
    try {
      // 戻り値は「消せなかったときに元へ戻す手」＝待つものが無くても必ず返る。
      await expect(emitProjectDeleted('proj_20260101_001')).resolves.toBeInstanceOf(Function);
    } finally {
      off();
    }
  });

  it('**失敗した書き込みも待つ**（着地したことだけが要る＝消す側を止めない）', async () => {
    const off = onProjectDeleted(() => ({ pending: Promise.reject(new Error('書けなかった')) }));
    try {
      // 失敗を投げ返すと消す側が止まり、**消せないまま壊れた動画が一覧に残る**。
      await expect(emitProjectDeleted('proj_20260101_001')).resolves.toBeInstanceOf(Function);
    } finally {
      off();
    }
  });

  it('受け手が投げても他の受け手には伝える（1つの失敗で残りが片づかない、を作らない）', async () => {
    const ok = vi.fn();
    const offBad = onProjectDeleted(() => { throw new Error('受け手の都合'); });
    const offOk = onProjectDeleted(ok);
    try {
      await emitProjectDeleted('proj_20260101_001');
      expect(ok).toHaveBeenCalledWith('proj_20260101_001');
    } finally {
      offBad(); offOk();
    }
  });

  it('複数の受け手の着地を**すべて**待つ（片方だけ待って消さない）', async () => {
    const lands: (() => void)[] = [];
    const make = () => onProjectDeleted(() => ({ pending: new Promise<void>((resolve) => { lands.push((): void => resolve()); }) }));
    const offs = [make(), make()];
    try {
      let done = false;
      const emitting = emitProjectDeleted('proj_20260101_001').then(() => { done = true; });
      await new Promise((r) => setTimeout(r, 0));

      lands[0](); // 片方だけ着地
      await new Promise((r) => setTimeout(r, 0));
      expect(done).toBe(false);

      lands[1]();
      await emitting;
      expect(done).toBe(true);
    } finally {
      lands.forEach((l) => l());
      offs.forEach((o) => o());
    }
  });

  it('外した受け手には伝えない（付けっぱなしにしない）', async () => {
    const fn = vi.fn();
    onProjectDeleted(fn)();
    await emitProjectDeleted('proj_20260101_001');
    expect(fn).not.toHaveBeenCalled();
  });
});
