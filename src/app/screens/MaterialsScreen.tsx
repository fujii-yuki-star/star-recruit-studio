import { useEffect, useRef, useState, type ChangeEvent } from "react";
import type { Asset } from "../../domain/project/types";
import type { ScreenId } from "../data/mockData";
import { ASSET_TYPE } from "../../domain/enums";
import { isListedMaterial } from "../../domain/asset/assetFile";
import { pickPanelAsset } from "./materialsSelection";
import { AssetThumb } from "../components/AssetThumb";
import { scenesUsingAsset, unusedAssetIds } from "../../domain/project/assetUsage";
import { hasOpenProject, isExportBusy, useProjectStore } from "../store/projectStore";
import { useTimelineStore } from "../store/timelineStore";
import { IMPORT_NO_PROJECT_MESSAGE, IMPORT_TIMELINE_OPEN_MESSAGE } from "../uiLabels";
import { PageHead, Switch } from "../components/ui";
import { AssetImportButton } from "../components/AssetImportButton";
import { ExportLockBanner } from "../components/ExportLockBanner";
import { NoticeZone } from "../components/NoticeZone";
import { EmptyState } from "../components/states";
import { ClipDetailControls } from "../components/ClipDetailControls";
import { AssetLibraryPanel } from "../components/AssetLibraryPanel";
import { CaptureFrameControls } from "../components/CaptureFrameControls";
import { showOpenAssetsDialog } from "../../infrastructure/dialog";
import { isTauri } from "../../infrastructure/assetFs";
import { UsedScenesRow } from "../components/UsedScenesRow";
import { DeleteConfirm } from "../components/DeleteConfirm";
import { assetTagCounts, matchesAssetQuery } from "../../domain/project/assetSearch";
import {
  UploadIcon,
  PlusIcon,
  TrashIcon,
  CheckIcon,
} from "../components/icons";

/**
 * 候補として見せるタグの数（#858）。多すぎると一覧が候補で埋まる。
 * 見た目ピッカーの `DEFAULT_VISIBLE`（`PickerList`）と同じ「一度に見せる数」の考え方。
 */
const VISIBLE_TAG_CHOICES = 8;

type Filter = "all" | "image" | "video" | "yuko";

// 音声系（BGM/ナレーション）は素材一覧に出さない（BGMは仕上がり確認で選ぶ）ため、音タブも持たない。
const filters: [Filter, string][] = [
  ["all", "すべて"],
  ["image", "写真"],
  ["video", "動画"],
  ["yuko", "ゆうこ"],
];

const VISUAL_TYPES: Asset["assetType"][] = [
  ASSET_TYPE.image,
  ASSET_TYPE.logo,
  ASSET_TYPE.yuko,
  ASSET_TYPE.qr,
  ASSET_TYPE.decor,
];
const isVisual = (type: Asset["assetType"]) => VISUAL_TYPES.includes(type);


