// ユーザー素材ライブラリ（ADR-0035・#260）。動画をまたいで使い回す素材の置き場。
//
// ⚠️ **取り込みは「コピー」**（決定3）＝置いた素材はこの動画のものになる。ライブラリから消しても、
// 既に取り込んだ動画は影響を受けない（プロジェクトは自己完結・ADR-0024 決定6）。
// ⚠️ **技術用語を出さない**（§2-3）＝「ライブラリ」は定着しているので使うが、
// 「アセット」「マニフェスト」「グローバル」は出さない。見出しは「よく使う素材」。
import { useEffect, useState } from "react";
import { isExportBusy, useProjectStore } from "../store/projectStore";
import { isTimelineExportBusy, useTimelineStore } from "../store/timelineStore";
import { DeleteConfirm } from "./DeleteConfirm";
import { isListedMaterial } from "../../domain/asset/assetFile";
import { showOpenLibraryAssetsDialog } from "../../infrastructure/dialog";
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
import { ASSET_TYPE, PROJECT_FORMAT, isFreeSlotAssetType } from "../../domain/enums";
import type { AssetType } from "../../domain/enums";

/** 種類の絞り込み（画面に出す名前）。 */
const TYPE_CHOICES: { label: string; value: AssetType | null }[] = [
  { label: "すべて", value: null },
  { label: "写真", value: ASSET_TYPE.image },
  { label: "動画", value: ASSET_TYPE.video },
  { label: "ロゴ", value: ASSET_TYPE.logo },
  { label: "音楽", value: ASSET_TYPE.bgm },
];

/**
 * 「種類」で選べる選択肢（差分再監査 2巡目）。
 *
 * ⚠️ **中身から決まるものは付け替えさせない**＝写真↔動画↔音を変えると、**中身と種類がずれた素材**が
 * できる（絵を動画スロットへ置けてしまい、書き出しの分岐を外れる）。拡張子で決まる種類はそのまま。
 * ⚠️ **絵の中での付け替えだけ許す**（写真 ⇄ ロゴ）＝ロゴは拡張子では判らないので、ここでしか選べない。
 * ⚠️ **いまの値は必ず選択肢に入れる**＝手で書いた目録の値（`yuko` 等）でも、開いた瞬間に
 * 別の種類が選ばれた顔にならない（触らなければ変わらない）。
 */
function editableTypeChoices(current: AssetType): { label: string; value: AssetType }[] {
  const pictures: { label: string; value: AssetType }[] = [
    { label: "写真", value: ASSET_TYPE.image },
    { label: "ロゴ", value: ASSET_TYPE.logo },
  ];
  if (pictures.some((c) => c.value === current)) return pictures;
  const label = TYPE_CHOICES.find((c) => c.value === current)?.label ?? "そのまま";
  return [{ label, value: current }];
}

/**
 * よく使う素材（ADR-0035）の棚。**どちらの形式からも使える**（差分再監査 4巡目 🟡）。
 *
 * ⚠️ **タイムラインには入口が無かった**＝「どの動画からでも取り込める」という棚の目的が
 * **片方の形式で成立していない**（ADR-0026②）。取り込み先を差し替えられるようにする。
 */
