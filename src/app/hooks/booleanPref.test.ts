// @vitest-environment jsdom
// 「はい／いいえ」の好みの土台（#1103）＝**覚えの読み取り**を直に叩く。
//
// ⚠️ **ここが無いと、読み取りは一度も検査されない**（実測）＝読むのはモジュールが読み込まれた
// 1回だけなので、画面を描き直す検査では通らない。実際、切り出す前は「読むのをやめる」変異が
// **生き残った**＝「開き直しても覚えている」と名乗る検査が、覚えの読み取りを1バイトも通っていなかった。
//
// ⚠️ **読み書きの置き場は `infrastructure/appSettings`**（`CLAUDE.md §4`＝外部I/O の隔離）。
// `app/hooks/booleanPref.ts` が持つのは React 側の糊だけなので、ここはその土台を直に叩く。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getBooleanSetting } from "../../infrastructure/appSettings";
import { SAFE_AREA_DEFAULT, SAFE_AREA_KEY } from "./useSafeAreaPref";
import { SIDEBAR_COLLAPSED_DEFAULT, SIDEBAR_COLLAPSED_KEY } from "./useSidebarCollapsed";
import { FOCUS_FREE_DEFAULT, LS_FOCUS_FREE } from "../screens/SceneEditScreen";
import { LS_SNAP, SNAP_DEFAULT } from "../screens/TimelineProjectScreen";

const KEY = "test.pref";

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("覚えを読む（getBooleanSetting）", () => {
  it("覚えが「はい」なら、はい", () => {
    localStorage.setItem(KEY, "1");
    expect(getBooleanSetting(KEY, false)).toBe(true);
  });

  it("覚えが「いいえ」なら、いいえ（既定が「はい」でも覚えが勝つ）", () => {
    // ⚠️ **既定へ倒さない**＝既定が「はい」の好みで「いいえ」を選んだ人が、開くたびに戻される。
    localStorage.setItem(KEY, "0");
    expect(getBooleanSetting(KEY, true)).toBe(false);
  });

  it("覚えが無ければ既定（既定が「はい」なら、はい）", () => {
    expect(getBooleanSetting(KEY, true)).toBe(true);
    expect(getBooleanSetting(KEY, false)).toBe(false);
  });

  it("壊れた中身は既定へ倒す（既定が「はい」なら、はい）", () => {
    // ⚠️ **「いいえ」に倒さない**（レビュー ℹ️・ADR-0033 結果・影響）＝既定が「はい」の好みで、
    // 壊れた値のときだけ黙って「いいえ」になると、**既定が効かない**。
    localStorage.setItem(KEY, "はい");
    expect(getBooleanSetting(KEY, true)).toBe(true);
    expect(getBooleanSetting(KEY, false)).toBe(false);
  });

  it("読めないときは既定（プライベートモード等で例外が出ても落ちない）", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("読めない");
    });
    expect(getBooleanSetting(KEY, true)).toBe(true);
    expect(getBooleanSetting(KEY, false)).toBe(false);
  });

  it("好みごとに別の鍵で覚える（取り違えない）", () => {
    localStorage.setItem("a", "1");
    localStorage.setItem("b", "0");
    expect(getBooleanSetting("a", false)).toBe(true);
    expect(getBooleanSetting("b", true)).toBe(false);
  });
});

// ⚠️ **既定は「呼び出しの中の値」なので、画面の検査では一度も通らない**（レビュー 🟡）＝
// 画面の検査は毎回 `resetXxxTo(false)` でこの場の正を上書きしてから描くため、
// 呼び出しに書いた既定を `true` に変えても**全部緑のまま**になる（「読み直しを通っていない」と同じ型）。
// 名前を付けて外へ出し、**実際の鍵と実際の読み取りを通して**留める。
describe("覚えが無いときの姿（既定の配線）", () => {
  it("左の帯は、はじめは出ている", () => {
    localStorage.removeItem(SIDEBAR_COLLAPSED_KEY);
    expect(getBooleanSetting(SIDEBAR_COLLAPSED_KEY, SIDEBAR_COLLAPSED_DEFAULT)).toBe(false);
  });

  it("端の目安は、はじめは出さない", () => {
    localStorage.removeItem(SAFE_AREA_KEY);
    expect(getBooleanSetting(SAFE_AREA_KEY, SAFE_AREA_DEFAULT)).toBe(false);
  });

  it("好みどうしで鍵がぶつからない", () => {
    // ⚠️ 同じ鍵を使うと、片方を切り替えたときにもう片方まで動く。
    const keys = [SIDEBAR_COLLAPSED_KEY, SAFE_AREA_KEY, LS_FOCUS_FREE, LS_SNAP];
    expect(new Set(keys).size).toBe(keys.length);
  });

  // ⚠️ **既定が ON の好みこそ、壊れた値の扱いが効く**（#1112）＝以前この2つは画面で
  // `localStorage` を直に触っており、**壊れた値を既定（ON）ではなく OFF に倒して**いた。
  // ADR-0033「読めない/壊れている値は既定として扱う」と食い違っていたので、寄せて揃えた。
  it("選択した要素だけ編集：はじめは ON・壊れた値でも ON", () => {
    expect(FOCUS_FREE_DEFAULT).toBe(true);
    localStorage.removeItem(LS_FOCUS_FREE);
    expect(getBooleanSetting(LS_FOCUS_FREE, FOCUS_FREE_DEFAULT)).toBe(true);
    localStorage.setItem(LS_FOCUS_FREE, "はい");
    expect(getBooleanSetting(LS_FOCUS_FREE, FOCUS_FREE_DEFAULT)).toBe(true);
    // 選んだ「いいえ」は覚えが勝つ（既定へ戻されない）。
    localStorage.setItem(LS_FOCUS_FREE, "0");
    expect(getBooleanSetting(LS_FOCUS_FREE, FOCUS_FREE_DEFAULT)).toBe(false);
  });

  it("吸着：はじめは ON・壊れた値でも ON", () => {
    expect(SNAP_DEFAULT).toBe(true);
    localStorage.removeItem(LS_SNAP);
    expect(getBooleanSetting(LS_SNAP, SNAP_DEFAULT)).toBe(true);
    localStorage.setItem(LS_SNAP, "はい");
    expect(getBooleanSetting(LS_SNAP, SNAP_DEFAULT)).toBe(true);
    localStorage.setItem(LS_SNAP, "0");
    expect(getBooleanSetting(LS_SNAP, SNAP_DEFAULT)).toBe(false);
  });
});
