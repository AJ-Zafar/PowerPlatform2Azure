import { describe, expect, it } from "vitest";

import { sortByStableKey, stableStringify } from "./deterministic";

describe("sortByStableKey", () => {
  it("returns deterministic ordering for equivalent keys", () => {
    const items = [
      { id: "2", group: "b" },
      { id: "1", group: "a" },
      { id: "3", group: "b" }
    ];

    expect(sortByStableKey(items, (item) => item.group)).toEqual([
      { id: "1", group: "a" },
      { id: "2", group: "b" },
      { id: "3", group: "b" }
    ]);
  });
});

describe("stableStringify", () => {
  it("serializes nested objects with sorted keys", () => {
    const payload = {
      z: 1,
      a: {
        y: 2,
        x: 3
      }
    };

    expect(stableStringify(payload)).toBe("{\"a\":{\"x\":3,\"y\":2},\"z\":1}");
  });
});
