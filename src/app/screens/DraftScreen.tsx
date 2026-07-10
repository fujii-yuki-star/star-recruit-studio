import { useEffect, useState } from "react";
import type { ScreenId } from "../data/mockData";
import { useProjectStore } from "../store/projectStore";
import { useDragReorder } from "../hooks/useDragReorder";
import { willSendExternally } from "../../infrastructure/aiClient";
import { ORIENTATION, type Orientation } from "../../domain/enums";
import { narrationProgress } from "../../domain/voice/narrationProgress";
import { sceneNeedsVoice } from "../../domain/project/narrationLines";
import { sceneToDraftRow, warningsToDraftWarnings } from "../adapters";
import { PageHead } from "../components/ui";
import { WarningBanner, VoiceStatusBadge, EmptyState } from "../components/states";
import { YukoPanel } from "../components/YukoPanel";
import {
  CheckIcon,
  SparkleIcon,
  PlusIcon,
  TrashIcon,
  PlayIcon,
  PhotoIcon,
  VideoIcon,
} from "../components/icons";

// 向きの表示名（§2-3：技術語を出さない）。
function orientationLabel(o: Orientation): string {
  return o === ORIENTATION.portrait ? "縦型（9:16）" : "横型（16:9）";
}

interface DraftProps {
  onNavigate: (screen: ScreenId) => void;
}

