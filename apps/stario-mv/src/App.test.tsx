// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { App, APP_TITLE } from "./App";

describe("骨組み", () => {
  it("アプリの名前を見出しに出す", () => {
    render(<App />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(APP_TITLE);
  });
});
