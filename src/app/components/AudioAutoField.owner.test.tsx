// @vitest-environment jsdom
// 音の自動処理の欄は**どちらの形式からも使える**（差分再監査 2巡目）。
//
// ⚠️ **値の持ち主を取り違えない**＝`value ?? 場面形式の値` にすると、まだ何も設定していない
// タイムライン動画で**別の動画（場面形式）の設定が自分のものとして表示される**。
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { AudioAutoField } from "./AudioAutoField";
import { useProjectStore } from "../store/projectStore";

beforeEach(() => {
  const meta = useProjectStore.getState().meta;
  // 場面形式の動画は「しない」にしてある。
  useProjectStore.setState({
    meta: { ...meta, videoSettings: { ...meta.videoSettings, audioAuto: { duckBgm: false, normalize: false } } },
  } as never);
});

describe("AudioAutoField の値の持ち主", () => {
  it("書き先を渡したら、場面形式の値は見ない（既定に戻る）", () => {
    render(<AudioAutoField value={undefined} onChange={vi.fn()} />);
    // 渡された値が未設定＝この動画の既定（する）を見せる。場面形式の「しない」を引っぱらない。
    expect(screen.getByRole("checkbox", { name: /BGMを控えめ/ })).toBeChecked();
  });

  it("書き先を渡さなければ、場面形式の値を見せる（従来どおり）", () => {
    render(<AudioAutoField />);
    expect(screen.getByRole("checkbox", { name: /BGMを控えめ/ })).not.toBeChecked();
  });
});
