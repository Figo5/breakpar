import { describe, it, expect } from "vitest";
import { normalizeXHandle, xHandleLabel, xHandleUrl } from "@/lib/xHandle";

describe("normalizeXHandle", () => {
  it("accepts a bare handle", () => {
    expect(normalizeXHandle("steelo555")).toBe("steelo555");
  });
  it("strips a leading @ and whitespace", () => {
    expect(normalizeXHandle("  @steelo555 ")).toBe("steelo555");
  });
  it("rejects full URLs (handle-only storage)", () => {
    expect(normalizeXHandle("https://x.com/steelo555")).toBeNull();
    expect(normalizeXHandle("x.com/steelo555")).toBeNull();
  });
  it("rejects invalid characters and over-length handles", () => {
    expect(normalizeXHandle("bad handle")).toBeNull();
    expect(normalizeXHandle("nope!")).toBeNull();
    expect(normalizeXHandle("a".repeat(16))).toBeNull();
  });
  it("returns null for empty/missing input (handle-less users)", () => {
    expect(normalizeXHandle(null)).toBeNull();
    expect(normalizeXHandle(undefined)).toBeNull();
    expect(normalizeXHandle("")).toBeNull();
  });
});

describe("rendering", () => {
  it("labels as x.com/handle, never a raw URL", () => {
    expect(xHandleLabel("steelo555")).toBe("x.com/steelo555");
  });
  it("builds the link href from the validated handle", () => {
    expect(xHandleUrl("steelo555")).toBe("https://x.com/steelo555");
  });
});
