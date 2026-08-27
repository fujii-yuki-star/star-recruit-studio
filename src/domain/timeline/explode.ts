// 見た目パターンのクリップを「バラす」（ADR-0032 決定6・#632）。純粋関数（副作用なし・§7 テスト対象）。
//
// **バラす＝表現の変更であって、見た目の変更ではない。** 差し込み口の付いた1つの部品を、中身ぶんの
// 部品（自由配置）へ展開する。バラす前後で**同じ絵**になることが完了条件なので、変換は描画と同じ
// 材料を通す：クリップ→`Scene`（`sceneFromClip`）→層ごとの要素（`freeLayoutFromPlacedContent`＝
// 場面形式の「通常→自由配置」と同じ関数・図形も含める）。ここで別の規則を書き起こさない（§6）。
//
// **戻せない**（ADR-0032 未解決6 の決着）＝バラした後の部品から元のテンプレは組み立て直せない
// （どの部品がどの差し込み口だったかを持たないうえ、バラした後に自由に動かせる）。取り消し（Ctrl+Z）で
// だけ戻る。だから**操作の前に断る**（`§2-5`＝画面が確認を出す）。
import { DEFAULT_BACKGROUND_COLOR, dimsForOrientation } from '../constants';
import { FREE_ELEMENT_KIND, LAYER_TYPE, TIMELINE_CLIP_KIND, TRACK_KIND } from '../enums';
import type { Group } from '../group/types';
import { createClipId, createGroupId, createTrackId } from '../project/persistence';
import { IDENTITY_TRANSFORM } from '../project/groupOps';
import { freeLayoutFromPlacedContent } from '../project/sceneOps';
import type { Template } from '../template/types';
import type { FreeElement } from '../project/types';
import { videoPlacementsOfClip, videoAssetIds } from './video';
import type { VideoPlacement } from './video';
import { ORIGINAL_AUDIO_VOLUME, SPEED_DEFAULT } from '../constants';
import { EDIT_BLOCKED } from './edit';
import type { EditResult } from './edit';
import { staticSubtitleText } from './bake';
import { sceneFromClip } from './sceneFromClip';
import type { TimelineClip, TimelineProject, Track } from './types';
import { resolveClipBox } from './box';

/**
 * 見た目パターンのクリップを、中身ぶんの部品へ展開する。
 *
 * - 展開した部品は**同じ時間**（開始・長さ）に置く。同じ列には重ねられない（`11 §8` V24）ので、
 *   **元の列のすぐ手前に列を足す**＝ほかの部品との前後関係は変わらない。
 * - 展開した部品は**1つのグループ**にする＝まとめて動かせる（焼き出しの FREE 場面と同じ扱い）。
 * - 元のクリップに付いていた**動き（キーフレーム）はグループへ移す**＝バラしても動きが止まらない。
 * - 元のクリップが**別のグループのメンバーだったときは、その席を新しいグループが引き継ぐ**。
 */
