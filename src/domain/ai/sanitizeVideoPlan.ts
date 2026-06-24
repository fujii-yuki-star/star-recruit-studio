// AI応答（ai-video-plan）の「受信前正規化」。正典スキーマに照らし、内部へ渡す前に LLM 由来の崩れ2種を無害化する純粋関数。
//  (1) スキーマに無いキー（説明・メモ・id 等の余計キー）を各階層で除去する（additionalProperties:false 不適合の回避）。
//  (2) 任意項目に来た「型違いの値」を除去＝未指定扱いにする。多くは空を表す null や [] で、例：
//      texts.main:null / assetRefs:null|[] は schema 上 string/object 必須で不適合になるが、これらは任意項目なので
//      「無い」とみなして落とせば適合する。必須項目（narrationText 等）の型違いは残し、検証で捕捉してリトライさせる
//      （＝品質を落とさず、本当に無い場合は再生成で拾う）。null 可の項目（yukoPoseTag）は保持する。
//
// §2-2（検証してから内部データへ）は後段の厳格 validate を残すので不変＝正規化は防御の一段。型・必須・enum・範囲の
// 最終判定は ajv が行う。許可キー/型はハードコードせず正典 ai-video-plan.schema.json を単一参照元にする（§2-7）。
import aiVideoPlanSchema from '../../../docs/yuko_recruit_docs/schemas/ai-video-plan.schema.json';

type JsonSchema = Record<string, unknown>;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** 値の JSON 種別（schema の type と突き合わせる用）。 */
function jsonTypeOf(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

/** value が schema.type に適合するか。type 未指定（enum のみ等）は判定対象外＝true（enum 違反は検証側が捕捉）。 */
function typeAllowed(value: unknown, schema: JsonSchema): boolean {
  const t = schema.type;
  if (t === undefined) return true;
  const types = Array.isArray(t) ? (t as string[]) : [t as string];
  const actual = jsonTypeOf(value);
  return types.some((tt) => tt === actual || (tt === 'integer' && actual === 'number'));
}

/** "#/$defs/Name" 形式の内部参照を root から解決する（本スキーマはこの形だけ使う）。解決できなければ元を返す。 */
function resolveRef(schema: JsonSchema, root: JsonSchema): JsonSchema {
  const ref = schema.$ref;
  if (typeof ref !== 'string') return schema;
  const m = /^#\/\$defs\/(.+)$/.exec(ref);
  const defs = root.$defs;
  if (m && isPlainObject(defs) && isPlainObject(defs[m[1]])) return defs[m[1]] as JsonSchema;
  return schema;
}

/** data を schema に従って正規化した新しい値を返す（元データは破壊しない）。未知キー除去＋任意項目の型違い除去。 */
function sanitizeNode(data: unknown, schema: JsonSchema, root: JsonSchema): unknown {
  const s = resolveRef(schema, root);

  // オブジェクト × properties 定義あり：宣言キーのみ残し（strict 時）、任意項目の型違いは除去、各値を再帰正規化。
  if (isPlainObject(data) && isPlainObject(s.properties)) {
    const props = s.properties as Record<string, JsonSchema>;
    const strict = s.additionalProperties === false;
    const required = Array.isArray(s.required) ? (s.required as string[]) : [];
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      const propSchema = props[key];
      if (!propSchema) {
        if (!strict) out[key] = value; // 自由キー許容＝そのまま。strict は未知キー除去。
        continue;
      }
      if (!typeAllowed(value, resolveRef(propSchema, root))) {
        // 型違い（多くは空を表す null/[]）。任意項目は「未指定」とみなして除去、必須項目は残して検証へ（→リトライ）。
        if (required.includes(key)) out[key] = value;
        continue;
      }
      out[key] = sanitizeNode(value, propSchema, root);
    }
    return out;
  }

  // 動的キーマップ（assetRefs 等の patternProperties）：キーは列挙されないため保持（値は単純型なので再帰不要）。
  if (isPlainObject(data) && isPlainObject(s.patternProperties)) return data;

  // 配列：items スキーマ（$ref 可）で各要素を正規化。
  if (Array.isArray(data) && isPlainObject(s.items)) {
    const itemSchema = s.items as JsonSchema;
    return data.map((item) => sanitizeNode(item, itemSchema, root));
  }

  return data; // プリミティブ／properties・items を持たないスキーマ＝そのまま。
}

/**
 * パース済み AI 応答を ai-video-plan スキーマで正規化して返す（純粋）。検証の前段に置く。
 * 余計キーと、任意項目に来た型違いの空値（null/[] 等）を除去して、LLM 由来の間欠的な不適合を無害化する。
 * 値の中身は変えないので、必須欠落・必須項目の型違い・enum 外・範囲外は後段の検証で捕捉される（→ 再生成）。
 */
export function sanitizeAiVideoPlan(data: unknown): unknown {
  const root = aiVideoPlanSchema as JsonSchema;
  return sanitizeNode(data, root, root);
}
