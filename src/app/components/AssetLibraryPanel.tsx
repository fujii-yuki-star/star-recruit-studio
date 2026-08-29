// ユーザー素材ライブラリ（ADR-0035・#260）。動画をまたいで使い回す素材の置き場。
//
// ⚠️ **取り込みは「コピー」**（決定3）＝置いた素材はこの動画のものになる。ライブラリから消しても、
// 既に取り込んだ動画は影響を受けない（プロジェクトは自己完結・ADR-0024 決定6）。
// ⚠️ **技術用語を出さない**（§2-3）＝「ライブラリ」は定着しているので使うが、
// 「アセット」「マニフェスト」「グローバル」は出さない。見出しは「よく使う素材」。
import { useEffect, useState } from "react";
import { isExportBusy, useProjectStore } from "../store/projectStore";
import { showOpenAssetsDialog } from "../../infrastructure/dialog";
import {
  addLibraryAsset,
  deleteLibraryAsset,
  listLibraryAssets,
  usedLibraryAssetIds,
  updateLibraryAsset,
} from "../../infrastructure/assetLibraryFs";
import {
  createLibraryAssetId,
  filterLibraryAssets,
  libraryTags,
  type LibraryAsset,
} from "../../domain/asset/assetLibrary";
import { detectAssetType, fileNameOf, UNNAMED_ASSET_NAME } from "../../domain/asset/assetFile";
import { libraryPartlyFailedMessage } from "../uiLabels";
import { ASSET_TYPE } from "../../domain/enums";
import type { AssetType } from "../../domain/enums";

/** 種類の絞り込み（画面に出す名前）。 */
const TYPE_CHOICES: { label: string; value: AssetType | null }[] = [
  { label: "すべて", value: null },
  { label: "写真", value: ASSET_TYPE.image },
  { label: "動画", value: ASSET_TYPE.video },
  { label: "ロゴ", value: ASSET_TYPE.logo },
  { label: "音楽", value: ASSET_TYPE.bgm },
];

