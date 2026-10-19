// 読み方辞書（ADR-0037・#350）。純粋な部分（§7 テスト対象）。
//
// ⚠️ **正典はアプリが持つ**（`appData/readingdict.json`）＝エンジンを入れ替えても、外部エンジンを
// 指しても同じ読みになる（決定1）。エンジンの辞書は**そこへ映したもの**。
// ⚠️ **他のアプリの辞書を壊さない**（決定3）＝丸ごと入れ替えない・**アプリが関与していない語に触らない**。
// ⚠️ **突き合わせは「言葉」で行う**（決定3b）＝`word_uuid` は「いま繋がっているエンジンでの控え」。
// 別PCへ移す・エンジンを入れ直すと通用しない（実測＝未知の uuid への `PUT`/`DELETE` は `422`）。
//
// ⚠️ **控え（uuid）は語そのものには持たせない**（実装判断・決定3b を構造で守る）。
// ADR は「書き出しに uuid を含めない」と規則で書いているが、語が uuid を持つ形にすると
// **書き出す側が毎回それを落とす**ことになり、落とし忘れると渡した先で全語が `422` になって
// 声が作れなくなる（決定7 と噛み合う）。そこで語（`ReadingEntry`）と控え（`EngineLinks`）を
// **別の入れ物**にし、書き出しは語だけを書く＝**含めようがない**形にした。

/** 音が下がる場所（アクセント型）。0＝下がらない（平板）／1以上＝そのモーラの後で下がる。 */
export type AccentType = number;

/** 辞書の1語（アプリが持つ形＝**これがそのまま書き出す形**）。 */
export interface ReadingEntry {
  /** 言葉（表記）。**突き合わせの鍵**。 */
  surface: string;
  /** 読み（カタカナ）。 */
  yomi: string;
  /** 音が下がる場所。 */
  accentType: AccentType;
}

/**
 * いま繋がっているエンジンでの控え（言葉→`word_uuid`）。**正典ではない**＝作り直せる。
 *
 * ⚠️ **「アプリが作った語」だけを覚える**（決定3）＝控えは**消してよい語の名簿**でもあるので、
 * 「言葉で引いたら同じ読みで既にあった」だけの語（＝利用者が VOICEVOX 本体で入れた語かもしれない）を
 * ここへ入れてはいけない。入れると、アプリの一覧から外したときに**本体側の語を消してしまう**
 *（辞書は OS 上の共有ファイル＝取り戻せない）。
 *
 * 二重登録を防ぐのは控えではなく**毎回の言葉での引き直し**（`GET /user_dict`）＝控えは速い道でしかない。
 * だから失っても壊れない（消せなくなるだけ＝触らない側＝安全な向き）。
 */
export type EngineLinks = Readonly<Record<string, string>>;

/** エンジン側の1語（`GET /user_dict` の値から要るものだけ）。 */
export interface EngineWord {
  uuid: string;
  surface: string;
  yomi: string;
  accentType: AccentType;
  /** エンジンでの優先度（0〜10）。読めなかったら未指定。 */
  priority?: number;
}

/**
 * 登録する語の優先度（0〜10・VOICEVOX の `priority`）。**いちばん高くする**（ADR-0037 追補 2026-10-19）。
 *
 * ⚠️ **既にエンジンの辞書にある言葉は、既定（5）では登録が効かない**（実測）＝「角田→カドタ」
 * 「東海林→トウカイリン」は 8〜9、「日本→ヒノモト」「山崎→ヤマサキ」は 10 でやっと効いた。
 * 直したいのはまさにそういう人名・地名なので、送らない（既定 5）と**登録したのに読みが変わらない**
 *（§2-5＝設定した意味どおりにならない）。辞書に無い言葉はどの値でも効く。
 */
export const READING_DICT_PRIORITY = 10;

/** エンジンへ**送る**操作（1語ぶん）。送らないもの（控えの取り直し）はここに出さない。 */
export type DictOp =
  | { kind: 'add'; entry: ReadingEntry }
  | { kind: 'update'; uuid: string; entry: ReadingEntry }
  | { kind: 'remove'; uuid: string; surface: string };

/** 言葉をそろえる（空白・全角空白を落とす）。 */
export function normalizeSurface(s: string): string {
  // 全角空白は `\u3000` で書く（生で置くと「見えない文字」になり、直す人が気づけない）。
  return s.replace(/[\s\u3000]+/g, '');
}

function sameReading(
  a: { yomi: string; accentType: AccentType },
  b: { yomi: string; accentType: AccentType },
): boolean {
  return a.yomi === b.yomi && a.accentType === b.accentType;
}

