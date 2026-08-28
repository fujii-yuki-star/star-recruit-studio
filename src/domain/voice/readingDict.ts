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
 * 役割は2つだけ：**①同じ語を二重に登録しない**（実測＝同じ言葉の `POST` は重複を作る）
 * **②アプリが入れた語だけを消す**（利用者が VOICEVOX 本体で入れた語に触らない）。
 * 失っても壊れない＝言葉で引き直せるし、消せなくなるだけ（触らない側＝安全な向き）。
 */
export type EngineLinks = Readonly<Record<string, string>>;

/** エンジン側の1語（`GET /user_dict` の値から要るものだけ）。 */
export interface EngineWord {
  uuid: string;
  surface: string;
  yomi: string;
  accentType: AccentType;
}

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

/** エンジンへ映すための計画（`planDictSync` の答え）。 */
export interface DictSyncPlan {
  /** エンジンへ送る操作。空＝そろっている（何も送らない）。 */
  ops: DictOp[];
  /**
   * **送らずに控えだけ取り直す**もの（言葉→uuid）。同じ読みの語が既にエンジンにあるとき
   *（別PCから持ち込んだ辞書・エンジンを入れ直した後など）＝送っても結果が変わらない。
   */
  links: Record<string, string>;
  /**
   * **黙って上書きしなかった**語（決定3b）＝言葉は同じだが読みが違い、**アプリが入れた覚えのない**語。
   * 利用者が VOICEVOX 本体で入れた読みを勝手に書き換えない。呼ぶ側が知らせて選ばせる。
   */
  conflicts: { entry: ReadingEntry; engine: EngineWord }[];
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
  const plan: DictSyncPlan = { ops: [], links: {}, conflicts: [] };
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
      if (!sameReading(byRef, entry)) plan.ops.push({ kind: 'update', uuid: byRef.uuid, entry });
      else plan.links[surface] = byRef.uuid; // そろっている＝控えを保つ
      continue;
    }
    // ② 控えが無い／当たらない（別PC・エンジン入れ直し）＝**言葉で引き直す**。
    const found = bySurface.get(surface);
    if (!found) {
      plan.ops.push({ kind: 'add', entry });
      continue;
    }
    if (sameReading(found, entry)) {
      plan.links[surface] = found.uuid; // 送らない＝控えを取り直すだけ
      continue;
    }
    // ③ 言葉は同じで読みが違う。**アプリが入れた覚えがあるなら**直す（uuid が変わっただけ）。
    if (known != null) {
      plan.ops.push({ kind: 'update', uuid: found.uuid, entry });
      continue;
    }
    // ④ 覚えが無い＝**黙って上書きしない**（決定3b）。
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
