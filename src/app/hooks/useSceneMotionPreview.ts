// 場面編集で「動き」（簡易アニメ・ADR-0019）をその場で再生確認するためのフック（#408 Part 1）。
// これまで場面編集プレビューは常に静止で、「ふわっと」等の秒数を変えるたび仕上がり確認へ往復していた（ADR-0026 ④）。
// 適用条件（sceneAnimationActive）と描画（ScenePreview の layoutScene(t)）は書き出し／仕上がり確認と同一を共有＝
// 「プレビューでは動くのに書き出しは静止」等のパリティ破れを作らない（ADR-0001/0026 ③）。
import { useEffect, useMemo, useState } from "react";
import type { Asset, ElementAnimation, Scene } from "../../domain/project/types";
import type { Template } from "../../domain/template/types";
import { animationsEndSec, sceneAnimationActive } from "../../domain/project/sceneAnimation";
import { findVideoSlots } from "../../renderer/export/findVideoSlot";
import { FPS } from "../../domain/constants";

// 動きの再生窓の下限（秒）。アニメが極端に短くても最低これだけは回す（PreviewScreen の MIN_PLAY_SEC と同趣旨）。
const MOTION_PREVIEW_MIN_SEC = 0.3;

export interface SceneMotionPreview {
  /** この場面に再生できる「動き」があるか（＝再生ボタンを出す条件）。 */
  animActive: boolean;
  /** 再生中か。 */
  playing: boolean;
  /** ScenePreview に渡す再生位置（停止中は 0）。 */
  timeSec: number;
  /** ScenePreview に渡すアニメ（再生中のみ非空＝停止中は静止で settled 表示・編集時に要素を隠さない）。 */
  previewAnimations: ElementAnimation[];
  /** 再生を開始する。 */
  play: () => void;
  /** 再生を止める（settled 表示へ戻る）。 */
  stop: () => void;
}

/**
 * 選択中の場面の「動き」を再生確認する状態を返す。scene/template が未定なら animActive=false（何も再生しない）。
 * 再生中は場面頭 0 から animationsEndSec までを 30fps 量子化（書き出しと同じ格子・ADR-0019 決定②）で進め、
 * 終端に達したら自動停止する（最終フレーム＝settled と一致するので停止時にカクつかない）。
 */
export function useSceneMotionPreview(
  scene: Scene | undefined,
  template: Template | undefined,
  assets: Asset[],
  overlayAnimations: ElementAnimation[] | undefined,
): SceneMotionPreview {
  const sceneId = scene?.sceneId;
  // この場面のアニメ（timelineOverlay 由来・AI/場面正準は不変）。
  const sceneAnimations = useMemo(
    () => (sceneId ? (overlayAnimations ?? []).filter((a) => a.sceneId === sceneId) : []),
    [overlayAnimations, sceneId],
  );
  // 動画スロットの有無（アニメ適用可否＝書き出しと同一条件で判定するため。#442/#435）。
  const hasVideoSlot = useMemo(
    () =>
      scene && template
        ? findVideoSlots(scene, template, (id) => assets.find((a) => a.assetId === id)).length > 0
        : false,
    [scene, template, assets],
  );
  const animActive = !!scene && sceneAnimationActive(scene, sceneAnimations, hasVideoSlot);

  const [playing, setPlaying] = useState(false);
  const [timeSec, setTimeSec] = useState(0);
  // 別の場面へ切り替えたら再生を止めて頭出しする（描画中に state を正す React 推奨パターン＝effect 内 setState を避ける・LooksScreen と同型）。
  const [syncId, setSyncId] = useState(sceneId);
  if (syncId !== sceneId) {
    setSyncId(sceneId);
    setPlaying(false);
    setTimeSec(0);
  }

  useEffect(() => {
    if (!playing || !animActive) return;
    const playDur = Math.max(MOTION_PREVIEW_MIN_SEC, animationsEndSec(sceneAnimations));
    const start = performance.now();
    let raf = 0;
    const tick = () => {
      const elapsed = (performance.now() - start) / 1000;
      // 書き出しと同じ 30fps 量子化でフレーム t を描く（ADR-0019 決定②の per-frame パリティ）。
      setTimeSec(Math.min(Math.floor(elapsed * FPS) / FPS, playDur));
      if (elapsed < playDur) raf = requestAnimationFrame(tick);
      else setPlaying(false); // 再生し終えたら停止（settled 表示へ戻す）。
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, animActive, sceneId, sceneAnimations]);

  return {
    animActive,
    playing,
    timeSec: playing ? timeSec : 0, // 停止中は場面頭（派生＝effect 内の同期 setState を避ける）。
    previewAnimations: playing && animActive ? sceneAnimations : [],
    play: () => setPlaying(true),
    stop: () => setPlaying(false),
  };
}