/**
 * **黙って上書きしなかった**語（決定3b）＝言葉は同じだが読みが違い、アプリが入れた覚えのない語。
 * 画面がこれを出して「そのままにする／こちらの読みにする」を選ばせる。
 */
export interface EngineConflict {
  entry: ReadingEntry;
  engine: EngineWord;
  /**
   * 読みは同じだが、**弱い登録**（優先度が `READING_DICT_PRIORITY` より低い）で効かないことがある（ADR-0037 追補）。
   * 他人の語なので黙って強くしない（決定3）＝知らせて、「こちらの読みにする」で登録し直せるようにする。
   */
  weak?: true;
}

/** エンジンへ映すための計画（`planDictSync` の答え）。 */
export interface DictSyncPlan {
  /** エンジンへ送る操作。空＝そろっている（何も送らない）。 */
  ops: DictOp[];
  /**
   * **送らずに控えだけ取り直す**もの（言葉→uuid）。**アプリが入れた覚えのある語だけ**＝
   * エンジンを入れ直して uuid が変わった場合の付け替え。⚠️ 覚えの無い語をここへ入れない（決定3）。
   */
  links: Record<string, string>;
  /**
   * **同じ読みで既にあったので何もしなかった**語（言葉）。⚠️ **控えには入れない**＝
   * 利用者が VOICEVOX 本体で入れた語かもしれないので、あとで消す対象にしない（決定3）。
   * 送らないのはどちらも同じだが、**消してよいかが違う**ので分けて返す。
   */
  adopted: string[];
  /**
   * **黙って上書きしなかった**語（決定3b）＝言葉は同じだが読みが違い、**アプリが入れた覚えのない**語。
   * 利用者が VOICEVOX 本体で入れた読みを勝手に書き換えない。呼ぶ側が知らせて選ばせる。
   */
  conflicts: EngineConflict[];
}

/**
 * アプリの辞書をエンジンへ映すための計画を出す（ADR-0037 決定2・3・3b）。
 *
 * ⚠️ **アプリが関与していない語に触らない**（決定3）＝エンジンにしか無い語は**消さない**。
 * 消すのは**控えを持っていた語**（＝アプリが入れた語）が辞書から消えたときだけ。
 */
export function planDictSync(
  entries: readonly ReadingEntry[],
  engineWords: readonly EngineWord[],
  links: EngineLinks = {},
): DictSyncPlan {
  const byUuid = new Map(engineWords.map((w) => [w.uuid, w]));
  const bySurface = new Map(engineWords.map((w) => [normalizeSurface(w.surface), w]));
  const plan: DictSyncPlan = { ops: [], links: {}, adopted: [], conflicts: [] };
  const wanted = new Set<string>();

  for (const raw of entries) {
    const surface = normalizeSurface(raw.surface);
    if (surface === '') continue; // 空の言葉は送らない（登録できない）
    if (wanted.has(surface)) continue; // 同じ言葉が2つあっても1回だけ送る（重複を作らない）
    wanted.add(surface);
    const entry: ReadingEntry = { ...raw, surface };
    // ① 控えの uuid で当たるか（いちばん速い道）。
    const known = links[surface];
    const byRef = known ? byUuid.get(known) : undefined;
    if (byRef) {
      // ⚠️ **優先度も見る**（ADR-0037 追補）＝前の版は優先度を送らずに登録していた（既定 5＝効かない語がある）。
      // 読みがそろっていても優先度が違えば送り直す＝開き直すだけで前の登録も効くようになる。
      // 自分の語（控えが当たった語）だけ＝他人の語の優先度には触らない（決定3）。
      // ⚠️ **優先度が読めない（返さない版のエンジン）ときは比べない**（PR #1467 レビュー ℹ️）＝比べると毎回
      // 送り直しになり、書き込めないエンジンでは毎回止まる（決定7）。
      if (!sameReading(byRef, entry) || (byRef.priority !== undefined && byRef.priority !== READING_DICT_PRIORITY)) {
        plan.ops.push({ kind: 'update', uuid: byRef.uuid, entry });
      }
      else plan.links[surface] = byRef.uuid; // そろっている＝控えを保つ
      continue;
    }
    // ② 控えが無い／当たらない（別PC・エンジン入れ直し）＝**言葉で引き直す**。
    const found = bySurface.get(surface);
    if (!found) {
      plan.ops.push({ kind: 'add', entry });
      continue;
    }
    // ⚠️ **控えが当たらなかった語は、覚えの有無にかかわらず「他人の語かもしれない」**
    //（PR #883 再レビュー 🔴）。以前は「覚えがある＝この語は自分のもの」と見て付け替え／上書きして
    // いたが、**覚えは「その言葉について過去に何か作った」ことしか示さない**。
    // 実際に起きうる筋道＝①アプリが登録 →②エンジンを入れ直して控えの uuid が消える
    // →③その言葉を**別の主体**（VOICEVOX 本体・別PC・別のアプリ）が独立に登録
    // →④アプリが同期すると、言葉で当たるのは**他人の語**。ここで直すと利用者の読みを黙って書き換え、
    // 控えへ入れると一覧から外したときに**他人の語を消す**（決定3・決定3b に反する）。
    //
    // 失うのは「エンジンを入れ直した直後の自動の付け替え」だけ＝**控えた uuid に一度でも
    // 実際に当たったときだけ**自分の語と見る、という安全側の縮小にする。
    if (sameReading(found, entry)) {
      // ⚠️ **同じ読みでも弱い登録なら知らせる**（PR #1467 レビュー 🟡）＝既にエンジンの辞書にある言葉は、
      // 優先度が低いと登録が効かない（事実14）。「アプリでは登録済みなのに読みが変わらない」を黙って残さない。
      // 優先度が読めない（返さない版）なら比べない＝言えないことは言わない。
      if (found.priority !== undefined && found.priority < READING_DICT_PRIORITY) {
        plan.conflicts.push({ entry, engine: found, weak: true });
        continue;
      }
      plan.adopted.push(surface); // 同じ読みで既にある＝送らない・控えにも入れない
      continue;
    }
    // ③ 言葉は同じで読みが違う＝**黙って上書きしない**（決定3b）。利用者に選ばせる。
    plan.conflicts.push({ entry, engine: found });
  }

  // ⑤ アプリが入れた語のうち、辞書から消えたもの＝エンジンからも消す。
  for (const [surface, uuid] of Object.entries(links)) {
    if (wanted.has(surface)) continue;
    if (!byUuid.has(uuid)) continue; // もうエンジンにも無い＝することが無い
    plan.ops.push({ kind: 'remove', uuid, surface });
  }
  return plan;
}

