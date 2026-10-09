// 同梱したチュートリアル映像を再生する道を組む（#1229・ADR-0046 ①）。
//
// ⚠️ **素材と同じ口（`asset://`）で読む**＝この口は途中から読む要求（Range）に応じるので、シークバーで先へ飛べる。
//   `public/` に置いて埋め込むと、その口は全体しか返さず**先へ飛べなかった**（2026-10-09 の実機確認）。
// ⚠️ 許可の範囲は `tauri.conf.json` の `assetProtocol.scope`（`$RESOURCE/tutorials/*`）。
import { convertFileSrc } from '@tauri-apps/api/core';
import { resolveResource } from '@tauri-apps/api/path';
import { isTauri } from './assetFs';

/**
 * 再生する道。`resourcePath` は同梱物の中での道（`tutorialVideoResourcePath`）。
 * Tauri の外・道を決められないときは null（画面が「開けない」と知らせる）。
 */
export async function tutorialVideoUrl(resourcePath: string): Promise<string | null> {
  if (!isTauri()) return null;
  try {
    return convertFileSrc(await resolveResource(resourcePath));
  } catch (e) {
    console.warn('[tutorial] 映像の道を決められない:', e);
    return null;
  }
}
