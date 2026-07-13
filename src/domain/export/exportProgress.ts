// 書き出しの進捗イベント（#376）。Rust の export_video が phase ごとに emit し、ExportScreen が encoding 段のバーを
// 実進捗（80→100%）で描く。純粋関数（副作用なし・§7 テスト対象）。UI 文言は非技術者向け（§2-3・「テロップ」→「字幕」）。

/** 書き出し中の段階。encode＝場面ごとエンコード（step/total 有効）／join＝結合／telop＝字幕合成／bgm＝BGM合成。 */
export type ExportPhase = 'encode' | 'join' | 'telop' | 'bgm';

/** Rust から届く進捗イベント（"export_progress"）。step/total は encode のみ有効（他は 0）。 */
export interface ExportProgressEvent {
  phase: ExportPhase;
  step: number;
  total: number;
}

// レンダリング段（場面フレーム焼き）が 0–80%、エンコード段（結合・字幕・BGM）が 80–100% を受け持つ（#391/#376）。
const ENCODE_BASE = 80;
// 各段の到達点（%）。encode は step/total で 80→92 を滑らかに、後段は段階的に上げる。100 は完了(done)時に別途。
const ENCODE_SPAN = 12; // 80→92
const JOIN_PCT = 94;
const TELOP_PCT = 96;
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
    case 'telop':
      return TELOP_PCT;
    case 'bgm':
      return BGM_PCT;
  }
}

/** 進捗イベント→ 利用者向けの状態文言（§2-3：技術用語を出さない）。 */
export function exportPhaseLabel(e: ExportProgressEvent): string {
  switch (e.phase) {
    case 'encode':
      return e.total > 1 ? `映像を作成しています（${Math.min(e.step, e.total)}/${e.total}）` : '映像を作成しています';
    case 'join':
      return 'つなぎ合わせています';
    case 'telop':
      return '字幕を重ねています';
    case 'bgm':
      return 'BGMを合わせています';
  }
}
