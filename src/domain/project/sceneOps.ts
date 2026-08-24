// 場面の構成編集（並べ替え・複製）の純粋ロジック（CLAUDE.md §4：副作用なし・テスト容易）。
// 再生・表示順の「正」＝scenes 配列順（buildExportScenes も scenes 配列を順に処理する）。
// scene.order（1..N）は配列順に追従させ、part.sceneIds は「パート所属＋パート内順序」を保持する目印。
// 並べ替えは scenes 配列の入れ替えで行い partId は変えない（パート間移動は MVP 外＝1パート前提）。
import { DEFAULT_BACKGROUND_COLOR, quantizeSec, SHAPE_FILL_FALLBACK_COLOR } from '../constants';
import { FIT, FREE_CATEGORY, FREE_ELEMENT_KIND, FREE_SHAPE_TYPE, LAYER_TYPE, NARRATION_STATUS, TEXT_KEY } from '../enums';
import type { FreeElementKind, SceneCategory } from '../enums';
import type { Template } from '../template/types';
import { composeGroupGeometry, isHiddenByGroup } from '../group/compose';
import { effectiveLayerZ } from '../template/layerOrder';
import { templateSlotIds } from '../template/layerOps';
import { boxHeightForLines, DEFAULT_LINE_HEIGHT, DEFAULT_TEMPLATE_MAX_LINES, resolveTextStyle } from '../template/textStyle';
import { wrapText } from '../text/textWrap';
import { resolveLineSubtitle } from './lineTimeline';
import { normalizeDialogueTiming } from './narrationLines';
import { createFreeElementId } from './persistence';
import { defaultSubtitleSource, freeSubtitleElementTexts, sceneDisplayedSubtitleTexts } from './subtitleBinding';
import type { FreeElement, Part, Scene } from './types';

/** 各パートの sceneIds を、現在の scenes 配列順（パート所属は保持）に合わせて作り直す。 */
export function rebuildPartSceneIds(parts: Part[], scenes: Scene[]): Part[] {
  return parts.map((p) => ({
    ...p,
    sceneIds: scenes.filter((sc) => sc.partId === p.partId).map((sc) => sc.sceneId),
  }));
}

/**
 * 場面の見た目パターン（テンプレ）を切り替えた結果を返す＝ADR-0030 の非破壊往復（Option A）。
 * - **assetRefs / slotFits は清算しない＝休眠保持**（ADR-0030 追補・#547 P3-14）：切替先に無い差し込み先
 *   （`background`/`slot`/`logo` レイヤーの id）への参照/収め方もそのまま残し、その差し込み先を持つ見た目へ戻すと復元される。
 *   休眠キーは描かれず（`layoutScene` は層駆動）実効使用にも数えない（`sceneActiveAssetIds` が同じ規則でゲート）＝
 *   ダングリングは無害（11 §5）。**以前は通常テンプレへの切替だけ #236 で清算していた**が、`mainVisual` の無い種類へ
 *   変えると写真の割当が消えて戻せず、`texts`/`freeLayout` は復元されるのに**非対称**だった（#547 P3-14・ADR-0026②）。
 * - **texts / textFontIds / textStyles も同じく保持する**（#236 から一貫）：固定の `TextKey` enum がキーでテンプレ非依存ゆえ
 *   ダングリングにならず、別パターンへ変えて戻したとき入力が復元される（描画は未使用 textKey を無視）。
 *   ※ 「揃える」目的でどれかを清算しないこと（利用者の入力消失になる）。揃えるなら**保持する側**へ寄せる。
 * - **warnings はクリアする**：旧テンプレ基準の検証結果（例: 必須スロット未設定）は切替で陳腐化するため引き継がない＝
 *   再検証前提（`duplicateSceneInList`/`splitSceneInList` と同ポリシー）。残すと存在しないスロットの警告などが誤って残る。
 * - **sceneType は新テンプレのカテゴリに追従する**（0.4.2 動確・FREE 全場面化）：見た目とカテゴリを常に一致させ、
 *   FREE を選べば自由配置に、通常テンプレを選べばその役割に変換する（ピッカーの整合＝`pickableTemplatesForScene` と対）。
 *   newCategory 未指定（旧呼び出し）は sceneType 据え置き（後方互換）。
 * - **通常→FREE は表示中の内容を `freeLayout` へ seed する**（ADR-0030・#524 P1）：旧テンプレ（`prevTemplate`）のスロット素材＋
 *   文字を FreeElement へ変換して持ち込む（`freeLayout` が空のときだけ＝既存の自由配置は上書きしない）。これで FREE 化で
 *   写真・動画・文字が無言消失しない（§2-2）。`prevTemplate` 未指定（旧呼び出し・テスト）は seed しない（後方互換）。
 * - **`freeLayout` は保持（休眠）**：通常テンプレへ戻しても消さない（`texts` と同じ #236 の非対称の延長・ADR-0030）。
 *   通常テンプレでは描画/編集/事前確認/素材使用の対象外（実効表現＝category でゲート）＝休眠データが悪さをしない（P2）。
 */
