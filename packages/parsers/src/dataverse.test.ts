import path from "node:path";

import { describe, expect, it } from "vitest";

import { parseDataverseMetadata } from "./dataverse";
import { discoverSolutionFiles } from "./solution-discovery";

const solutionFixturePath = (fixtureName: string): string =>
  path.resolve(process.cwd(), "packages/fixtures/samples/solutions", fixtureName);

describe("parseDataverseMetadata", () => {
  it("parses entities, attributes, relationships, and choices", async () => {
    const fixturePath = solutionFixturePath("dataverse-heavy");
    const discovery = await discoverSolutionFiles(fixturePath);
    const result = await parseDataverseMetadata(fixturePath, discovery.data);

    expect(result.data.entities).toHaveLength(2);
    expect(result.data.entities[0]?.attributes.length).toBeGreaterThan(0);
    expect(result.data.relationships).toHaveLength(2);
    expect(result.data.optionSets).toHaveLength(1);
    expect(result.warnings).toEqual([]);
  });

  it("generates warnings for malformed metadata without silently failing", async () => {
    const fixturePath = solutionFixturePath("malformed-metadata");
    const discovery = await discoverSolutionFiles(fixturePath);
    const result = await parseDataverseMetadata(fixturePath, discovery.data);

    expect(result.warnings.some((warning) => warning.code === "DATAVERSE_ENTITY_INVALID_XML")).toBe(
      true
    );
  });

  it("reports unsupported attribute metadata as structured warnings/features", async () => {
    const fixturePath = solutionFixturePath("unsupported-metadata");
    const discovery = await discoverSolutionFiles(fixturePath);
    const result = await parseDataverseMetadata(fixturePath, discovery.data);

    expect(
      result.warnings.some(
        (warning) => warning.code === "DATAVERSE_ATTRIBUTE_UNSUPPORTED_TYPE"
      )
    ).toBe(true);
    expect(
      result.unsupported.some((feature) =>
        feature.featureType.startsWith("dataverse.attribute-type.")
      )
    ).toBe(true);
  });
});
