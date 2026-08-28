import { useEffect, useState } from "react";
import type { PrecheckItem, ScreenId } from "../data/mockData";
import type { Scene } from "../../domain/project/types";
import { isExportBusy, useProjectStore, type StandardLookApplyResult } from "../store/projectStore";
import { buildPrecheckItems, exportBlockedMessage, isExportBlocking } from "../adapters";
import { useExportCapability } from "../hooks/useExportCapability";
import { standardLookFixesForUnresolved } from "../../domain/template/templateSelection";
import { standardLookButtonReason, standardLookResultMessage } from "../uiLabels";
import { PageHead } from "../components/ui";
import { BulkVoiceControls } from "../components/BulkVoiceControls";
import { ExportLockBanner } from "../components/ExportLockBanner";
import { CheckIcon, ChevronRightIcon, ArrowLeftIcon } from "../components/icons";
import { NoScenesState } from "../components/NoScenesState";
import { EXPORT_CAPABILITY_NOTICE, blocksExport } from "../../domain/export/exportCapability";

interface PrecheckProps {
  onNavigate: (screen: ScreenId) => void;
}

const severityStyle: Record<PrecheckItem["severity"], { label: string; color: string; bg: string }> = {
  ok: { label: "問題なし", color: "var(--color-success)", bg: "var(--color-primary-soft)" },
  warning: { label: "注意", color: "var(--color-warn)", bg: "var(--color-yellow)" },
  action: { label: "要対応", color: "var(--color-danger)", bg: "var(--color-danger-soft)" },
};