export function switchSceneTemplate(
  scene: Scene,
  newTemplateId: string,
  newCategory?: SceneCategory,
  prevTemplate?: Template,
): Scene {
  // 通常→FREE：表示中の配置内容（スロット素材＋文字＋字幕＋立ち絵）を freeLayout へ seed（空のときだけ・ADR-0030）。旧テンプレの幾何が要る。
  const seeded =
    newCategory === FREE_CATEGORY &&
    prevTemplate &&
    prevTemplate.category !== FREE_CATEGORY &&
    (scene.freeLayout?.length ?? 0) === 0
      ? freeLayoutFromPlacedContent(scene, prevTemplate)
      : undefined;
  return {
    ...scene,
    templateId: newTemplateId,
    sceneType: newCategory ?? scene.sceneType, // 見た目のカテゴリに追従（未指定は据え置き＝後方互換）
    // assetRefs / slotFits は素通し＝清算しない（休眠保持・上記ポリシー）。切替先の層一覧は要らない
    // ＝**引数で受け取らない**ことで「実は絞っている」という誤解と、絞り込みの復活を構造的に防ぐ。
    // 通常→FREE の seed 結果があれば freeLayout を差し替え（空 seed・非該当は ...scene の freeLayout を休眠保持）。
    ...(seeded && seeded.elements.length ? { freeLayout: seeded.elements } : {}),
    // 動画クリップ調整（範囲/速度/元音声）を旧層 id → 新 FREE 要素 id へ移送（#524 P1）。旧キーは休眠のまま残す（往復）。
    ...(seeded && Object.keys(seeded.slotClips).length ? { slotClips: { ...scene.slotClips, ...seeded.slotClips } } : {}),
    // texts / textFontIds / textStyles は保持（上記ポリシー＝#236）。warnings は再検証前提でクリア。
    warnings: [],
  };
}

/**
 * 通常→FREE 変換で文字/字幕の枠に与える高さ（#555 レビュー P1）。
 *
 * **通常テンプレと FREE は行数のモデルが違う**：通常は `layer.maxLines`（既定2）で行数が決まり枠高は行数に効かないが、
 * FREE は**枠高から行数を導出**する（`linesForBoxHeight`）。枠高をそのまま持ち込むと、テンプレの枠が行数ぶんの高さを
 * 持たない場合に**行が減って文字が切り詰められる**（`wrapText` が末尾を … にする）。実例＝標準テンプレの見出し層
 * （h=140・72px）は通常2行だが、そのままでは FREE で1行になる。#555 以前からの欠陥だが、文字を大きくできる
 * ようになって悪化した（96px なら 140px の枠に1行も入らない）。
 *
 * ADR-0030「表示中の内容を持ち込む」に従い、**同じ行数が入る高さ**へ広げる。**縮めない**のは、枠高が回転の中心
 * （`y + h/2`）にも効くため＝利用者テンプレ（ADR-0017）が文字層を回転させていた場合に位置が動くのを避ける。
 */
function textBoxH(h: number, fontSize: number, maxLines: number | undefined): number {
  return Math.max(h, boxHeightForLines(maxLines ?? DEFAULT_TEMPLATE_MAX_LINES, fontSize));
}

/**
 * 通常→FREE 変換で字幕の枠に与える上端 y（#555 再レビュー P2）。
 *
 * **字幕はアンカーが逆**：テンプレ字幕層は**下端基準**（`anchorBottom`＝行が増えると上へ伸び、下端が動かない
 * ＝画面下端に置いた帯が2行でも画面外へ出ない・ADR-0031）。一方 FREE 字幕は**上端起点**で下へ伸びる
 * （箱の高さは利用者が持つ＝ADR-0008）。同じ y に置くと帯が `(行数-1)×行高` ぶん**下がり**、画面下端から
 * はみ出しうる（例：字幕60px・2行なら下端が 1034→1112 でキャンバス外）。
 *
 * そこで**アンカーの違いを座標へ翻訳**する＝帯が実際に占めていた上端へ y を移す。**1行の字幕は元から一致
 * している**ので動かさない（`行数-1 = 0`）。掛け合いは行ごとに行数が変わり単一の y では一致させられないため、
 * **全行の最大行数**に寄せる＝どの行でもテンプレより下がらない（はみ出しを増やさない）側を採る。
 */
function subtitleTopY(scene: Scene, y: number, w: number, fontSize: number, maxLines: number | undefined): number {
  const cap = maxLines ?? DEFAULT_TEMPLATE_MAX_LINES;
  // 単独/掛け合いの判別は **生の `scene.lines`** で行う（`defaultSubtitleSource` と同じ規則）。
  // `sceneLines()` は lines 不在のとき narration から1行を合成して返すため、ここで使うと単独場面まで
  // 掛け合い扱いになり静的字幕（`texts.subtitle`）の行数を見落とす。
  const lines = scene.lines ?? [];
  const shown =
    lines.length > 0
      ? Math.max(
          1,
          ...lines.map((l) => {
            const sub = resolveLineSubtitle(l, scene);
            return sub.enabled && sub.text.length > 0 ? wrapText(sub.text, w, fontSize, cap).length : 1;
          }),
        )
      : wrapText(scene.texts[TEXT_KEY.subtitle] ?? '', w, fontSize, cap).length;
  return y - (shown - 1) * fontSize * DEFAULT_LINE_HEIGHT;
}

