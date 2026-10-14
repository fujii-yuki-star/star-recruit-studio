// 声を選ぶ一覧（同梱＋拡張パックの声・ADR-0060 段階3）。パックを入れる・外すと描き直す。
//
// ⚠️ **選ぶ一覧はこの1つから取る**＝画面ごとに `VOICE_CATALOG` を直接読むと、パックの声が出る画面と出ない画面に割れる（ADR-0026②）。
import { useMemo } from "react";
import { voiceCatalog, type VoiceCharacter } from "../../domain/voice/voiceCatalog";
import { useProjectStore } from "../store/projectStore";

export function useVoiceCatalog(): readonly VoiceCharacter[] {
  // `loadPacks` が声を足してから `packs` を差し替えるので、`packs` が変わったら一覧を取り直せば新しい声が見える。
  const packs = useProjectStore((s) => s.packs);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- 一覧はモジュールの登録から読む＝`packs` の変化を合図に取り直す
  return useMemo(() => voiceCatalog(), [packs]);
}
