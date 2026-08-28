// 書き出しの進捗イベント（#376）。Rust の export_video が phase ごとに emit し、ExportScreen が encoding 段のバーを
// 実進捗（80→100%）で描く。純粋関数（副作用なし・§7 テスト対象）。UI 文言は非技術者向け（§2-3）。

/**
 * 書き出し中の段階。encode＝場面ごとエンコード（step/total 有効）／join＝結合／bgm＝BGM合成／
 * loudness＝音量をそろえるだけ（BGM 無し・#259）。
 * ⚠️ **BGM が無いのに「BGMを合わせています」と出さない**（PR #896 レビュー ℹ️）＝
 * 音を整えるだけでも同じ段を通るので、段を分けて事実どおりの文言にする（§2-5）。
 * 旧・タイムラインのテロップ合成（`telop`）は #635 で退役＝**誰も emit しない段は持たない**（#663）。
 */
export type ExportPhase = 'encode' | 'join' | 'bgm' | 'loudness';

/** Rust から届く進捗イベント（"export_progress"）。step/total は encode のみ有効（他は 0）。 */
export interface ExportProgressEvent {
  phase: ExportPhase;
  step: number;
  total: number;
}

// レンダリング段（場面フレーム焼き）が 0–80%、エンコード段（結合・BGM）が 80–100% を受け持つ（#391/#376）。
const ENCODE_BASE = 80;
// 各段の到達点（%）。encode は step/total で 80→92 を滑らかに、後段は段階的に上げる。100 は完了(done)時に別途。
const ENCODE_SPAN = 12; // 80→92
const JOIN_PCT = 94;
const BGM_PCT = 98;

/**
 * 進捗イベント→ encoding 段のバーの % （80–98）。encode は step/total を按分、後段は固定点。
 * total=0（想定外）や step>total でも 80–98 に収まるようクランプする。完了(100%)は phase では出さない（done で出す）。
 */
export function exportEncodePercent(e: ExportProgressEvent): number {
  switch (e.phase) {
    case 'encode': {
      if (e.total <= 0) return ENCODE_BASE;
      const ratio = Math.min(1, Math.max(0, e.step / e.total));
      return ENCODE_BASE + Math.round(ratio * ENCODE_SPAN);
    }
    case 'join':
      return JOIN_PCT;
    case 'bgm':
    case 'loudness':
      return BGM_PCT; // 同じ段（音を作る）なので進み具合は同じ
  }
}

/** 進捗イベント→ 利用者向けの状態文言（§2-3：技術用語を出さない）。 */
export function exportPhaseLabel(e: ExportProgressEvent): string {
  switch (e.phase) {
    case 'encode':
      return e.total > 1 ? `映像を作成しています（${Math.min(e.step, e.total)}/${e.total}）` : '映像を作成しています';
    case 'join':
      return 'つなぎ合わせています';
    case 'bgm':
      return 'BGMを合わせています';
    case 'loudness':
      return '音量をそろえています';
  }
}

/**
 * 書き出しジョブの状態（実行時のみ・`project.json` には持たない＝`15 §1`）。
 * ここを**単一の参照元**にし、store の `ExportPhase` はこれを別名にする（§2-7）。`phase: string` にすると
 * 値を rename しても型エラーにならず、進捗が黙って 0% に落ちる（この差分が潰した「止まって見える」の再発）。
 */
export const EXPORT_RUN_PHASE = {
  idle: 'idle',
  /** 保存先を選んでもらっている（タイムライン形式・#631）。**ここも走行中に数える**＝ダイアログを
   *  開いている間に押し直しても書き出しが二重に走らない。まだ何も描いていないので進捗は出さない。 */
  preparing: 'preparing',
  rendering: 'rendering',
  encoding: 'encoding',
  done: 'done',
  error: 'error',
  unsupported: 'unsupported',
  cancelled: 'cancelled',
} as const;

export const EXPORT_RUN_PHASES = Object.values(EXPORT_RUN_PHASE);
export type ExportRunPhase = (typeof EXPORT_RUN_PHASE)[keyof typeof EXPORT_RUN_PHASE];

/** 書き出しの実行状態のうち、進捗の表示に要る分（`ExportRunState` の部分集合＝domain は store に依存しない）。 */
export interface ExportProgressState {
  phase: ExportRunPhase;
  progress: { done: number; total: number; frameFraction?: number };
  encode?: ExportProgressEvent;
}

/**
 * 書き出し全体の進み具合（0–100%）。
 *
 * レンダリング段が 0–80%、エンコード段が 80–100%（`exportEncodePercent`）。書き出し画面のバーと、
 * 他画面に出す「書き出し中」バナーが**同じ数字**を出すための単一の参照元（§2-7）。別々に計算すると
 * 画面を移った利用者に違う進捗が見え、止まった/戻ったと誤認させる（ADR-0026②）。
 */
export function exportOverallPercent(run: ExportProgressState): number {
  if (run.phase === 'done') return 100;
  if (run.phase === 'encoding') return run.encode ? exportEncodePercent(run.encode) : ENCODE_BASE;
  if (run.phase === 'rendering' && run.progress.total > 0) {
    // 場面数ベース＋処理中の場面のフレーム進捗で 0〜80% を滑らかに（#391）。
    const done = run.progress.done + (run.progress.frameFraction ?? 0);
    return Math.round((done / run.progress.total) * ENCODE_BASE);
  }
  return 0;
}