export function DraftScreen({ onNavigate }: DraftProps) {
  const { status, draftFromAi, scenes, parts, templates, assets, warnings, meta, generate, autoGenerateIfSafe, addScene, removeScene, moveScene, moveSceneToIndex, duplicateScene, changeOrientation, setEditingSceneId, setConfirmReturnTo, setPreviewReturnTo, generateAllNarrations, isGeneratingNarration, undo, redo } =
    useProjectStore();
  // 取り消し/やり直し（ADR-0020・#413）。たたき台の削除/並べ替えも戻せる（キーボード Ctrl+Z/Y は App で全画面有効）。
  const canUndo = useProjectStore((s) => s.past.length > 0);
  const canRedo = useProjectStore((s) => s.future.length > 0);
  // 行の「セリフ/素材/見た目」から場面編集を開くとき、その場面を指定してから遷移（#400）。
  const editScene = (sceneId: string) => { setEditingSceneId(sceneId); onNavigate("scene-edit"); };
  // 場面のドラッグ&ドロップ並び替え（#398）。持ち手（順番セルのグリップ）を掴んで任意の行へ落とす。↑/↓ も併存（下記・キーボード用）。
  const dnd = useDragReorder(moveSceneToIndex);
  const aspectRatio = meta.videoSettings.aspectRatio;
  // 行ごと削除の二段確認（誤操作防止）。確認中の行 id。
  const [confirmId, setConfirmId] = useState<string | null>(null);
  // 「作り直す」は手直し内容を丸ごと破棄して再生成する（Undo 不可＝generate は履歴を積まない）ので確認を挟む（#383）。
  const [confirmRegen, setConfirmRegen] = useState(false);
  // 向き変更の結果メッセージ（§2-5：何が起きたか＋次の行動）。
  const [orientationMsg, setOrientationMsg] = useState<{ warn: boolean; text: string } | null>(null);
  // 「全場面の声を作成」の完了メッセージ。remaining＝作成後もまだ声が要る場面数（0＝全部できた／>0＝一部失敗）。null=非表示。
  const [voiceResult, setVoiceResult] = useState<{ remaining: number } | null>(null);

  function switchOrientation() {
    const target = aspectRatio === ORIENTATION.portrait ? ORIENTATION.landscape : ORIENTATION.portrait;
    const { changed, unsupported } = changeOrientation(target);
    const label = orientationLabel(target);
    if (changed === 0 && unsupported === 0) {
      setOrientationMsg({ warn: false, text: `すでに${label}です。` });
    } else if (changed === 0) {
      // 対応する見た目が無く1件も切り替えられない（向きは変更していない）。
      setOrientationMsg({
        warn: true,
        text: `${label}に対応する見た目が無いため、切り替えできませんでした。場面の見た目を見直してから、もう一度お試しください。`,
      });
    } else if (unsupported === 0) {
      setOrientationMsg({ warn: false, text: `${changed}件の場面を${label}に切り替えました。` });
    } else {
      setOrientationMsg({
        warn: true,
        text: `${changed}件を${label}に切り替えました。${unsupported}件は${label}に合う見た目が無いため元の向きのままです。別の見た目を選び直してください。`,
      });
    }
  }

  // セリフ音声の生成進捗（行単位）。「全場面の声を作成」ボタンの表示条件・進捗表示に使う。
  const { done: narrDone, total: narrTotal } = narrationProgress(scenes);
  // 全場面の声を作成（既存 action を呼ぶだけ＝場面編集の一括作成と同じ）。完了後に「まだ声が要る場面」を数えて通知する。
  const runBulkVoice = async () => {
    setVoiceResult(null);
    await generateAllNarrations();
    const remaining = useProjectStore.getState().scenes.filter(sceneNeedsVoice).length;
    setVoiceResult({ remaining });
  };

  // たたき台へ直接来た場合は生成する（本実装では保存済みプロジェクトの読込に置き換え）
  useEffect(() => {
    void autoGenerateIfSafe(); // 自動生成は Mock（外部送信なし）のときだけ（#384・§2-6）。実プロバイダは空状態のまま。
  }, [status, autoGenerateIfSafe]);

  const rows = scenes.map((s) => sceneToDraftRow(s, parts, templates, assets));
  const draftWarnings = warningsToDraftWarnings(warnings);

  if (rows.length === 0) {
    // 場面ゼロだがプロジェクトはある（白紙開始／全削除＝status "ready"）＝手動で場面を足す導線を出す（#393）。
    // status "idle"（まだ何も無い）はウィザードへ誘導。生成中は「作成中」表示。
    const started = status === "ready";
    return (
      <div className="main-scroll">
        <PageHead title="動画のたたき台を確認" desc="台本表で場面を確認・修正できます。" />
        <EmptyState
          title={status === "generating" ? "動画案を作成中です…" : started ? "場面を追加して作り始めましょう" : "まだ動画案がありません"}
          message={
            started
              ? "「場面を追加」で最初の場面を作り、セリフ・素材・見た目を設定していきましょう。"
              : "「新しい動画を作る」から、会社情報と素材を入れて動画案を作成しましょう。"
          }
          action={
            started ? (
              <button className="btn btn-primary" onClick={() => addScene()}>
                <PlusIcon size={18} />
                場面を追加
              </button>
            ) : (
              <button className="btn btn-primary" onClick={() => onNavigate("wizard")}>
                新しい動画を作る
              </button>
            )
          }
        />
      </div>
    );
  }

  return (
    <div className="main-scroll">
      <div className="content-with-yuko">
        <div>
          <PageHead
            title="動画のたたき台を確認"
            desc={
              draftFromAi
                ? "ゆうこが作った構成です。台本表を見ながら、自由に修正してください。"
                : "台本表を見ながら、場面を自由に足したり並べ替えたり直したりできます。"
            }
          />

          {/* 取り消し/やり直し（#413）＝たたき台の削除・並べ替えも戻せる。キーボードは Ctrl+Z/Y（全画面・App で有効）。 */}
          <div className="row gap-sm" style={{ justifyContent: "flex-end", marginBottom: "var(--gap-sm)" }}>
            <button className="btn btn-ghost btn-icon text-sm" onClick={undo} disabled={!canUndo} aria-label="取り消す" title="取り消す（Ctrl+Z）">↶ 取り消す</button>
            <button className="btn btn-ghost btn-icon text-sm" onClick={redo} disabled={!canRedo} aria-label="やり直す" title="やり直す（Ctrl+Y）">↷ やり直す</button>
          </div>

          {/* AI 生成直後だけ「ゆうこ(AI)が作成した」旨を出す（白紙/手動/読込済みでは出さない＝表示と実挙動の一致・#467/ADR-0026）。 */}
          {draftFromAi && (
            <div className="notice notice-warn mb">
              <SparkleIcon size={18} />
              <span>
                このたたき台はゆうこ（AI）が作成したものです。必要に応じて自由に修正してください。
              </span>
            </div>
          )}

          {/* 自動補正・確認の通知 */}
          <WarningBanner warnings={draftWarnings} />

          {/* 画面の向き（B5-b）。現在の向きと、もう一方への切替導線。 */}
          <div className="row-between mb">
            <span className="text-muted">画面の向き：<strong>{orientationLabel(aspectRatio)}</strong></span>
            <button className="btn btn-ghost" onClick={switchOrientation}>
              {orientationLabel(aspectRatio === ORIENTATION.portrait ? ORIENTATION.landscape : ORIENTATION.portrait)}に切り替える
            </button>
          </div>
          {orientationMsg && (
            <div className={`notice ${orientationMsg.warn ? "notice-warn" : "notice-info"} mb`} role="status">
              {orientationMsg.text}
            </div>
          )}

          {/* 全場面の声をまとめて作成（音声バッジは見せているので作る手段もここに置く・#413）。すべて作成済みなら隠す。 */}
          {narrTotal > 0 && !(narrDone === narrTotal && !isGeneratingNarration) && (
            <div className="row-between mb">
              <span className="text-muted">声 <strong>{narrDone}/{narrTotal}</strong>{isGeneratingNarration ? "（作成中…）" : ""}</span>
              <button className="btn btn-primary" onClick={() => void runBulkVoice()} disabled={isGeneratingNarration}>
                {isGeneratingNarration ? "作成中…" : "全場面の声を作成"}
              </button>
            </div>
          )}
          {/* 一括作成の完了通知（現在は進捗が消えるだけ＝#413）。全部できたら仕上がり確認へ誘導、一部失敗は次の行動を案内。 */}
          {voiceResult && !isGeneratingNarration &&
            (voiceResult.remaining === 0 ? (
              <div className="notice notice-info mb" role="status">
                <CheckIcon size={18} />
                <span className="grow">全場面の声ができました。</span>
                <button className="btn btn-ghost" onClick={() => { setPreviewReturnTo("draft"); onNavigate("preview"); }}>
                  <PlayIcon size={16} />
                  仕上がり確認へ
                </button>
              </div>
            ) : (
              <div className="notice notice-warn mb" role="status">
                <span className="grow">声を作成しました。{voiceResult.remaining}件の場面はうまく作れませんでした。各場面の「声を作り直す」でもう一度お試しください。</span>
              </div>
            ))}

          {/* 台本表 */}
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 44 }}>順番</th>
                  <th>パート</th>
                  <th>場面</th>
                  <th>使う素材</th>
                  <th style={{ minWidth: 240 }}>セリフ</th>
                  <th>見た目</th>
                  <th>音声</th>
                  <th style={{ width: 210 }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr
                    key={row.id}
                    {...dnd.dropProps(i)}
                    style={{
                      opacity: dnd.draggingId === row.id ? 0.4 : undefined,
                      background:
                        dnd.overIndex === i && dnd.draggingId && dnd.draggingId !== row.id
                          ? "var(--color-primary-soft)"
                          : undefined,
                    }}
                  >
                    <td className="table-num">
                      <span className="row gap-sm" style={{ alignItems: "center" }}>
                        {/* ドラッグの持ち手（装飾＝aria-hidden）。ネイティブ DnD はキー操作不可のため、アクセシブルな並び替えは
                            右の ↑/↓ ボタンが担う（見せかけのボタンにしない・#398 レビュー）。 */}
                        <span
                          {...dnd.handleProps(row.id)}
                          aria-hidden="true"
                          title="ドラッグして並び替え"
                          style={{ cursor: "grab", touchAction: "none", userSelect: "none", color: "var(--color-text-muted)", lineHeight: 1 }}
                        >
                          ⠿
                        </span>
                        {row.order}
                      </span>
                    </td>
                    <td>
                      <strong>{row.part}</strong>
                    </td>
                    <td>{row.scene}</td>
                    <td>
                      <span className="row gap-sm">
                        {row.materialType === "video" ? (
                          <VideoIcon size={16} className="text-faint" />
                        ) : (
                          <PhotoIcon size={16} className="text-faint" />
                        )}
                        {row.material}
                      </span>
                    </td>
                    <td className="text-pretty">{row.line}</td>
                    <td>
                      <span className="badge badge-teal">{row.look}</span>
                    </td>
                    <td>
                      <VoiceStatusBadge status={row.voiceStatus} />
                    </td>
                    <td>
                      <div className="row gap-sm row-wrap">
                        <button
                          className="btn btn-ghost btn-icon"
                          title="上へ移動"
                          aria-label="上へ移動"
                          disabled={i === 0}
                          onClick={() => moveScene(row.id, "up")}
                        >
                          ↑
                        </button>
                        <button
                          className="btn btn-ghost btn-icon"
                          title="下へ移動"
                          aria-label="下へ移動"
                          disabled={i === rows.length - 1}
                          onClick={() => moveScene(row.id, "down")}
                        >
                          ↓
                        </button>
                        <button
                          className="btn btn-ghost btn-icon"
                          title="この場面を複製"
                          aria-label="この場面を複製"
                          onClick={() => duplicateScene(row.id)}
                        >
                          複製
                        </button>
                        <button className="btn btn-ghost btn-icon" title="セリフを直す" onClick={() => editScene(row.id)}>
                          セリフ
                        </button>
                        <button className="btn btn-ghost btn-icon" title="素材を変更" onClick={() => editScene(row.id)}>
                          素材
                        </button>
                        <button className="btn btn-ghost btn-icon" title="見た目を変更" onClick={() => editScene(row.id)}>
                          見た目
                        </button>
                        {confirmId === row.id ? (
                          // 表の行内は notice ブロックが入らないためインライン。順序/色は統一（やめる左・削除する=danger右＝#410）。
                          <>
                            <button className="btn btn-ghost btn-icon" onClick={() => setConfirmId(null)}>
                              やめる
                            </button>
                            <button
                              className="btn btn-danger btn-icon"
                              onClick={() => {
                                removeScene(row.id);
                                setConfirmId(null);
                              }}
                            >
                              削除する
                            </button>
                          </>
                        ) : (
                          <button
                            className="btn btn-ghost btn-icon"
                            style={{ color: "var(--color-danger)" }}
                            title="この場面を削除"
                            aria-label="この場面を削除"
                            onClick={() => setConfirmId(row.id)}
                          >
                            <TrashIcon size={14} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* 場面の追加（削除は各行の操作から） */}
          <div className="row gap-sm mt">
            <button className="btn btn-secondary" onClick={() => addScene()}>
              <PlusIcon size={18} />
              場面を追加
            </button>
            <button className="btn btn-ghost" onClick={() => { setPreviewReturnTo("draft"); onNavigate("preview"); }}>
              <PlayIcon size={16} />
              途中まで仕上がり確認
            </button>
          </div>

          {confirmRegen && (
            <div className="notice notice-warn mt-lg" role="alert">
              <span>
                今の手直し内容（セリフの修正・場面の追加や削除など）は消えて、動画案を新しく作り直します。よろしいですか？
              </span>
              {/* 確認は「やめる（左・ghost）／実行（右）」で全画面統一（#410 sub2・削除確認と同じ並び）。 */}
              <div className="row gap-sm">
                <button className="btn btn-ghost btn-icon" onClick={() => setConfirmRegen(false)}>
                  やめる
                </button>
                <button
                  className="btn btn-primary btn-icon"
                  onClick={() => {
                    setConfirmRegen(false);
                    // 実プロバイダ（外部送信）なら送信前確認（ConfirmScreen）を必ず通す。Mock はそのまま作り直す（§2-6・#423）。
                    // 判定自体が失敗（鍵ストア/invoke 不能で reject）したときは fail-closed で「送信し得る側」に倒し、確認画面へ送る
                    // ＝autoGenerateIfSafe と同じ挙動。無反応（破棄確認は閉じたのに何も起きない）にせず §2-6 を厳守する（#423 P2）。
                    void (async () => {
                      let external = true; // 判定不能時の既定＝確認画面を通す側（fail-closed）
                      try {
                        external = await willSendExternally();
                      } catch {
                        // 判定不能＝external は true のまま＝ConfirmScreen へ（送信前確認を必ず通す）
                      }
                      if (external) {
                        setConfirmReturnTo("draft"); // ConfirmScreen の「キャンセル」でここ（たたき台）へ戻す
                        onNavigate("confirm");
                      } else {
                        void generate();
                      }
                    })();
                  }}
                >
                  <SparkleIcon size={16} />
                  作り直す
                </button>
              </div>
            </div>
          )}

          {/* 主操作 */}
          <div className="row-between mt-lg">
            <button
              className="btn btn-secondary"
              onClick={() => setConfirmRegen(true)}
              disabled={status === "generating"}
            >
              <SparkleIcon size={18} />
              {status === "generating" ? "作成中…" : "作り直す"}
            </button>
            <button
              className="btn btn-primary btn-lg"
              onClick={() => onNavigate("scene-edit")}
            >
              <CheckIcon size={20} />
              この内容で確認・編集する
            </button>
          </div>
        </div>

        <YukoPanel
          messages={[
            `動画のたたき台ができました！全部で${rows.length}つの場面で構成しています。`,
            "セリフや素材は、表の右の操作ボタンから直せます。",
            "気になるところがなければ「この内容で確認・編集する」に進みましょう。",
          ]}
        />
      </div>
    </div>
  );
}
