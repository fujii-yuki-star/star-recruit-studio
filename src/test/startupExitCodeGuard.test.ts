import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * 終了コードが**呼んだ側へ届く**形のままかを見る門番（ADR-0042 決定④・#1184）。
 *
 * ⚠️ **なぜ要るか**＝`AppHandle::exit(code)` は**コードを捨てる**
 * （`tauri-runtime-wry 2.11` の `request_exit` は `ControlFlow::Exit`＝0 固定）。
 * 実機で「居ない動画を指しても 0 が返る」＝**AI から見ると失敗も成功に見える**状態だった。
 * 戻してしまっても**テストは緑のまま**（プロセスの終了コードは単体テストに出ない）ので、
 * ここで**書き方そのもの**を留める。
 *
 * ⚠️ **後片づけの通り道も数える**＝自分で落とすと `RunEvent::ExitRequested` が走らないので、
 * 通さないと同梱 ENGINE が居残り（#149）、`ffmpeg.exe` が孤児になる（#380）。
 */
const SRC = 'src-tauri/src/lib.rs';

/**
 * 頼まれごとの締めの関数だけを切り出す（純粋＝門番自身を壊して確かめられる）。
 *
 * ⚠️ **説明の行は落とす**＝ここでは「やってはいけない書き方」を説明文に書くので、
 * 落とさないと**説明を書いただけで門番が鳴る**（実際に鳴った）。
 */
export function finishJobBody(rust: string): string {
  const head = rust.indexOf('fn finish_startup_job(');
  if (head < 0) return '';
  const end = rust.indexOf('\nfn ', head);
  return rust
    .slice(head, end < 0 ? rust.length : end)
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n');
}

describe('頼まれごとの終了コードが、呼んだ側へ届く形のままか（#1184）', () => {
  const rust = readFileSync(SRC, 'utf8');
  const body = finishJobBody(rust);

  it('締めの関数が見つかる（走査が空振りしていない）', () => {
    expect(body).toContain('quit_when_done');
  });

  it('⚠️ `app.exit(` を使っていない（コードが捨てられる）', () => {
    expect(body).not.toContain('app.exit(');
  });

  it('自分で終了コードを渡して落としている', () => {
    expect(body).toContain('std::process::exit(code)');
  });

  it('落とす前に後片づけを通している', () => {
    expect(body).toContain('shutdown_side_processes(&app)');
    expect(body).toContain('cleanup_before_exit()');
  });

  // ⚠️ **実数で留める**＝「呼んでいる所が1つ以上」だと、片方の道から消えても緑のまま。
  it('後片づけは、終わる道2つの**両方**から呼ばれている（実数で留める）', () => {
    const calls = rust.split('shutdown_side_processes(').length - 1;
    expect(calls, '後片づけの呼び出し数（定義1＋呼び出し2）').toBe(3);
  });

  describe('門番自身の検査（わざと壊した入力を通す）', () => {
    it('締めの関数が無ければ空を返す（空振りを緑にしない）', () => {
      expect(finishJobBody('fn other() {}')).toBe('');
    });

    it('説明の行に書いた「やってはいけない書き方」では鳴らない', () => {
      const fake = 'fn finish_startup_job() {\n  // app.exit( は使わない\n  よい\n}\n';
      expect(finishJobBody(fake)).not.toContain('app.exit(');
      expect(finishJobBody(fake)).toContain('よい');
    });

    it('次の関数まで飲み込まない', () => {
      const fake = 'fn finish_startup_job(a: u8) {\n  ここ\n}\nfn next_one() {\n  よそ\n}\n';
      expect(finishJobBody(fake)).toContain('ここ');
      expect(finishJobBody(fake)).not.toContain('よそ');
    });
  });
});