export function MaterialsScreen({ onNavigate }: { onNavigate: (s: ScreenId) => void }) {
  const { assets, scenes, templates, meta, updateAsset, removeAsset, removeAssets, assetSrcById, setAssetImage, relinkAssetByPath, missingAssetIds, refreshMissingAssets, importError, clearImportError, isImporting, setEditingSceneId } = useProjectStore();
  // 書き出し中は素材の追加/削除/編集を止める（store 側も #547 P2-1 でガード＝ここは無言 no-op を避ける表示側・ADR-0026④）。
  // 進行中の書き出しが読むファイル/データと競合するため（プロジェクト切替 loadProject 等は #379 で既にガード済み）。
  const isExporting = useProjectStore((s) => isExportBusy(s.exportRun.phase));
  // ⚠️ **入れる先が無いときも押せない**（差分再監査 6巡目 🟡）＝棚からの取り込みだけ塞ぐと、
  // 同じ「取り込み」で断り方が2通りになる（ADR-0026②）。判定は共有の1つから採る。
  const projectOpen = useProjectStore(hasOpenProject);
  // ⚠️ **「開いていない」と言い切らない**（#991）＝この画面が扱うのは**場面形式の素材**だが、
  // タイムライン形式を開いている人には「先に動画を開くか、新しく作る」が**嘘**に見える（開いているので）。
  // ⚠️ **次の行動も変わる**＝そちらの素材は**その編集画面から**取り込む。
  const timelineOpen = useTimelineStore((s) => s.doc != null);
  const addDisabled = isImporting || isExporting || !projectOpen; // 取り込み中・書き出し中・行き先なしは押せない
  const [filter, setFilter] = useState<Filter>("all");
  /** 名前・タグの絞り込み（#858）。⚠️ **文書に依存する状態は覚えない**（ADR-0034 決定14）。 */
  const [query, setQuery] = useState("");
  /** 使っていないものだけを見る（#348）。同じく覚えない。 */
  const [unusedOnly, setUnusedOnly] = useState(false);
  /** まとめて消す前の確認（#348）。`null`＝出していない。 */
  const [bulkConfirm, setBulkConfirm] = useState<string[] | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [newTag, setNewTag] = useState("");
  // 素材名は編集中だけドラフトで持ち、確定は blur。空/未変更は破棄して元の名前へ戻す＝素材名を空にできないようにする（#411 item7・ProjectNameField と同型）。
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  // 素材削除は取り消せない（assets は Undo 対象外＝ADR-0020）ので、他の削除と同様にインライン確認を挟む（#383）。
  // id で持つ＝別の素材を選び直したら確認は自動的に解除される。
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  // 画像差し替えの file input（label ラップでなく button+ref.click()＝キーボードで押せる・BgmPicker と同方式・#412）
  const imageInputRef = useRef<HTMLInputElement>(null);

  // 音声系（BGM/ナレーション）は「素材」一覧に出さない（BGMは仕上がり確認で選ぶ）。
  // ⚠️ **絞りの規則は1か所**（`isListedMaterial`・§2-7）＝ここに書き写すと、見つからない素材を
  // 調べる側（`refreshMissingAssets`）とずれた瞬間に「一覧に出ないものが見つかりませんに数えられる」。
  const materials = assets.filter((a) => isListedMaterial(a.assetType));
  // ⚠️ **タグは付けられるのに探せなかった**（#858）＝付与UI も AI 利用も動いているのに、
  // 一覧の絞り込みは**種類だけ**だった。名前とタグの両方で絞れるようにする。
  // 規則は domain の1か所（`matchesAssetQuery`）＝画面で数え直さない。
  // 取り消し・やり直しで戻る場面（この先の `unusedAssetIds` が数える）。
  const historyPast = useProjectStore((s) => s.past);
  const historyFuture = useProjectStore((s) => s.future);
  const byType = materials.filter((a) => filter === "all" || a.assetType === filter);
  // ⚠️ **種類とは別の軸**（#348）＝種類のタブに5つ目として混ぜると「どこにも置いていない動画だけ」が
  // 見られなくなる。掛け合わせられるように独立させる。
  // ⚠️ **判定は「どこからも指されていない」**（`unusedAssetIds`）＝公開前チェックの「使っていない素材」
  //（＝動画に出るか）とは**別の規則**。あちらは「そのままでよい」警告だが、こちらは**消す判断**で、
  // 間違えると取り消せない（`assets` は履歴の外＝ADR-0020/0028）。だから休眠も数えて**安全側**へ倒す。
  // ⚠️ **取り消しで戻る場面も数える**（α-6 出口監査 🔴）＝場面を消した／写真を外した直後に
  // まとめて消すと、取り消しても素材は戻らない（実体ファイルごと消えている）。
  const unusedIds = new Set(unusedAssetIds(
    materials, scenes, meta.bgmSettings?.assetId,
    [...historyPast, ...historyFuture].map((snap) => snap.scenes),
  ));
  const byUse = unusedOnly ? byType.filter((a) => unusedIds.has(a.assetId)) : byType;
  // ⚠️ **件数も種類で絞った後で数える**＝タブと掛け合わせたとき、チェックの数と下の
  // 「いま出ているNつ」が食い違わない（レビュー 🟡）。
  const unusedInView = byType.filter((a) => unusedIds.has(a.assetId)).length;
  // 確認に出す中身は**押した瞬間に控えた id** から引き直す（絞り込みを変えても中身がずれない）。
  const confirmTargets = bulkConfirm ? assets.filter((a) => bulkConfirm.includes(a.assetId)) : [];
  const visible = byUse.filter((a) => matchesAssetQuery(a, query));
  // 候補のタグは**絞り込んだ後**から集める＝押しても0件になる候補を出さない。
  const tagChoices = assetTagCounts(byUse);
  // 右パネルは「表示中（フィルタ後）」の中からだけ選ぶ＝フィルタ0件のとき別フィルタの素材を出さない（#413）。
  const selected = pickPanelAsset(visible, selectedId);
  // この素材を使っている場面（逆引き・#406）。削除確認の件数（#383）と「使用場面」バッジで共有する。
  // 実効テンプレでゲート＝FREE→通常で休眠した素材を「使用場面」に出さない・事前確認と同一規則（ADR-0030）。
  const usedScenes = selected ? scenesUsingAsset(scenes, selected.assetId, (s) => templates.find((t) => t.templateId === s.templateId)) : [];
  const usedSceneCount = usedScenes.length;
  // 使用場面バッジを押したら、その場面の編集を開く（editingSceneId 機構＝#400・DraftScreen と同方式）。
  const jumpToScene = (sceneId: string) => { setEditingSceneId(sceneId); onNavigate("scene-edit"); };

  function addTag() {
    const v = newTag.trim();
    if (!v || !selected) return;
    const tags = selected.tags ?? [];
    if (!tags.includes(v)) updateAsset(selected.assetId, (a) => ({ ...a, tags: [...(a.tags ?? []), v] }));
    setNewTag("");
  }

  // ⚠️ **開いたときに調べ直す**（#347）＝素材は**アプリの外**で動かされる（移動・削除・別PCへ持ち込み）。
  // 一度きり読み込み時に調べるだけだと、開きっぱなしのまま消されたときに気づけない。
  useEffect(() => { void refreshMissingAssets(); }, [refreshMissingAssets, assets.length]);

  /** ファイルが見つからない素材（#347）。 */
  const missing = new Set(missingAssetIds);

  /** 素材のファイルを選び直す（再リンク＝`assetId` は変わらないので配置も紐づけも残る）。 */
  async function onRelink(assetId: string) {
    const paths = await showOpenAssetsDialog();
    if (paths[0]) await relinkAssetByPath(assetId, paths[0]);
  }

  function onPickImage(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !selected) return;
    void setAssetImage(selected.assetId, file);
    // 同じファイルを選び直しても change が発火するよう値をクリアする。
    e.target.value = "";
  }

  return (
    <div className="main-scroll">
      <PageHead
        title="素材を管理"
        desc="動画に使う写真・動画・音・ゆうこの素材を管理します。説明やタグを付けると、ゆうこが使いどころを判断しやすくなります。"
        actions={
          <AssetImportButton
            store={useProjectStore}
            disabledReason={addDisabled ? (isExporting ? "書き出しが終わるまでお待ちください" : isImporting ? "いま取り込んでいます" : timelineOpen ? IMPORT_TIMELINE_OPEN_MESSAGE : IMPORT_NO_PROJECT_MESSAGE) : null}
          />
        }
      />

      <NoticeZone>
        {importError && (
          <div className="notice notice-warn row-between mb" role="alert">
            <span>{importError}</span>
            <button className="btn btn-ghost text-sm" onClick={clearImportError}>閉じる</button>
          </div>
        )}

        {/* ⚠️ **見つからない素材は書き出す前に知らせる**（#347・§2-5）＝黙って抜けた動画を成功として
            出さない。次の行動は**そのファイルを選び直す**（`assetId` は変わらないので、置いた場所も
            切り出す範囲も字幕の紐づけもそのまま戻る）。 */}
        {missingAssetIds.length > 0 && (
          <div className="notice notice-warn mb" role="alert">
            {missingAssetIds.length}つの素材のファイルが見つかりません。動かしたか、消えている可能性があります。
            その素材を選んで「ファイルを選び直す」から入れ直してください（置いた場所や設定はそのまま残ります）。
          </div>
        )}

        {/* 書き出し中の案内は共通バナーに寄せる（#547 P2-1）。以前はこの画面だけ独自文言で、進捗も戻る導線も無かった
            ＝同じ状況なのに画面ごとに見え方が違う（§2-7・ADR-0026②）。素材操作を実際に試したときの個別案内は
            store の `EXPORT_BUSY_ASSET_MSG`（importError）が出す。 */}
        <ExportLockBanner onNavigate={onNavigate} />
      </NoticeZone>

      {/* よく使う素材（ADR-0035・#260）＝動画をまたいで使い回す置き場。この動画の素材とは別の棚で、
          取り込みは**コピー**（プロジェクトは自己完結・ADR-0024 決定6）。 */}
      <div className="mb">
        <AssetLibraryPanel />
      </div>

      <div className="row gap-sm row-wrap mb" style={{ alignItems: "center" }}>
        <div className="segment" role="group" aria-label="素材の種類" style={{ display: "inline-flex" }}>
          {filters.map(([id, label]) => (
            <button key={id} className={filter === id ? "active" : ""} onClick={() => { setFilter(id); setBulkConfirm(null); }}>
              {label}
            </button>
          ))}
        </div>
        {/* ⚠️ **名前とタグの両方で探せる**（#858）＝どちらで覚えているか分からないので片方だけにしない。
            言い方は他の画面と揃える（場面編集の「素材を検索」・見た目ピッカーの「絞り込み」）＝
            「検索」「絞り込み」は一般語なので §2-3 の対象外（ADR-0034 決定21）。 */}
        <input
          className="input"
          style={{ maxWidth: 220 }}
          type="search"
          aria-label="名前やタグで探す"
          placeholder="名前やタグで探す"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setBulkConfirm(null); }}
        />
        {query !== "" && (
          <button className="btn btn-ghost text-sm" onClick={() => { setQuery(""); setBulkConfirm(null); }}>
            絞り込みをやめる
          </button>
        )}
        {/* ⚠️ **種類とは別の軸**（#348）＝種類のタブに混ぜると「使っていない動画だけ」が見られない。
            件数を出す＝押す前に「片づけるものがあるか」が分かる（空振りの操作を作らない）。 */}
        <label className="row gap-sm text-sm" style={{ alignItems: "center", cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={unusedOnly}
            onChange={(e) => { setUnusedOnly(e.target.checked); setBulkConfirm(null); }}
          />
          どこにも置いていないものだけ（{unusedInView}）
        </label>
      </div>

      {/* ⚠️ **まとめて消せるのは「いま見えているもの」だけ**（#348）＝絞り込みで隠れているものまで
          消えると、押した本人にも何が消えたか分からない（§2-5）。件数と名前を先に見せてから消す。
          ⚠️ **取り消せない**（`assets` は履歴の外＝ADR-0028）ので、他の削除と同じく確認を挟む（#383）。 */}
      {/* ⚠️ **たたき台を作る前は出さない**（レビュー ℹ️）＝場面が無いと**全部が「どこにも置いていない」**に
          なる。素材は**AI への入力**でもある（`12 §6` 利用可能な素材・`12 §8.3` poseTag）ので、
          生成のために取り込んだ一式が1押しで消える。 */}
      {unusedOnly && visible.length > 0 && scenes.length > 0 && (
        <div className="row gap-sm row-wrap mb" style={{ alignItems: "center" }}>
          {bulkConfirm === null ? (
            <button
              className="btn btn-secondary text-sm"
              disabled={isExporting}
              title={isExporting ? "書き出しが終わるまでお待ちください" : undefined}
              onClick={() => setBulkConfirm(visible.map((a) => a.assetId))}
            >
              いま出ている{visible.length}つをまとめて消す
            </button>
          ) : (
            /* ⚠️ **共有の確認を通す**（#990）＝手書きだったので、**焦点の移動も `Escape` も
                名簿への名乗りも無く**、さらに **`削除する` → `やめる` の順**で `06 §2-1` の
                【やめる（左）／削除する（右）】と**逆**だった＝`.row` は素の flex なので
                見た目も `Tab` の順も**取り返しのつかない側が先**になっていた。 */
            <DeleteConfirm
              className="row-between"
              message={
                <>
                  {/* ⚠️ **名前も「押した瞬間のもの」から引く**（レビュー 🔴）＝生きている一覧から
                      作ると、確認を出したまま種類タブや言葉を変えたときに**見せている名前と消えるもの**
                      がずれる。 */}
                  {confirmTargets.length}つの素材を削除します（
                  {confirmTargets.slice(0, 3).map((a) => a.displayName).join("、")}
                  {confirmTargets.length > 3 ? ` ほか${confirmTargets.length - 3}つ` : ""}）。元に戻せません。
                </>
              }
              onCancel={() => setBulkConfirm(null)}
              onConfirm={() => { removeAssets(bulkConfirm); setBulkConfirm(null); }}
            />
          )}
        </div>
      )}

      {/* ⚠️ **押して絞れる候補を出す**（#858）＝自由入力だけだと打ち間違いで見つからない。
          候補は**種類で絞った後**から集める＝押しても0件になる候補を出さない。 */}
      {tagChoices.length > 0 && (
        <div className="row gap-sm row-wrap mb" style={{ alignItems: "center" }}>
          <span className="text-sm text-muted">よく使うタグ：</span>
          {tagChoices.slice(0, VISIBLE_TAG_CHOICES).map(({ tag, count }) => (
            <button
              key={tag}
              className={`badge ${query === tag ? "badge-teal" : "badge-gray"}`}
              // 押した候補をもう一度押したら解除＝同じ操作で戻れる（行き止まりを作らない）。
              onClick={() => { setQuery((q) => (q === tag ? "" : tag)); setBulkConfirm(null); }}
            >
              {tag}（{count}）
            </button>
          ))}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: "var(--gap-lg)", alignItems: "start" }}>
        {/* 左: 素材グリッド */}
        {visible.length > 0 ? (
          <div className="card-grid cols-3">
            {visible.map((a) => (
              <button
                key={a.assetId}
                className="action-card"
                style={{
                  borderColor: selected?.assetId === a.assetId ? "var(--color-primary)" : undefined,
                  background: selected?.assetId === a.assetId ? "var(--color-primary-soft)" : undefined,
                }}
                onClick={() => setSelectedId(a.assetId)}
              >
                <AssetThumb type={a.assetType} src={assetSrcById[a.assetId]} />
                <span className="action-card-title" style={{ marginTop: 6 }}>
                  {a.displayName}
                </span>
                <div className="row gap-sm row-wrap" style={{ justifyContent: "center" }}>
                  {/* ⚠️ **どれが見つからないのか一覧で分かる**＝案内だけだと探し回ることになる。 */}
                  {missing.has(a.assetId) && <span className="badge badge-yellow">見つかりません</span>}
                  {a.isPublicChecked ? (
                    <span className="badge badge-teal">
                      <CheckIcon size={12} /> 確認済み
                    </span>
                  ) : (
                    <span className="badge badge-gray">未確認</span>
                  )}
                </div>
              </button>
            ))}
          </div>
        ) : (
          // ⚠️ **「元から無い」と「絞り込みで消えた」を分ける**（§2-5）＝絞り込みで0件のときに
          // 「まだありません」と出すと、**追加しに行かせてしまう**（実際には持っている）。
          query !== "" ? (
            <EmptyState
              title="その言葉の素材は見つかりません"
              message="ほかの言葉で探すか、上の「絞り込みをやめる」で全部に戻せます。"
            />
          ) : unusedOnly ? (
            // ⚠️ **これは良い知らせ**（#348）＝「無い」ではなく「全部置けている」と言う。
            // 「まだありません」と出すと、片づけに来た人に**素材を追加しに行かせてしまう**。
            <EmptyState
              title="どこにも置いていない素材はありません"
              message="いまある素材はすべて、どこかの場面に置かれています。上のチェックを外すと全部に戻せます。"
            />
          ) : (
            // ⚠️ **押せないボタンを案内しない**（差分再監査 7巡目 🟡・§2-5）＝動画を開いていないときは
            // 「素材を追加」が押せないのに、案内はそのボタンを指したままだった（理由はホバーにしか
            // 出ないので、押しに行って初めて分かる）。その場に次の行動を出す。
            <EmptyState
              title="この種類の素材はまだありません"
              message={projectOpen
                ? "「素材を追加」から、写真・動画・ゆうこの素材を登録できます。BGMは仕上がり確認で選べます。"
                : timelineOpen
                  // ⚠️ **開いているのに「開いてください」と言わない**（#991・§2-5）＝ここは
                  // 場面から作る動画の素材置き場。タイムラインで作る動画の素材は、その画面で取り込む。
                  ? "この画面は、場面から作る動画の素材置き場です。いま開いているタイムラインの動画へ入れるなら、その編集画面から取り込んでください。"
                  : "素材はどの動画に入れるかが決まってから登録します。先に動画を開くか、新しく作ってください。"}
            />
          )
        )}

        {/* 右: 選択中の素材の情報 */}
        {selected && (
          <div className="card">
            <h2 className="section-title">素材の情報</h2>
            <div style={{ maxWidth: 160, margin: "0 auto var(--gap)" }}>
              <AssetThumb type={selected.assetType} src={assetSrcById[selected.assetId]} size={28} />
            </div>

            {/* ⚠️ **ファイルを選び直す**（#347）＝`assetId` は変えないので、置いた場所・切り出す範囲・
                キーフレーム・字幕の紐づけは**そのまま残る**（ADR-0024＝Asset は元素材の源泉）。
                見つからないときの復旧と、使ったまま別のファイルへ差し替える、の両方をこれ1つで賄う。
                アプリの中だけに出す＝ブラウザにはネイティブの「開く」が無く、押しても何も起きない
                （§2-5＝押せるのに何も起きない、を作らない）。 */}
            {isTauri() && (
              <div className="field">
                {/* ⚠️ **上のバナーと同じ文を繰り返さない**（§6・この画面の既存の流儀）＝状況は上、
                    どれかは一覧の印、直し方はこのボタン、と役割を分ける。見つからないときは
                    ボタンを目立たせる（探し当てた先で「これを押せばいい」が分かる）。 */}
                <button
                  type="button"
                  className={missing.has(selected.assetId) ? "btn btn-primary" : "btn btn-secondary"}
                  disabled={isImporting || isExporting}
                  title={isExporting ? "書き出しが終わるまでお待ちください" : isImporting ? "いま取り込んでいます" : undefined}
                  onClick={() => void onRelink(selected.assetId)}
                >
                  <UploadIcon size={16} />
                  ファイルを選び直す
                </button>
                <p className="text-sm text-muted" style={{ marginTop: 4 }}>
                  置いた場所・切り出す範囲・字幕の結びつきはそのまま、中身のファイルだけを入れ替えます。
                </p>
              </div>
            )}

            {isExporting && (
              <p className="text-sm text-muted" style={{ margin: "0 0 var(--gap)" }}>
                {/* 上のバナーと同じ文を繰り返さない（同じ画面に同じ案内を二度出さない・§6）。ここは編集欄が消えた理由だけ。 */}
                書き出しが終わると、ここで編集できます。
              </p>
            )}
            {/* 書き出し中は編集控えを丸ごと隠す（無言 no-op を避ける＝ADR-0026④・store も #547 P2-1 でガード）。使用場面は下で常に表示。 */}
            {!isExporting && (
            <>
            {/* 動画クリップの「素材の既定」を編集（使う範囲・速度・元音声）。ここは asset.clip＝全場面の既定・Undo 対象外（ADR-0028 D3）。
                場面ごとの調整は場面編集の per-use（scene.slotClips）で（そちらは Undo 可）。 */}
            {selected.assetType === ASSET_TYPE.video && (
              <ClipDetailControls
                asset={selected}
                clip={selected.clip}
                scope="material"
                patchClip={(p) => updateAsset(selected.assetId, (a) => ({ ...a, clip: { ...a.clip, ...p } }))}
              />
            )}

            {/* 動画から静止画を切り出す（#349）。**普通の写真素材として増える**（ADR-0024＝Asset は源泉）。 */}
            {selected.assetType === ASSET_TYPE.video && <CaptureFrameControls asset={selected} />}

            {isVisual(selected.assetType) && (
              <div className="field">
                <label className="field-label">画像</label>
                {/* ネイティブの「ファイル未選択」表示を避けたボタン。label ラップでなく button+ref.click()
                    ＝Tab フォーカス・:disabled 見た目が効く（BgmPicker と同方式・#412） */}
                <input
                  ref={imageInputRef}
                  key={selected.assetId}
                  type="file"
                  accept="image/*"
                  onChange={onPickImage}
                  disabled={isImporting}
                  hidden
                />
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={isImporting}
                  onClick={() => imageInputRef.current?.click()}
                >
                  <UploadIcon size={16} />
                  {assetSrcById[selected.assetId] ? "画像を変更する" : "画像を選ぶ"}
                </button>
                <p className="text-sm text-muted" style={{ marginTop: 4 }}>
                  {assetSrcById[selected.assetId]
                    ? "この素材に画像を設定済みです（仕上がり確認の枠に表示）。差し替えるには「画像を変更する」から選び直してください。"
                    : "画像を選ぶと、仕上がり確認のこの素材の枠に表示されます。"}
                </p>
              </div>
            )}

            <div className="field">
              <label className="field-label" htmlFor="mat-name">名前</label>
              <input
                id="mat-name"
                className="input"
                value={nameDraft ?? selected.displayName}
                onFocus={() => setNameDraft(selected.displayName)}
                onChange={(e) => setNameDraft(e.target.value)}
                onBlur={() => {
                  const name = (nameDraft ?? "").trim();
                  if (name && name !== selected.displayName) updateAsset(selected.assetId, (a) => ({ ...a, displayName: name }));
                  setNameDraft(null); // 空・未変更は破棄＝元の名前に戻す（素材名を空にできない・#411）
                }}
              />
            </div>

            <div className="field">
              <label className="field-label" htmlFor="mat-desc">説明</label>
              <textarea
                id="mat-desc"
                className="textarea"
                value={selected.description ?? ""}
                placeholder="例：若手社員が作業しているオフィス写真"
                onChange={(e) => updateAsset(selected.assetId, (a) => ({ ...a, description: e.target.value }))}
              />
            </div>

            <div className="field">
              <label className="field-label">タグ</label>
              <div className="chip-input-row">
                {(selected.tags ?? []).map((t) => (
                  <span className="chip" key={t}>
                    {t}
                    <button
                      aria-label={`${t}を削除`}
                      onClick={() =>
                        updateAsset(selected.assetId, (a) => ({ ...a, tags: (a.tags ?? []).filter((x) => x !== t) }))
                      }
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
              <div className="row gap-sm">
                <input
                  className="input"
                  value={newTag}
                  placeholder="タグを追加"
                  onChange={(e) => setNewTag(e.target.value)}
                  onKeyDown={(e) => { if (!e.nativeEvent.isComposing && e.key === "Enter") addTag(); }}
                />
                <button className="btn btn-secondary" onClick={addTag}>
                  <PlusIcon size={16} />
                  追加
                </button>
              </div>
            </div>

            <div className="toggle-row">
              <span className="field-label" style={{ margin: 0 }}>公開チェック済み</span>
              <Switch
                on={selected.isPublicChecked ?? false}
                onChange={(v) => updateAsset(selected.assetId, (a) => ({ ...a, isPublicChecked: v }))}
                label="公開チェック済み"
              />
            </div>
            </>
            )}

            {/* 使用場面の逆引き（#406）：この素材を使っている場面へ1クリックで飛べる。削除の前に影響範囲も分かる。 */}
            <hr className="divider" />
            <div className="field" style={{ marginBottom: 0 }}>
              <label className="field-label">使用場面</label>
              <UsedScenesRow scenes={usedScenes} onJump={jumpToScene} emptyText="まだどの場面でも使われていません。" />
            </div>

            {!isExporting && (confirmDeleteId === selected.assetId ? (
              <DeleteConfirm
                className="mt"
                message={
                  <>
                    「{selected.displayName || "この素材"}」を削除しますか？元に戻せません。
                    {/* ⚠️ **取り消しで戻る場面も見る**（`/canon-check` ℹ️）＝「まとめて消す」側は
                        数えているのに、1件削除は**いまの場面だけ**を見て「どこでも使われていません」と
                        言い切っていた（同じ穴が入口違いで残る＝ADR-0026②）。素材は履歴の外なので、
                        消したあとに取り消しても戻らない＝**先に言う**（§2-5）。 */}
                    {usedSceneCount > 0
                      ? `使っている${usedSceneCount}つの場面は、この素材が空欄になります。`
                      : unusedIds.has(selected.assetId)
                        ? "この素材はどの場面でも使われていません。"
                        : "いまはどの場面でも使われていませんが、「元に戻す」で戻る場面が使っています。削除すると、元に戻しても素材は戻りません。"}
                  </>
                }
                onCancel={() => setConfirmDeleteId(null)}
                onConfirm={() => {
                  removeAsset(selected.assetId);
                  setConfirmDeleteId(null);
                }}
              />
            ) : (
              <button className="btn btn-danger btn-block mt" onClick={() => setConfirmDeleteId(selected.assetId)}>
                <TrashIcon size={16} />
                この素材を削除
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
