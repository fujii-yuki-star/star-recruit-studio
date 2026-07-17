// グループの位置・大きさ・角度の数値入力（#554）。FREE の場面編集とテンプレ作成エディタで**共有**する。
//
// なぜ数値欄が要るか：グループはこれまで枠のドラッグでしか動かせず、拡大率の下限（GROUP_MIN_SCALE）を
// 下回る縮小ができなかった。FREE 要素は幅/高さの数値欄が「逃げ道」になっていて、ドラッグの下限
// （GEOM_MIN_SIZE＝つまみが掴める大きさ）とは別に細かい値へ行けるのに、グループにはそれが無い＝
// 同じ「小さくする」がオブジェクトの種類で別挙動だった（ADR-0026②）。
//
// なぜ共有コンポーネントか：同じ欄を2画面に別々に書くと、片方だけ上限が変わる類の分裂（#554 が棚卸しした
// 縁取りの太さ＝FREE 100 / テンプレ 20 と同じ轍）を必ず踏む。参照元は1つにする（§2-7）。
import type { GroupTransform } from "../../domain/group/types";
import { ROTATION_DEG_MAX, ROTATION_DEG_MIN } from "../../domain/constants";
import { percentToScale, SCALE_PERCENT_MIN, scaleToPercent } from "../../domain/format/scale";
import { NumberField } from "./NumberField";

export function GroupTransformFields({
  transform,
  onChange,
}: {
  transform: GroupTransform;
  /** 変更ぶんだけを渡す（updateGroupTransform へそのまま流す想定）。 */
  onChange: (patch: Partial<GroupTransform>) => void;
}) {
  return (
    <div className="row gap-sm">
      {/* 位置はグループの平行移動（canvas px）＝メンバーの座標は動かさない。上下限なし＝ドラッグと同じ。 */}
      <NumberField label="横位置" value={transform.x} onChange={(v) => onChange({ x: v })} />
      <NumberField label="縦位置" value={transform.y} onChange={(v) => onChange({ y: v })} />
      {/* 大きさは % 表示（100=等倍）＝濃さ(%) と同じ流儀。上限なし・下限は拡縮ドラッグと同じ GROUP_MIN_SCALE。 */}
      <NumberField
        label="大きさ(%)"
        value={scaleToPercent(transform.scale)}
        min={SCALE_PERCENT_MIN}
        title="100 で元の大きさ。枠の角をつまんで拡大縮小するより細かく指定できます。"
        onChange={(v) => onChange({ scale: percentToScale(v) })}
      />
      {/* 角度は要素の角度欄と同じ共有定数（回転ドラッグの正規化＝rotationFromPointer/snapAngle と同じ値域）。 */}
      <NumberField
        label="角度"
        value={Math.round(transform.rotation)}
        min={ROTATION_DEG_MIN}
        max={ROTATION_DEG_MAX}
        onChange={(v) => onChange({ rotation: v })}
      />
    </div>
  );
}
