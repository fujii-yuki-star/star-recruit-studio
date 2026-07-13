// プレビュー再生の音量適用（#452 P1）。UI/正典の音量域は 0.0〜1.5（domain/constants）。HTMLMediaElement.volume は
// 上限 UNITY_VOLUME(1.0) のため、100%超は Web Audio の GainNode で増幅し、書き出し（FFmpeg volume=…）と一致させる
// （ADR-0026「プレビュー=書き出し」）。≤1.0 は要素の .volume で厳密一致＝Web Audio 不要（autoplay で無音化する
// リスクを既定 100% の常道ケースに持ち込まない）。AudioContext が無い環境（jsdom/古ブラウザ）や生成失敗時は
// .volume の 1.0 クランプにフォールバック（少なくとも下げ方向は一致）。narration/BGM が共有 ctx を使う（生成数を抑える）。
//
// 再生中の音量変更（#465/#392）は setVolume で即時反映する。100% 境界（要素 .volume ↔ GainNode）を跨ぐ変更も、
// 要素を GainNode 経路へ**その場で載せ替える**（media.currentTime を保つ＝頭出ししない）ことで扱い、音声だけ場面頭へ
// 戻る不整合（映像/アニメ/テロップの時計と乖離）を作らない。一度 GainNode 化したら以後も維持する（0〜1.5 を素通し）。
import { clampVolume } from "../../domain/voice/audioMix";
import { UNITY_VOLUME } from "../../domain/constants";

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

/** 再生音量の制御ハンドル。setMuted/setVolume で（再生を止めず・頭出しせず）ミュート・音量を即時反映する（#465/#392）。
 *  100% 境界を跨ぐ音量変更も内部で経路を載せ替えて吸収するため、呼び出し側は張り直し不要。
 *  dispose は置換/停止時に GainNode グラフを共有 ctx から切る（要素経路のみのときは no-op・#465 P2）。 */
export interface VolumeControl {
  setMuted: (muted: boolean) => void;
  setVolume: (volume: number) => void;
  dispose: () => void;
}

/**
 * media（audio/video 要素）を volume（0〜1.5）で鳴らす。100%超は共有 AudioContext の GainNode で増幅、
 * 以下は要素 .volume。setVolume/setMuted は現在の経路（要素↔GainNode）に応じて即時反映し、100% 超に達した
 * ときだけ GainNode へその場で載せ替える（頭出ししない）。初期 muted も適用する。
 */
export function attachVolume(
  ctxRef: AudioCtxRef,
  media: HTMLMediaElement,
  volume: number,
  muted: boolean,
): VolumeControl {
  let curVol = clampVolume(volume);
  let curMuted = muted;
  // GainNode 経路の実体（100%超に達したら一度だけ生成し、以後は維持＝#465 P2「GainNode化後は維持」）。
  let source: MediaElementAudioSourceNode | null = null;
  let gain: GainNode | null = null;

  // 要素を Web Audio（source→gain→destination）へ載せ替える。createMediaElementSource は要素ごとに一度きり
  // のため、生成済みなら再利用。成功で true。失敗（Web Audio 不可/二重取得）で false＝要素 .volume フォールバックへ。
  const upgradeToGain = (): boolean => {
    if (gain) return true;
    const Ctor = resolveAudioContextCtor();
    if (!Ctor) return false;
    try {
      if (!ctxRef.current) ctxRef.current = new Ctor();
      const ctx = ctxRef.current;
      source = ctx.createMediaElementSource(media);
      gain = ctx.createGain();
      source.connect(gain).connect(ctx.destination);
      media.volume = 1; // 最終音量は gain が作る（要素側は等倍で素通し）
      media.muted = false; // ミュートは gain=0 で表現する
      return true;
    } catch {
      source = null;
      gain = null;
      return false;
    }
  };

  const apply = (): void => {
    if (curVol > UNITY_VOLUME) upgradeToGain(); // 100%超は GainNode が要る（未生成ならその場で載せ替え）
    if (gain) {
      gain.gain.value = curMuted ? 0 : curVol; // 0〜1.5 を素通し（増幅も 100%側への減衰も即時）
      void ctxRef.current?.resume().catch(() => {});
    } else {
      // 要素経路（≤1.0 または Web Audio 不可）：.volume は 1.0 クランプ、ミュートは .muted。
      media.muted = curMuted;
      media.volume = Math.min(UNITY_VOLUME, curVol);
    }
  };

  apply(); // 初期音量/ミュートを反映

  return {
    setMuted: (m: boolean) => {
      curMuted = m;
      apply();
    },
    setVolume: (v: number) => {
      curVol = clampVolume(v); // 正典の 0.0〜1.5 に収める（§2-7）
      apply();
    },
    dispose: () => {
      // GainNode 経路のときだけグラフを切る（共有 ctx に古い source/gain を残さない・#465 P2）。要素経路は何もしない。
      try {
        source?.disconnect();
        gain?.disconnect();
      } catch {
        /* 既に切断済み等は無視 */
      }
      source = null;
      gain = null;
    },
  };
}

/** 共有 AudioContext を閉じる（PreviewScreen の unmount 時）。 */
export function closeAudioContext(ctxRef: AudioCtxRef): void {
  void ctxRef.current?.close().catch(() => {});
  ctxRef.current = null;
}
