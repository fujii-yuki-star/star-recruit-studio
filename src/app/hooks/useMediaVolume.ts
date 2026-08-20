// 動画要素の**音量**（消音・100%超の増幅）。場面形式（`SlotVideo`）とタイムライン形式
// （`TimelineSlotVideo`）が**同じ仕組み**を通る（#512 段2）＝同概念同挙動（ADR-0026②）。
//
// ⚠️ `video.volume` の上限は 1.0 なので、100%超（最大 150%）は Web Audio の GainNode で作る
// ＝書き出し（FFmpeg の `volume=1.5`）と一致させる（#432 P2）。`AudioContext` が無い環境
// （jsdom・古いブラウザ）は `video.volume` に 1.0 クランプでフォールバックする（≤1.0 は元から一致）。
import { useEffect, useRef, type RefObject } from "react";

/**
 * その要素の音量を効かせる。`volume` は 0〜1.5（`muted` で無音）。
 *
 * ⚠️ **一度張ったグラフは unmount まで畳まない**＝`createMediaElementSource` で奪った音声出力は
 * 仕様上 `video.volume` へ戻せないため、増幅が要らなくなっても graph を保ったまま gain で音量を作る
 * （畳むと無音のまま復帰しない）。
 */
export function useMediaVolume(
  ref: RefObject<HTMLVideoElement | null>,
  { volume, muted }: { volume: number; muted: boolean },
): void {
  const audioRef = useRef<{ ctx: AudioContext; gain: GainNode } | null>(null);
  const needsAmp = volume > 1;

  useEffect(() => {
    const v = ref.current;
    if (!v || !needsAmp || audioRef.current) return;
    const AC =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return; // フォールバック（video.volume クランプ）
    try {
      const ctx = new AC();
      const source = ctx.createMediaElementSource(v);
      const gain = ctx.createGain();
      source.connect(gain).connect(ctx.destination);
      audioRef.current = { ctx, gain };
      v.volume = 1; // 素の音量は最大＝最終音量は gain で作る
    } catch { /* 生成失敗は video.volume フォールバック */ }
  }, [ref, needsAmp]);

  // 要素の破棄（unmount）時にだけ AudioContext を閉じる。
  useEffect(
    () => () => {
      void audioRef.current?.ctx.close().catch(() => {});
      audioRef.current = null;
    },
    [],
  );

  // ミュート/音量の即時反映（再生を止めずに）。graph があれば gain（全音量を担当）、無ければ video.volume。
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    const wa = audioRef.current;
    if (wa) {
      wa.gain.gain.value = muted ? 0 : Math.max(0, volume);
      v.muted = false; // 音量は graph に一本化（要素側は素通し）
      void wa.ctx.resume().catch(() => {});
    } else {
      v.muted = muted || volume <= 0;
      v.volume = Math.min(1, Math.max(0, volume));
    }
  }, [ref, muted, volume, needsAmp]);
}
