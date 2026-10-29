import { describe, expect, it } from "bun:test";
import { canonicalJson, sha256Hex } from "../src/convex/lib/sha256";

describe("sha256", () => {
  it("matches the published vector for 'abc'", () => {
    expect(sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("is deterministic for the empty string", () => {
    expect(sha256Hex("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });
});

describe("canonicalJson", () => {
  it("is stable across key order", () => {
    const a = canonicalJson({ b: 1, a: 2, c: { z: 1, y: [3, 2, 1] } });
    const b = canonicalJson({ c: { y: [3, 2, 1], z: 1 }, a: 2, b: 1 });
    expect(a).toBe(b);
    expect(sha256Hex(a)).toBe(sha256Hex(b));
  });

  it("drops undefined values so an absent field never changes a hash", () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe(canonicalJson({ a: 1 }));
  });
});
