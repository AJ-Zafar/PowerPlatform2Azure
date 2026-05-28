import path from "node:path";

import { describe, expect, it } from "vitest";

import { discoverSolutionFiles } from "./solution-discovery";

const solutionFixturePath = (fixtureName: string): string =>
  path.resolve(process.cwd(), "packages/fixtures/samples/solutions", fixtureName);

describe("discoverSolutionFiles", () => {
  it("scans files deterministically and classifies known solution files", async () => {
    const fixturePath = solutionFixturePath("minimal-valid");
    const firstRun = await discoverSolutionFiles(fixturePath);
    const secondRun = await discoverSolutionFiles(fixturePath);

    expect(firstRun.data.files.map((file) => file.path)).toEqual([
      "customizations.xml",
      "solution.xml"
    ]);
    expect(firstRun.data.files).toEqual(secondRun.data.files);
    expect(firstRun.warnings).toEqual([]);
  });

  it("detects unknown files and infrastructure-oriented classifications", async () => {
    const fixturePath = solutionFixturePath("unknown-file-layout");
    const result = await discoverSolutionFiles(fixturePath);
    const classifications = new Set(
      result.data.files.map((file) => file.classification)
    );

    expect(classifications.has("solution-manifest")).toBe(true);
    expect(classifications.has("workflows-folder")).toBe(true);
    expect(classifications.has("canvas-app")).toBe(true);
    expect(classifications.has("web-resource")).toBe(true);
    expect(classifications.has("plugin-metadata")).toBe(true);
    expect(classifications.has("security-role")).toBe(true);
    expect(classifications.has("unknown")).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(
      result.unsupported.some(
        (feature) => feature.featureType === "solution.unknown-file-layout"
      )
    ).toBe(true);
  });

  it("classifies canvas source shapes with detailed canvas categories", async () => {
    const fixturePath = solutionFixturePath("canvas-heavy");
    const result = await discoverSolutionFiles(fixturePath);
    const classifications = new Set(result.data.files.map((file) => file.classification));

    expect(classifications.has("canvas-app")).toBe(true);
    expect(classifications.has("canvas-screen")).toBe(true);
    expect(classifications.has("canvas-component")).toBe(true);
    expect(classifications.has("canvas-control")).toBe(true);
    expect(classifications.has("canvas-formula")).toBe(true);
    expect(classifications.has("canvas-resource")).toBe(true);
    expect(classifications.has("canvas-unknown")).toBe(true);
  });
});
