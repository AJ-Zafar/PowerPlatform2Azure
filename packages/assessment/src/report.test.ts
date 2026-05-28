import path from "node:path";

import { describe, expect, it } from "vitest";

import { analyseSolutionFolder } from "@power-exit/parsers";

import { assessPowerPlatformIR, generateAssessmentReportMarkdown } from "./index";

const solutionFixturePath = (fixtureName: string): string =>
  path.resolve(process.cwd(), "packages/fixtures/samples/solutions", fixtureName);

describe("generateAssessmentReportMarkdown", () => {
  it("generates deterministic markdown report with required sections", async () => {
    const ir = (await analyseSolutionFolder(solutionFixturePath("flow-heavy"))).ir;
    const assessment = assessPowerPlatformIR(ir);

    const reportA = generateAssessmentReportMarkdown(ir, assessment);
    const reportB = generateAssessmentReportMarkdown(ir, assessment);

    expect(reportA).toBe(reportB);
    expect(reportA).toContain("# Power Exit Migration Assessment Report");
    expect(reportA).toContain("## Executive summary");
    expect(reportA).toContain("## Overall readiness");
    expect(reportA).toContain("## Dataverse assessment");
    expect(reportA).toContain("## Canvas assessment");
    expect(reportA).toContain("## Cloud Flow assessment");
    expect(reportA).toContain("## Security assessment");
    expect(reportA).toContain("## Connection and dependency assessment");
    expect(reportA).toContain("## Recommended migration waves");
  });

  it("matches markdown snapshot output", async () => {
    const ir = (await analyseSolutionFolder(solutionFixturePath("flow-heavy"))).ir;
    const assessment = assessPowerPlatformIR(ir);
    const report = generateAssessmentReportMarkdown(ir, assessment);

    expect(report).toMatchSnapshot();
  });
});