export function explodeTemplateClip(doc: TimelineProject, clipId: string, template: Template): EditResult {
  const clip = doc.clips.find((c) => c.id === clipId);
  if (!clip || clip.kind !== TIMELINE_CLIP_KIND.template) return { ok: false, reason: EDIT_BLOCKED.notFound };
  // 渡された見た目パターンがその部品のものであることを確かめる＝渡し違いで**別の見た目の中身**に
  // 化けない（バラすは戻せないので、取り違えたまま進ませない）。
  if (clip.templateId !== template.templateId) return { ok: false, reason: EDIT_BLOCKED.notFound };
  const trackIndex = doc.tracks.findIndex((t) => t.id === clip.trackId);
  if (trackIndex < 0) return { ok: false, reason: EDIT_BLOCKED.notFound };
  if (doc.tracks[trackIndex].locked) return { ok: false, reason: EDIT_BLOCKED.locked };

  // 描画と同じ材料で中身を取り出す（`faithful`＝**描かれるものすべて**＝落とすと見た目が変わる）。
  const scene = sceneFromClip(clip, template);
  // ⚠️ **枠の使い方も持ち越す**（#512 段3b）＝差し込み口の元の音・切り出す先頭・速さを捨てると、
  // 鳴っていた音が黙って消え、切り出しも前と変わる（決定23＝前後で絵が変わらない）。
  // ⚠️ **引くのは per-use ではなく実効値**（レビュー 🔴）＝`slotClips` だけを見ると、素材既定
  //（`asset.clip`）に頼っている枠が「設定なし」になり、バラした瞬間に音が消える。描画・再生と
  // **同じ解決**（`videoPlacementsOfClip`）から採る＝展開後に継承経路が無くなっても値は残る。
  const { elements, slotLayerByElementId, characterElementIds } = freeLayoutFromPlacedContent(scene, template, { faithful: true });
  const placementByLayer = new Map(
    videoPlacementsOfClip(doc, clip, { templateOf: () => template }).map((pl) => [pl.layerId, pl]),
  );
  // ⚠️ **持っていけないものは黙って落とさない**（ADR-0032）＝「切り出す終わり」は直接置きの語彙に
  // 無く、置いた長さを縮めると**絵が早く消える**・縮めないと**その先まで流れる**＝どちらも決定23 に
  // 反する。動きが付いた部品と同じ流儀で、バラす前に断る。
  // ⚠️ **出どころで案内を分ける**（レビュー 🟡）＝「ここまで」は**その枠だけの設定**（`slotClips`）と
  // **素材の既定**（`asset.clip`）のどちらからも来る（解決は per-use が優先＝`resolveSlotClip`）。
  // 素材の画面で外せるのは後者だけなので、前者に同じ案内を出すと**従っても解除されない行き止まり**になる。
  // ⚠️ **差し込み口でない層に入れた動画は、バラすと動き出す**（#816-4）＝いまは静止画として描かれる
  //（置き場所にするのは差し込み口の層だけ）が、バラすと直接置きになり実映像になる＝決定23 に反する。
  // 「動かさない」を写す語彙が直接置きに無いので、切り出す終わりと同じ流儀で先に断る。
  // ⚠️ **数えるのは「これから作る要素」**（レビュー 🟡／ℹ️）＝テンプレの層や `assetRefs` から数えると、
  // **立ち絵**（`character.poseAssetId`＝変換は slot 要素にする）を取りこぼし、逆に**テンプレの
  // まとまりで隠れた層**（持ち込まない）まで数えて過剰に断る。要素から数えれば両方そろう。
  // バラすと直接置きの動画になり**動き出す**（バラす前は静止＋書き出しも断っていたのに、後は黙って通る）。
  const videoIds = videoAssetIds(doc);
  // ⚠️ **立ち絵の要素も置き場所と結ぶ**（#809）＝`slotLayerByElementId` は差し込み口の層しか
  // 持たないので、立ち絵の要素はそのままだと「置き場所ではない」＝**バラすと動き出す**と
  // 誤判定される（実際に、断りが背景用のコードで出た）。立ち絵の層 id で引き直す。
  const characterLayerId = template.layers.find((l) => l.type === LAYER_TYPE.character)?.id;
  const layerOfElement = (el: FreeElement): string =>
    (characterElementIds.has(el.id) ? characterLayerId : slotLayerByElementId[el.id]) ?? '';
  const movesToVideo = (el: FreeElement): boolean =>
    el.kind === FREE_ELEMENT_KIND.slot &&
    typeof el.assetId === 'string' &&
    videoIds.has(el.assetId) &&
    !placementByLayer.has(layerOfElement(el));
  // ⚠️ **立ち絵の別扱いは退役した**（#809）＝かつては「バラすと動き出す」（バラす前は静止で、
  // 書き出しも断っていた）ので専用の断りを持っていたが、**立ち絵に入れた動画も映るようになった**
  // ので前提が消えた。判定は `placementByLayer`（`videoPlacementsOfClip` 由来）を見ているので、
  // 立ち絵が置き場所になった時点で `movesToVideo` が偽になり、**この分岐は到達しなくなった**＝
  // 残すと「まだバラせません」という**嘘の理由**を持つ死んだコードになるので消した。
  if (elements.some(movesToVideo)) return { ok: false, reason: EDIT_BLOCKED.explodeBackgroundVideo };

  const shortened = [...placementByLayer.values()].filter((pl) => pl.durationSec < clip.durationSec);
  if (shortened.length > 0) {
    const perUse = shortened.some((pl) => pl.layerId != null && clip.slotClips?.[pl.layerId]?.endSec != null);
    return { ok: false, reason: perUse ? EDIT_BLOCKED.explodeTrimEndPerUse : EDIT_BLOCKED.explodeTrimEnd };
  }
  // ⚠️ **ここも `layerOfElement` で引く**（#809・PR #871 レビュー 🔴）＝`slotLayerByElementId` は
  // 差し込み口の層しか持たないので、**立ち絵の要素はキーごと落ちる**。落ちると `use` が渡らず、
  // per-use の使い方（元の音・速さ・使い始め）が**バラした後に既定へ戻る**＝ADR-0032 決定23
  //（バラす前後で変わらない）に反する。上の `movesToVideo` だけ直して**ここを直し忘れていた**。
  const useByElement = new Map(
    elements.map((el) => [el.id, placementByLayer.get(layerOfElement(el))]),
  );
  // 下地（`template.defaults.backgroundColor`）は層ではなくクリップの塗り（`layoutTimelineAt`）なので、
  // **最背面の図形として自分で足す**＝背景の層を持たない見た目でもバラした後に白く抜けない。
  // 箱は描画と**同じ関数**で解決する（`resolveClipBox`＝未指定は画面いっぱい・#685）。
  const canvas = dimsForOrientation(doc.videoSettings.aspectRatio);
  const box = resolveClipBox(clip, canvas);
  const background: FreeElement = {
    // この id はクリップへ写すときに捨てる（保存しない一時的な目印）。
    id: 'background',
    kind: FREE_ELEMENT_KIND.shape,
    x: box.x,
    y: box.y,
    w: box.w,
    h: box.h,
    fillColor: template.defaults?.backgroundColor ?? DEFAULT_BACKGROUND_COLOR,
    opacity: 1,
    radius: 0,
  };
  // 字幕は**いま出ている文を焼き付ける**（焼き出しと同じ＝`staticSubtitleText`）。付けないと、
  // 字幕の部品が「対象」から解こうとして何も出ない＝バラした瞬間に字幕が消える（#642 レビューと同じ筋）。
  const withSubtitleText = elements.map((el) => ({ ...el, ...staticSubtitleText(el, scene) }));
  // 動きの支点は、クリップでは**箱の中心**・グループでは**メンバー全体の外接矩形の中心**。中身が箱から
  // はみ出していると支点がずれ、拡大・回転の動きで**絵がずれる**（平行移動と不透明度は支点に依らない）。
  // 黙ってずれた動画にせず、先に動きを外してもらう（§2-5・ADR-0026④）。
  if (movesAroundAnchor(doc, clip) && !fitsInBox(withSubtitleText, background)) {
    return { ok: false, reason: EDIT_BLOCKED.explodeAnchor };
  }
  return { ok: true, doc: buildExploded(doc, clip, trackIndex, [background, ...sortedByZ(withSubtitleText)], useByElement) };
}

