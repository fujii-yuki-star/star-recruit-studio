// 安全領域（セーフエリア）の枠の出し入れ（#265）。**3つの画面が同じものを使う**共有部品。
//
// ⚠️ **共有部品として作る**（`PreviewZoomControl` と同じ理由・`CLAUDE.md §11`）＝場面編集専用に
// 作ると ADR-0032 の凍結（場面形式の編集機能の拡張）とぶつかる。`ScenePreview` を使う画面
//（場面編集・見た目パターン編集・タイムライン編集）すべてに同時に効かせる。
//
// ⚠️ **画面の好みなので覚える**（ADR-0033・ADR-0034 決定14）＝倍率（文書の見え方）と違い、
// 「端の目安を出すか」は**その人の作り方**。開き直すたびに消えると毎回入れ直すことになる。
import { useSafeAreaPref } from "../hooks/useSafeAreaPref";

export function SafeAreaToggle() {
  const [on, setOn] = useSafeAreaPref();
  return (
    <label className="row gap-sm text-sm" style={{ alignItems: "center", cursor: "pointer" }}>
      <input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} />
      {/* ⚠️ **「セーフエリア」と言わない**（§2-3）＝一般の利用者に通じない業界語。
          何のための線かを名前にする（ADR-0034 決定21 の「動画編集の一般語」にも当たらない）。 */}
      端の目安を出す
    </label>
  );
}
