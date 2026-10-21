// @vitest-environment jsdom
// 入っている拡張パックの権利の表記を「このアプリについて」に出す（ADR-0060 決定6）。
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { AboutScreen } from "./AboutScreen";
import { useProjectStore } from "../store/projectStore";

describe("AboutScreen：拡張パックの表記", () => {
  it("入っていなければ出さない", () => {
    useProjectStore.setState({ packs: [] });
    render(<AboutScreen />);
    expect(screen.queryByTestId("about-pack-credits")).toBeNull();
  });

  it("パックごとに作った人・版と、中身ごとの権利と表記を出す", () => {
    useProjectStore.setState({
      packs: [{
        schemaVersion: "1.0", packId: "office", name: "オフィスの見た目", version: "1.2.0", publisher: "総務部", minAppVersion: "0.5.0",
        contents: { templates: [{ file: "t/a.json" }] }, files: [{ path: "t/a.json", sha256: "a".repeat(64) }],
        licenses: [{ target: "templates", license: "社内利用に限る", credit: "© 総務部" }],
      }],
    });
    render(<AboutScreen />);
    const box = screen.getByTestId("about-pack-credits");
    expect(box.textContent).toContain("オフィスの見た目");
    expect(box.textContent).toContain("総務部（1.2.0）");
    expect(box.textContent).toContain("見た目パターン：社内利用に限る（© 総務部）");
  });
});