/** 拡大・回転の動きが付いているか（平行移動と不透明度は支点に依らないので数えない）。 */
function movesAroundAnchor(doc: TimelineProject, clip: TimelineClip): boolean {
  const anim = (doc.animations ?? []).find((a) => a.targetId === clip.id);
  return !!anim?.keyframes.some((k) => (k.scale != null && k.scale !== 1) || (k.rotation != null && k.rotation !== 0));
}

/** 中身が箱の中に収まっているか（収まっていればグループの外接矩形＝箱＝支点が変わらない）。 */
function fitsInBox(elements: readonly FreeElement[], box: FreeElement): boolean {
  return elements.every(
    (el) => el.x >= box.x && el.y >= box.y && el.x + el.w <= box.x + box.w && el.y + el.h <= box.y + box.h,
  );
}

/** 重なり順（実効 z）で背面→前面へ。同じ z はテンプレの層の並び（描画と同じ）。 */
function sortedByZ(elements: readonly FreeElement[]): FreeElement[] {
  return elements.map((el, i) => ({ el, i })).sort((a, b) => (a.el.zIndex ?? 0) - (b.el.zIndex ?? 0) || a.i - b.i).map((x) => x.el);
}

function buildExploded(
  doc: TimelineProject,
  clip: TimelineClip,
  trackIndex: number,
  elements: readonly FreeElement[],
  /** 新しい要素 id → その枠の**実効の**使い方（切り出す先頭・速さ・元の音）。#512 段3b。 */
  useByElement: ReadonlyMap<string, VideoPlacement | undefined> = new Map(),
): TimelineProject {
  const clipIds = doc.clips.map((c) => c.id);
  const trackIds = doc.tracks.map((t) => t.id);
  const newClips: TimelineClip[] = [];
  const newTracks: Track[] = [];
  elements.forEach((el, i) => {
    // 背面から順に、元の列（1つめ）とその手前に足した列（2つめ以降）へ置く。
    let trackId: string;
    if (i === 0) {
      trackId = clip.trackId;
    } else {
      trackId = createTrackId(trackIds);
      trackIds.push(trackId);
      // 元の列の「隠す」「固定」は足す列にも引き継ぐ＝隠していた中身がバラした瞬間に表へ出ない。
      const src = doc.tracks[trackIndex];
      newTracks.push({
        id: trackId,
        kind: TRACK_KIND.visual,
        ...(src.hidden ? { hidden: true } : {}),
        ...(src.locked ? { locked: true } : {}),
      });
    }
    const id = createClipId(clipIds);
    clipIds.push(id);
    newClips.push(clipFromElement(el, id, trackId, clip, useByElement.get(el.id)));
  });

  const tracks = [...doc.tracks];
  tracks.splice(trackIndex + 1, 0, ...newTracks);

  const groupId = createGroupId((doc.groups ?? []).map((g) => g.id));
  // 変形は素通し（バラした時点では動かさない）＝焼き出しが場面ごとに作るグループと同じ形。
  const group: Group = { id: groupId, members: newClips.map((c) => c.id), transform: { ...IDENTITY_TRANSFORM } };
  // 元のクリップが入っていたグループの席は、新しいグループが引き継ぐ（入れ子＝`groupElementIds` が辿る）。
  const groups = (doc.groups ?? []).map((g) =>
    g.members.includes(clip.id) ? { ...g, members: g.members.map((m) => (m === clip.id ? groupId : m)) } : g,
  );
  // 動き（キーフレーム）はグループへ移す＝バラしても同じように動く。
  const animations = (doc.animations ?? []).map((a) => (a.targetId === clip.id ? { ...a, targetId: groupId } : a));

  return {
    ...doc,
    tracks,
    clips: [...doc.clips.filter((c) => c.id !== clip.id), ...newClips],
    groups: [...groups, group],
    ...(animations.length > 0 ? { animations } : {}),
  };
}