/**
 * 通常→FREE 変換で**字幕要素を作るか**（＝いま字幕が出ているか）。純粋関数。
 *
 * 判定は実表示の正典（`sceneDisplayedSubtitleTexts`）に委ねる＝字幕層の `textKey` が `subtitle` 以外でも
 * （テンプレ作成エディタで変更できる・ADR-0017）、OFF でも、非表示グループでも描画と一致する。
 * `TEXT_KEY.subtitle` 固定で見ると、元は出ていない字幕を FREE へ持ち込み、戻すときに
 * 「往復しただけなのに字幕が出なくなります」と言う（`freeContentHiddenBySwitch` は実表示で数えるため）。
 */
function showsSubtitle(scene: Scene, template: Template): boolean {
  return sceneDisplayedSubtitleTexts(scene, template).length > 0;
}

/**
 * 通常テンプレの「表示中の配置内容」を FREE 要素へ変換する（ADR-0030・通常→FREE の seed 用）。純粋関数。
 * 旧テンプレのレイヤー幾何（x/y/w/h/rotation/zIndex）ごと、以下を FreeElement へ写す（表示されていないものは持ち込まない）:
 * - スロット層（background/slot/logo）の素材（`assetRefs`）→ slot 要素。**動画クリップ調整（`slotClips`）は新 id へ移送**（#524 P1）。
 * - 立ち絵層（character）の `scene.character.poseAssetId` → slot 要素（画像）。`scene.character` は休眠保持（往復で戻る・#524 P1）。
 * - 文字層（text）のテキスト（`texts`）→ text 要素。**枠高は行数を保つよう広げる**（`textBoxH`・#555 レビュー P1）。
 * - 字幕層（subtitle）→ subtitle 要素（`subtitleSource`＝単独 narration／掛け合い allLines・ADR-0029）。字幕が出る場面のみ（#524 P1）。
 * **`opts.faithful`**（既定 false）＝「表示中の**内容**」ではなく「**描かれるものすべて**」を写す。
 * タイムライン形式の「バラす」（#632）は**前後で絵が変わらない**ことが条件なので、こちらを使う：
 * 図形・装飾層も写す／**素材の入っていないスロット層も空のまま写す**（灰色の枠が消えない）／
 * **素材の入っていない背景層は塗りとして写す**（層が持つ色が消えない）。ADR-0030 の切替（通常⇄自由配置）は
 * 既定のまま＝意匠は持ち込まない。
 * 字幕/文字の背景帯（`layer.background`）は FreeElement.background へ移送する（#529）。
 * 戻り値の `slotClips` は「新 FREE 要素 id → クリップ調整」（呼び出し側 `switchSceneTemplate` が既存 `slotClips` へマージ）。
 * 戻り値の `slotLayerByElementId` は「新 FREE 要素 id → 元の差し込み口の層 id」＝**per-use が無い枠も含む**
 * 対応表（呼び出し側が素材既定を含む実効値を引くのに使う・#512 段3b）。
 * 戻り値の `characterElementIds` は「立ち絵層（character）から持ち込んだ要素の id」の集合（#831）＝
 * `slotLayerByElementId` には**入らない**（差し込み口の層ではないため）が、呼び出し側が「差し込み口
 * ではない層の動画」と「立ち絵に入れた動画」を**取り違えない**ために要る（前者は差し込み口へ入れ
 * 直せるが、後者にその逃げ道は無い＝実行できる行動が違う）。
 */
