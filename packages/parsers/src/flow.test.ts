import path from "node:path";

import { describe, expect, it } from "vitest";

import { parseCloudFlows } from "./flow";
import { discoverSolutionFiles } from "./solution-discovery";

const solutionFixturePath = (fixtureName: string): string =>
  path.resolve(process.cwd(), "packages/fixtures/samples/solutions", fixtureName);

describe("parseCloudFlows", () => {
  it("extracts triggers, actions, runAfter dependencies, and references", async () => {
    const fixturePath = solutionFixturePath("flow-heavy");
    const discovery = await discoverSolutionFiles(fixturePath);
    const result = await parseCloudFlows(fixturePath, discovery.data);

    expect(result.data.length).toBeGreaterThanOrEqual(12);
    expect(
      result.data.some(
        (flow) =>
          flow.trigger.triggerClassification === "manual" &&
          flow.actions.some((action) => action.actionType === "ApiConnection")
      )
    ).toBe(true);
    expect(
      result.data.some((flow) =>
        flow.actions.some((action) =>
          action.runAfter.some((dependency) => dependency.actionName === "action_a")
        )
      )
    ).toBe(true);
    expect(
      result.data.some((flow) =>
        flow.actions.some((action) =>
          action.referencedConnectionReferences.includes("contoso_dataverse")
        )
      )
    ).toBe(true);
    expect(
      result.data.some((flow) =>
        flow.actions.some((action) => action.referencedEntities.includes("accounts"))
      )
    ).toBe(true);
    expect(
      result.data.some((flow) =>
        flow.expressions.some((expression) =>
          expression.references.some((reference) => reference.referenceType === "variable")
        )
      )
    ).toBe(true);
  });

  it("reports malformed files and unsupported action types without aborting", async () => {
    const fixturePath = solutionFixturePath("flow-heavy");
    const discovery = await discoverSolutionFiles(fixturePath);
    const result = await parseCloudFlows(fixturePath, discovery.data);

    expect(result.warnings.some((warning) => warning.code === "FLOW_JSON_INVALID")).toBe(true);
    expect(
      result.warnings.some((warning) => warning.code === "FLOW_ACTION_UNSUPPORTED_TYPE")
    ).toBe(true);
    expect(
      result.unsupported.some((feature) =>
        feature.featureType.startsWith("flow.action.unsupported-type.")
      )
    ).toBe(true);
  });

  it("assigns readiness metadata and emits risk warnings", async () => {
    const fixturePath = solutionFixturePath("flow-heavy");
    const discovery = await discoverSolutionFiles(fixturePath);
    const result = await parseCloudFlows(fixturePath, discovery.data);

    expect(result.data.some((flow) => flow.migrationReadiness === "blocked")).toBe(true);
    expect(result.data.some((flow) => flow.migrationReadiness === "high")).toBe(true);
    expect(
      result.warnings.some((warning) => warning.code === "FLOW_PREMIUM_OR_CUSTOM_CONNECTOR")
    ).toBe(true);
    expect(
      result.warnings.some((warning) => warning.code === "FLOW_HUMAN_IN_THE_LOOP_ACTION")
    ).toBe(true);
  });

  it("produces deterministic parse output", async () => {
    const fixturePath = solutionFixturePath("flow-heavy");
    const discovery = await discoverSolutionFiles(fixturePath);
    const resultA = await parseCloudFlows(fixturePath, discovery.data);
    const resultB = await parseCloudFlows(fixturePath, discovery.data);

    expect(JSON.stringify(resultA.data)).toBe(JSON.stringify(resultB.data));
  });
});