/**
 * 要素1つを、同じ時間に置くクリップへ写す（空間の語彙は同じもの＝`11 §7.6`）。
 *
 * **落とすものを名指しする**（焼き出し `bake.ts` と同じ形）＝`zIndex`（重ね順は列の並びだけ）と
 * `subtitleSource`（本形式に「対象」の語彙は無い）はクリップに置けない。名指しで落とさないと
 * スキーマに適合しない文書ができ、**自動保存が黙って書かれない**（型では止まらない＝spread の穴）。
 */
function clipFromElement(
  el: FreeElement,
  id: string,
  trackId: string,
  from: TimelineClip,
  use?: VideoPlacement,
): TimelineClip {
  const { id: _elId, kind, zIndex: _z, subtitleSource: _src, ...spatial } = el;
  void _elId;
  void _z;
  void _src;
  return {
    ...spatial,
    id,
    kind,
    trackId,
    startSec: from.startSec,
    durationSec: from.durationSec,
    // ⚠️ **枠の使い方はクリップ自身の語彙へ写す**（#512 段3b）＝直接置きの動画は `slotClips` を
    // 持たず、素材既定（`asset.clip`）も見ない。**実効値をここで書き切る**＝継承経路が無くなっても
    // 前と同じに鳴る・同じところから流れる。既定と同じ値は書かない（他の操作と同じ規則）。
    //（「切り出す終わり」は上で断っているのでここには来ない。）
    ...(use && use.sourceStartSec !== 0 ? { sourceStartSec: use.sourceStartSec } : {}),
    ...(use && use.speed !== SPEED_DEFAULT ? { speed: use.speed } : {}),
    ...(use?.useOriginalAudio ? { useOriginalAudio: true } : {}),
    ...(use && use.useOriginalAudio && use.originalAudioVolume !== ORIGINAL_AUDIO_VOLUME
      ? { originalAudioVolume: use.originalAudioVolume }
      : {}),
    // 隠してある部品をバラしても表に出さない（前後で絵が変わらない・決定23）。
    ...(from.hidden ? { hidden: true } : {}),
  };
}
