import { useEffect, useState } from "react";
import { editApi } from "./api";
import { NumberScrub } from "./NumberScrub";
import { isTimed, setSpeedOp, speedOf } from "./layerOps";
import {
  animAt,
  clampFor,
  colorToHex,
  fromComponents,
  hasExpression,
  hasKeyAt,
  hexToColor,
  isAnimated,
  nextKeyFrame,
  prevKeyFrame,
  propDefsFor,
  setPlainOp,
  setValueOp,
  toComponents,
  toggleKeyOp,
  toggleStopwatchOp,
  type PropDef,
} from "./props";
import { BLEND_MODES, type AnimValue, type Color, type Layer, type Op } from "./types";

/** 成分の名前（2 成分＝x・y）。 */
const AXES = ["x", "y"];

/**
 * 値の欄（MV-0008 決定5）＝選んだレイヤーの値を数で直し、キーフレームを打つ（AE の型）。
 * ⚠️ 今の時刻の値は Rust に求めてもらう（描画の核と同じ計算＝`edit_eval`）。
 * ⚠️ 錠のかかったレイヤーは直せない（見るだけ）。
 */
export function PropsPanel(props: {
  layer: Layer;
  frame: number;
  /** コンポジションの fps（速度を求める）。 */
  fps: number;
  onTrial: (ops: Op[] | null) => void;
  onCommit: (ops: Op[]) => unknown;
  onSeek: (frame: number) => void;
}): React.JSX.Element {
  const { layer, frame } = props;
  const [evaluated, setEvaluated] = useState<{ layer: Layer; frame: number; values: Record<string, AnimValue> } | null>(
    null,
  );
  useEffect(() => {
    let alive = true;
    editApi.eval(layer, frame).then(
      (values) => {
        if (alive) setEvaluated({ layer, frame, values });
      },
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [layer, frame]);
  // ⚠️ 求めた値は、どのレイヤー・どの時刻のものかと一緒に持つ＝別のレイヤーの値を一瞬見せない
  const values = evaluated && evaluated.layer === layer && evaluated.frame === frame ? evaluated.values : null;
  const locked = layer.locked;

  const row = (def: PropDef): React.JSX.Element | null => {
    const a = animAt(layer, def.path);
    if (!a) return null;
    const expr = hasExpression(a);
    const animated = isAnimated(a);
    const current = values?.[def.path];
    const comps = toComponents(current, def.dims);
    const disabled = locked || expr || current === undefined;
    const write = (i: number, shown: number): Op[] => {
      const next = comps.slice();
      next[i] = shown / def.factor;
      return [setValueOp(layer, def.path, frame, fromComponents(clampFor(def.path, next), def.dims))];
    };
    const prev = prevKeyFrame(a, frame);
    const next = nextKeyFrame(a, frame);
    return (
      <div className="prop-row" key={def.path} data-testid={`prop-${def.path}`}>
        <button
          type="button"
          className="stopwatch"
          aria-label={`${def.label}のストップウォッチ`}
          aria-pressed={animated}
          disabled={disabled}
          title={animated ? "キーフレームをやめる（今の値の固定値に戻す）" : "キーフレームにする（今の時刻にキーを打つ）"}
          onClick={() => current !== undefined && props.onCommit([toggleStopwatchOp(layer, def.path, frame, current)])}
        >
          ⏱
        </button>
        <span className="prop-label">
          {def.label}
          {expr && <span className="muted">（式）</span>}
        </span>
        <span className="prop-fields">
          {comps.map((c, i) => (
            <NumberScrub
              key={i}
              label={def.dims === 2 ? `${def.label} ${AXES[i]}` : def.label}
              value={c * def.factor}
              step={def.step}
              unit={def.unit}
              disabled={disabled}
              onPreview={(v) => props.onTrial(write(i, v))}
              onCancel={() => props.onTrial(null)}
              onCommit={(v) => props.onCommit(write(i, v))}
            />
          ))}
        </span>
        {animated && (
          <span className="keynav">
            <button
              type="button"
              aria-label={`${def.label}の前のキーへ`}
              disabled={prev == null}
              onClick={() => prev != null && props.onSeek(prev)}
            >
              ◀
            </button>
            <button
              type="button"
              aria-label={`${def.label}のキーを足す・消す`}
              aria-pressed={hasKeyAt(a, frame)}
              disabled={disabled}
              onClick={() => {
                const op = current !== undefined ? toggleKeyOp(layer, def.path, frame, current) : null;
                if (op) props.onCommit([op]);
              }}
            >
              ◆
            </button>
            <button
              type="button"
              aria-label={`${def.label}の次のキーへ`}
              disabled={next == null}
              onClick={() => next != null && props.onSeek(next)}
            >
              ▶
            </button>
          </span>
        )}
      </div>
    );
  };

  const color = (label: string, path: string, c: Color | undefined): React.JSX.Element | null =>
    c ? (
      <label className="prop-row plain">
        <span className="prop-label">{label}</span>
        <input
          type="color"
          aria-label={label}
          value={colorToHex(c)}
          disabled={locked}
          onChange={(e) => {
            const v = hexToColor(e.target.value, c[3]);
            if (v) props.onCommit([setPlainOp(layer, path, v)]);
          }}
        />
      </label>
    ) : null;

  return (
    <div className="props-panel" data-testid="props-panel">
      {locked && <p className="muted">錠がかかっています（タイムラインの錠を外すと直せます）。</p>}
      <h3>変形</h3>
      {propDefsFor(layer).map(row)}
      <label className="prop-row plain">
        <span className="prop-label">描画モード</span>
        <select
          aria-label="描画モード"
          value={layer.blendMode ?? "normal"}
          disabled={locked}
          onChange={(e) => props.onCommit([setPlainOp(layer, "/blendMode", e.target.value)])}
        >
          {BLEND_MODES.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </label>
      {isTimed(layer) && (
        <>
          <h3>時間</h3>
          <div className="prop-row plain" data-testid="prop-speed">
            <span className="prop-label">速度</span>
            {(() => {
              const speed = speedOf(layer, props.fps);
              return speed == null ? (
                <span className="muted" title="キーフレームでタイムリマップを細かく指定しています">
                  タイムリマップ
                </span>
              ) : (
                <NumberScrub
                  label="速度"
                  value={speed}
                  step={1}
                  unit="%"
                  disabled={locked}
                  onCommit={(v) => {
                    const op = setSpeedOp(layer, v);
                    if (op) props.onCommit([op]);
                  }}
                />
              );
            })()}
          </div>
          <label className="prop-row plain">
            <span className="prop-label">タイムリマップ</span>
            <input
              type="checkbox"
              aria-label="タイムリマップ"
              checked={layer.timeRemap != null}
              disabled={locked}
              title="今の見え方のまま、始めと終わりにキーフレームを置く（Ctrl+Alt+T）"
              onChange={(e) => props.onCommit([{ op: "enableTimeRemap", layerId: layer.id, enabled: e.target.checked }])}
            />
          </label>
        </>
      )}
      {layer.type === "text" && layer.text && (
        <>
          <h3>文字</h3>
          <label className="prop-row plain">
            <span className="prop-label">文</span>
            <textarea
              aria-label="文"
              defaultValue={layer.text.text}
              key={`${layer.id}|${layer.text.text}`}
              disabled={locked}
              rows={3}
              onKeyDown={(e) => e.stopPropagation()}
              onBlur={(e) => {
                if (e.target.value !== layer.text?.text) props.onCommit([setPlainOp(layer, "/text/text", e.target.value)]);
              }}
            />
          </label>
          <div className="prop-row plain">
            <span className="prop-label">文字の大きさ</span>
            <NumberScrub
              label="文字の大きさ"
              value={layer.text.fontSize}
              step={0.5}
              min={1}
              disabled={locked}
              onCommit={(v) => props.onCommit([setPlainOp(layer, "/text/fontSize", v)])}
            />
          </div>
          {color("文字の色", "/text/fill", layer.text.fill)}
        </>
      )}
      {layer.type === "solid" && layer.solid && (
        <>
          <h3>単色</h3>
          {color("単色の色", "/solid/color", layer.solid.color)}
          <div className="prop-row plain">
            <span className="prop-label">幅・高さ</span>
            <span className="prop-fields">
              <NumberScrub
                label="単色の幅"
                value={layer.solid.width}
                step={1}
                digits={0}
                min={1}
                disabled={locked}
                onCommit={(v) => props.onCommit([setPlainOp(layer, "/solid/width", Math.round(v))])}
              />
              <NumberScrub
                label="単色の高さ"
                value={layer.solid.height}
                step={1}
                digits={0}
                min={1}
                disabled={locked}
                onCommit={(v) => props.onCommit([setPlainOp(layer, "/solid/height", Math.round(v))])}
              />
            </span>
          </div>
        </>
      )}
      {layer.type === "shape" && layer.shape && (
        <>
          <h3>図形</h3>
          {color("塗りの色", "/shape/fill", layer.shape.fill)}
        </>
      )}
    </div>
  );
}
