// @vitest-environment jsdom
// 動画全体の既定の声（設定）。いま選べない声は「未設定」として読む（ADR-0003 追補・2026-10-16）。
import { beforeEach, describe, expect, it } from "vitest";
import { getVoicevoxSpeaker, setVoicevoxSpeaker } from "./appSettings";
import { isGoneGeneratedVoice } from "../domain/voice/goneVoices";

beforeEach(() => localStorage.clear());

describe("getVoicevoxSpeaker", () => {
  it("一覧にある声は、そのまま読む", () => {
    setVoicevoxSpeaker(14); // 冥鳴ひまり
    expect(getVoicevoxSpeaker()).toBe(14);
  });

  // ⚠️ 会社が携わる利用で事前確認が要る声（青山龍星＝13・もち子さん＝20）は一覧から外した＝
  //   以前に既定の声へ選んでいた人も、外した声で作り続けない（既定のずんだもんへ戻る）。
  it("一覧から外した声（青山龍星・もち子さん）は未設定として読む", () => {
    for (const speaker of [13, 20]) {
      setVoicevoxSpeaker(speaker);
      expect(getVoicevoxSpeaker()).toBeNull();
    }
  });

  it("未設定・数でない値は未設定", () => {
    expect(getVoicevoxSpeaker()).toBeNull();
    localStorage.setItem("app.voicevoxSpeaker", "abc");
    expect(getVoicevoxSpeaker()).toBeNull();
  });
});

describe("一覧から外した声で作り済みの読み上げ", () => {
  // 書き出しの前に止める門（`goneVoices`）にかかる＝鳴る声（青山龍星）と名乗るキャラ（既定）が食い違う動画を出さない。
  it("書き出しを止める側に数える", () => {
    expect(isGoneGeneratedVoice({ speaker: 13, status: "generated", text: "こんにちは" })).toBe(true);
    expect(isGoneGeneratedVoice({ speaker: 20, status: "generated", text: "こんにちは" })).toBe(true);
    expect(isGoneGeneratedVoice({ speaker: 21, status: "generated", text: "こんにちは" })).toBe(false);
  });
});