export function freeLayoutFromPlacedContent(
  scene: Scene,
  template: Template,
  opts: { faithful?: boolean } = {},
): {
  elements: FreeElement[];
  slotClips: NonNullable<Scene['slotClips']>;
  slotLayerByElementId: Record<string, string>;
  characterElementIds: Set<string>;
} {
  const elements: FreeElement[] = [];
  const slotClips: NonNullable<Scene['slotClips']> = {};
  const slotLayerByElementId: Record<string, string> = {};
  const characterElementIds = new Set<string>();
  const nextId = (): string => createFreeElementId(elements.map((e) => e.id));
  // 通常描画（layoutScene）と同じくグループ transform を前合成し、非表示グループのメンバーは持ち込まない（ADR-0022・#524 P1）。
  // これで生の layer.x/y/w/h ではなく「実効配置」を FREE 要素へ写す＝グループ利用テンプレでも FREE 化直後に崩れない。
  const groups = template.groups ?? [];
  const layerGeom = composeGroupGeometry(template.layers, groups);
  const subtitleShown = showsSubtitle(scene, template);
  for (const layer of template.layers) {
    if (isHiddenByGroup(layer.id, groups)) continue; // 非表示グループのメンバーは変換しない（通常描画と一致）
    const cg = layerGeom.get(layer.id) ?? { x: layer.x, y: layer.y, w: layer.w, h: layer.h, rotation: layer.rotation };
    const geom = {
      x: cg.x,
      y: cg.y,
      w: cg.w,
      h: cg.h,
      ...(cg.rotation ? { rotation: cg.rotation } : {}),
      zIndex: effectiveLayerZ(layer), // 実効 z（明示 zIndex 優先・無ければ種別既定）＝通常描画と重なり順が一致（#524 P2）
    };
    if (layer.type === 'background' || layer.type === 'slot' || layer.type === 'logo') {
      const assetId = scene.assetRefs[layer.id] ?? layer.assetId ?? null; // 場面素材→テンプレ既定素材（描画と同じ解決）
      if (!assetId) {
        if (!opts.faithful) continue; // 空スロットは持ち込まない（ADR-0030 の切替）
        // 描かれるものをそのまま写す：背景層は**塗り**、スロット層は**空の枠**（どちらも絵に出ている）。
        // ロゴ層は素材が無ければ何も描かれないので写さない（描画＝`layoutScene` と同じ扱い）。
        if (layer.type === LAYER_TYPE.background) {
          elements.push({
            id: nextId(),
            kind: FREE_ELEMENT_KIND.shape,
            ...geom,
            shapeType: FREE_SHAPE_TYPE.rect,
            fillColor: layer.fillColor ?? template.defaults?.backgroundColor ?? DEFAULT_BACKGROUND_COLOR,
            opacity: layer.opacity ?? 1,
            radius: layer.radius ?? 0,
          });
        } else if (layer.type === LAYER_TYPE.slot) {
          elements.push({ id: nextId(), kind: FREE_ELEMENT_KIND.slot, ...geom, assetId: null, fit: scene.slotFits?.[layer.id] ?? layer.fit });
        }
        continue;
      }
      const id = nextId();
      // 収め方の既定は**層の種別ごと**（描画＝`layoutScene` と同じ）。ロゴだけ contain＝写した瞬間に
      // 切り取られた絵にならない（自由配置の既定は cover なので、既定に任せると変わってしまう）。
      elements.push({
        id,
        kind: FREE_ELEMENT_KIND.slot,
        ...geom,
        assetId,
        fit: scene.slotFits?.[layer.id] ?? layer.fit ?? (layer.type === LAYER_TYPE.logo ? FIT.contain : undefined),
      });
      const clip = scene.slotClips?.[layer.id];
      if (clip) slotClips[id] = clip; // 動画クリップ調整を新 id へ移送（#524 P1）
      // ⚠️ **どの差し込み口から来たか**も返す（#512 段3b レビュー 🔴）＝per-use が無いときでも
      // 素材既定（`asset.clip`）を含む**実効値**を引けるようにする（`slotClips` だけだと per-use が
      // 無い枠は空になり、呼び出し側が「設定なし」と取り違える）。
      slotLayerByElementId[id] = layer.id;
    } else if (layer.type === 'character') {
      const poseId = scene.character?.poseAssetId;
      if (!poseId) continue; // ポーズ未設定は持ち込まない
      // 立ち絵は slot 要素（画像）で持ち込む＝FREE で見えて自由に動かせる。scene.character は休眠保持（往復で戻る）。
      const id = nextId();
      characterElementIds.add(id); // 差し込み口の層ではない＝slotLayerByElementId には入れない（#831）
      elements.push({ id, kind: FREE_ELEMENT_KIND.slot, ...geom, assetId: poseId, fit: layer.fit ?? FIT.contain });
    } else if (layer.type === 'text' && layer.textKey) {
      const text = scene.texts[layer.textKey];
      if (!text) continue; // 空文字は持ち込まない
      // 体裁は**場面の上書き（textStyles・#555）を解決した実効値**を写す。生の layer.* を写すと、場面で
      // 変えた色/大きさが FREE 化で黙ってテンプレ既定へ戻る（隣の fontId は per-scene なのに体裁だけ戻る＝
      // ADR-0026②の非対称・ADR-0030「表示中の内容を持ち込む」に反する）。
      const st = resolveTextStyle(layer, scene.textStyles?.[layer.textKey]);
      elements.push({
        id: nextId(),
        kind: FREE_ELEMENT_KIND.text,
        ...geom,
        h: textBoxH(geom.h, st.fontSize, layer.maxLines),
        text,
        fontSize: st.fontSize,
        color: st.color,
        fontWeight: st.fontWeight,
        fontId: scene.textFontIds?.[layer.textKey],
        ...(st.strokeColor != null ? { strokeColor: st.strokeColor } : {}),
        ...(st.strokeWidth != null ? { strokeWidth: st.strokeWidth } : {}),
        // 背景帯（可読性の下地）も移送（#529）。ただし**文字層の帯は通常テンプレでは描かれない**
        // （`layoutScene` は字幕層だけ帯を出す）ので、`faithful`（バラす）では写さない＝元の絵に無い帯を足さない。
        ...(!opts.faithful && layer.background != null ? { background: layer.background } : {}),
      });
    } else if (opts.faithful && (layer.type === LAYER_TYPE.shape || layer.type === LAYER_TYPE.decor)) {
      // 図形・装飾＝描画（`layoutScene`）と同じ既定へ落とす（線は矩形として写す＝描画の扱いと同じ）。
      elements.push({
        id: nextId(),
        kind: FREE_ELEMENT_KIND.shape,
        ...geom,
        shapeType: layer.shapeType === FREE_SHAPE_TYPE.ellipse ? FREE_SHAPE_TYPE.ellipse : FREE_SHAPE_TYPE.rect,
        fillColor: layer.fillColor ?? SHAPE_FILL_FALLBACK_COLOR,
        opacity: layer.opacity ?? 1,
        radius: layer.radius ?? 0,
        // 枠線（`strokeColor`/`strokeWidth`）は**通常テンプレの図形では描かれない**（`layoutScene`）。
        // 写すと元の絵に無い線が出る＝バラす前後で見た目が変わる。持ち物ではなく**描かれるもの**を写す。
      });
    } else if (layer.type === 'subtitle') {
      if (!subtitleShown) continue; // 字幕が出ない場面は空の字幕要素を作らない
      // 表示文言は subtitleSource から解決＝el.text は持たない（ADR-0029）。単独→narration／掛け合い→allLines。
      const st = resolveTextStyle(layer, layer.textKey ? scene.textStyles?.[layer.textKey] : undefined);
      elements.push({
        id: nextId(),
        kind: FREE_ELEMENT_KIND.subtitle,
        ...geom,
        y: subtitleTopY(scene, cg.y, cg.w, st.fontSize, layer.maxLines),
        h: textBoxH(geom.h, st.fontSize, layer.maxLines),
        subtitleSource: defaultSubtitleSource(scene),
        fontSize: st.fontSize,
        color: st.color,
        fontWeight: st.fontWeight,
        fontId: layer.textKey ? scene.textFontIds?.[layer.textKey] : undefined,
        ...(st.strokeColor != null ? { strokeColor: st.strokeColor } : {}),
        ...(st.strokeWidth != null ? { strokeWidth: st.strokeWidth } : {}),
        ...(layer.background != null ? { background: layer.background } : {}), // 字幕の背景帯（可読性の下地）を移送（#529）
      });
    }
  }
  return { elements, slotClips, slotLayerByElementId, characterElementIds };
}