export function AssetLibraryPanel() {
  const [items, setItems] = useState<LibraryAsset[]>([]);
  const [text, setText] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [assetType, setAssetType] = useState<AssetType | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<{ id: string; name: string; tags: string } | null>(null);
  const importFromLibrary = useProjectStore((s) => s.importFromLibrary);
  const isImporting = useProjectStore((s) => s.isImporting);
  const isExporting = useProjectStore((s) => isExportBusy(s.exportRun.phase));
  const brandKit = useProjectStore((s) => s.brandKit);
  const updateBrandKit = useProjectStore((s) => s.updateBrandKit);

  const refresh = async (): Promise<void> => {
    setItems(await listLibraryAssets());
  };
  useEffect(() => {
    // ⚠️ **effect の中で同期に setState しない**（lint）＝一覧の読み込みは非同期なので、
    // `then` の中で入れる（読み込み前は空のまま＝「まだ何も置いていません」は出さない）。
    let alive = true;
    void listLibraryAssets().then((list) => {
      if (alive) setItems(list);
    });
    return () => {
      alive = false;
    };
  }, []);

  // ⚠️ **書き出し中も押せなくする**（α-6 出口監査 🟡15）＝すぐ隣の「素材を追加」は押す前に無効化＋理由なのに、
  // ここだけ押せて**画面上部のバナー**で断っていた（同じ「取り込み」で断り方が2通り＝ADR-0026②）。
  const working = busy || isImporting || isExporting;
  // 押せない理由は必ず添える（押せないのに理由が出ない、を作らない＝§2-5・`MaterialsScreen` と同じ文言）。
  const blockedReason = isExporting
    ? "書き出しが終わるまでお待ちください"
    : isImporting
      ? "いま取り込んでいます"
      : undefined;
  const shown = filterLibraryAssets(items, { text, tags, assetType });
  const allTags = libraryTags(items);

  async function onAdd(): Promise<void> {
    setNotice("");
    setError("");
    setBusy(true);
    try {
      const paths = await showOpenAssetsDialog();
      if (paths.length === 0) return;
      // ⚠️ **1件ずつ順に採番する**（まとめて採ると重なる）。
      // ⚠️ **「これまでに使った番号」から採る**＝消した番号は使い回さない（α-6 出口監査 🟡8）。
      // 一覧は実体があるものだけなので、最大番号を外すと同じ番号が再発行される。
      let known = await usedLibraryAssetIds();
      let added = 0;
      // ⚠️ **途中で失敗しても、置けたぶんは残して数える**（α-6 出口監査 🟡16・§2-5）＝
      // まとめて投げて途中でこけると「全部失敗した」と読め、**もう一度押して二重に置く**。
      const failedNames: string[] = [];
      let firstMessage: string | null = null;
      for (const path of paths) {
        const name = fileNameOf(path);
        const id = createLibraryAssetId(known);
        try {
          await addLibraryAsset(id, name.replace(/\.[^.]+$/, "") || UNNAMED_ASSET_NAME, detectAssetType(name), [], path);
          known = [...known, id];
          added += 1;
        } catch (e) {
          failedNames.push(name || UNNAMED_ASSET_NAME);
          firstMessage ??= typeof e === "string" ? e : "素材を置けませんでした。もう一度お試しください。";
        }
      }
      await refresh();
      if (added > 0) setNotice(`${added}件を置きました。動画から「この動画で使う」で取り込めます。`);
      // ⚠️ **1件だけ失敗したときは理由をそのまま出す**（件数で案内を変えない＝ADR-0026②・`addAssets` と同じ）。
      if (failedNames.length === 1) setError(firstMessage ?? "");
      else if (failedNames.length > 1) setError(libraryPartlyFailedMessage(failedNames, firstMessage));
    } catch (e) {
      setError(typeof e === "string" ? e : "素材を置けませんでした。もう一度お試しください。");
    } finally {
      setBusy(false);
    }
  }

  async function onImport(a: LibraryAsset): Promise<void> {
    setNotice("");
    setError("");
    const id = await importFromLibrary(a.id);
    // 失敗の文言は取り込みと同じ場所（`importError`）に出る＝ここでは成功したときだけ知らせる。
    if (id) setNotice(`「${a.displayName}」をこの動画へ取り込みました。素材の一覧に増えています。`);
  }

  async function onDelete(a: LibraryAsset): Promise<void> {
    setNotice("");
    setError("");
    setBusy(true);
    try {
      // ⚠️ **消す前に「会社の見た目が指しているか」を覚える**＝下で書き換えるので、
      // 判定を後回しにすると（読むタイミング次第で）知らせと実際がずれる。
      const wasBrandLogo = brandKit.logoLibraryAssetId === a.id;
      await deleteLibraryAsset(a.id);
      // ⚠️ **会社の見た目が指したままにしない**（PR #888 レビュー 🟡）＝消した素材を指し続けると、
      // 新しい動画を作るたびに「ロゴを取り込めませんでした」になる（直す道が分かりにくい）。
      if (wasBrandLogo) await updateBrandKit({ ...brandKit, logoLibraryAssetId: undefined });
      await refresh();
      // ⚠️ **既に取り込んだ動画は影響を受けない**ことを伝える（コピーだから＝不安を残さない）。
      setNotice(
        wasBrandLogo
          ? `「${a.displayName}」を置き場から外し、会社の見た目のロゴも外しました。取り込み済みの動画はそのまま使えます。`
          : `「${a.displayName}」を置き場から外しました。取り込み済みの動画はそのまま使えます。`,
      );
    } catch (e) {
      setError(typeof e === "string" ? e : "素材を外せませんでした。もう一度お試しください。");
    } finally {
      setBusy(false);
    }
  }

  async function onSaveEdit(): Promise<void> {
    if (!editing) return;
    setBusy(true);
    try {
      await updateLibraryAsset(
        editing.id,
        editing.name,
        editing.tags.split(/[,、\s]+/).map((t) => t.trim()).filter(Boolean),
      );
      await refresh();
      setEditing(null);
    } catch (e) {
      setError(typeof e === "string" ? e : "直せませんでした。もう一度お試しください。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h2 className="section-title">よく使う素材</h2>
      <p className="page-desc text-pretty">
        会社のロゴや写真をここに置いておくと、どの動画からでも取り込めます。取り込んだ素材はその動画のものになるので、
        ここから外しても取り込み済みの動画はそのまま使えます。
      </p>

      <div className="row">
        <button type="button" className="btn btn-primary" disabled={working} title={blockedReason} onClick={() => void onAdd()}>
          {busy ? "置いています…" : "素材を置く"}
        </button>
      </div>

      <div className="row mt" style={{ flexWrap: "wrap" }}>
        <label className="field" style={{ margin: 0, flex: 1, minWidth: 180 }}>
          <span className="field-label">名前で探す</span>
          <input className="input" value={text} placeholder="例：ロゴ" onChange={(e) => setText(e.target.value)} />
        </label>
        <label className="field" style={{ margin: 0 }}>
          <span className="field-label">種類</span>
          <select
            className="input"
            value={TYPE_CHOICES.find((c) => c.value === assetType)?.label ?? "すべて"}
            onChange={(e) => setAssetType(TYPE_CHOICES.find((c) => c.label === e.target.value)?.value ?? null)}
          >
            {TYPE_CHOICES.map((c) => (
              <option key={c.label} value={c.label}>{c.label}</option>
            ))}
          </select>
        </label>
      </div>

      {allTags.length > 0 && (
        <div className="field">
          <span className="field-label">タグで絞る</span>
          {/* ⚠️ **選ぶほど狭まる**（すべて含む＝AND）＝タグを足すと候補が減る、が直感に合う。 */}
          <div className="chip-input-row">
            {allTags.map((t) => (
              <button
                key={t}
                type="button"
                className={tags.includes(t) ? "badge badge-teal" : "badge badge-gray"}
                aria-pressed={tags.includes(t)}
                onClick={() => setTags((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]))}
              >
                {t}
              </button>
            ))}
            {tags.length > 0 && (
              <button type="button" className="btn btn-ghost text-sm" onClick={() => setTags([])}>
                絞り込みをやめる
              </button>
            )}
          </div>
        </div>
      )}

      {notice && <p className="field-hint mt">{notice}</p>}
      {error && <p className="form-error mt" role="alert">{error}</p>}

      <div className="mt">
        {items.length === 0 ? (
          <p className="field-hint">まだ何も置いていません。「素材を置く」から、よく使う写真やロゴを入れてください。</p>
        ) : shown.length === 0 ? (
          // ⚠️ **絞り込みで0件のときは「無い」と言わない**＝条件を外せば見えることを伝える（行き止まりにしない）。
          <p className="field-hint">条件に合う素材がありません。名前・種類・タグを変えてみてください。</p>
        ) : (
          <ul className="list-reset">
            {shown.map((a) => (
              <li key={a.id} style={{ display: "flex", alignItems: "center", gap: "var(--gap-sm)" }}>
                <span style={{ flex: 1 }}>
                  {a.displayName}
                  {a.tags.length > 0 && <span className="text-sm text-muted">（{a.tags.join("・")}）</span>}
                </span>
                <button type="button" className="btn btn-secondary" disabled={working} title={blockedReason} onClick={() => void onImport(a)}>
                  この動画で使う
                </button>
                <button
                  type="button"
                  className="btn"
                  disabled={working}
                  title={blockedReason}
                  onClick={() => setEditing({ id: a.id, name: a.displayName, tags: a.tags.join("、") })}
                >
                  名前とタグ
                </button>
                <button type="button" className="btn" disabled={working} title={blockedReason} onClick={() => void onDelete(a)}>
                  外す
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {editing && (
        <div className="mt">
          <label className="field">
            <span className="field-label">名前</span>
            <input
              className="input"
              value={editing.name}
              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
            />
          </label>
          <label className="field">
            <span className="field-label">タグ（読点・カンマ・空白で区切る）</span>
            <input
              className="input"
              value={editing.tags}
              placeholder="例：会社、ロゴ"
              onChange={(e) => setEditing({ ...editing, tags: e.target.value })}
            />
          </label>
          <div className="row">
            <button type="button" className="btn btn-primary" disabled={working} onClick={() => void onSaveEdit()}>
              直す
            </button>
            <button type="button" className="btn" onClick={() => setEditing(null)}>やめる</button>
          </div>
        </div>
      )}
    </div>
  );
}