export function PrecheckScreen({ onNavigate }: PrecheckProps) {
  const { status, scenes, assets, templates, meta, autoGenerateIfSafe, setEditingSceneId, narrationError, applyStandardLookToUnresolvedScenes, missingAssetIds, refreshMissingAssets, userFontIds, refreshUserFonts } = useProjectStore();
  const isExporting = useProjectStore((s) => isExportBusy(s.exportRun.phase)); // 書き出し中は声作成を止める（#570 P2）
  const undo = useProjectStore((s) => s.undo);
  // 「まとめて標準にする」の結果（直した件数・入れ直しが要る場面）。この画面に取り消しの入口が無いため
  // 「取り消す」もここに添える（他画面へ移動して Ctrl+Z、を強いない・#547 P1-1 の方針は変えない）。語彙は UndoRedoButtons と統一。
  // 適用直後の scenes 参照も控える：この画面の「声を作成」は履歴を積まない（narration.status を直接書く）ため、
  // その後に undo() すると**声の作成まで巻き戻る**。場面が変わったら「取り消す」は出さない（無関係な編集を消さない）。
  const [lookFix, setLookFix] = useState<{ result: StandardLookApplyResult; scenesRef: Scene[] } | null>(null);
  const lookFixResult = lookFix?.result ?? null;
  const canUndoLookFix = lookFix != null && lookFix.scenesRef === scenes;
  // 書き出し能力（標準方式 h264_mf の可用性）の事前検知（#120）。書き出し画面と**同じフック**を使う（検知を1か所に）。
  const capability = useExportCapability();

  // 自動生成は Mock（外部送信なし）のときだけ（#384・§2-6）。実プロバイダは空状態のまま。
  useEffect(() => {
    void autoGenerateIfSafe();
  }, [status, autoGenerateIfSafe]);

  // ⚠️ **開くたびに調べ直す**（#347）＝素材はアプリの外で動かされるので、書き出す直前に確かめる。
  useEffect(() => { void refreshMissingAssets(); }, [refreshMissingAssets]);
  // 持ち込みフォント（#261）も同じ理由で開くたびに調べ直す＝アプリの外で消されうる。
  useEffect(() => { void refreshUserFonts(); }, [refreshUserFonts]);

  // 場面ゼロは「全項目問題なし」に見えて書き出しに進めてしまう（押すと保存先選択後に失敗）＝空状態で止める（#403）。
  if (scenes.length === 0) {
    return (
      <div className="main-scroll">
        <PageHead title="公開前チェック" desc="動画を書き出す前に内容を点検します。" />
        <ExportLockBanner onNavigate={onNavigate} />
        <NoScenesState purpose="ここで公開前チェックができます" onNavigate={onNavigate} />
      </div>
    );
  }

  const baseItems = buildPrecheckItems(
    scenes, assets, templates, meta.timelineOverlay?.animations, missingAssetIds, meta.bgmSettings?.assetId,
    // ⚠️ `userFontIds` が `null`（まだ調べていない）なら渡さない＝嘘の「問題なし」を出さない（#347 と同じ流儀）。
    { projectFontId: meta.videoSettings.fontId, ...(userFontIds ? { availableUserFontIds: userFontIds } : {}) },
  );
  // 書き出し能力チェックを先頭に差し込む（取得できた場合のみ・#120）。
  const capNotice = capability ? EXPORT_CAPABILITY_NOTICE[capability] : null;
  const items: PrecheckItem[] = capNotice
    ? [
        { id: "export-capability", label: capNotice.label, detail: capNotice.detail, severity: capNotice.severity },
        ...baseItems,
      ]
    : baseItems;
  const count = (s: PrecheckItem["severity"]) => items.filter((i) => i.severity === s).length;
  // 書き出し不可（unavailable/toolMissing）のときだけ事前にブロック。fallback は予備方式で書き出せるので進める。
  const capabilityBlocked = capability != null && blocksExport(capability);
  // 残っていると書き出しが**必ず失敗する**項目（見た目欠け・動画配置不可・再生タイミング＝#547 P2-5）。
  // 「直せば良くなる」警告（字幕が長い・声が未作成）とは分け、主ボタンを止める根拠にする。
  // 止めないと、保存先を選ばせた後に §2-5 エラーで落ちる＝手戻りが大きい（ADR-0026④）。
  // 書き出し画面の「動画を保存」と**同じ述語**を使う（片方だけ別条件で止めない・ADR-0026②）。
  // 既に算出済みの items を絞るだけ＝重い buildPrecheckItems を二度走らせない。
  const blockingItems = items.filter(isExportBlocking);
  // 「まとめて標準にする」で直せる場面（store の一括適用と**同じ判定**＝押せるのに何も起きない、を作らない）。
  const standardFixes = standardLookFixesForUnresolved(scenes, templates, meta.videoSettings.aspectRatio);
  const exportBlocked = capabilityBlocked || blockingItems.length > 0;

  return (
    <div className="main-scroll">
      <PageHead
        title="公開前チェック"
        desc="動画を書き出す前に内容を点検しました。気になる項目は直してから進めましょう。"
      />

      {/* サマリ */}
      <div className="card-grid cols-3 mb">
        <div className="card text-center">
          <div className="page-title" style={{ color: "var(--color-danger)" }}>{count("action")}</div>
          <div className="text-muted text-sm">要対応</div>
        </div>
        <div className="card text-center">
          <div className="page-title" style={{ color: "var(--color-warn)" }}>{count("warning")}</div>
          <div className="text-muted text-sm">注意</div>
        </div>
        <div className="card text-center">
          <div className="page-title" style={{ color: "var(--color-success)" }}>{count("ok")}</div>
          <div className="text-muted text-sm">問題なし</div>
        </div>
      </div>

      {/* チェック結果一覧 */}
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: 120 }}>状態</th>
              <th style={{ width: 180 }}>項目</th>
              <th>内容</th>
              <th style={{ width: 140 }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const s = severityStyle[item.severity];
              return (
                <tr key={item.id}>
                  <td>
                    <span className="badge" style={{ background: s.bg, color: s.color }}>
                      {item.severity === "ok" && <CheckIcon size={12} />}
                      {s.label}
                    </span>
                  </td>
                  <td>
                    <strong>{item.label}</strong>
                  </td>
                  <td className="text-pretty">{item.detail}</td>
                  <td>
                    {item.action ? (
                      item.id === "voice" ? (
                        // 「声を作成」はラベルどおりその場で一括生成する（従来は場面編集へ飛ぶだけだった＝#403）。
                        // 進捗・中止は他画面と同じ共通操作を使う（この画面だけ進捗が無かった＝#547 P2-6・ADR-0026②）。
                        <span className="col gap-xs" style={{ alignItems: "flex-start" }}>
                          <BulkVoiceControls label={item.action} buttonClassName="btn btn-ghost btn-icon text-sm" />
                        </span>
                      ) : item.id === "sceneTemplate" ? (
                        // 見た目が見つからない場面（TEMPLATE_NOT_FOUND）。自動では置換しない方針なので、
                        // 「1つずつ選び直す」と「まとめて標準に寄せる」の**どちらも利用者が選べる**ようにする（15 §3）。
                        <span className="row gap-sm">
                          <button
                            className="btn btn-ghost btn-icon text-sm"
                            onClick={() => {
                              if (item.sceneId) setEditingSceneId(item.sceneId);
                              onNavigate("scene-edit");
                            }}
                          >
                            {item.action}
                          </button>
                          <button
                            className="btn btn-ghost btn-icon text-sm"
                            onClick={() => {
                              const result = applyStandardLookToUnresolvedScenes();
                              setLookFix({ result, scenesRef: useProjectStore.getState().scenes });
                            }}
                            disabled={standardFixes.length === 0 || isExporting}
                            title={standardLookButtonReason(standardFixes.length, isExporting)}
                          >
                            まとめて標準にする
                          </button>
                        </span>
                      ) : (
                        // その他（字幕を短く/動画を直す）は該当場面を指定してから場面編集へ（#400）。
                        <button
                          className="btn btn-ghost btn-icon text-sm"
                          onClick={() => {
                            if (item.sceneId) setEditingSceneId(item.sceneId);
                            onNavigate("scene-edit");
                          }}
                        >
                          {item.action}
                        </button>
                      )
                    ) : (
                      <span className="text-faint text-sm">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* 「まとめて標準にする」の結果（#547）。件数だけでなく**中身が減った場面**まで示す＝直った風に見えて
          写真が外れたまま書き出す、を作らない（15 §5 の「3件を自動調整、1件は確認が必要」流儀・ADR-0026④）。
          全部直ると該当行ごと消えるので、表の中ではなく外に出す。 */}
      {lookFixResult && standardLookResultMessage(lookFixResult) !== "" && (
        <div className={`notice ${lookFixResult.lostContent.length > 0 || lookFixResult.unfixable.length > 0 ? "notice-warn" : ""} mt`} role="status">
          <span>{standardLookResultMessage(lookFixResult)}</span>
          {lookFixResult.fixed.length > 0 && canUndoLookFix && (
            <button
              className="btn btn-ghost text-sm"
              disabled={isExporting}
              title={isExporting ? "書き出しが終わるまでお待ちください" : undefined}
              onClick={() => {
                undo();
                setLookFix(null);
              }}
            >
              取り消す
            </button>
          )}
        </div>
      )}

      {/* 声の一括生成に失敗したとき（VOICEVOX 未起動など）は「次の行動」を示す（§2-5）。 */}
      {narrationError && (
        <div className="notice notice-warn mt" role="alert">
          <span>{narrationError}</span>
        </div>
      )}

      {/* 操作 */}
      <div className="row-between mt-lg">
        <button className="btn btn-ghost btn-icon" onClick={() => onNavigate("scene-edit")}>
          <ArrowLeftIcon size={16} />
          場面編集へ戻る
        </button>
        <div className="col gap-xs" style={{ alignItems: "flex-end" }}>
          <button
            className="btn btn-primary btn-lg"
            onClick={() => onNavigate("export")}
            disabled={exportBlocked}
          >
            このまま書き出す
            <ChevronRightIcon size={18} />
          </button>
          {capabilityBlocked ? (
            <span className="text-sm" style={{ color: "var(--color-danger)" }}>
              この端末では動画を保存できません。上の確認結果で問題の項目を解消してから、もう一度お試しください。
            </span>
          ) : blockingItems.length > 0 ? (
            <span className="text-sm" style={{ color: "var(--color-danger)" }}>
              {exportBlockedMessage(blockingItems, "precheck")}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