/**
 * 読み込んだ辞書をいまの辞書へ足す（決定8）。
 *
 * ⚠️ **足すのが既定で、同じ言葉があるとき黙って上書きしない**（利用者判断 2026-08-26）＝
 * 重なった語は**返して選ばせる**（どちらを残すかは利用者が決める）。読みまで同じなら重なりに出さない
 *（選ばせることが無い）。
 */
export function mergeDict(
  current: readonly ReadingEntry[],
  incoming: readonly ReadingEntry[],
): { merged: ReadingEntry[]; duplicates: { current: ReadingEntry; incoming: ReadingEntry }[] } {
  const bySurface = new Map(current.map((e) => [normalizeSurface(e.surface), e]));
  const merged = [...current];
  const duplicates: { current: ReadingEntry; incoming: ReadingEntry }[] = [];
  for (const raw of incoming) {
    const surface = normalizeSurface(raw.surface);
    if (surface === '') continue;
    const entry: ReadingEntry = { surface, yomi: raw.yomi, accentType: raw.accentType };
    const exists = bySurface.get(surface);
    if (exists) {
      if (!sameReading(exists, entry)) duplicates.push({ current: exists, incoming: entry });
      continue;
    }
    bySurface.set(surface, entry);
    merged.push(entry);
  }
  return { merged, duplicates };
}

/**
 * 読み込んだ辞書のうち、重なった語を**入ってきた側で置き換える**（利用者が「置き換える」を選んだとき）。
 * 選ばなかったものは触らない＝**まとめて上書きにしない**（決定8）。
 */
export function replaceEntries(
  entries: readonly ReadingEntry[],
  replacements: readonly ReadingEntry[],
): ReadingEntry[] {
  const bySurface = new Map(replacements.map((e) => [normalizeSurface(e.surface), e]));
  return entries.map((e) => bySurface.get(normalizeSurface(e.surface)) ?? e);
}

/**
 * 読み（カタカナ）を**音の粒**に分ける。
 *
 * ⚠️ **画面に「モーラ」とは出さない**（決定6・§2-3）＝これは「どこで下がるか」の候補を数えるための
 * 内部の道具。小さいカナ（ャュョァィゥェォヮ）は**直前とひとまとまり**、伸ばす音（ー）・詰まる音（ッ）・
 * はねる音（ン）は**それぞれ1つ**（VOICEVOX のアクセント型の数え方と同じ）。
 */
export function splitMorae(yomi: string): string[] {
  const small = 'ャュョァィゥェォヮゃゅょぁぃぅぇぉゎ';
  const out: string[] = [];
  for (const ch of yomi) {
    if (out.length > 0 && small.includes(ch)) out[out.length - 1] += ch;
    else out.push(ch);
  }
  return out;
}