/**
 * FREE→通常の切替で**動画に出なくなる**自由配置の中身の数（要素の種別ごと）。`total===0` なら見た目が保たれる。
 *
 * キーは `FreeElementKind` 由来＝**種別が増えたら数える側も見せる側もコンパイルエラー**になる（数え漏らし・
 * 表示漏れに気づける）。`slot`＝素材（写真・動画・立ち絵など）、`shape`＝図形（飾り）。
 */
export type FreeContentHidden = Record<FreeElementKind, number> & { total: number };

/** 「何も出なくならない」結果。**毎回新しいオブジェクト**を返す（共有インスタンスを返すと呼び出し側の書き換えが伝播する）。 */
function noFreeContentHidden(): FreeContentHidden {
  return { slot: 0, text: 0, subtitle: 0, shape: 0, total: 0 };
}

/** 多重集合から1つ消費する。あれば true（＝その中身は通常の見た目でも出る）。 */
function takeOne<T>(bag: Map<T, number>, key: T): boolean {
  const n = bag.get(key) ?? 0;
  if (n <= 0) return false;
  bag.set(key, n - 1);
  return true;
}

/**
 * FREE→通常の切替で**動画に出なくなる**自由配置の中身を数える（#547 P2-9・ADR-0030）。純粋関数。
 * （語は確認文言と揃えて「動画に出なくなる」＝この製品の「画面」は編集画面を指すので紛れる。）
 *
 * 切替そのものは非破壊で `freeLayout` は休眠保持されるが、**通常の見た目には自由配置の要素という枠が無い**ため、
 * 通常側で表示される中身（差し込み先の素材・文字・字幕）に対応しないものは動画に出なくなる。
 * 元の確認は「復元される休眠配置があるか（`willRestore`）」だけを見ていたので、**1枚でも復元されれば確認が出ず**、
 * FREE で足した残りが無言で消えていた（ADR-0026④）。ここでは逆に「**復元先を超えた分**」を数える。
 *
 * 突き合わせは**中身の同値＋多重度**で行う（要素 id ではない）：`freeLayoutFromPlacedContent` は変換のたびに新しい
 * 要素 id を振り、由来を残さないため id では辿れない。素材は assetId、文字は文字列、字幕は「通常側に字幕層があるか」で見る。
 * 同じ素材を2つ置いたのに通常側の差し込み先が1つなら、超過1つを数える（多重度を見ないと取りこぼす）。
 *
 * **いま見えていないものは数えない**：`hidden` の要素・非表示グループのメンバーは、切替で失う見た目が無い
 * （PR #576 の `contentHiddenBySwitch` と同じ流儀＝出ないものを「出なくなる」と言わない）。
 */
