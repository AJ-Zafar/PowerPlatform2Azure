import path from "node:path";

import { describe, expect, it } from "vitest";

import { discoverSolutionFiles } from "./solution-discovery";
import { parseSolutionManifest } from "./manifest";

const solutionFixturePath = (fixtureName: string): string =>
  path.resolve(process.cwd(), "packages/fixtures/samples/solutions", fixtureName);

describe("parseSolutionManifest", () => {
  it("parses manifest metadata from solution.xml", async () => {
    const fixturePath = solutionFixturePath("minimal-valid");
    const discovery = await discoverSolutionFiles(fixturePath);
    const result = await parseSolutionManifest(fixturePath, discovery.data);

    expect(result.data.uniqueName).toBe("contoso_core");
    expect(result.data.version).toBe("1.2.3.4");
    expect(result.data.publisher.uniqueName).toBe("contoso");
    expect(result.data.managed).toBe(false);
  });

  it("handles malformed XML with explicit warnings", async () => {
    const fixturePath = solutionFixturePath("malformed-manifest");
    const discovery = await discoverSolutionFiles(fixturePath);
    const result = await parseSolutionManifest(fixturePath, discovery.data);

    expect(result.data.uniqueName).toBe("malformed-manifest");
    expect(result.warnings.some((warning) => warning.code === "SOLUTION_MANIFEST_INVALID_XML")).toBe(
      true
    );
    expect(result.confidence).toBeLessThan(0.2);
  });
});
