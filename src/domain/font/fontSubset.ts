// 使う字の形だけを残した字体を作る（ADR-0062）。書き出しで SVG に埋め込むため。
//
// ⚠️ **字体の表はそのまま残し、使わない字の形（glyf）だけを空にする**＝字の番号を付け直さないので、
//   詰め（GPOS）・合字や置き換え（GSUB）・字幅（hmtx）・行の高さが**元の字体と同じ**＝仕上がり確認と同じ並びになる。
//   字体を組み直す切り出し（番号を付け直す）は、表と番号が合わなくなり、詰めや合字が落ちる・壊れる。
// ⚠️ **残す字の形**＝使う字（cmap）＋合字・置き換えで出てくる字（GSUB を横書きの既定の機能に絞って閉じるまで辿る）
//   ＋組み合わせ字の部品（glyf の composite）＋ 0 番（.notdef）。
// ⚠️ **glyf を持たない字体（CFF の OTF）は扱わない**＝null を返す（呼ぶ側が丸ごと埋め込む）。

/** 横書きで、ブラウザが既定で効かせる置き換えの機能（GSUB）。ここに無い機能（縦書きなど）の字の形は残さない。 */
export const DEFAULT_GSUB_FEATURES: readonly string[] = ['ccmp', 'locl', 'liga', 'clig', 'calt', 'rlig', 'rclt', 'rvrn'];

interface TableRec {
  tag: string;
  offset: number;
  length: number;
}

/** 字体の表の一覧（タグ→位置）。字体として読めなければ null。 */
export function readTables(b: Uint8Array): Map<string, TableRec> | null {
  if (b.length < 12) return null;
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const n = v.getUint16(4);
  if (12 + n * 16 > b.length) return null;
  const out = new Map<string, TableRec>();
  for (let i = 0; i < n; i++) {
    const o = 12 + i * 16;
    const tag = String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
    const offset = v.getUint32(o + 8);
    const length = v.getUint32(o + 12);
    if (offset + length > b.length) return null;
    out.set(tag, { tag, offset, length });
  }
  return out;
}

/** 文字（コードポイント）→ 字の番号。cmap の (3,10) 形式12 → (3,1)/(0,*) 形式4 の順に引く。無ければ 0。 */
export function cmapLookup(b: Uint8Array, tables: Map<string, TableRec>): (cp: number) => number {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const cmap = tables.get('cmap');
  if (!cmap) return () => 0;
  const c = cmap.offset;
  const n = v.getUint16(c + 2);
  let fmt12 = -1;
  let fmt4 = -1;
  for (let i = 0; i < n; i++) {
    const pid = v.getUint16(c + 4 + i * 8);
    const eid = v.getUint16(c + 6 + i * 8);
    const sub = c + v.getUint32(c + 8 + i * 8);
    const fmt = v.getUint16(sub);
    if (fmt === 12 && (pid === 0 || (pid === 3 && eid === 10)) && fmt12 < 0) fmt12 = sub;
    if (fmt === 4 && (pid === 0 || (pid === 3 && eid === 1)) && fmt4 < 0) fmt4 = sub;
  }
  return (cp: number): number => {
    if (fmt12 >= 0) {
      const groups = v.getUint32(fmt12 + 12);
      let lo = 0;
      let hi = groups - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const g = fmt12 + 16 + mid * 12;
        const start = v.getUint32(g);
        const end = v.getUint32(g + 4);
        if (cp < start) hi = mid - 1;
        else if (cp > end) lo = mid + 1;
        else return v.getUint32(g + 8) + (cp - start);
      }
      return 0;
    }
    if (fmt4 >= 0 && cp <= 0xffff) {
      const segX2 = v.getUint16(fmt4 + 6);
      const ends = fmt4 + 14;
      const starts = ends + segX2 + 2;
      const deltas = starts + segX2;
      const ranges = deltas + segX2;
      for (let s = 0; s < segX2 / 2; s++) {
        const end = v.getUint16(ends + s * 2);
        if (cp > end) continue;
        const start = v.getUint16(starts + s * 2);
        if (cp < start) return 0;
        const delta = v.getInt16(deltas + s * 2);
        const ro = v.getUint16(ranges + s * 2);
        if (ro === 0) return (cp + delta) & 0xffff;
        const g = v.getUint16(ranges + s * 2 + ro + (cp - start) * 2);
        return g === 0 ? 0 : (g + delta) & 0xffff;
      }
    }
    return 0;
  };
}