export function freeContentHiddenBySwitch(scene: Scene, newTemplate: Template | undefined): FreeContentHidden {
  const freeLayout = scene.freeLayout ?? [];
  if (freeLayout.length === 0 || !newTemplate || newTemplate.category === FREE_CATEGORY) return noFreeContentHidden();

  // 通常側で表示される中身を多重集合に積む（＝この分は切替後も出る）。
  // **非表示グループのメンバー層は描かれない**ので受け皿に数えない（ADR-0022・`layoutScene` と同じ除外）。
  // 数えてしまうと「受け皿がある」と誤認して確認が出ず、本来直したい無言消失がそのまま残る。
  const tmplGroups = newTemplate.groups ?? [];
  const shownLayers = newTemplate.layers.filter((l) => !isHiddenByGroup(l.id, tmplGroups));
  const slotIds = templateSlotIds(shownLayers); // 差し込み先の判定は描画・実効使用と同じ `templateSlotIds`（§2-7）
  const assetBag = new Map<string, number>();
  const add = (bag: Map<string, number>, key: string) => bag.set(key, (bag.get(key) ?? 0) + 1);
  for (const layer of shownLayers) {
    if (!slotIds.has(layer.id)) continue;
    // 描画は「場面の素材 ?? テンプレ既定素材」（ADR-0021・`layoutScene`）。同じ規則で受け皿を数える
    // ＝テンプレ既定の背景で出る素材を「出なくなる」と誤って言わない。
    const assetId = scene.assetRefs[layer.id] ?? layer.assetId;
    if (assetId) add(assetBag, assetId);
  }
  // 立ち絵（character 層）も通常側で出る素材＝FREE 化で slot 要素へ移した立ち絵と対応づく（ADR-0030）。
  // `character.enabled` は**見ない**：描画（`layoutScene`）も実効使用（`sceneActiveAssetIds`）も廃止済みで参照しない。
  // 層の数だけ積む：`layoutScene` は character 層ごとに立ち絵を描くので、2層あるテンプレでは2つ受け皿がある
  // （1つしか数えないと、立ち絵を2つ置いた往復で「出なくなる」と過剰に言う）。
  const poseAssetId = scene.character?.poseAssetId;
  if (poseAssetId) for (const l of shownLayers) if (l.type === 'character') add(assetBag, poseAssetId);
  const textBag = new Map<string, number>();
  for (const layer of shownLayers) {
    if (layer.type !== 'text' || !layer.textKey) continue;
    const text = scene.texts[layer.textKey];
    // 空文字だけを除く＝`layoutScene` が描く条件（`text.length > 0`）と同じ。空白だけの文字も**描かれる**
    // （背景帯つきなら帯が出る）ので、trim で落とすと受け皿を数え落とす。
    if (text) add(textBag, text);
  }
  // 字幕は箱の数では突き合わせない：通常テンプレの字幕層1枚がその場面の字幕を**すべて**受け持つ
  // （逐次も同時字幕の段積みも1層＝ADR-0031／`layoutScene`）。**箱が出している文が切替後も出るか**で判断する。
  // 判定は実表示の正典（`sceneDisplayedSubtitleTexts`）に委ねる＝層の textKey 違い・OFF・非表示グループも織り込み済み。
  //
  // 「切替後に字幕が1つでも出るか」では足りない：掛け合い場面で対象＝読み上げ（`texts.subtitle`）の箱を置くと、
  // 通常テンプレの字幕層は行の字幕で上書きされる（`layoutScene` の `opts.subtitleText`）ため **`texts.subtitle` は
  // 決して出ない**のに、行字幕があるせいで「字幕は出ている」と誤判定して無言消失する。
  const subtitlesAfter = new Set(sceneDisplayedSubtitleTexts(scene, newTemplate));

  const groups = scene.groups ?? [];
  const out = noFreeContentHidden();
  for (const el of freeLayout) {
    if (el.hidden || isHiddenByGroup(el.id, groups)) continue; // いま出ていないものは「出なくなる」に数えない
    if (el.kind === FREE_ELEMENT_KIND.slot) {
      if (!el.assetId) continue; // 空スロットは失う中身が無い
      if (!takeOne(assetBag, el.assetId)) out.slot += 1;
    } else if (el.kind === FREE_ELEMENT_KIND.text) {
      // 空文字だけが「失う中身が無い」＝描画条件（`layoutScene` の `text.length > 0`）と同じ。空白だけの文字は
      // 背景帯つきなら帯が出ているので、数えないと帯が確認なしで消える（受け皿側と同じ規則で対称）。
      if (!el.text) continue;
      if (!takeOne(textBag, el.text)) out.text += 1;
    } else if (el.kind === FREE_ELEMENT_KIND.subtitle) {
      const own = freeSubtitleElementTexts(el, scene);
      if (own.length === 0) continue; // いま何も出していない字幕箱は数えない
      // この箱が出している文が**すべて**切替後にも出るなら失っていない（1層が全話者・全行を受け持つ）。
      if (!own.every((t) => subtitlesAfter.has(t))) out.subtitle += 1;
    } else {
      // 図形は通常テンプレに受け皿が無い（飾りはテンプレ側が持つ）＝必ず出なくなる。
      // ここは `shape` 以外の種別（将来 `FREE_ELEMENT_KINDS` が増えた場合）も拾う **意図的な受け皿**：
      // 数え漏らすと「確認が出ないまま消える」＝直そうとしている不具合そのものになるため、
      // 種別名がずれてでも数える側に倒す（種別が増えたらここの分類を見直す）。
      out.shape += 1;
    }
  }
  return { ...out, total: out.slot + out.text + out.subtitle + out.shape };
}

/** order を配列順に 1..N で振り直す。 */
function reindexOrder(scenes: Scene[]): Scene[] {
  return scenes.map((sc, i) => ({ ...sc, order: i + 1 }));
}

/** 場面を上/下へ1つ移動した結果を返す（端なら変化なし）。 */
export function moveSceneInList(
  scenes: Scene[],
  parts: Part[],
  sceneId: string,
  direction: 'up' | 'down',
): { scenes: Scene[]; parts: Part[] } {
  const idx = scenes.findIndex((s) => s.sceneId === sceneId);
  const swap = direction === 'up' ? idx - 1 : idx + 1;
  if (idx < 0 || swap < 0 || swap >= scenes.length) return { scenes, parts };
  const next = [...scenes];
  [next[idx], next[swap]] = [next[swap], next[idx]];
  const reordered = reindexOrder(next);
  return { scenes: reordered, parts: rebuildPartSceneIds(parts, reordered) };
}

