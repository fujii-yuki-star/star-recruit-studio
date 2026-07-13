// 場面編集で「切り替え効果」（トランジション・ADR-0009）をその場で再生確認するフック（#408 Part 2）。
// これまで切替効果はアプリ内に再生手段が無く、MP4 書き出しが唯一の確認方法だった（ADR-0026 ③「設定できるのに動かない」）。
// 単境界の先行実装：前場面の最終フレーム→当該場面を D 秒でフェード/スライド（統合の連続再生は α-5・ADR-0023）。
// 型/方向/clamp後 D は resolveBoundaryTransition＝書き出し（xfade）と同一値を共有＝プレビュー=書き出しパリティ（ADR-0001）。
import { useEffect, useMemo, useState } from "react";
import type { Scene } from "../../domain/project/types";
import { resolveBoundaryTransition } from "../../domain/project/sceneTransitions";
import type { BoundaryTransition } from "../../domain/project/sceneTransitions";
import { FPS } from "../../domain/constants";

export interface SceneTransitionPreview {
  /** この境界に再生できる切替効果があるか（＝再生ボタンを出す条件）。先頭場面・none・D=0 は false。 */
  transitionActive: boolean;
  /** 解決済みの境界遷移（type/direction/clamp 後 D）。書き出しと同一値。 */
  boundary: BoundaryTransition;
  /** 再生中か。 */
  playing: boolean;
  /** 進捗 0→1（TransitionPreview が fade/slide の補間に使う）。停止中は 0。 */
  progress: number;
  play: () => void;
  stop: () => void;
}

/**
 * scenes[targetIndex] に入る境界（A=直前場面→ B=当該場面）の切替効果を再生確認する状態を返す。先頭（targetIndex<=0）や
 * none は transitionActive=false。実効 D は書き出しと同じ**全場面 transitionTimeline**で解決＝直前場面が短くても一致
 * （#408 レビュー P1）。再生中は progress を 0→1 へ、書き出しと同じ 30fps 量子化（ADR-0019 決定②の格子）で進め、
 * D 秒で自動停止する（停止時はオーバーレイを外し、下の ScenePreview が当該場面 B を表示＝最終フレームと一致してカクつかない）。
 */
export function useSceneTransitionPreview(
  scenes: Scene[],
  targetIndex: number,
): SceneTransitionPreview {
  const scene = targetIndex >= 0 ? scenes[targetIndex] : undefined;
  const boundary = useMemo(
    () => resolveBoundaryTransition(scenes, targetIndex),
    [scenes, targetIndex],
  );
  const transitionActive = !!scene && boundary.durationSec > 0;

  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  // 描画中に state を正す React 推奨パターン（effect 内 setState を避ける・useSceneMotionPreview と同型）。
  const sceneId = scene?.sceneId;
  const [syncId, setSyncId] = useState(sceneId);
  if (syncId !== sceneId) {
    // 別の場面へ切り替えたら再生を止めて頭出しする。
    setSyncId(sceneId);
    setPlaying(false);
    setProgress(0);
  } else if (playing && !transitionActive) {
    // 再生中に切替効果が無効化された（none にした／先頭へ移動した 等）ら停止する。
    setPlaying(false);
    setProgress(0);
  }

  useEffect(() => {
    if (!playing || !transitionActive) return;
    const dur = boundary.durationSec;
    const start = performance.now();
    let raf = 0;
    const tick = () => {
      const elapsed = (performance.now() - start) / 1000;
      const t = Math.min(Math.floor(elapsed * FPS) / FPS, dur); // 書き出しと同じ 30fps 量子化
      setProgress(dur > 0 ? t / dur : 1);
      if (elapsed < dur) raf = requestAnimationFrame(tick);
      else {
        setProgress(1); // 終端＝当該場面 B が完全表示
        setPlaying(false);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, transitionActive, boundary.durationSec, sceneId]);

  return {
    transitionActive,
    boundary,
    playing,
    progress: playing ? progress : 0, // 停止中は 0（オーバーレイは非表示・下の ScenePreview が B を表示）
    play: () => {
      setProgress(0);
      setPlaying(true);
    },
    stop: () => {
      setPlaying(false);
      setProgress(0);
    },
  };
}
