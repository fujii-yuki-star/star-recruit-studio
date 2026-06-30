// 要素のグループ化（ADR-0022）の型。正典は project.schema.json / template.schema.json の Group 定義。
// scene.groups（メンバー＝FreeElement id）と template.groups（メンバー＝Layer id）で同じ形を共有する。
// グループはネスト可（members に group id を含められる）＝木構造（森）。メンバーは最大1グループに属す。

/** グループ自身の変形（グループ中心まわり）。identity＝{x:0,y:0,rotation:0,scale:1}。 */
export interface GroupTransform {
  /** 平行移動 X（canvas px）。 */
  x: number;
  /** 平行移動 Y（canvas px）。 */
  y: number;
  /** 回転角（度・グループ中心まわり・時計回り＝CSS/SVG rotate と同じ向き）。 */
  rotation: number;
  /** 拡大率（グループ中心まわり・1=等倍・>0）。 */
  scale: number;
}

export interface Group {
  /** group_NNN（scene/template 内一意・11 §2）。 */
  id: string;
  /** メンバーの id（要素/レイヤー、ネストでグループ id も可）。 */
  members: string[];
  /** グループ自身の変形（中心まわり）。 */
  transform: GroupTransform;
  /** 表示名（任意・UI 用）。 */
  name?: string;
  /** 重ね順（任意・整数。UI で使う）。 */
  zIndex?: number;
  /** 非表示（任意・メンバーごと描画を抑止）。 */
  hidden?: boolean;
  /** ロック（任意・編集を抑止）。 */
  locked?: boolean;
}
