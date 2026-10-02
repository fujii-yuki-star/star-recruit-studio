// 編集中のプロジェクト名を表示・変更する入力（#252）。ヘッダに置き、戻らずにその場で改名できる。
// 確定は blur/Enter（1改名=1履歴＝store.setProjectName）。空・未変更は破棄して元の名前に戻す。技術用語なし（§2-3）。
import { useEffect, useRef, useState } from "react";
import { VIDEO_KIND } from "../../domain/enums";
import { isExportBusy, useProjectStore } from "../store/projectStore";
import { PROJECT_NAME_MAX_LENGTH } from "../../domain/constants";
import { videoTitleSource } from "../../domain/ai/assist";
import { AiSuggest, useLocalAiAvailable } from "./AiSuggest";
import { AI_ASSIST_VIDEO_TITLE_KINDS, AI_ASSIST_VIDEO_TITLE_LABEL } from "../uiLabels";

export function ProjectNameField() {
  const projectName = useProjectStore((s) => s.meta.projectName);
  const setProjectName = useProjectStore((s) => s.setProjectName);
  const isExporting = useProjectStore((s) => isExportBusy(s.exportRun.phase)); // 書き出し中は改名を止める（#570 P2）
  const [draft, setDraft] = useState<string | null>(null); // null＝非編集（store の名前を表示）
  // 題名の候補（#1316・ADR-0053）。材料＝主題（会社名／発表の題）と場面の語り。同梱の AI が無ければ AiSuggest は何も出さない。
  const [suggestOpen, setSuggestOpen] = useState(false);
  const aiAvailable = useLocalAiAvailable(); // 無ければボタンごと出さない（押しても何も起きない、を作らない）
  const meta = useProjectStore((s) => s.meta);
  const scenes = useProjectStore((s) => s.scenes);
  // テーマ＝採用なら会社名・一般なら発表の題（一般の動画に残っている会社名を主題にしない）。
  const topic = meta.videoKind === VIDEO_KIND.general ? meta.generalBrief?.title : meta.companyInfo?.companyName;
  // 欄は Escape・外側のクリックで閉じる（浮いて重なる表示なので、閉じる手段がボタンだけだと邪魔になる）。
  const wrapRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!suggestOpen) return;
    const onDown = (e: MouseEvent) => { if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setSuggestOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setSuggestOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [suggestOpen]);

  const commit = () => {
    if (draft != null) {
      const name = draft.trim();
      if (name && name !== projectName) setProjectName(name); // 空・未変更は保存しない
    }
    setDraft(null);
  };

  return (
    <span ref={wrapRef} style={{ position: "relative", display: "inline-flex", alignItems: "center", gap: 6, minWidth: 0 }}>
    <input
      className="input"
      value={draft ?? projectName}
      placeholder="無題の動画"
      aria-label="動画の名前"
      title="動画の名前（ここで変えられます）"
      maxLength={PROJECT_NAME_MAX_LENGTH} // schema の projectName 上限（1–80字）に合わせる（貼り付け等での超過を UI で予防・#411）
      disabled={isExporting}
      onFocus={() => setDraft(projectName)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        // 日本語IMEの変換確定 Enter では確定（blur）しない（HomeScreen/FreeLayoutOverlay と同じガード・レビュー対応）。
        if (e.nativeEvent.isComposing) return;
        if (e.key === "Enter") e.currentTarget.blur();
      }}
      style={{ fontWeight: 600, maxWidth: 320, minWidth: 120 }}
    />
    {aiAvailable && <button
      className="btn btn-ghost btn-sm text-sm"
      style={{ flexShrink: 0 }}
      disabled={isExporting}
      aria-expanded={suggestOpen}
      onClick={() => setSuggestOpen((o) => !o)}
    >
      {AI_ASSIST_VIDEO_TITLE_LABEL}
    </button>}
    {/* 書き出し中は出さない＝名前は変えられない（store が断る）ので、選んでも何も起きない欄を残さない。 */}
    {aiAvailable && suggestOpen && !isExporting && (
      <div className="card" style={{ position: "absolute", top: "100%", left: 0, zIndex: 50, width: 420, padding: 8, marginTop: 4 }}>
        <AiSuggest
          kinds={AI_ASSIST_VIDEO_TITLE_KINDS}
          source={videoTitleSource(topic, scenes)}
          current={projectName}
          limits={{}}
          companyName={meta.videoKind === VIDEO_KIND.general ? undefined : meta.companyInfo?.companyName}
          onPick={(t) => { setProjectName(t); setSuggestOpen(false); }}
        />
      </div>
    )}
    </span>
  );
}