export function AssetLibraryPanel({ target }: { target?: "timeline" } = {}) {
  const [items, setItems] = useState<LibraryAsset[]>([]);
  const [text, setText] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [assetType, setAssetType] = useState<AssetType | null>(null);
  const [busy, setBusy] = useState(false);
  // ⚠️ **外すのは確認を通す**（α-6 出口監査 🟡27）＝同じ画面の素材削除は必ず確認を通すのに、
  // ここだけ1クリックで消えていた（同じ画面に「確認する削除」と「1クリック削除」を同居させない）。
  const [confirming, setConfirming] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  // ⚠️ **種類も直せる**（差分再監査）＝**ロゴはファイル名から判らない**（拡張子は写真と同じ）ので、
  // 置いたあとに選ぶしかない。選べないと ADR-0036 の「いつものロゴ」が**どこからも設定できない**。
  const [editing, setEditing] = useState<{ id: string; name: string; tags: string; assetType: AssetType } | null>(null);
  const importToScene = useProjectStore((s) => s.importFromLibrary);
  const importToTimeline = useTimelineStore((s) => s.importFromLibrary);
  const timelineName = useTimelineStore((s) => s.doc?.projectName);
  // ⚠️ **判定材料も置かれた画面の側で決める**（PR #913 レビュー 🟡）＝行き先がタイムラインなのに
  // 場面形式の状態を見ると、**タイムラインが書き出し中・取り込み中でも押せて**、中で静かに弾かれる。
  const sceneImporting = useProjectStore((s) => s.isImporting);
  const timelineImporting = useTimelineStore((s) => s.isImporting);
  const timelineExporting = useTimelineStore((s) => isTimelineExportBusy(s.exportRun.phase));
  const isImporting = target === PROJECT_FORMAT.timeline ? timelineImporting : sceneImporting;
  /**
   * 取り込み先の**場面形式の動画の名前**（差分再監査 4巡目 🔴）。
   *
   * ⚠️ **タイムラインが載っているだけで塞がない**＝両形式は同時に開いたままにでき、**閉じる導線が
   * 無い**ので、塞ぐと一度タイムラインを開いた**セッション中ずっと**取り込めなくなる（しかも
   * 理由は事実と違う）＝解除できない行き止まり（§2-5）。**どの動画へ入るかは名前で解く**。
   */
  const sceneName = useProjectStore((s) => s.meta.projectName);
  const destName = target === PROJECT_FORMAT.timeline ? timelineName : sceneName;
  const sceneExporting = useProjectStore((s) => isExportBusy(s.exportRun.phase));
  const isExporting = target === PROJECT_FORMAT.timeline ? timelineExporting : sceneExporting;
  const brandKit = useProjectStore((s) => s.brandKit);
  const updateBrandKit = useProjectStore((s) => s.updateBrandKit);

  // ⚠️ **「読めなかった」を「1つも無い」に見せない**（差分再監査・§2-5）＝空を出すと、
  // 置いてあるものが**消えたように見える**（持ち込みフォント側と同じ流儀＝`null` は「まだ分からない」）。
  const [unreadable, setUnreadable] = useState(false);
  const refresh = async (): Promise<void> => {
    const list = await listLibraryAssets();
    setUnreadable(list == null);
    if (list) setItems(list);
  };
  useEffect(() => {
    // ⚠️ **effect の中で同期に setState しない**（lint）＝一覧の読み込みは非同期なので、
    // `then` の中で入れる（読み込み前は空のまま＝「まだ何も置いていません」は出さない）。
    let alive = true;
    void listLibraryAssets().then((list) => {
      if (!alive) return;
      setUnreadable(list == null);
      if (list) setItems(list);
    });
    return () => {
      alive = false;
    };
  }, []);

  // ⚠️ **書き出し中も押せなくする**（α-6 出口監査 🟡15）＝すぐ隣の「素材を追加」は押す前に無効化＋理由なのに、
  // ここだけ押せて**画面上部のバナー**で断っていた（同じ「取り込み」で断り方が2通り＝ADR-0026②）。
  const working = busy || isImporting || isExporting;
  // ⚠️ **入れる先が無いときは取り込ませない**（差分再監査 5巡目 🟡・`06 §15`）＝「素材」は
  // 動画を開いていなくても開ける画面なので、そのまま押せると**画面に出ていない空の動画**が
  // その場で作られ、そこへ入って**どこにも見えない**（知らせも名無しの「この動画へ」になる）。
  // 判定は会社の見た目の反映と同じ式（`meta.projectId` か場面がある）＝同概念で流儀を割らない。
  const sceneOpen = useProjectStore((s) => s.meta.projectId !== "" || s.scenes.length > 0);
  const destOpen = target === PROJECT_FORMAT.timeline ? timelineName != null : sceneOpen;
  const importBlocked = working || !destOpen;
  // 押せない理由は必ず添える（押せないのに理由が出ない、を作らない＝§2-5・`MaterialsScreen` と同じ文言）。
  // ⚠️ **理由は押せない相手にだけ添える**（PR #912 レビュー 🟡）＝タイムラインの理由を共通の
  // `title` に混ぜると、**押せる**「置く」「名前・種類・タグ」「外す」にも「取り込めません」と出て、
  // 実際にできる操作に対して**間違った次の行動**を示すことになる（§2-5）。
  /** 棚の操作（置く・直す・外す）が押せない理由。 */
  const blockedReason = isExporting
    ? "書き出しが終わるまでお待ちください"
    : isImporting
      ? "いま取り込んでいます"
      : undefined;
  /** 取り込み（この動画で使う）が押せない理由。棚の操作の理由に「入れる先が無い」が加わる。 */
  const importBlockedReason = blockedReason ?? (destOpen ? undefined : "先に動画を開いてください");
  const shown = filterLibraryAssets(items, { text, tags, assetType });
  const allTags = libraryTags(items);

  async function onAdd(): Promise<void> {
    setNotice("");
    setError("");
    setBusy(true);
    try {
      // ⚠️ **音楽も選べる口を使う**（差分再監査）＝ADR-0035 は棚の中身に**ロゴ・写真・BGM**を
      // 挙げているのに、写真・動画しか選べず「音楽」のタブが常に0件だった。
      const paths = await showOpenLibraryAssetsDialog();
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
    // ⚠️ **取り込み先は置かれた画面で決まる**＝タイムラインの欄からはタイムラインの文書へ入れる。
    if (target === PROJECT_FORMAT.timeline) {
      // ⚠️ **できたときだけ知らせる**（PR #913 レビュー 🔴）＝返り値を見ないと、失敗しても
      // 「取り込みました」と出て、画面下の本当の理由と**同時に**並ぶ（成功を騙る）。
      if (!(await importToTimeline(a.id))) return;
      const dest = destName ? `「${destName}」` : "この動画";
      // ⚠️ **どの欄から置けるかは種類で変わる**（差分再監査 5巡目 🟡）＝音は「素材・文字・図形を置く」の
      // 候補に出ない（絵として置ける種別だけ＝`isFreeSlotAssetType`）ので、種類を見ずに1文で言うと
      // **案内どおり探しても見つからない**（場面形式で同じ形を直したのと同型＝§2-5）。
      setNotice(
        isFreeSlotAssetType(a.assetType)
          ? `「${a.displayName}」を${dest}へ取り込みました。「素材・文字・図形を置く」から置けます。`
          : `「${a.displayName}」を${dest}へ取り込みました。音は「音を置く」から置けます。`,
      );
      return;
    }
    const id = await importToScene(a.id);
    // 失敗の文言は取り込みと同じ場所（`importError`）に出る＝ここでは成功したときだけ知らせる。
    // ⚠️ **どこに増えたかは種類で変わる**（α-6 出口監査 🟡29）＝音（BGM・読み上げ）は**素材の一覧に出ない**
    //（`isListedMaterial`）ので、「素材の一覧に増えています」と言うと**案内どおり探しても見つからない**（§2-5）。
    if (id) {
      // ⚠️ **どの動画へ入ったかを名指しする**（差分再監査 4巡目 🔴）＝開いている文書は2種類あるので、
      // 「この動画へ」だけでは**どちらのことか分からない**（塞ぐ代わりに名前で解く）。
      const dest = destName ? `「${destName}」` : "この動画";
      setNotice(
        isListedMaterial(a.assetType)
          ? `「${a.displayName}」を${dest}へ取り込みました。素材の一覧に増えています。`
          : `「${a.displayName}」を${dest}へ取り込みました。音は素材の一覧には並びません。「動画を保存」のBGMから選べます。`,
      );
    }
  }

  async function onDelete(a: LibraryAsset): Promise<void> {
    setConfirming(null);
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
      // ⚠️ **覚え直しの失敗を握りつぶさない**（差分再監査・§2-5）＝`updateBrandKit` は投げずに
      // `false` を返して**画面の側を巻き戻す**ようになった（🟡23）。戻り値を捨てると、キットは
      // 消した素材を指したまま「外しました」と出て、**新しい動画を作るたびにロゴの取り込みが失敗**する。
      // 理由（`brandKitError`）はこの画面には出ないので、ここで受けて出す。
      const brandOk = wasBrandLogo ? await updateBrandKit({ ...brandKit, logoLibraryAssetId: undefined }) : true;
      await refresh();
      // ⚠️ **既に取り込んだ動画は影響を受けない**ことを伝える（コピーだから＝不安を残さない）。
      setNotice(
        wasBrandLogo && brandOk
          ? `「${a.displayName}」を置き場から外し、会社の見た目のロゴも外しました。取り込み済みの動画はそのまま使えます。`
          : `「${a.displayName}」を置き場から外しました。取り込み済みの動画はそのまま使えます。`,
      );
      // ⚠️ **できなかったことは言う**＝素材は外れたが、会社の見た目は消した素材を指したまま。
      if (wasBrandLogo && !brandOk) {
        setError("会社の見た目のロゴを外せませんでした。設定の「会社の見た目」から選び直してください。");
      }
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
        editing.assetType,
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

      {/* ⚠️ **絞り込みの作法は素材画面と同じにする**（α-6 出口監査 🟡28）＝この欄は素材画面の中に
          あり、**すぐ下に別の絞り込みが縦に並んで見える**。種類＝タブ／探す＝「名前やタグで探す」／
          消す＝「絞り込みをやめる」を揃える（同じ画面で作法を2つ持たない）。 */}
      <div className="row gap-sm row-wrap mt" style={{ alignItems: "center" }}>
        {/* ⚠️ **どちらの棚のタブか**を名前で分ける＝同じ画面にタブが2組並ぶ（下は素材の種類）。 */}
        <div className="segment" role="group" aria-label="よく使う素材の種類" style={{ display: "inline-flex" }}>
          {TYPE_CHOICES.map((c) => (
            <button
              key={c.label}
              type="button"
              className={assetType === c.value ? "active" : ""}
              onClick={() => setAssetType(c.value)}
            >
              {c.label}
            </button>
          ))}
        </div>
        <input
          className="input"
          style={{ maxWidth: 220 }}
          type="search"
          // ⚠️ **同じ画面に同じ名前の欄を2つ置かない**＝この欄は素材画面の中にあり、すぐ下に
          // 素材の絞り込みが並ぶ。作法（タブ＋探す＋やめる）は揃えたうえで、**どちらの棚か**を名前で分ける。
          aria-label="よく使う素材を名前やタグで探す"
          placeholder="名前やタグで探す"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        {text !== "" && (
          <button type="button" className="btn btn-ghost text-sm" onClick={() => setText("")}>
            絞り込みをやめる
          </button>
        )}
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

      {/* ⚠️ **件数に依らず出す**（差分再監査 2巡目）＝一度読めたあとに読めなくなると**古い一覧を
          そのまま見せて何も言わない**（外したはずの行が残る）。兄弟2か所（持ち込みフォント・
          会社の見た目）は件数を見ずに出しているので、同じ状態の見せ方を揃える（ADR-0026②）。 */}
      {unreadable && (
        <p className="form-error mt" role="alert">
          よく使う素材の一覧を読めませんでした。ここに出ているものは古いかもしれません。アプリを開き直してから、もう一度お試しください。
        </p>
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
            {shown.map((a) => (confirming === a.id ? (
              <li key={a.id}>
                <DeleteConfirm
                  busy={working}
                  confirmLabel="外す"
                  busyLabel="外しています…"
                  message={`「${a.displayName}」を置き場から外しますか？元に戻せません。取り込み済みの動画はそのまま使えます。`}
                  onCancel={() => setConfirming(null)}
                  onConfirm={() => void onDelete(a)}
                />
              </li>
            ) : (
              // ⚠️ **どの行を直しているか分かるようにする**（α-6 出口監査 ℹ️）＝欄は一覧の下に出るので、
              // 印が無いと**どれを直しているのか**が分からない（一覧が長いほど分からない）。
              <li
                key={a.id}
                aria-current={editing?.id === a.id ? "true" : undefined}
                style={{
                  display: "flex", alignItems: "center", gap: "var(--gap-sm)",
                  ...(editing?.id === a.id
                    ? { borderLeft: "3px solid var(--color-accent)", paddingLeft: 6, background: "var(--color-surface-alt)" }
                    : {}),
                }}
              >
                <span style={{ flex: 1 }}>
                  {a.displayName}
                  {a.tags.length > 0 && <span className="text-sm text-muted">（{a.tags.join("・")}）</span>}
                </span>
                <button type="button" className="btn btn-secondary" disabled={importBlocked} title={importBlockedReason} onClick={() => void onImport(a)}>
                  この動画で使う
                </button>
                <button
                  type="button"
                  className="btn"
                  disabled={working}
                  title={blockedReason}
                  onClick={() => setEditing({ id: a.id, name: a.displayName, tags: a.tags.join("、"), assetType: a.assetType })}
                >
                  名前・種類・タグ
                </button>
                <button type="button" className="btn" disabled={working} title={blockedReason} onClick={() => setConfirming(a.id)}>
                  外す
                </button>
              </li>
            )))}
          </ul>
        )}
      </div>

      {editing && (
        <div className="mt">
          {/* ⚠️ **何を直しているかを欄にも書く**（α-6 出口監査 ℹ️）＝一覧の印と両方あると迷わない。 */}
          <p className="field-hint">「{items.find((x) => x.id === editing.id)?.displayName ?? editing.name}」の名前とタグを直しています。</p>
          <label className="field">
            <span className="field-label">名前</span>
            <input
              className="input"
              value={editing.name}
              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
            />
          </label>
          <label className="field">
            <span className="field-label">種類</span>
            {/* ⚠️ **ロゴはここでしか選べない**＝拡張子では写真と区別できない（ADR-0036 の「いつものロゴ」）。
                ⚠️ **選べるのは絵の種類だけ**（差分再監査 2巡目）＝写真↔動画↔音を付け替えると、
                中身と種類がずれた素材ができる（絵を動画スロットへ置けてしまう）。中身から決まるもの
                （写真・動画・音）は**取り込んだときのまま**にし、ここでは「写真 ⇄ ロゴ」だけ選べる。 */}
            <select
              className="input"
              value={editing.assetType}
              onChange={(e) => setEditing({ ...editing, assetType: e.target.value as AssetType })}
            >
              {editableTypeChoices(editing.assetType).map((c) => (
                <option key={c.label} value={c.value}>{c.label}</option>
              ))}
            </select>
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