/** 被覆表（Coverage）→ [字の番号, 並びの番号] の列。 */
function coverage(v: DataView, at: number): [number, number][] {
  const fmt = v.getUint16(at);
  const out: [number, number][] = [];
  if (fmt === 1) {
    const n = v.getUint16(at + 2);
    for (let i = 0; i < n; i++) out.push([v.getUint16(at + 4 + i * 2), i]);
  } else if (fmt === 2) {
    const n = v.getUint16(at + 2);
    for (let i = 0; i < n; i++) {
      const r = at + 4 + i * 6;
      const start = v.getUint16(r);
      const end = v.getUint16(r + 2);
      const idx = v.getUint16(r + 4);
      for (let g = start; g <= end; g++) out.push([g, idx + (g - start)]);
    }
  }
  return out;
}

/** GSUB で、既定の機能から使われうる置き換え（と、その中から呼ばれる置き換え）を辿り、出てくる字を足す。 */
function gsubClosure(v: DataView, gsub: TableRec, keep: Set<number>, features: readonly string[]): void {
  const base = gsub.offset;
  const featureList = base + v.getUint16(base + 6);
  const lookupList = base + v.getUint16(base + 8);
  const lookupCount = v.getUint16(lookupList);
  const queue: number[] = [];
  const featureCount = v.getUint16(featureList);
  for (let i = 0; i < featureCount; i++) {
    const r = featureList + 2 + i * 6;
    const tag = String.fromCharCode(v.getUint8(r), v.getUint8(r + 1), v.getUint8(r + 2), v.getUint8(r + 3));
    if (!features.includes(tag)) continue;
    const f = featureList + v.getUint16(r + 4);
    const n = v.getUint16(f + 2);
    for (let k = 0; k < n; k++) queue.push(v.getUint16(f + 4 + k * 2));
  }
  // 使う置き換え（と、文脈つきの置き換えから呼ばれるもの）を集める。
  type Sub = { type: number; at: number };
  const subs: Sub[] = [];
  const seen = new Set<number>();
  while (queue.length > 0) {
    const li = queue.pop()!;
    if (seen.has(li) || li >= lookupCount) continue;
    seen.add(li);
    const lk = lookupList + v.getUint16(lookupList + 2 + li * 2);
    const lookupType = v.getUint16(lk);
    const n = v.getUint16(lk + 4);
    for (let s = 0; s < n; s++) {
      let at = lk + v.getUint16(lk + 6 + s * 2);
      let type = lookupType;
      if (lookupType === 7) {
        // 拡張（中身の型と、32ビットの位置）＝副表ごとに開く
        type = v.getUint16(at + 2);
        at = at + v.getUint32(at + 4);
      }
      if (type === 5 || type === 6) {
        for (const li2 of contextLookups(v, at, type)) queue.push(li2);
      } else {
        subs.push({ type, at });
      }
    }
  }
  // 閉じるまで回す（置き換えた字がさらに置き換わることがある）。
  for (let changed = true; changed; ) {
    changed = false;
    const add = (g: number): void => {
      if (!keep.has(g)) {
        keep.add(g);
        changed = true;
      }
    };
    for (const { type, at } of subs) {
      const fmt = v.getUint16(at);
      if (type === 8) {
        const cov = coverage(v, at + v.getUint16(at + 2));
        const back = v.getUint16(at + 4);
        const ahead = v.getUint16(at + 6 + back * 2);
        const subsAt = at + 8 + (back + ahead) * 2;
        for (const [g, i] of cov) if (keep.has(g)) add(v.getUint16(subsAt + 2 + i * 2));
        continue;
      }
      const cov = coverage(v, at + v.getUint16(at + 2));
      if (type === 1) {
        for (const [g, i] of cov) {
          if (!keep.has(g)) continue;
          add(fmt === 1 ? (g + v.getInt16(at + 4)) & 0xffff : v.getUint16(at + 6 + i * 2));
        }
      } else if (type === 2 || type === 3) {
        for (const [g, i] of cov) {
          if (!keep.has(g)) continue;
          const seq = at + v.getUint16(at + 6 + i * 2);
          const m = v.getUint16(seq);
          for (let k = 0; k < m; k++) add(v.getUint16(seq + 2 + k * 2));
        }
      } else if (type === 4) {
        for (const [g, i] of cov) {
          if (!keep.has(g)) continue;
          const set = at + v.getUint16(at + 6 + i * 2);
          const m = v.getUint16(set);
          for (let k = 0; k < m; k++) {
            const lig = set + v.getUint16(set + 2 + k * 2);
            const comps = v.getUint16(lig + 2);
            let all = true;
            for (let c = 1; c < comps; c++) if (!keep.has(v.getUint16(lig + 4 + (c - 1) * 2))) all = false;
            if (all) add(v.getUint16(lig));
          }
        }
      }
    }
  }
}

