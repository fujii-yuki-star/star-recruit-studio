// 試し聞き（プレビュー再生）の共有制御（#388）。投げっぱなしの new Audio をやめ、
// - 再生中の要素を ref 保持し、新しい再生の前・アンマウント時に必ず pause＝画面遷移で鳴り続けない・連打で重ならない
// - 現在鳴っている音源キー（playingKey）を返し、ボタンを「再生↔停止」に切り替えられるようにする。
// play(key, url) は同じ key を再度呼ぶと停止（トグル）。異なる key なら前を止めて新しく鳴らす。
import { useCallback, useEffect, useRef, useState } from "react";

export interface AudioPreview {
  /** 現在鳴っている音源のキー（無音なら null）。ボタンの「再生↔停止」切替に使う。 */
  playingKey: string | null;
  /** key の音源（url）を鳴らす。同じ key を再度呼ぶと停止（トグル）。onError は再生失敗時に一度呼ぶ。 */
  play: (key: string, url: string, onError?: () => void) => void;
  /** 明示停止（画面遷移・別操作の前に呼べる）。 */
  stop: () => void;
}

export function useAudioPreview(): AudioPreview {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const keyRef = useRef<string | null>(null);
  const [playingKey, setPlayingKey] = useState<string | null>(null);

  const stop = useCallback((): void => {
    audioRef.current?.pause();
    audioRef.current = null;
    keyRef.current = null;
    setPlayingKey(null);
  }, []);

  const play = useCallback(
    (key: string, url: string, onError?: () => void): void => {
      const toggleOff = keyRef.current === key; // 同じ音源が鳴っている＝もう一度押したら停止
      stop(); // 何が鳴っていても先に止める（連打・別音源で重ならない）
      if (toggleOff) return;
      const a = new Audio(url);
      audioRef.current = a;
      keyRef.current = key;
      setPlayingKey(key);
      a.onended = (): void => {
        if (audioRef.current === a) stop(); // 鳴り終わったら停止状態へ（ボタンを再生に戻す）
      };
      void a.play().catch((e) => {
        console.warn("[useAudioPreview] 再生に失敗", e);
        if (audioRef.current === a) stop();
        onError?.();
      });
    },
    [stop],
  );

  // アンマウント（画面遷移）で確実に止める＝別画面で鳴り続けない。
  useEffect(() => () => stop(), [stop]);

  return { playingKey, play, stop };
}
