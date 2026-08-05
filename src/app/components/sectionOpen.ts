// 欄の中の節（アコーディオン）の開閉の記憶（#550 ③→#687 で共有化）。
//
// **画面ごとに覚える**（ADR-0033 の配置と同じ考え方）＝画面が違えば節の顔ぶれも違うので、
// 同じ見出し（例「文字」）が別画面にあっても記憶が混ざらない。
// 保存先は `localStorage`＝**プロジェクトの schema には入れない**（画面の好みは動画の中身ではない・§5）。
//
// 部品（`CollapsibleSection`）と別ファイルにしてあるのは、部品のファイルから部品以外を export すると
// 開発中の差し替え（fast refresh）が効かなくなるため。

/**
 * 記憶の名前空間（画面ごと）。**値は localStorage のキーになるので気軽に変えない**
 * （変えると利用者の開閉の記憶がその画面ぶんだけ失われる）。
 */
export const SECTION_SCOPE = { sceneEdit: "sceneEdit", timeline: "timeline" } as const;
// ⚠️ 配置の `PANEL_SCREEN`（ADR-0033・`domain/layout/panelLayout.ts`）とは**値がずれている**（`sceneEdit` ⇄ `scene`）。
// 揃えたくなるが、この値は既存の localStorage のキーそのものなので**変えると利用者の記憶がその画面ぶん消える**。
// 揃えるなら「名前空間 → キー」の写像を挟むこと（値の直接の付け替えはしない）。
export type SectionScope = (typeof SECTION_SCOPE)[keyof typeof SECTION_SCOPE];

const lsKey = (scope: SectionScope): string => `${scope}.sectionOpen`;

type SectionOpenMap = Record<string, boolean>;

/**
 * 覚えている開閉を読む。壊れた値・保存不可（プライベートモード等）は既定へ倒す＝編集を止めない。
 * キーは節の見出し（安定・少数）。
 */
export function loadSectionOpen(scope: SectionScope): SectionOpenMap {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(lsKey(scope)) ?? "{}");
    if (typeof v !== "object" || v === null || Array.isArray(v)) return {};
    return Object.fromEntries(Object.entries(v).filter(([, b]) => typeof b === "boolean")) as SectionOpenMap;
  } catch { return {}; }
}

export function saveSectionOpen(scope: SectionScope, title: string, open: boolean): void {
  try {
    localStorage.setItem(lsKey(scope), JSON.stringify({ ...loadSectionOpen(scope), [title]: open }));
  } catch { /* 保存できなくても編集は続けられる（次回は既定で開く/畳む） */ }
}
