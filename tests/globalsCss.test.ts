import { readFileSync } from "node:fs";
import postcss from "postcss";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const requiredSharedTokens = [
  "--pm-paper",
  "--pm-paper-2",
  "--pm-ink",
  "--pm-ink-soft",
  "--pm-flag",
  "--pm-flag-soft",
  "--pm-amber",
  "--pm-safe",
  "--pm-normal",
  "--pm-line",
  "--pm-line-strong",
];

describe("global CSS integrity", () => {
  it("parses and keeps one top-level token source", () => {
    const stylesheet = postcss.parse(css);
    const roots = stylesheet.nodes.filter(
      (node) => node.type === "rule" && node.selector === ":root",
    );

    expect(roots).toHaveLength(1);
  });

  it("keeps every shared Phase 3 token globally defined", () => {
    const stylesheet = postcss.parse(css);
    const root = stylesheet.nodes.find(
      (node) => node.type === "rule" && node.selector === ":root",
    );
    const declarations = new Set<string>();

    if (root?.type === "rule") {
      root.walkDecls((declaration) => {
        declarations.add(declaration.prop);
      });
    }

    expect(requiredSharedTokens.filter((token) => !declarations.has(token))).toEqual([]);
  });
});
