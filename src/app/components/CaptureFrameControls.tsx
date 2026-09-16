// 動画の「その瞬間」を写真として切り出す（#349）。
//
// ⚠️ **技術用語を出さない**（§2-3）＝「フレーム」「抽出」は書かず「この瞬間を写真にする」と書く。
// ⚠️ **見ながら選べる**＝時間を数字で入れさせず、動画を再生して止めたところを切り出す
//（`#349` の「時刻指定はプレビュー付き」）。
import { useEffect, useRef, useState } from "react";
import { useProjectStore } from "../store/projectStore";
import { assetDisplayUrl } from "../../infrastructure/assetFs";
import type { Asset } from "../../domain/project/types";
import { CAPTURE_FRAME_ASSET_MISSING_MESSAGE, CAPTURE_FRAME_LABEL, IMPORT_BUSY_MESSAGE, RELINK_ASSET_LABEL } from "../uiLabels";

export function CaptureFrameControls({ asset }: { asset: Asset }) {
  const projectId = useProjectStore((s) => s.meta.projectId);
  /**
   * **動画の本体**の URL（#1154）。
   *
   * ⚠️ **`assetSrcById` を使わない**＝場面形式のあの地図は、動画に**代表フレームの PNG**を入れる
   * （絵として描く用・`projectStore` の読込と `applyEnrichment`）。PNG は `<video>` で再生できないので
   * `currentTime` は **0 のまま**＝「止めたところ」を選んでも**常に先頭のコマ**が切り出されていた。
   * `06 §4` は「止めた瞬間と同じ絵を出す」と書いており、正典の約束が実装されていなかった（ADR-0026①）。
   * ⚠️ **解き方は同じ画面の作法に合わせる**＝`PreviewScreen` も実映像は
   * `assetDisplayUrl(projectId, relPath)` でその場で解く（タイムライン形式は `videoSrcById` という
   * 地図を持つが、こちらは**素材そのもの**から引けるので地図を増やさない＝古い URL が残る筋を作らない）。
   * ⚠️ **URL を組むだけで本体は読まない**（`convertFileSrc`）＝ここで解いても大容量を抱えない。
   */
  // ⚠️ **差し替えの合図**（PR #1175 レビュー 🔴）＝**ファイルを選び直しても `filePath` は変わらない**
  //（`relinkAssetByPath` は `assetId` を保ち、保存名は `newAssetFrom(_, _, assetId)` で決まる＝
  // 同じ拡張子なら同じ名前へ上書きする）。`filePath` だけを見ていると**解き直しが走らず**、
  // **古い動画を見ながら止めた時刻で、新しい動画から切り出す**ことになる（ADR-0026④）。
  // 代表フレームの URL は選び直すたびに新しくなる（`?t=` 付き）ので、それを合図に使う。
  const relinkStamp = useProjectStore((s) => s.assetSrcById[asset.assetId]);
  /**
   * 解いた結果。**`null` は「まだ解いていない」**＝解けたうえでの「無い」（`{ url: null }`）と分ける
   * （PR #1175 レビュー ℹ️）。分けないと、開いた瞬間は必ず未解決なので
   * **毎回一瞬「再生できません」が見える**（§2-5＝出すべきでないときに出さない）。
   */
  const [resolved, setResolved] = useState<{ url: string | null } | null>(null);
  const src = resolved?.url ?? null;
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const url = projectId && asset.filePath ? await assetDisplayUrl(projectId, asset.filePath) : null;
      if (cancelled) return;
      // ⚠️ **同じ名前へ上書きすると表示が古いまま**（#140）＝`asset://` の URL が変わらないので
      // webview が前の動画を返す。ほかの経路（`relinkAssetByPath`・タイムライン形式）と同じく
      // 取り直させる（保存データには入れない）。
      setResolved({ url: url ? `${url}?t=${Date.now()}` : null });
    })();
    return () => { cancelled = true; };
  }, [projectId, asset.filePath, relinkStamp]);
  const captureVideoFrame = useProjectStore((s) => s.captureVideoFrame);
  const isImporting = useProjectStore((s) => s.isImporting);
  // ⚠️ **ファイルが見つからない動画では押せなくする**（#1168 レビュー 🟡）＝`store` 側にも同じ門が
  // あるが、あちらは**押したあと**に断る形なので、`06 §12` が言う「押す前に断る」になっていなかった
  //（タイムライン形式の「絵を止める」は押せなくしている＝同じ概念を形式で割らない・ADR-0026②）。
  // ⚠️ **`src` では代わりにならない**＝`convertFileSrc` は実在を見ないので、ファイルが無くても残る。
  const isMissing = useProjectStore((s) => s.missingAssetIds.includes(asset.assetId));
  const videoRef = useRef<HTMLVideoElement>(null);
  const [atSec, setAtSec] = useState(0);
  const [notice, setNotice] = useState("");

  // ⚠️ **書き出し中の非表示は親（素材画面）が持つ**（欄ごと出さない）＝ここは取り込み中だけ見る。
  // 使われない口を作らない（§9-2「将来のために設計しない」・PR #885 レビュー ℹ️）。
  const busy = isImporting;

  /**
   * 押せない理由（`null` なら押せる）。
   *
   * ⚠️ **押す前に断る**（#1168 レビュー 🟡）＝タイムライン形式の「絵を止める」（`freezeExtra`）と
   * **同じ形**にする＝**押せない理由はここ1か所で決める**（あちこちの条件に散らさない）。
   * ⚠️ **順番も合わせる**＝あちらは取り込み中が先（両方成り立つときに出る文が形式で割れない）。
   * ⚠️ **見られない動画（`!src`）はここに入れない**＝そのときの理由は**下の案内が画面に出して**おり、
   * 同じことを `title` でも言うと「二度言う」側に倒れる（この画面の流儀・#1168 レビュー 🟡）。
   * ＝押せなくする条件は `!src` を足した2つ、理由を持つのはこの1つ、という形。
   */
  const blocked: string | null =
    busy ? IMPORT_BUSY_MESSAGE : isMissing ? CAPTURE_FRAME_ASSET_MISSING_MESSAGE : null;

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
      <span className="field-label">{CAPTURE_FRAME_LABEL}</span>
      <p className="field-hint">
        動画を再生して、写真にしたいところで止めてください。止めたところが1枚の写真になります。
      </p>
      {/* ⚠️ **解いている間は断らない**（PR #1175 レビュー ℹ️）＝解く前は必ず `null` なので、
          開いた瞬間に「再生できません」が一瞬出ていた（§2-5＝出すべきでないときに出さない）。 */}
      {resolved == null ? (
        <p className="field-hint">動画を読み込んでいます…</p>
      ) : src ? (
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
        // 呼び名は `RELINK_ASSET_LABEL` から取る（#1168）。別の名で呼ぶと、探す先が分からない。
        <p className="field-hint">この動画をここでは再生できません。その素材を選んで「{RELINK_ASSET_LABEL}」から入れ直すと、表示できる場合があります。</p>
      )}
      {/* ⚠️ **押す前の状態では知らせを増やさない**（#1168 レビュー 🟡・§6＝この画面の流儀）＝状況はバナー、
          どれかは一覧の印、直し方はボタン、と役割が分かれている。ここにも同じ説明を出すと
          **同じ状態で `alert` が2つ**になる（`MaterialsScreen.relink.test.tsx` が記録した形）。
          押せない理由は `title` に出す＝タイムライン形式の「絵を止める」と同じ（`freezeExtra`）。 */}
      <div className="row mt">
        <button
          type="button"
          className="btn btn-secondary"
          disabled={blocked != null || !src}
          title={blocked ?? undefined}
          onClick={() => void onCapture()}
        >
          {/* ⚠️ **押していないのに進行中と名乗らない**（#1170・#1168 レビュー 🟡）＝`isImporting` は
              **アプリ全体**の取り込みで立つので、写真を落としただけでもここが「切り出しています…」に
              変わっていた。しかも `title` は「終わってからもう一度お試しください」＝**同じボタンが
              名前と説明で逆のことを言う**。タイムライン形式は #1136 ℹ️ でこの形を採らないと決めている。 */}
          {CAPTURE_FRAME_LABEL}
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
