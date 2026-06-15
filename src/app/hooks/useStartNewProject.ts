// 「新しい動画を作る」の共通フロー（破棄ガード付き）。ヘッダ(App)とホームで共有し挙動を統一する（CLAUDE.md §4）。
import { useState } from "react";
import type { ScreenId } from "../data/mockData";
import { useProjectStore } from "../store/projectStore";
import { sampleAssets } from "../../infrastructure/sampleData";

// サンプル素材以外（ユーザーが取り込んだ素材）を「作業中の内容」とみなす。
const SAMPLE_ASSET_IDS = new Set(sampleAssets.map((a) => a.assetId));

/**
 * 新規作成フロー。作業中の内容（場面 or 取り込んだ素材）があるときは、いきなり破棄せず確認を挟む。
 * confirming=true の間は呼び出し側が確認UIを出し、confirm()/cancel() を繋ぐ。確定で newProject→wizard。
 */
export function useStartNewProject(navigate: (screen: ScreenId) => void) {
  const newProject = useProjectStore((s) => s.newProject);
  const sceneCount = useProjectStore((s) => s.scenes.length);
  const hasCustomAsset = useProjectStore((s) =>
    s.assets.some((a) => !SAMPLE_ASSET_IDS.has(a.assetId)),
  );
  const [confirming, setConfirming] = useState(false);

  function start() {
    if (sceneCount > 0 || hasCustomAsset) {
      setConfirming(true);
      return;
    }
    newProject();
    navigate("wizard");
  }
  function confirm() {
    setConfirming(false);
    newProject();
    navigate("wizard");
  }
  function cancel() {
    setConfirming(false);
  }

  return { confirming, start, confirm, cancel };
}
