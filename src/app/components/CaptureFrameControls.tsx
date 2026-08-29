// 動画の「その瞬間」を写真として切り出す（#349）。
//
// ⚠️ **技術用語を出さない**（§2-3）＝「フレーム」「抽出」は書かず「この瞬間を写真にする」と書く。
// ⚠️ **見ながら選べる**＝時間を数字で入れさせず、動画を再生して止めたところを切り出す
//（`#349` の「時刻指定はプレビュー付き」）。
import { useRef, useState } from "react";
import { useProjectStore } from "../store/projectStore";
import type { Asset } from "../../domain/project/types";

export function CaptureFrameControls({ asset }: { asset: Asset }) {
  const src = useProjectStore((s) => s.assetSrcById[asset.assetId]);
  const captureVideoFrame = useProjectStore((s) => s.captureVideoFrame);
  const isImporting = useProjectStore((s) => s.isImporting);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [atSec, setAtSec] = useState(0);
  const [notice, setNotice] = useState("");

  // ⚠️ **書き出し中の非表示は親（素材画面）が持つ**（欄ごと出さない）＝ここは取り込み中だけ見る。
  // 使われない口を作らない（§9-2「将来のために設計しない」・PR #885 レビュー ℹ️）。
  const busy = isImporting;

  async function onCapture(): Promise<void> {
    setNotice("");
    // ⚠️ **いま見えている時間を切る**（欄の値ではなく動画の再生位置）＝見たものと違う絵が出てこない。
    const at = videoRef.current?.currentTime ?? atSec;
    const id = await captureVideoFrame(asset.assetId, at);
    // 失敗の文言は取り込みと同じ場所（`importError`）に出る＝ここでは成功したときだけ知らせる。
    if (id) setNotice("写真にしました。素材の一覧に増えています。");
  }

  return (
    <div className="field">
      <span className="field-label">この瞬間を写真にする</span>
      <p className="field-hint">
        動画を再生して、写真にしたいところで止めてください。止めたところが1枚の写真になります。
      </p>
      {src ? (
        <video
          ref={videoRef}
          src={src}
          controls
          preload="metadata"
          style={{ width: "100%", maxHeight: 280, borderRadius: "var(--radius-sm)", background: "#000" }}
          onTimeUpdate={(e) => setAtSec(e.currentTarget.currentTime)}
        />
      ) : (
        // ⚠️ **見られないときも行き止まりにしない**（§2-5）＝理由と次の行動を出す。
        // ⚠️ **同じ操作は同じ名前で呼ぶ**（α-6 出口監査 🟡25・§2-3）＝同じ画面の導線は
        // 「ファイルを選び直す」（`MaterialsScreen` の4か所で統一）。別の名で呼ぶと、探す先が分からない。
        <p className="field-hint">この動画をここでは再生できません。その素材を選んで「ファイルを選び直す」から入れ直すと、表示できる場合があります。</p>
      )}
      <div className="row mt">
        <button type="button" className="btn btn-secondary" disabled={busy || !src} onClick={() => void onCapture()}>
          {isImporting ? "切り出しています…" : "この瞬間を写真にする"}
        </button>
        <span className="text-sm text-muted">{formatTime(atSec)}</span>
      </div>
      {notice && <p className="field-hint">{notice}</p>}
    </div>
  );
}

/** 秒を「分:秒」で見せる（画面に出る文字なので読める形にする・§2-3）。 */
function formatTime(sec: number): string {
  const t = Math.max(0, sec);
  return `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
}
