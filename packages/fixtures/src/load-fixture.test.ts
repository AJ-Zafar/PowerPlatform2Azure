import { describe, expect, it } from "vitest";

import { loadFixtureText } from "./load-fixture";

describe("loadFixtureText", () => {
  it("loads fixture files with normalized relative path handling", async () => {
    const content = await loadFixtureText(
      "simple-solution/../simple-solution/manifest.json"
    );

    expect(content).toContain("\"name\": \"Sample Solution\"");
    expect(content).toContain("\"version\": \"1.0.0.0\"");
  });
});
