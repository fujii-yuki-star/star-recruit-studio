// @vitest-environment jsdom
// 欄の器の高さ（#1104・実機の指摘②③）。
//
// ⚠️ **実機の数字から直した**＝「初期表示では帯より上の3行しか見えず、下まで送っても
// 列は3本しか見えない（とても実用的ではない）」（2026-09-10）。
// 原因は2つ＝①器が `76vh` の決め打ちで、貼り付く見出しと余白のぶん画面からはみ出す
// ②「並び」の取り分が既定 0.28（1080px の画面で約 230px＝目盛りを引くと約3.7列）。
//
// ⚠️ **実際の高さは実機でしか見られない**（jsdom はレイアウトを計算しない）＝
// ここで留めるのは「**何を引いているか**」と「**取り分の実数**」まで。
import { describe, expect, it } from "vitest";
import { panelLayoutHeight } from "./usePanelViewportHeight";
import { MAX_REGION_RATIO, DEFAULT_REGION_SIZES } from "../../domain/layout/panelLayout";

describe("器の高さ（#1104）", () => {
  it("画面の高さから、貼り付く見出しと余白を引く", () => {
    expect(panelLayoutHeight(160)).toBe("calc(100vh - 160px - var(--gap))");
  });

  it("見出しが測れない場（0）でも、いまより狭くならない", () => {
    // ⚠️ **悪化させない側へ倒す**＝測れないときに `76vh` より狭い値を出さない。
    expect(panelLayoutHeight(0)).toBe("calc(100vh - 0px - var(--gap))");
  });

  it("壊れた値・負の値は 0 として扱う（器が伸びも縮みもしない）", () => {
    expect(panelLayoutHeight(Number.NaN)).toBe("calc(100vh - 0px - var(--gap))");
    expect(panelLayoutHeight(-50)).toBe("calc(100vh - 0px - var(--gap))");
  });

  it("端数は丸める（小数の px を CSS に流し込まない）", () => {
    expect(panelLayoutHeight(160.4)).toBe("calc(100vh - 160px - var(--gap))");
  });
});

describe("「並び」の取り分（#1104）", () => {
  it("タイムラインは上限まで広げる（既定の 0.28 では約3列しか見えなかった）", () => {
    // ⚠️ **実数で留める**＝ここが黙って戻ると、また「3列しか見えない」に戻る。
    expect(MAX_REGION_RATIO).toBe(0.5);
    expect(DEFAULT_REGION_SIZES.bottom).toBe(0.28); // 他の画面の既定は変えていない
    expect(MAX_REGION_RATIO).toBeGreaterThan(DEFAULT_REGION_SIZES.bottom);
  });

  it("実機の数字と合う（なぜ3列だったか）", () => {
    // 1080px の画面：器 76vh = 820.8px ／ その 28% = 229.8px ／ 目盛り 22px を引いて 40px で割る。
    const containerPx = 1080 * 0.76;
    const lanes = (n: number): number => Math.floor((containerPx * n - 22) / 40);
    // ⚠️ **実数で固定する**＝「倍以上」のような相対で書くと、片方が動いたときに一緒に緩む。
    expect(lanes(DEFAULT_REGION_SIZES.bottom)).toBe(5); // 欄の見出し・余白を除くと実機の「3列」になる
    expect(lanes(MAX_REGION_RATIO)).toBe(9);            // 取り分だけで 5→9（約1.8倍）
    // ⚠️ **これでもまだ足りない**＝器の高さも直すので、実機ではここからさらに増える
    //（1080px の画面で見出しが 160px なら、器は 820.8px → 904px ぶんになる）。
  });
});
