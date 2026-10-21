// @vitest-environment jsdom
// 声を選ぶ一覧＝パックを入れる・外すと取り直す（ADR-0060 段階3）。
import { afterEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useVoiceCatalog } from "./useVoiceCatalog";
import { useProjectStore } from "../store/projectStore";
import { setExtraVoiceCharacters, VOICE_CATALOG } from "../../domain/voice/voiceCatalog";

afterEach(() => setExtraVoiceCharacters([]));

describe("useVoiceCatalog", () => {
  it("パックが変わると、足した声を含む一覧を取り直す", () => {
    const { result } = renderHook(() => useVoiceCatalog());
    expect(result.current).toBe(VOICE_CATALOG);
    act(() => {
      setExtraVoiceCharacters([{ character: "あおい", styles: [{ speaker: 9001, label: "ノーマル" }] }]);
      useProjectStore.setState({ packs: [] } as never); // 新しい配列＝パックが変わった合図
    });
    expect(result.current.at(-1)?.character).toBe("あおい");
  });
});
