// 場面編集で「動き」（簡易アニメ・ADR-0019）をその場で再生確認するためのフック（#408 Part 1）。
// これまで場面編集プレビューは常に静止で、「ふわっと」等の秒数を変えるたび仕上がり確認へ往復していた（ADR-0026 ④）。
// 適用条件（sceneAnimationActive）と描画（ScenePreview の layoutScene(t)）は書き出し／仕上がり確認と同一を共有＝
// 「プレビューでは動くのに書き出しは静止」等のパリティ破れを作らない（ADR-0001/0026 ③）。
import { useEffect, useMemo, useState } from "react";
import type { Asset, ElementAnimation, Scene } from "../../domain/project/types";
import type { Template } from "../../domain/template/types";
import { animationsEndSec, sceneAnimationActive } from "../../domain/project/sceneAnimation";
import { findVideoSlots } from "../../renderer/export/findVideoSlot";
import { FPS, PREVIEW_MIN_PLAY_SEC } from "../../domain/constants";


export interface SceneMotionPreview {
  /** この場面に再生できる「動き」があるか（＝再生ボタンを出す条件）。 */
  animActive: boolean;
  /** この場面に動画スロットがあるか。掛け合い併用時の「動き」不可案内（#469）に使う。 */
  hasVideoSlot: boolean;
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
  // template 未解決（見た目パターンが見つからない）場面は ScenePreview が「表示する場面がありません」になり、
  // 再生しても何も起きない（§2-5「押せるのに無反応」）。よって template が無ければアニメがあっても再生対象にしない。
  const animActive = !!scene && !!template && sceneAnimationActive(scene, sceneAnimations, hasVideoSlot);

  const [playing, setPlaying] = useState(false);
  const [timeSec, setTimeSec] = useState(0);
  // 描画中に state を正す React 推奨パターン（effect 内 setState を避ける・LooksScreen と同型）。
  const [syncId, setSyncId] = useState(sceneId);
  if (syncId !== sceneId) {
    // 別の場面へ切り替えたら再生を止めて頭出しする。
    setSyncId(sceneId);
    setPlaying(false);
    setTimeSec(0);
  } else if (playing && !animActive) {
    // 再生中にアニメが適用外になった（「動き」を外した／動画×掛け合いで不可になった／テンプレ未解決になった 等）ら停止する。
    // 放置すると playing=true のまま：再生ボタンは消えて止められず、FREE 編集オーバーレイも隠れたままになる（#408 レビュー・ADR-0026 ④）。
    setPlaying(false);
    setTimeSec(0);
  }

  useEffect(() => {
    if (!playing || !animActive) return;
    const playDur = Math.max(PREVIEW_MIN_PLAY_SEC, animationsEndSec(sceneAnimations));
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
    hasVideoSlot, // 掛け合い×動画スロットの「動き」不可（#469）を UI 側で案内するために公開（sceneAnimationActive の gate と同じ判定材料）。
    playing,
    timeSec: playing ? timeSec : 0, // 停止中は場面頭（派生＝effect 内の同期 setState を避ける）。
    previewAnimations: playing && animActive ? sceneAnimations : [],
    play: () => setPlaying(true),
    stop: () => setPlaying(false),
  };
}