/**
 * 場面を結果配列の toIndex へ移動した結果を返す（ドラッグ&ドロップの任意位置移動・#398）。
 * toIndex は「移動後の配列でのその場面の index」＝ドロップ先の要素の位置。上下どちらの向きでも直感的に落ち着く
 *（下向き＝ドロップ先の位置へ、上向き＝ドロップ先を押し下げる）。範囲外は端にクランプ。移動後は order を 1..N で振り直し、
 * part.sceneIds もパート所属を保ったまま再構築する（moveSceneInList と同じ整合）。対象なし/位置不変は同一参照を返す（未保存/履歴にしない）。
 */
export function moveSceneToIndexInList(
  scenes: Scene[],
  parts: Part[],
  sceneId: string,
  toIndex: number,
): { scenes: Scene[]; parts: Part[] } {
  const from = scenes.findIndex((s) => s.sceneId === sceneId);
  if (from < 0) return { scenes, parts };
  const to = Math.max(0, Math.min(toIndex, scenes.length - 1));
  if (from === to) return { scenes, parts };
  const next = [...scenes];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  const reordered = reindexOrder(next);
  return { scenes: reordered, parts: rebuildPartSceneIds(parts, reordered) };
}

/**
 * 場面を複製し、元の直後に挿入した結果を返す（新IDは呼び出し側が採番して渡す）。
 * 複製された場面は音声を作り直す：単一 narration は voices/<sceneId>.wav が sceneId 単位、掛け合いの行音声は
 * lineAudioKey(sceneId, lineId) がキー（ADR-0015）で、いずれも新 sceneId では実体が無い。よって narration と scene.lines の
 * 両方について voicePath=null / status='none' にリセットする（「作成済みに見えるのに音声が無い/旧音声を指す」不整合を防ぐ）。
 * 行の lineId/text/speaker/startSec は複製としてそのまま保持（尺・素材割当・クリップ設定なども引き継ぐ）。
 */
export function duplicateSceneInList(
  scenes: Scene[],
  parts: Part[],
  sceneId: string,
  newSceneId: string,
): { scenes: Scene[]; parts: Part[] } {
  const idx = scenes.findIndex((s) => s.sceneId === sceneId);
  if (idx < 0) return { scenes, parts };
  const src = scenes[idx];
  const copy: Scene = {
    ...src,
    sceneId: newSceneId,
    narration: { ...src.narration, status: NARRATION_STATUS.none, voicePath: null },
    // 掛け合い（行ごと音声）も新 sceneId で音声キーが変わるため各行を作り直しにする（lineId/text/speaker/startSec は保持）。
    ...(src.lines ? { lines: src.lines.map((l) => ({ ...l, status: NARRATION_STATUS.none, voicePath: null })) } : {}),
    // 複製直後は検証し直す前提で警告をクリアする（古い検証結果を引き継がない）。
    warnings: [],
  };
  const next = [...scenes];
  next.splice(idx + 1, 0, copy);
  const reordered = reindexOrder(next);
  return { scenes: reordered, parts: rebuildPartSceneIds(parts, reordered) };
}

/**
 * 場面のセリフ（narration.text）を splitIndex で前半/後半に分け、1場面を2場面にする（Phase 2b・ADR-0007）。
 * 新IDは呼び出し側が採番して渡す。見た目・素材・clip 等は両場面に引き継ぐ。
 * 表示時間は前半/後半の文字数比で按分（合計は不変・各最低1秒）。両場面とも音声は作り直し・warnings はクリア。
 */
export function splitSceneInList(
  scenes: Scene[],
  parts: Part[],
  sceneId: string,
  splitIndex: number,
  newSceneId: string,
): { scenes: Scene[]; parts: Part[] } {
  const idx = scenes.findIndex((s) => s.sceneId === sceneId);
  if (idx < 0) return { scenes, parts };
  const src = scenes[idx];
  // 尺が 0 以下なら分割しない（両側 >0 を作れない）。場面ごとの下限は持たない（#553）。
  if (src.durationSec <= 0) return { scenes, parts };
  const at = resolveSplitIndex(src.narration.text, splitIndex);
  if (at == null) return { scenes, parts }; // セリフが短すぎて分割できない
  const firstText = src.narration.text.slice(0, at).trimEnd();
  const secondText = src.narration.text.slice(at).trimStart();
  const [d1, d2] = apportionDuration(src.durationSec, firstText.length, secondText.length);
  const first: Scene = {
    ...src,
    durationSec: d1,
    narration: { ...src.narration, text: firstText, status: NARRATION_STATUS.none, voicePath: null },
    warnings: [],
  };
  const second: Scene = {
    ...src,
    sceneId: newSceneId,
    durationSec: d2,
    narration: { ...src.narration, text: secondText, status: NARRATION_STATUS.none, voicePath: null },
    warnings: [],
  };
  const next = [...scenes];
  next.splice(idx, 1, first, second);
  const reordered = reindexOrder(next);
  return { scenes: reordered, parts: rebuildPartSceneIds(parts, reordered) };
}

