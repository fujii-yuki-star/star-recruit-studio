// 流れの帯（ADR-0048 追補・利用者判断 2026-10-05）＝たたき台 → 場面編集 → 仕上がり確認 → 公開前チェック → 書き出しの
// 5画面の上に、**戻る（左）・いまどの段か（中）・進む（右）**を同じ形で置く。
//
// ⚠️ **戻る／進むは画面ごとにばらばらだった**（台本表は下の右・場面編集は上の帯の右・仕上がり確認は右の列の下・
//   公開前チェックと書き出しは下の右・戻るも上だったり下だったり）＝探させていた。ここへ寄せて、元の場所からは外す
//   （同じ操作を2か所に置かない）。
// ⚠️ **段は押して移れる**＝見るだけの段は近道にならない。移るときの「来た画面」の覚え方は `flowJump` の1か所。
// ⚠️ **貼り付ける**（`.editor-header`）＝スクロールしても消えない（場面編集の帯と同じ）。
import type { ReactNode } from "react";
import { FLOW_STEPS, type FlowScreen } from "../flowSteps";
import { EDITOR_HEADER_CLASS } from "./EditorToolbar";
import { ArrowLeftIcon, ChevronRightIcon } from "./icons";

export interface FlowBarProps {
  current: FlowScreen;
  back?: { label: string; onClick: () => void; disabled?: boolean; title?: string };
  next?: {
    label: ReactNode;
    onClick: () => void;
    disabled?: boolean;
    /** 押せない理由（押す前に見せる＝§2-5）。押せないときだけ下に出す。 */
    reason?: ReactNode;
  };
  /** 段を押したとき。画面ごとの下ごしらえ（いまの場面を預ける等）があれば包んで渡す。 */
  onJump: (to: FlowScreen) => void;
  /** 段を押せない（書き出し中など）。理由は `jumpDisabledReason`（押す前に見せる＝§2-5）。 */
  jumpDisabled?: boolean;
  jumpDisabledReason?: string;
  /**
   * 段ごとに押せない理由（PR #1347 レビュー 🟡）＝進むが押せないのに、隣の段からは同じ先へ抜けられた
   * （同じ帯に流儀が2つ）。進むと同じ条件をここにも渡す。
   */
  stepBlocked?: Partial<Record<FlowScreen, string | null | undefined>>;
  /** 貼り付けない（スクロールの外に置く画面＝場面編集）。 */
  sticky?: boolean;
}

export function FlowBar({ current, back, next, onJump, jumpDisabled = false, jumpDisabledReason, stepBlocked, sticky = true }: FlowBarProps) {
  return (
    <div className={`flow-bar${sticky ? ` ${EDITOR_HEADER_CLASS}` : ""}`} data-testid="flow-bar">
      <div className="flow-bar-side">
        {back && (
          <button className="btn btn-ghost btn-icon" onClick={back.onClick} disabled={back.disabled} title={back.title}>
            <ArrowLeftIcon size={16} />
            {back.label}
          </button>
        )}
      </div>
      <nav className="flow-bar-steps" aria-label="動画づくりの流れ">
        <ol>
          {FLOW_STEPS.map((s, i) => (
            <li key={s.screen}>
              {/* 区切り（読み上げない）＝並んだボタンではなく順番だと見て分かるように（PR #1347 レビュー ℹ️）。 */}
              {i > 0 && <span className="flow-step-sep" aria-hidden="true">›</span>}
              {s.screen === current ? (
                <span className="flow-step flow-step--current" aria-current="step">{`${i + 1} ${s.label}`}</span>
              ) : (
                <button
                  type="button"
                  className="flow-step"
                  onClick={() => onJump(s.screen)}
                  disabled={jumpDisabled || !!stepBlocked?.[s.screen]}
                  title={jumpDisabled ? jumpDisabledReason : stepBlocked?.[s.screen] ?? undefined}
                >
                  {`${i + 1} ${s.label}`}
                </button>
              )}
            </li>
          ))}
        </ol>
      </nav>
      <div className="flow-bar-side flow-bar-side--end">
        {next && (
          <div className="col gap-xs" style={{ alignItems: "flex-end" }}>
            <button className="btn btn-primary" onClick={next.onClick} disabled={next.disabled}>
              {next.label}
              <ChevronRightIcon size={18} />
            </button>
            {next.disabled && next.reason ? (
              <span className="text-sm flow-bar-reason">{next.reason}</span>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
