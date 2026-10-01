// @vitest-environment jsdom
// 選択欄（`<select>`）を名前で探し、見えている選択肢の文字で選ぶ式（タイムライン編集の上級の台本で要った）。
// ⚠️ **式を本当に走らせて確かめる**＝文字列の形だけ見ると、選んだつもりで React に届かない形を見逃す。
import { beforeEach, describe, expect, it } from "vitest";
import { CHOOSE_OPTION, FIND_SELECT } from "./cdp.mjs";

// jsdom には配置が無い＝`offsetParent` が常に null なので、見えているものとして扱う。
Object.defineProperty(HTMLElement.prototype, "offsetParent", { configurable: true, get() { return this.hidden ? null : document.body; } });
HTMLElement.prototype.scrollIntoView = () => {};
// eslint-disable-next-line no-eval -- 画面へ送る式そのものを、送る先と同じく評価して確かめる
const run = (expr) => (0, eval)(expr);

beforeEach(() => {
  document.body.innerHTML = `
    <label>重ね方<select id="blend"><option value="normal">ふつう</option><option value="screen">重ねて明るく</option></select></label>
    <label for="ease">ここまでの動き方</label><select id="ease"><option value="linear">一定</option><option value="ease-out">ゆっくり終わる</option><option value="ease-in">ゆっくり始まる</option></select>
    <select aria-label="声"><option value="">動画全体に合わせる</option><option value="8">春日部つむぎ（ノーマル）</option></select>
    <label>隠れた欄<select id="hidden" hidden><option value="a">ふつう</option></select></label>`;
});

describe("選択欄を名前で探す", () => {
  it("包んでいる見出し・for の見出し・aria-label のどれでも見つかる（選択肢の文字は名前に混ぜない）", () => {
    expect(run(FIND_SELECT("重ね方"))?.id).toBe("blend");
    expect(run(FIND_SELECT("ここまでの動き方"))?.id).toBe("ease");
    expect(run(FIND_SELECT("声"))?.getAttribute("aria-label")).toBe("声");
    // 選択肢の文字（「ふつう」）では見つけない＝包む見出しの文字だけで比べている。
    expect(run(FIND_SELECT("重ね方ふつう重ねて明るく"))).toBeNull();
  });

  it("見えていない選択欄は探さない", () => {
    expect(run(FIND_SELECT("隠れた欄"))).toBeNull();
  });

  it("完全一致を先に見る", () => {
    document.body.insertAdjacentHTML("afterbegin", `<label>声の高さ<select id="pitch"><option>ふつう</option></select></label>`);
    expect(run(FIND_SELECT("声"))?.getAttribute("aria-label")).toBe("声");
  });
});

describe("選択肢を見えている文字で選ぶ", () => {
  it("選んだ選択肢の文字を返し、change を送る（React が受け取る道）", () => {
    const el = document.getElementById("ease");
    let changed = null;
    el.addEventListener("change", (e) => { changed = e.target.value; });
    expect(run(CHOOSE_OPTION("ここまでの動き方", "ゆっくり終わる"))).toBe("ゆっくり終わる");
    expect(el.value).toBe("ease-out");
    expect(changed).toBe("ease-out");
  });

  it("選択肢は完全一致だけ（「ゆっくり」で別の選択肢を選ばない）", () => {
    expect(run(CHOOSE_OPTION("ここまでの動き方", "ゆっくり"))).toBeNull();
    expect(document.getElementById("ease").value).toBe("linear");
  });

  it("同じ名前の欄が並ぶときは何番目かで選ぶ（無い番目は null）", () => {
    document.body.insertAdjacentHTML("beforeend", `<label for="ease2">ここまでの動き方</label><select id="ease2"><option value="linear">一定</option><option value="ease-out">ゆっくり終わる</option></select>`);
    expect(run(FIND_SELECT("ここまでの動き方", 2))?.id).toBe("ease2");
    expect(run(CHOOSE_OPTION("ここまでの動き方", "ゆっくり終わる", 2))).toBe("ゆっくり終わる");
    expect(document.getElementById("ease").value).toBe("linear");
    expect(run(FIND_SELECT("ここまでの動き方", 3))).toBeNull();
  });

  it("欄が無ければ null", () => {
    expect(run(CHOOSE_OPTION("無い欄", "一定"))).toBeNull();
  });
});
