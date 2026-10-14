// 拡張パック（ADR-0060）＝見た目パターン・文字の形・音楽・声・機能を後から足す。設定の欄。
//
// ⚠️ **入れる前に見せる**（決定3）＝選んだファイルの中身・発行者・権利を見せてから「入れる」。
// ⚠️ **外す前に知らせる**＝使っている動画の数を数えて確かめる（黙って見た目パターンを消さない）。
// ⚠️ **技術用語を出さない**（§2-3）＝「manifest」「SHA-256」「zip」は出さない。
import { useState } from "react";
import { isExportBusy, useProjectStore } from "../store/projectStore";
import { isTimelineExportBusy, useTimelineStore } from "../store/timelineStore";
import { countVideosUsingPack, inspectPackFile, installInspectedPack, removeInstalledPack } from "../store/packActions";
import { showOpenExtensionPackDialog } from "../../infrastructure/dialog";
import type { ExtensionPackManifest } from "../../domain/pack/extensionPack";
import { PACK_CONTENT_LABEL, packContentsSummary, packInstalledMessage, packRemoveConfirmMessage, packRemovedMessage, packSkippedMessage, packVoiceSkippedMessage, PACK_BUSY_MESSAGE } from "../uiLabels";
import { DeleteConfirm } from "./DeleteConfirm";

export function ExtensionPackSection() {
  const packs = useProjectStore((s) => s.packs);
  const skipped = useProjectStore((s) => s.packsSkipped);
  // 声（段階3）＝ほかのパックと番号が重なって足せなかった声と、声を作るソフトを起こし直せなかったこと。
  const voicesSkipped = useProjectStore((s) => s.packVoicesSkipped);
  const voiceRestartError = useProjectStore((s) => s.voiceEngineRestartError);
  // ⚠️ **声を作っている間・書き出しの間は入れる・外すを押せない**（段階3・PR レビュー 🟡）＝声のパックを入れる・外すと
  //   声を作るソフトを起こし直すので、作っている途中の声が失敗したり、別の接続先へ流れたりする（15 §4 の排他と同じ扱い）。
  const sceneBusy = useProjectStore((s) => s.isGeneratingNarration || isExportBusy(s.exportRun.phase));
  const timelineBusy = useTimelineStore((s) => s._voiceRun != null || isTimelineExportBusy(s.exportRun.phase));
  const otherBusy = sceneBusy || timelineBusy;
  const busyTitle = otherBusy ? PACK_BUSY_MESSAGE : undefined;
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  /** 中を見て、入れるかどうかを確かめている途中。 */
  const [pending, setPending] = useState<{ path: string; manifest: ExtensionPackManifest; raw: string } | null>(null);
  /** 外すかどうかを確かめている途中（使っている動画の数つき）。 */
  const [removing, setRemoving] = useState<{ manifest: ExtensionPackManifest; used: number } | null>(null);

  async function onPick(): Promise<void> {
    setNotice("");
    setError("");
    setBusy(true);
    try {
      const path = await showOpenExtensionPackDialog();
      if (!path) return;
      const r = await inspectPackFile(path);
      if (r.ok) setPending({ path, manifest: r.manifest, raw: r.raw });
      else setError(r.message);
    } finally {
      setBusy(false);
    }
  }

  async function onInstall(): Promise<void> {
    if (!pending) return;
    setBusy(true);
    try {
      const r = await installInspectedPack(pending.path, pending.manifest, pending.raw);
      if (r.ok) setNotice(packInstalledMessage(pending.manifest.name));
      else setError(r.message);
      setPending(null);
    } finally {
      setBusy(false);
    }
  }

  async function onAskRemove(m: ExtensionPackManifest): Promise<void> {
    setNotice("");
    setError("");
    setBusy(true);
    try {
      setRemoving({ manifest: m, used: await countVideosUsingPack(m.packId) });
    } finally {
      setBusy(false);
    }
  }

  async function onRemove(): Promise<void> {
    if (!removing) return;
    setBusy(true);
    try {
      const r = await removeInstalledPack(removing.manifest.packId);
      if (r.ok) setNotice(packRemovedMessage(removing.manifest.name));
      else setError(r.message);
      setRemoving(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" data-testid="extension-pack-section">
      <h2 className="section-title">拡張パック</h2>
      <p className="page-desc text-pretty">
        配られた拡張パックを入れると、見た目パターン・文字の形・音楽・声・機能が増えます。入れる前に、中身と使ってよい範囲を確かめられます。
      </p>

      <div className="row">
        <button type="button" className="btn btn-primary" disabled={busy || otherBusy || pending != null} title={busyTitle} onClick={() => void onPick()}>
          {busy && !pending ? "読んでいます…" : "拡張パックを入れる…"}
        </button>
      </div>
      {notice && <p className="field-hint mt">{notice}</p>}
      {error && <p className="form-error mt" role="alert">{error}</p>}
      {skipped.length > 0 && <p className="form-error mt" role="alert">{packSkippedMessage(skipped)}</p>}
      {voicesSkipped.length > 0 && <p className="form-error mt" role="alert">{packVoiceSkippedMessage(voicesSkipped)}</p>}
      {voiceRestartError && <p className="form-error mt" role="alert">{voiceRestartError}</p>}

      {pending && (
        <div className="card mt" data-testid="extension-pack-confirm">
          <h3 className="section-title">「{pending.manifest.name}」を入れますか？</h3>
          <ul className="list-reset">
            <li>作った人：{pending.manifest.publisher}</li>
            <li>版：{pending.manifest.version}</li>
            {pending.manifest.description && <li>説明：{pending.manifest.description}</li>}
            <li>中身：{packContentsSummary(pending.manifest)}</li>
            <li>使ってよい範囲：</li>
            {pending.manifest.licenses.map((l) => (
              <li key={l.target} className="text-sm">
                ・{PACK_CONTENT_LABEL[l.target]}：{l.license}
                {l.credit ? `（表記：${l.credit}）` : ""}
              </li>
            ))}
          </ul>
          <div className="row mt">
            <button type="button" className="btn btn-primary" disabled={busy || otherBusy} title={busyTitle} onClick={() => void onInstall()}>
              {busy ? "入れています…" : "入れる"}
            </button>
            <button type="button" className="btn" disabled={busy} onClick={() => setPending(null)}>
              やめる
            </button>
          </div>
        </div>
      )}

      <div className="mt">
        {packs.length === 0 ? (
          <p className="field-hint">まだ入れていません。</p>
        ) : (
          <ul className="list-reset">
            {packs.map((m) =>
              removing?.manifest.packId === m.packId ? (
                <li key={m.packId}>
                  <DeleteConfirm
                    busy={busy}
                    confirmLabel="外す"
                    busyLabel="外しています…"
                    message={packRemoveConfirmMessage(m.name, removing.used)}
                    onCancel={() => setRemoving(null)}
                    onConfirm={() => void onRemove()}
                  />
                </li>
              ) : (
                <li key={m.packId} style={{ display: "flex", alignItems: "center", gap: "var(--gap-sm)" }}>
                  <span style={{ flex: 1 }}>
                    <strong>{m.name}</strong>
                    <span className="text-sm text-muted">（{m.version}・{m.publisher}）</span>
                    <br />
                    <span className="text-sm text-muted">{packContentsSummary(m)}</span>
                  </span>
                  <button type="button" className="btn" disabled={busy || otherBusy} title={busyTitle} onClick={() => void onAskRemove(m)}>
                    外す
                  </button>
                </li>
              ),
            )}
          </ul>
        )}
      </div>
    </div>
  );
}