/**
 * いま何をしているか（§2-3：技術用語を出さない）。進捗バーに添える1行。
 * 書き出し画面と他画面のバナーで共有する（同じ瞬間に違う説明を出さない・ADR-0026②）。
 *
 * `compact` は**文の途中に差し込む**とき用（バナーは「動画を書き出し中です（80%・◯◯）。」と括弧内に入れる）。
 * 句点で終わる完結文を入れると文の中に文が入れ子になり読みにくいので、その分岐だけ短い語にする。
 */
export function exportProgressLabel(run: ExportProgressState, opts?: { compact?: boolean }): string {
  if (run.phase === 'rendering' && run.progress.total > 0) {
    // done は「完了した場面数」。処理中は +1 した1始まりで読ませる（バーが動くのにカウンタが0のまま、を防ぐ・#391）。
    return `場面 ${Math.min(run.progress.done + 1, run.progress.total)} / ${run.progress.total} を処理中`;
  }
  if (run.phase === 'encoding') {
    if (run.encode) return exportPhaseLabel(run.encode);
    return opts?.compact ? '最後の仕上げ中' : '最後の仕上げ中です。そのままお待ちください。';
  }
  return '';
}

/**
 * 進捗バーに添える見出し（粗い状態）。`06_UI_SPEC §13` の「動画を書き出しています」に合わせる。
 * 段階の細かい説明は `exportProgressLabel` が受け持つ＝見出しと詳細で別の状態名を出さない（ADR-0026②）。
 */
export function exportHeadingLabel(run: ExportProgressState): string {
  if (run.phase === 'done') return '保存しました';
  if (run.phase === 'rendering' || run.phase === 'encoding') return '動画を書き出しています';
  return '';
}

/**
 * 結果が確定して**もう動かない**状態か（`done`/`error`/`cancelled`）。走行中は `isExportBusy`（store）。
 *
 * `unsupported` は入れない：これは「この端末では書き出せない」という**環境の事情**で、書き出した結果ではない。
 * 過去形（前回の…）で示すと「いま押せば書き出せる」と読めてしまう（ADR-0026①）。
 */
export function isExportFinished(phase: ExportRunPhase): boolean {
  return phase === 'done' || phase === 'error' || phase === 'cancelled';
}

/**
 * 書き出し画面に**入った時点で既に終わっていた**結果に添える1行（#547 P3-11）。
 *
 * 実行状態は次の書き出しまで残す（`15 §1` 実行時状態。書き出し中に画面を移っても進捗が見えるように＝#379/P2-1）。
 * そのため画面を離れて戻ると「100%・保存しました」「失敗しました」が**いま起きたことのように**出続け、
 * 直したはずの内容が既に書き出せている／たったいま失敗した、と誤読させる（ADR-0026④）。
 * 過去のことだと分かる言い方にし、そのうえで次の行動（もう一度「動画を保存」）を示す（§2-5）。
 *
 * 走行中・未実行（`idle`/`rendering`/`encoding`/`unsupported`）は空文字＝呼び出し側で phase を場合分けしない。
 */
export function pastExportNotice(phase: ExportRunPhase): string {
  switch (phase) {
    case 'done':
      // 「完了しています」で止めると、そのあとの編集も入っていると読める。保存し直せることまで言う。
      return '前回の書き出しは完了しています。そのあとに動画を直したときは、もう一度「動画を保存」を押すと、いまの内容で保存し直せます。';
    case 'error':
      // 失敗の中身（原因と次の行動）は書き出し画面がこの下に出す。ここは「いつのことか」だけを足す。
      return '前回の書き出しは失敗しました。';
    case 'cancelled':
      return '前回の書き出しは中止しました。もう一度「動画を保存」を押すと、やり直せます。';
    default:
      return '';
  }
}

/**
 * 書き出しが**たったいま終わった**ことを、書き出し画面以外にいる利用者へ伝える1行（#589）。
 *
 * 書き出し中は他の画面へ移動できる設計（`15 §4`）だが、終端になると編集ロックのバナー（`ExportLockBanner`）は
 * 消えるだけだった＝**離席中に失敗しても「消えた＝成功して終わった」と誤読**し、書き出し画面へ戻るまで気づけない。
 * `pastExportNotice`（後から入り直したとき用の**過去形**）とは別物で、こちらは「いま終わった」の**現在形**。
 *
 * 失敗の理由は書き出し画面が持つ（`exportRun.message`）ので、ここでは種別だけを言い切って画面へ誘導する（§2-5）。
 * 走行中・未実行（`idle`/`rendering`/`encoding`/`unsupported`）は空文字＝呼び出し側で phase を場合分けしない。
 */
export function finishedExportNotice(phase: ExportRunPhase): string {
  switch (phase) {
    case 'done':
      return '動画の書き出しが終わりました。';
    case 'error':
      return '動画の書き出しに失敗しました。書き出しの画面で理由を確認してください。';
    case 'cancelled':
      return '動画の書き出しを中止しました。';
    default:
      return '';
  }
}
