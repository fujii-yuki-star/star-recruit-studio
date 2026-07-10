// プレビュー再生の音量適用（#452 P1）。UI/正典の音量域は 0.0〜1.5（domain/constants）。HTMLMediaElement.volume は
// 上限 1.0 のため、100%超は Web Audio の GainNode で増幅し、書き出し（FFmpeg volume=…）と一致させる
// （ADR-0026「プレビュー=書き出し」）。≤1.0 は要素の .volume で厳密一致＝Web Audio 不要（autoplay で無音化する
// リスクを既定 100% の常道ケースに持ち込まない）。AudioContext が無い環境（jsdom/古ブラウザ）や生成失敗時は
// .volume の 1.0 クランプにフォールバック（少なくとも下げ方向は一致）。narration/BGM が共有 ctx を使う（生成数を抑える）。

type AudioContextCtor = typeof AudioContext;

function resolveAudioContextCtor(): AudioContextCtor | undefined {
  if (typeof window === "undefined") return undefined;
  return (
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext
  );
}

/** 共有 AudioContext の保持先（PreviewScreen の ref を渡す）。 */
export type AudioCtxRef = { current: AudioContext | null };

/** 再生音量の制御ハンドル。setMuted/setVolume で（再生を止めずに）ミュート・音量を即時反映する（#465/#392）。
 *  ※100% 境界（要素経路↔GainNode 経路）を跨ぐ音量変更は setVolume 単体では切替できない（要素は 1.0 クランプ）。
 *    境界跨ぎの張り直しは呼び出し側の effect（音量>1 の真偽を deps に入れる）で行う＝Option 2「境界で鳴り直す」。 */
export interface VolumeControl {
  setMuted: (muted: boolean) => void;
  setVolume: (volume: number) => void;
}

/**
 * media（audio/video 要素）を volume（0〜1.5）で鳴らす。100%超は共有 AudioContext の GainNode で増幅、
 * 以下は要素 .volume。返す setMuted は経路に応じて gain=0 か .muted を切り替える。初期 muted も適用する。
 */
export function attachVolume(
  ctxRef: AudioCtxRef,
  media: HTMLMediaElement,
  volume: number,
  muted: boolean,
): VolumeControl {
  const vol = Math.max(0, volume);
  if (vol > 1) {
    const Ctor = resolveAudioContextCtor();
    if (Ctor) {
      try {
        if (!ctxRef.current) ctxRef.current = new Ctor();
        const ctx = ctxRef.current;
        const source = ctx.createMediaElementSource(media);
        const gain = ctx.createGain();
        // 現在音量/ミュートをクロージャで保持し、setMuted/setVolume が同じ gain へ即時反映する（#465/#392）。
        let curVol = vol;
        let curMuted = muted;
        const apply = () => {
          gain.gain.value = curMuted ? 0 : curVol;
          void ctx.resume().catch(() => {});
        };
        gain.gain.value = curMuted ? 0 : curVol;
        source.connect(gain).connect(ctx.destination);
        media.volume = 1; // 最終音量は gain が作る（要素側は素通し）
        void ctx.resume().catch(() => {});
        return {
          setMuted: (m: boolean) => { curMuted = m; apply(); },
          // GainNode 経路は 0〜1.5 をそのまま反映（>1.0 の増幅も、100%側への減衰も即時）。
          setVolume: (v: number) => { curVol = Math.max(0, v); apply(); },
        };
      } catch {
        /* 生成/接続失敗（createMediaElementSource の二重取得等）は .volume フォールバックへ */
      }
    }
  }
  // ≤1.0 または Web Audio 不可：要素の .volume（1.0 クランプ）＋ .muted。
  media.volume = Math.min(1, vol);
  media.muted = muted;
  return {
    setMuted: (m: boolean) => { media.muted = m; },
    // 要素経路は 1.0 クランプ（≤100% の変更を即時反映）。>1.0 への変更は境界跨ぎ＝呼び出し側が張り直す（Option 2）。
    setVolume: (v: number) => { media.volume = Math.min(1, Math.max(0, v)); },
  };
}

/** 共有 AudioContext を閉じる（PreviewScreen の unmount 時）。 */
export function closeAudioContext(ctxRef: AudioCtxRef): void {
  void ctxRef.current?.close().catch(() => {});
  ctxRef.current = null;
}