/** 文脈つきの置き換え（型5・6）が呼ぶ置き換えの番号。 */
function contextLookups(v: DataView, at: number, type: number): number[] {
  const out: number[] = [];
  const fmt = v.getUint16(at);
  const records = (r: number, count: number): void => {
    for (let k = 0; k < count; k++) out.push(v.getUint16(r + k * 4 + 2));
  };
  if (type === 5) {
    if (fmt === 1 || fmt === 2) {
      const nSets = v.getUint16(at + (fmt === 1 ? 4 : 6));
      for (let s = 0; s < nSets; s++) {
        const off = v.getUint16(at + (fmt === 1 ? 6 : 8) + s * 2);
        if (off === 0) continue;
        const set = at + off;
        const nRules = v.getUint16(set);
        for (let r = 0; r < nRules; r++) {
          const rule = set + v.getUint16(set + 2 + r * 2);
          const glyphs = v.getUint16(rule);
          const subst = v.getUint16(rule + 2);
          records(rule + 4 + (glyphs - 1) * 2, subst);
        }
      }
    } else if (fmt === 3) {
      const glyphs = v.getUint16(at + 2);
      const subst = v.getUint16(at + 4);
      records(at + 6 + glyphs * 2, subst);
    }
  } else if (type === 6) {
    if (fmt === 1 || fmt === 2) {
      const nSets = v.getUint16(at + (fmt === 1 ? 4 : 10));
      for (let s = 0; s < nSets; s++) {
        const off = v.getUint16(at + (fmt === 1 ? 6 : 12) + s * 2);
        if (off === 0) continue;
        const set = at + off;
        const nRules = v.getUint16(set);
        for (let r = 0; r < nRules; r++) {
          let p = set + v.getUint16(set + 2 + r * 2);
          p += 2 + v.getUint16(p) * 2; // 前
          p += v.getUint16(p) * 2; // 入力（数の2バイト＋先頭を除く inputGlyphCount-1 個＝ count*2）
          p += 2 + v.getUint16(p) * 2; // 後
          records(p + 2, v.getUint16(p));
        }
      }
    } else if (fmt === 3) {
      let p = at + 2;
      p += 2 + v.getUint16(p) * 2;
      p += 2 + v.getUint16(p) * 2;
      p += 2 + v.getUint16(p) * 2;
      records(p + 2, v.getUint16(p));
    }
  }
  return out;
}

/** 組み合わせ字（composite）の部品の番号。 */
function compositeParts(v: DataView, glyph: number, length: number): number[] {
  if (length < 10 || v.getInt16(glyph) >= 0) return [];
  const out: number[] = [];
  let p = glyph + 10;
  for (;;) {
    const flags = v.getUint16(p);
    out.push(v.getUint16(p + 2));
    p += 4 + (flags & 0x1 ? 4 : 2);
    if (flags & 0x8) p += 2;
    else if (flags & 0x40) p += 4;
    else if (flags & 0x80) p += 8;
    if (!(flags & 0x20)) break;
  }
  return out;
}

function checksum(b: Uint8Array, off: number, len: number): number {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let sum = 0;
  const end = off + ((len + 3) & ~3);
  for (let i = off; i < end; i += 4) sum = (sum + v.getUint32(i)) >>> 0;
  return sum;
}

/**
 * 使う字（コードポイント）の形だけを残した字体を作る。glyf を持たない字体・読めない字体は null（丸ごと使う）。
 * ⚠️ 字の番号・ほかの表は変えない（上の ⚠️）。
 */
