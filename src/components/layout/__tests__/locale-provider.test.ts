import { describe, it, expect, vi } from "vitest";
import { loadLocaleMessages } from "../LocaleProvider";

describe("loadLocaleMessages", () => {
  it("makes no dynamic import for en", async () => {
    const importer = vi.fn();
    const m = await loadLocaleMessages("en", importer);
    expect(importer).not.toHaveBeenCalled();
    expect(Object.keys(m).length).toBeGreaterThan(0);
  });

  it("imports and merges a non-en locale over en", async () => {
    const importer = vi.fn(async () => ({ default: { __probe: { a: "x" } } }));
    const m = await loadLocaleMessages("de", importer);
    expect(importer).toHaveBeenCalledWith("de");
    expect(m.__probe).toEqual({ a: "x" });
  });

  it("falls back to en when the bundle fails", async () => {
    const en = await loadLocaleMessages("en");
    const m = await loadLocaleMessages("xx", vi.fn(async () => { throw new Error("missing"); }));
    expect(m).toBe(en);
  });
});