/**
 * 掛け合い場面（scene.lines）を行境界で2つに分ける（#405）。lines[0, lineIndex) を前・[lineIndex, 末] を後の場面へ。
 * 後の場面は新 sceneId になり行の音声キー（lineAudioKey）が変わるため、後半の各行の音声状態/パス/開始秒をリセット
 *（作り直し前提・自動逐次に戻す＝splitSceneInList と同ポリシー）。前半は sceneId 不変ゆえ音声（キー）は保つが、
 * 場面尺が d1 に縮むと手動 startSec が新しい尺を超え得る（例: 10秒場面で startSec:6 の行が前半 d1<6 で範囲外→
 * lineTimeline でクランプされ0秒区間として落ち「作成済みなのに出ない」不整合＝ADR-0026 ④）ため、**両場面とも
 * startSec は自動逐次に戻す**（保存された startSec が新しい durationSec を超えて残らないことを保証）。
 * 掛け合いでない/1行/範囲外/尺が0以下は分割しない（変化なし）。表示時間は各側の総文字数比で按分（両側 >0・合計は元のまま）。
 */
export function splitSceneLinesInList(
  scenes: Scene[],
  parts: Part[],
  sceneId: string,
  lineIndex: number,
  newSceneId: string,
): { scenes: Scene[]; parts: Part[] } {
  const idx = scenes.findIndex((s) => s.sceneId === sceneId);
  if (idx < 0) return { scenes, parts };
  const src = scenes[idx];
  const lines = src.lines;
  if (!lines || lines.length < 2) return { scenes, parts }; // 掛け合いでない/1行＝分割不能
  if (lineIndex < 1 || lineIndex > lines.length - 1) return { scenes, parts }; // 各側1行以上
  if (src.durationSec <= 0) return { scenes, parts }; // 両側 >0 を作れない（#553：場面ごとの下限は持たない）
  // 前半は音声（sceneId 不変ゆえキー lineAudioKey も不変）を保つが、尺が縮み手動 startSec が範囲外になり得るため
  // startSec は自動逐次へ戻す（後半と対称・上記 JSDoc の不整合を分割時に潰す）。lineId/text/speaker/subtitle 等は保持。
  const firstLines = lines.slice(0, lineIndex).map((l) => ({ ...l, startSec: undefined }));
  const secondLines = lines
    .slice(lineIndex)
    .map((l) => ({ ...l, status: NARRATION_STATUS.none, voicePath: null, startSec: undefined }));
  const len1 = firstLines.reduce((n, l) => n + l.text.length, 0);
  const len2 = secondLines.reduce((n, l) => n + l.text.length, 0);
  const [d1, d2] = apportionDuration(src.durationSec, len1, len2);
  // 後半の先頭になった同時開始フラグを落とす（前と同時にする相手がいない・ADR-0031）。startSec は上で自動逐次へ戻し済み。
  const first: Scene = normalizeDialogueTiming({ ...src, durationSec: d1, lines: firstLines, warnings: [] });
  const second: Scene = normalizeDialogueTiming({ ...src, sceneId: newSceneId, durationSec: d2, lines: secondLines, warnings: [] });
  const next = [...scenes];
  next.splice(idx, 1, first, second);
  const reordered = reindexOrder(next);
  return { scenes: reordered, parts: rebuildPartSceneIds(parts, reordered) };
}

/** 分割位置を [1, len-1] に収める。端/範囲外は中央に近い文末記号→無ければ中央で分割。len<2 は null（分割不能）。 */
function resolveSplitIndex(text: string, index: number): number | null {
  const len = text.length;
  if (len < 2) return null;
  if (index >= 1 && index <= len - 1) return index;
  const mid = Math.floor(len / 2);
  const boundaries: number[] = [];
  for (let i = 1; i < len; i++) {
    if ('。！？!?\n'.includes(text[i - 1])) boundaries.push(i);
  }
  if (boundaries.length === 0) return mid;
  return boundaries.reduce((best, b) => (Math.abs(b - mid) < Math.abs(best - mid) ? b : best));
}

/**
 * 表示時間を文字数比で按分する（合計は元のまま）。**場面ごとの下限は持たない**（#553）＝守るのは「両側とも >0」だけ
 * （0秒の場面を作らない＝11 §9 の自動補正と同じ流儀）。片側の文字数が 0 で比が潰れるときは等分。
 * 整数丸めはやめたが（旧実装は各側を最低3秒に揃えていた）、**生の二進浮動小数を持ち込まない**よう 0.1 秒へ量子化する
 * ＝秒（実数）が正準（ADR-0023）でも UI に 2.3333333333333335 のような値を出さないため。**合計は d2 = total - d1 で厳密保持**。
 */
function apportionDuration(total: number, len1: number, len2: number): [number, number] {
  const half: [number, number] = [total / 2, total / 2];
  if (len1 + len2 === 0) return half;
  const raw = (total * len1) / (len1 + len2);
  const d1 = quantizeSec(raw); // 表示・入力と同じ格子（SEC_STEP）へ量子化＝欄の値と表示が食い違わない（§2-7）
  if (d1 <= 0 || total - d1 <= 0) return half; // 片側が潰れる＝等分（>0 を守る）
  return [d1, total - d1]; // 合計は元のまま（差で出す＝丸め誤差を残さない）
}
