// 「会社の見た目」（ブランドキット・ADR-0036）への入口（#1032）。
//
// ⚠️ **入口が設定画面の奥だけだった**＝よく使う文字の形・色・ロゴを決める場所は、
// **素材を選んでいるとき・見た目を選んでいるとき**にこそ思い出すのに、そこからは辿れなかった。
//
// ⚠️ **同じ行き先は同じ言葉で呼ぶ**（`06 §3`・#1026 で同じ穴を直した）＝押す言葉も、
// 行き先で寄る欄の指定も、この部品1つが持つ（画面ごとに書くと片方だけ言い方が変わる）。
import type { ScreenId } from "../data/mockData";
import { useProjectStore } from "../store/projectStore";

/** 押す言葉（§2-3＝「ブランドキット」は出さない）。 */
export const BRAND_KIT_LINK_LABEL = "会社の見た目を決める";

export function BrandKitLink({ onNavigate }: { onNavigate: (screen: ScreenId) => void }) {
  const setSettingsFocus = useProjectStore((s) => s.setSettingsFocus);
  return (
    <button
      className="btn btn-ghost text-sm"
      style={{ marginBottom: "var(--gap)" }}
      title="よく使う文字の形・色・ロゴを覚えておくと、新しい動画に最初から入ります"
      onClick={() => {
        // ⚠️ **行き先の欄まで指定する**＝設定は縦に長く、この欄は下の方にある。
        // 指定しないと「押しても目的の欄が見えない」（#1026 の「来ていない画面を指す」と同じ型）。
        setSettingsFocus("brandKit");
        onNavigate("settings");
      }}
    >
      {BRAND_KIT_LINK_LABEL}
    </button>
  );
}
