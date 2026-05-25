import { describe, expect, it } from "vitest";

import { createBootstrapMetadata } from "./index";

describe("createBootstrapMetadata", () => {
  it("returns deterministic package bootstrap metadata", () => {
    expect(createBootstrapMetadata()).toEqual({
      packageName: "@power-exit/ir",
      packageVersion: "0.1.0"
    });
  });
});