/**
 * 「どこで下がるか」の候補（0＝下がらない〜粒の数）。
 * ⚠️ **既定は先頭で下がる形**（決定6）＝粒が1つ以上あれば 1、無ければ 0。
 */
export function accentCandidates(yomi: string): AccentType[] {
  const n = splitMorae(yomi).length;
  return Array.from({ length: n + 1 }, (_, i) => i);
}

/** 段（ア・イ・ウ・エ・オ）ごとのカナ。伸ばす音を母音へ置き換えるのに使う。 */
const VOWEL_ROWS: readonly (readonly [string, string])[] = [
  ['ア', 'アカサタナハマヤラワガザダバパァャヮヵ'],
  ['イ', 'イキシチニヒミリギジヂビピィヰ'],
  ['ウ', 'ウクスツヌフムユルグズヅブプゥュヴ'],
  ['エ', 'エケセテネヘメレゲゼデベペェヱヶ'],
  ['オ', 'オコソトノホモヨロヲゴゾドボポォョ'],
];

/**
 * エンジンの「かな」の書き方が受け付ける粒へ直す（粒の数は変えない＝下がる場所はずれない）。
 *
 * ⚠️ **伸ばす音「ー」は受け付けられない**（2026-10-19 実測＝`コーポレーション`・`ディズニー` は 400）＝
 * 直前の粒の母音へ置き換える（エンジン自身も登録後は `ショウジ` を `ショオジ` と読む＝同じ音）。
 * 「ン」「ッ」のあとはそのまま（母音が無い）。小さい「ヵ」「ヶ」も受け付けないので「カ」「ケ」へ。
 */
function kanaMorae(morae: readonly string[]): string[] {
  const vowelOf = (mora: string | undefined): string | undefined => {
    const last = mora?.[mora.length - 1];
    return last == null ? undefined : VOWEL_ROWS.find(([, row]) => row.includes(last))?.[0];
  };
  const out: string[] = [];
  for (const m of morae) {
    if (m === 'ー') out.push(vowelOf(out[out.length - 1]) ?? m);
    else out.push(m.replace('ヵ', 'カ').replace('ヶ', 'ケ'));
  }
  return out;
}

/** 聞き比べで言葉のうしろに付ける助詞（「下がらない」と「最後で下がる」は、言葉だけだと同じ音になる）。 */
const PREVIEW_PARTICLE = 'ガ';

/**
 * 聞き比べの音を作る読み（エンジンの「かな」の書き方＝下がる所のうしろに `'`）。
 *
 * ⚠️ **登録した後と同じ音になる形で作る**（ADR-0037 追補 2026-10-19・実測で一致を確認）。前の版は
 * 読みで作った音の「下がる場所」の数だけを差し替えていたが、エンジンは**音の高さを作り直さない**ので、
 * **どの候補を押しても同じ音**だった。さらに読みが2つのかたまりに分かれると（`ホシノ｜ハラ`）先頭だけが
 * 対象になっていた。かなの書き方なら1つのかたまりで、指定した所で下がる。
 * ⚠️ **うしろに「ガ」を付ける**＝「下がらない（0）」と「最後で下がる」は言葉だけだと同じ音で、
 * 助詞が続くと違う（`ホシノハラガ'`／`ホシノハラ'ガ`＝登録後の文と同じ）。
 */
export function accentPreviewKana(yomi: string, accentType: AccentType): string {
  const morae = [...kanaMorae(splitMorae(yomi)), PREVIEW_PARTICLE];
  const n = morae.length - 1; // 言葉の粒の数（助詞を除く）
  const at = accentType <= 0 || accentType > n ? morae.length : accentType; // 0＝助詞まで下がらない
  return `${morae.slice(0, at).join('')}'${morae.slice(at).join('')}`;
}

/** 読みに「下がる場所」の印を入れた見せ方（`ウ↓ツノミヤ`）。0＝印なし（下がらない）。 */
export function accentMark(yomi: string, accentType: AccentType): string {
  const morae = splitMorae(yomi);
  if (accentType <= 0 || accentType > morae.length) return yomi;
  return `${morae.slice(0, accentType).join('')}↓${morae.slice(accentType).join('')}`;
}

/** 読みに対する既定の下がる場所（決定6＝先頭で下がる形）。 */
export function defaultAccentType(yomi: string): AccentType {
  return splitMorae(yomi).length > 0 ? 1 : 0;
}

/** 読みとして受け付ける形か（カタカナ・伸ばす音だけ）。VOICEVOX が受け取れる形にそろえる。 */
export function isValidYomi(yomi: string): boolean {
  return yomi.length > 0 && /^[ァ-ヶー]+$/.test(yomi);
}
