// コンポーネント/対話テスト（*.test.tsx・jsdom 環境）向けの共通セットアップ（ADR-0014）。
//
// 既定 environment は node のため、このファイルは全テストで読み込まれる。
// jest-dom のマッチャ拡張は DOM 非依存なので全環境で登録してよい（下記 import）。
// 一方 RTL（@testing-library/react）の cleanup は node 環境では読み込まない＝環境ガード（afterEach 内の動的 import）。
import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";

// jsdom は PointerEvent を実装しない。ドラッグ/選択などポインタ操作の対話を検証できるよう
// 最小限のクラスで補う（PointerEvent が既にある実ブラウザ/happy-dom では何もしない）。
if (typeof window !== "undefined" && typeof window.PointerEvent === "undefined") {
  class PointerEventPolyfill extends MouseEvent {
    readonly pointerId: number;
    constructor(type: string, params: PointerEventInit = {}) {
      super(type, params);
      this.pointerId = params.pointerId ?? 0;
    }
  }
  window.PointerEvent = PointerEventPolyfill as unknown as typeof PointerEvent;
}

// 各テスト後に描画ツリーを破棄（テスト間の DOM リークを防ぐ）。
// node 環境（document なし）では RTL を読み込まない＝既存テストへ無影響。
afterEach(async () => {
  if (typeof document === "undefined") return;
  const { cleanup } = await import("@testing-library/react");
  cleanup();
});
