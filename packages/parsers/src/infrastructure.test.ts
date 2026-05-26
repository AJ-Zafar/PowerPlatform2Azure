import path from "node:path";

import { describe, expect, it } from "vitest";

import { parseSolutionInfrastructure } from "./infrastructure";
import { discoverSolutionFiles } from "./solution-discovery";

const solutionFixturePath = (fixtureName: string): string =>
  path.resolve(process.cwd(), "packages/fixtures/samples/solutions", fixtureName);

describe("parseSolutionInfrastructure", () => {
  it("parses environment variables, connection references, and security roles", async () => {
    const fixturePath = solutionFixturePath("infra-heavy");
    const discovery = await discoverSolutionFiles(fixturePath);
    const result = await parseSolutionInfrastructure(fixturePath, discovery.data);

    expect(result.data.environmentVariables).toHaveLength(2);
    expect(result.data.connectionReferences).toHaveLength(2);
    expect(result.data.security.roles).toHaveLength(2);
    expect(result.warnings).toEqual([]);
  });
});