export function subsetFontKeepingTables(
  src: Uint8Array,
  codepoints: Iterable<number>,
  features: readonly string[] = DEFAULT_GSUB_FEATURES,
): Uint8Array | null {
  const tables = readTables(src);
  if (!tables) return null;
  const glyf = tables.get('glyf');
  const loca = tables.get('loca');
  const head = tables.get('head');
  const maxp = tables.get('maxp');
  if (!glyf || !loca || !head || !maxp) return null;
  const v = new DataView(src.buffer, src.byteOffset, src.byteLength);
  const numGlyphs = v.getUint16(maxp.offset + 4);
  const longLoca = v.getInt16(head.offset + 50) === 1;
  const locaAt = (g: number): number =>
    longLoca ? v.getUint32(loca.offset + g * 4) : v.getUint16(loca.offset + g * 2) * 2;
  if ((longLoca ? 4 : 2) * (numGlyphs + 1) > loca.length) return null;

  const keep = new Set<number>([0]);
  const lookup = cmapLookup(src, tables);
  for (const cp of codepoints) {
    const g = lookup(cp);
    if (g > 0 && g < numGlyphs) keep.add(g);
  }
  const gsub = tables.get('GSUB');
  if (gsub) gsubClosure(v, gsub, keep, features);
  for (const g of [...keep]) if (g >= numGlyphs) keep.delete(g);
  // 組み合わせ字の部品（部品がさらに組み合わせのこともある）
  const stack = [...keep];
  while (stack.length > 0) {
    const g = stack.pop()!;
    const start = locaAt(g);
    const len = locaAt(g + 1) - start;
    for (const part of compositeParts(v, glyf.offset + start, len)) {
      if (part < numGlyphs && !keep.has(part)) {
        keep.add(part);
        stack.push(part);
      }
    }
  }

  // 新しい glyf と loca（長い形・4 バイトにそろえる）
  let glyfLen = 0;
  for (const g of keep) glyfLen += (locaAt(g + 1) - locaAt(g) + 3) & ~3;
  const newGlyf = new Uint8Array(glyfLen);
  const newLoca = new Uint8Array((numGlyphs + 1) * 4);
  const lv = new DataView(newLoca.buffer);
  let pos = 0;
  for (let g = 0; g < numGlyphs; g++) {
    lv.setUint32(g * 4, pos);
    if (!keep.has(g)) continue;
    const start = locaAt(g);
    const len = locaAt(g + 1) - start;
    newGlyf.set(src.subarray(glyf.offset + start, glyf.offset + start + len), pos);
    pos += (len + 3) & ~3;
  }
  lv.setUint32(numGlyphs * 4, pos);

  // 字の名前を持たない post（3.0）。先頭の 16 バイト（傾き・下線・等幅）は元のまま。
  const post = tables.get('post');
  let newPost: Uint8Array | null = null;
  if (post && post.length >= 32) {
    newPost = new Uint8Array(32);
    newPost.set(src.subarray(post.offset, post.offset + 16));
    new DataView(newPost.buffer).setUint32(0, 0x00030000);
  }

  // 組み立て
  const parts: { tag: string; data: Uint8Array }[] = [];
  for (const t of tables.values()) {
    if (t.tag === 'DSIG') continue; // 中身を変えたので署名は合わない
    let data = src.subarray(t.offset, t.offset + t.length);
    if (t.tag === 'glyf') data = newGlyf;
    else if (t.tag === 'loca') data = newLoca;
    else if (t.tag === 'post' && newPost) data = newPost;
    else if (t.tag === 'head') {
      data = data.slice();
      const hv = new DataView(data.buffer, data.byteOffset, data.byteLength);
      hv.setUint32(8, 0); // checkSumAdjustment は最後に入れ直す
      hv.setInt16(50, 1); // loca は長い形
    }
    parts.push({ tag: t.tag, data });
  }
  parts.sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));
  const n = parts.length;
  let size = 12 + n * 16;
  for (const p of parts) size += (p.data.length + 3) & ~3;
  const out = new Uint8Array(size);
  const ov = new DataView(out.buffer);
  ov.setUint32(0, v.getUint32(0));
  ov.setUint16(4, n);
  let es = 0;
  while (1 << (es + 1) <= n) es++;
  ov.setUint16(6, (1 << es) * 16);
  ov.setUint16(8, es);
  ov.setUint16(10, n * 16 - (1 << es) * 16);
  let at = 12 + n * 16;
  let headAt = -1;
  parts.forEach((p, i) => {
    const r = 12 + i * 16;
    for (let k = 0; k < 4; k++) out[r + k] = p.tag.charCodeAt(k);
    out.set(p.data, at);
    ov.setUint32(r + 4, checksum(out, at, p.data.length));
    ov.setUint32(r + 8, at);
    ov.setUint32(r + 12, p.data.length);
    if (p.tag === 'head') headAt = at;
    at += (p.data.length + 3) & ~3;
  });
  if (headAt >= 0) ov.setUint32(headAt + 8, (0xb1b0afba - checksum(out, 0, out.length)) >>> 0);
  return out;
}
