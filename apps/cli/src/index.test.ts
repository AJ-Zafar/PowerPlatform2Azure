import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { validatePowerPlatformIR } from "@power-exit/ir";

import { runCli } from "./index";

const createTempDirectory = async (): Promise<string> =>
  mkdtemp(path.join(os.tmpdir(), "power-exit-cli-"));

const fileExists = async (filePath: string): Promise<boolean> => {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
};

interface GenerationPlanFile {
  path: string;
  action: "create" | "overwrite" | "skip" | "unchanged";
  contentHash: string;
}

interface GenerationPlanSummary {
  totalPlannedFiles: number;
  creates: number;
  overwrites: number;
  skips: number;
  unchanged: number;
}

interface GenerationPlanPayload {
  plannedFiles: GenerationPlanFile[];
  skippedFiles: Array<{ path: string }>;
  overwrittenFiles: Array<{ path: string }>;
  formulaHotspots: Array<{
    screen: string;
    control: string | null;
    property: string;
    formulaBucket: string;
    originalPowerFx: string;
    generatedStubName: string;
    likelyManualImplementationArea: string;
    severity: string;
    recommendation: string;
  }>;
  sqlPlan: {
    tablesToCreate: string[];
    columnsToCreate: Array<{ table: string; column: string }>;
    foreignKeysToCreate: string[];
    joinTablesToCreate: string[];
    unsupportedColumns: string[];
    unresolvedRelationships: string[];
    namingCollisions: string[];
  } | null;
  functionsPlan: {
    plannedFunctions: Array<{
      functionName: string;
      triggerType: string;
      sourceArtifactIds: string[];
    }>;
    manualReviewHotspots: Array<{ message: string }>;
    unsupportedActions: Array<{ actionName: string }>;
    unresolvedDependencies: Array<{ referenceName: string }>;
  } | null;
  summary: GenerationPlanSummary;
}

const readGenerationPlan = async (outputFolder: string): Promise<GenerationPlanPayload> =>
  JSON.parse(
    await readFile(path.join(outputFolder, "generation-plan.json"), "utf-8")
  ) as GenerationPlanPayload;

describe("power-exit analyse command", () => {
  it("produces deterministic ir.json for a valid input folder", async () => {
    const tempRoot = await createTempDirectory();
    const outputA = path.join(tempRoot, "out-a");
    const outputB = path.join(tempRoot, "out-b");
    const inputFolder = path.resolve(
      process.cwd(),
      "packages/fixtures/samples/solutions/dataverse-heavy"
    );
    const stdOut: string[] = [];
    const stdErr: string[] = [];

    const exitCodeA = await runCli(
      ["analyse", inputFolder, "--out", outputA],
      stdOut.push.bind(stdOut),
      stdErr.push.bind(stdErr)
    );
    const exitCodeB = await runCli(
      ["analyse", inputFolder, "--out", outputB],
      stdOut.push.bind(stdOut),
      stdErr.push.bind(stdErr)
    );

    expect(exitCodeA).toBe(0);
    expect(exitCodeB).toBe(0);

    const irA = await readFile(path.join(outputA, "ir.json"), "utf-8");
    const irB = await readFile(path.join(outputB, "ir.json"), "utf-8");

    expect(irA).toBe(irB);
    expect(() => validatePowerPlatformIR(JSON.parse(irA))).not.toThrow();
    expect(stdOut.length).toBe(2);
    expect(stdOut[0]).toContain('"filesScanned"');
    expect(stdOut[0]).toContain('"entitiesParsed"');
    expect(stdOut[0]).toContain('"attributesParsed"');
    expect(stdOut[0]).toContain('"relationshipsParsed"');
    expect(stdOut[0]).toContain('"classifiedFiles"');
    expect(stdOut[0]).toContain('"choicesParsed"');
    expect(stdOut[0]).toContain('"canvasAppsParsed"');
    expect(stdOut[0]).toContain('"canvasScreensParsed"');
    expect(stdOut[0]).toContain('"canvasControlsParsed"');
    expect(stdOut[0]).toContain('"canvasFormulasParsed"');
    expect(stdOut[0]).toContain('"canvasScreensByReadiness"');
    expect(stdOut[0]).toContain('"canvasControlsByRole"');
    expect(stdOut[0]).toContain('"canvasBlockedControls"');
    expect(stdOut[0]).toContain('"canvasUnknownControls"');
    expect(stdOut[0]).toContain('"canvasComplexFormulas"');
    expect(stdOut[0]).toContain('"canvasLayoutWarnings"');
    expect(stdOut[0]).toContain('"flowsParsed"');
    expect(stdOut[0]).toContain('"triggersParsed"');
    expect(stdOut[0]).toContain('"actionsParsed"');
    expect(stdOut[0]).toContain('"connectorsDetected"');
    expect(stdOut[0]).toContain('"premiumCustomConnectors"');
    expect(stdOut[0]).toContain('"flowsByReadiness"');
    expect(stdOut[0]).toContain('"unsupportedFlowFeatures"');
    expect(stdOut[0]).toContain('"unresolvedFlowDependencies"');
    expect(stdOut[0]).toContain('"unresolvedDependencies"');
    expect(stdErr).toEqual([]);

    await rm(tempRoot, { recursive: true, force: true });
  });

  it("prints a structured error for missing input folder", async () => {
    const output = await createTempDirectory();
    const stdOut: string[] = [];
    const stdErr: string[] = [];

    const exitCode = await runCli(
      ["analyse", "/tmp/does-not-exist", "--out", output],
      stdOut.push.bind(stdOut),
      stdErr.push.bind(stdErr)
    );

    expect(exitCode).toBe(1);
    expect(stdOut).toEqual([]);
    expect(stdErr[0]).toContain('"code":"INPUT_FOLDER_NOT_FOUND"');

    await rm(output, { recursive: true, force: true });
  });

  it("prints a structured error for invalid output path", async () => {
    const tempRoot = await createTempDirectory();
    const inputFolder = path.resolve(
      process.cwd(),
      "packages/fixtures/samples/solutions/infra-heavy"
    );
    const outputFilePath = path.join(tempRoot, "output-file");
    const stdOut: string[] = [];
    const stdErr: string[] = [];

    await writeFile(outputFilePath, "cannot-be-directory", "utf-8");

    const exitCode = await runCli(
      ["analyse", inputFolder, "--out", outputFilePath],
      stdOut.push.bind(stdOut),
      stdErr.push.bind(stdErr)
    );

    expect(exitCode).toBe(1);
    expect(stdOut).toEqual([]);
    expect(stdErr[0]).toContain('"code":"INVALID_OUTPUT_PATH"');

    await rm(tempRoot, { recursive: true, force: true });
  });

  it("includes structured canvas data in generated IR output", async () => {
    const tempRoot = await createTempDirectory();
    const output = path.join(tempRoot, "out");
    const inputFolder = path.resolve(
      process.cwd(),
      "packages/fixtures/samples/solutions/canvas-heavy"
    );
    const stdOut: string[] = [];
    const stdErr: string[] = [];

    const exitCode = await runCli(
      ["analyse", inputFolder, "--out", output],
      stdOut.push.bind(stdOut),
      stdErr.push.bind(stdErr)
    );

    expect(exitCode).toBe(0);
    const ir = JSON.parse(
      await readFile(path.join(output, "ir.json"), "utf-8")
    ) as ReturnType<typeof validatePowerPlatformIR>;

    expect(ir.canvasApps.length).toBeGreaterThan(0);
    expect(ir.canvasApps.some((app) => app.screens.length > 0)).toBe(true);
    expect(ir.dependencyGraph.edges.some((edge) => edge.dependencyType === "canvas-app-screen")).toBe(
      true
    );
    expect(stdErr).toEqual([]);

    await rm(tempRoot, { recursive: true, force: true });
  });

  it("includes structured flow data in generated IR output and summary", async () => {
    const tempRoot = await createTempDirectory();
    const output = path.join(tempRoot, "out");
    const inputFolder = path.resolve(
      process.cwd(),
      "packages/fixtures/samples/solutions/flow-heavy"
    );
    const stdOut: string[] = [];
    const stdErr: string[] = [];

    const exitCode = await runCli(
      ["analyse", inputFolder, "--out", output],
      stdOut.push.bind(stdOut),
      stdErr.push.bind(stdErr)
    );

    expect(exitCode).toBe(0);
    const ir = JSON.parse(
      await readFile(path.join(output, "ir.json"), "utf-8")
    ) as ReturnType<typeof validatePowerPlatformIR>;
    const summary = JSON.parse(stdOut[0]) as {
      flowsParsed: number;
      triggersParsed: number;
      actionsParsed: number;
      connectorsDetected: number;
    };

    expect(ir.cloudFlows.length).toBeGreaterThan(0);
    expect(ir.cloudFlows.some((flow) => flow.actions.length > 0)).toBe(true);
    expect(
      ir.dependencyGraph.edges.some((edge) => edge.dependencyType === "flow-action")
    ).toBe(true);
    expect(summary.flowsParsed).toBeGreaterThan(0);
    expect(summary.triggersParsed).toBeGreaterThan(0);
    expect(summary.actionsParsed).toBeGreaterThan(0);
    expect(summary.connectorsDetected).toBeGreaterThan(0);
    expect(stdErr).toEqual([]);

    await rm(tempRoot, { recursive: true, force: true });
  });

  it("writes assessment-report.md when analyse is called with --report", async () => {
    const tempRoot = await createTempDirectory();
    const output = path.join(tempRoot, "out");
    const inputFolder = path.resolve(
      process.cwd(),
      "packages/fixtures/samples/solutions/flow-heavy"
    );
    const stdOut: string[] = [];
    const stdErr: string[] = [];

    const exitCode = await runCli(
      ["analyse", inputFolder, "--out", output, "--report"],
      stdOut.push.bind(stdOut),
      stdErr.push.bind(stdErr)
    );

    expect(exitCode).toBe(0);
    const report = await readFile(path.join(output, "assessment-report.md"), "utf-8");
    expect(report).toContain("# Power Exit Migration Assessment Report");
    expect(report).toContain("## Recommended migration waves");
    expect(stdErr).toEqual([]);

    await rm(tempRoot, { recursive: true, force: true });
  });

  it("generates report from an existing ir.json via report command", async () => {
    const tempRoot = await createTempDirectory();
    const output = path.join(tempRoot, "out");
    const inputFolder = path.resolve(
      process.cwd(),
      "packages/fixtures/samples/solutions/mixed-partial"
    );
    const stdOut: string[] = [];
    const stdErr: string[] = [];

    const analyseExitCode = await runCli(
      ["analyse", inputFolder, "--out", output],
      stdOut.push.bind(stdOut),
      stdErr.push.bind(stdErr)
    );
    expect(analyseExitCode).toBe(0);

    const reportOutput = path.join(tempRoot, "report-out");
    const reportStdOut: string[] = [];
    const reportStdErr: string[] = [];
    const reportExitCode = await runCli(
      ["report", path.join(output, "ir.json"), "--out", reportOutput],
      reportStdOut.push.bind(reportStdOut),
      reportStdErr.push.bind(reportStdErr)
    );

    expect(reportExitCode).toBe(0);
    const report = await readFile(path.join(reportOutput, "assessment-report.md"), "utf-8");
    expect(report).toContain("## Executive summary");
    expect(report).toContain("## Overall readiness");
    expect(reportStdOut[0]).toContain('"command":"report"');
    expect(reportStdErr).toEqual([]);

    await rm(tempRoot, { recursive: true, force: true });
  });
});

describe("power-exit generate sql command", () => {
  it("validates IR input and writes schema.sql plus generation-report.md", async () => {
    const tempRoot = await createTempDirectory();
    const analyseOutput = path.join(tempRoot, "analyse-out");
    const generateOutput = path.join(tempRoot, "generate-out");
    const inputFolder = path.resolve(
      process.cwd(),
      "packages/fixtures/samples/solutions/dataverse-heavy"
    );
    const analyseStdOut: string[] = [];
    const analyseStdErr: string[] = [];

    const analyseExitCode = await runCli(
      ["analyse", inputFolder, "--out", analyseOutput],
      analyseStdOut.push.bind(analyseStdOut),
      analyseStdErr.push.bind(analyseStdErr)
    );

    expect(analyseExitCode).toBe(0);
    expect(analyseStdErr).toEqual([]);

    const generateStdOut: string[] = [];
    const generateStdErr: string[] = [];
    const generateExitCode = await runCli(
      [
        "generate",
        "sql",
        path.join(analyseOutput, "ir.json"),
        "--out",
        generateOutput
      ],
      generateStdOut.push.bind(generateStdOut),
      generateStdErr.push.bind(generateStdErr)
    );

    expect(generateExitCode).toBe(0);
    const schemaContent = await readFile(path.join(generateOutput, "schema.sql"), "utf-8");
    const reportContent = await readFile(path.join(generateOutput, "generation-report.md"), "utf-8");
    expect(schemaContent).toContain("Generated by Power Exit.");
    expect(schemaContent).toContain("CREATE TABLE");
    expect(reportContent).toContain("Generated by Power Exit.");
    expect(reportContent).toContain("# Power Exit SQL Generation Report");
    expect(generateStdOut[0]).toContain('"command":"generate-sql"');
    expect(generateStdOut[0]).toContain('"tablesGenerated"');
    expect(generateStdOut[0]).toContain('"columnsGenerated"');
    expect(generateStdOut[0]).toContain('"relationshipsGenerated"');
    expect(generateStdOut[0]).toContain('"warnings"');
    expect(generateStdOut[0]).toContain('"unsupportedFeatures"');
    expect(generateStdErr).toEqual([]);

    await rm(tempRoot, { recursive: true, force: true });
  });

  it("detects conflicts during dry-run without mutating existing files", async () => {
    const tempRoot = await createTempDirectory();
    const analyseOutput = path.join(tempRoot, "analyse-out");
    const generateOutput = path.join(tempRoot, "generate-out");
    const inputFolder = path.resolve(
      process.cwd(),
      "packages/fixtures/samples/solutions/dataverse-heavy"
    );
    const existingUserContent = "-- user-owned schema\nSELECT 1;\n";

    expect(await runCli(["analyse", inputFolder, "--out", analyseOutput], () => undefined, () => undefined)).toBe(0);
    await mkdir(generateOutput, { recursive: true });
    await writeFile(path.join(generateOutput, "schema.sql"), existingUserContent, "utf-8");

    expect(
      await runCli(
        [
          "generate",
          "sql",
          path.join(analyseOutput, "ir.json"),
          "--out",
          generateOutput,
          "--dry-run"
        ],
        () => undefined,
        () => undefined
      )
    ).toBe(0);
    const dryRunPlan = await readGenerationPlan(generateOutput);
    expect(
      dryRunPlan.plannedFiles.some(
        (file) => file.path === "schema.sql" && file.action === "skip"
      )
    ).toBe(true);
    expect(await readFile(path.join(generateOutput, "schema.sql"), "utf-8")).toBe(existingUserContent);

    expect(
      await runCli(
        [
          "generate",
          "sql",
          path.join(analyseOutput, "ir.json"),
          "--out",
          generateOutput,
          "--dry-run",
          "--force"
        ],
        () => undefined,
        () => undefined
      )
    ).toBe(0);
    const forceDryRunPlan = await readGenerationPlan(generateOutput);
    expect(
      forceDryRunPlan.plannedFiles.some(
        (file) => file.path === "schema.sql" && file.action === "overwrite"
      )
    ).toBe(true);
    expect(await readFile(path.join(generateOutput, "schema.sql"), "utf-8")).toBe(existingUserContent);

    await rm(tempRoot, { recursive: true, force: true });
  });

  it("prints a structured error when generate sql input IR is missing", async () => {
    const tempRoot = await createTempDirectory();
    const output = path.join(tempRoot, "out");
    const stdOut: string[] = [];
    const stdErr: string[] = [];

    const exitCode = await runCli(
      ["generate", "sql", path.join(tempRoot, "missing-ir.json"), "--out", output],
      stdOut.push.bind(stdOut),
      stdErr.push.bind(stdErr)
    );

    expect(exitCode).toBe(1);
    expect(stdOut).toEqual([]);
    expect(stdErr[0]).toContain('"code":"INPUT_FILE_NOT_FOUND"');

    await rm(tempRoot, { recursive: true, force: true });
  });

  it("supports --dry-run and writes only generation plan files", async () => {
    const tempRoot = await createTempDirectory();
    const analyseOutput = path.join(tempRoot, "analyse-out");
    const generateOutput = path.join(tempRoot, "generate-out");
    const inputFolder = path.resolve(
      process.cwd(),
      "packages/fixtures/samples/solutions/dataverse-heavy"
    );
    const analyseStdOut: string[] = [];
    const analyseStdErr: string[] = [];
    const generateStdOut: string[] = [];
    const generateStdErr: string[] = [];

    const analyseExitCode = await runCli(
      ["analyse", inputFolder, "--out", analyseOutput],
      analyseStdOut.push.bind(analyseStdOut),
      analyseStdErr.push.bind(analyseStdErr)
    );
    expect(analyseExitCode).toBe(0);

    const generateExitCode = await runCli(
      [
        "generate",
        "sql",
        path.join(analyseOutput, "ir.json"),
        "--out",
        generateOutput,
        "--dry-run"
      ],
      generateStdOut.push.bind(generateStdOut),
      generateStdErr.push.bind(generateStdErr)
    );

    expect(generateExitCode).toBe(0);
    expect(await fileExists(path.join(generateOutput, "schema.sql"))).toBe(false);
    expect(await fileExists(path.join(generateOutput, "generation-report.md"))).toBe(false);
    expect(await fileExists(path.join(generateOutput, "generation-plan.json"))).toBe(true);
    expect(await fileExists(path.join(generateOutput, "generation-plan.md"))).toBe(true);
    expect(generateStdOut[0]).toContain('"dryRun":true');
    expect(generateStdOut[0]).toContain('"planSummary"');
    expect(generateStdErr).toEqual([]);

    await rm(tempRoot, { recursive: true, force: true });
  });

  it("produces deterministic planned file hashes in dry-run mode", async () => {
    const tempRoot = await createTempDirectory();
    const analyseOutput = path.join(tempRoot, "analyse-out");
    const dryRunA = path.join(tempRoot, "dry-a");
    const dryRunB = path.join(tempRoot, "dry-b");
    const inputFolder = path.resolve(
      process.cwd(),
      "packages/fixtures/samples/solutions/dataverse-heavy"
    );
    const analyseStdOut: string[] = [];
    const analyseStdErr: string[] = [];
    const stdErrA: string[] = [];
    const stdErrB: string[] = [];

    expect(
      await runCli(
        ["analyse", inputFolder, "--out", analyseOutput],
        analyseStdOut.push.bind(analyseStdOut),
        analyseStdErr.push.bind(analyseStdErr)
      )
    ).toBe(0);

    expect(
      await runCli(
        ["generate", "sql", path.join(analyseOutput, "ir.json"), "--out", dryRunA, "--dry-run"],
        () => undefined,
        stdErrA.push.bind(stdErrA)
      )
    ).toBe(0);
    expect(
      await runCli(
        ["generate", "sql", path.join(analyseOutput, "ir.json"), "--out", dryRunB, "--dry-run"],
        () => undefined,
        stdErrB.push.bind(stdErrB)
      )
    ).toBe(0);

    const planA = await readGenerationPlan(dryRunA);
    const planB = await readGenerationPlan(dryRunB);

    const hashesA = planA.plannedFiles.map((file) => `${file.path}:${file.contentHash}`);
    const hashesB = planB.plannedFiles.map((file) => `${file.path}:${file.contentHash}`);

    expect(hashesA).toEqual(hashesB);
    expect(stdErrA).toEqual([]);
    expect(stdErrB).toEqual([]);

    await rm(tempRoot, { recursive: true, force: true });
  });

  it("skips conflicting files by default and overwrites with --force", async () => {
    const tempRoot = await createTempDirectory();
    const analyseOutput = path.join(tempRoot, "analyse-out");
    const generateOutput = path.join(tempRoot, "generate-out");
    const inputFolder = path.resolve(
      process.cwd(),
      "packages/fixtures/samples/solutions/dataverse-heavy"
    );
    const analyseStdOut: string[] = [];
    const analyseStdErr: string[] = [];
    const skipStdErr: string[] = [];
    const forceStdErr: string[] = [];
    const existingUserContent = "-- user-owned schema\nSELECT 1;\n";

    expect(
      await runCli(
        ["analyse", inputFolder, "--out", analyseOutput],
        analyseStdOut.push.bind(analyseStdOut),
        analyseStdErr.push.bind(analyseStdErr)
      )
    ).toBe(0);

    await mkdir(generateOutput, { recursive: true });
    await writeFile(path.join(generateOutput, "schema.sql"), existingUserContent, "utf-8");

    expect(
      await runCli(
        ["generate", "sql", path.join(analyseOutput, "ir.json"), "--out", generateOutput],
        () => undefined,
        skipStdErr.push.bind(skipStdErr)
      )
    ).toBe(0);
    expect(await readFile(path.join(generateOutput, "schema.sql"), "utf-8")).toBe(existingUserContent);
    const skippedPlan = await readGenerationPlan(generateOutput);
    expect(skippedPlan.skippedFiles.some((entry) => entry.path === "schema.sql")).toBe(true);

    expect(
      await runCli(
        [
          "generate",
          "sql",
          path.join(analyseOutput, "ir.json"),
          "--out",
          generateOutput,
          "--force"
        ],
        () => undefined,
        forceStdErr.push.bind(forceStdErr)
      )
    ).toBe(0);
    expect(await readFile(path.join(generateOutput, "schema.sql"), "utf-8")).toContain("CREATE TABLE");
    const forcedPlan = await readGenerationPlan(generateOutput);
    expect(forcedPlan.overwrittenFiles.some((entry) => entry.path === "schema.sql")).toBe(true);
    expect(skipStdErr).toEqual([]);
    expect(forceStdErr).toEqual([]);

    await rm(tempRoot, { recursive: true, force: true });
  });

  it("supports --clean and only removes files with generated marker", async () => {
    const tempRoot = await createTempDirectory();
    const analyseOutput = path.join(tempRoot, "analyse-out");
    const generateOutput = path.join(tempRoot, "generate-out");
    const inputFolder = path.resolve(
      process.cwd(),
      "packages/fixtures/samples/solutions/dataverse-heavy"
    );
    const userOwnedSchema = "-- user-owned schema\nSELECT 99;\n";
    const markerLines =
      "<!-- Generated by Power Exit. -->\n<!-- Do not edit directly unless you intend to own the generated file. -->\n";
    const generateStdErr: string[] = [];

    expect(
      await runCli(
        ["analyse", inputFolder, "--out", analyseOutput],
        () => undefined,
        () => undefined
      )
    ).toBe(0);

    await mkdir(generateOutput, { recursive: true });
    await writeFile(path.join(generateOutput, "schema.sql"), userOwnedSchema, "utf-8");
    await writeFile(
      path.join(generateOutput, "generation-report.md"),
      `${markerLines}\nlegacy generated report`,
      "utf-8"
    );

    expect(
      await runCli(
        [
          "generate",
          "sql",
          path.join(analyseOutput, "ir.json"),
          "--out",
          generateOutput,
          "--clean"
        ],
        () => undefined,
        generateStdErr.push.bind(generateStdErr)
      )
    ).toBe(0);

    expect(await readFile(path.join(generateOutput, "schema.sql"), "utf-8")).toBe(userOwnedSchema);
    expect(await readFile(path.join(generateOutput, "generation-report.md"), "utf-8")).toContain(
      "# Power Exit SQL Generation Report"
    );
    expect(generateStdErr).toEqual([]);

    await rm(tempRoot, { recursive: true, force: true });
  });

  it("does not mutate files when dry-run is combined with --clean", async () => {
    const tempRoot = await createTempDirectory();
    const analyseOutput = path.join(tempRoot, "analyse-out");
    const generateOutput = path.join(tempRoot, "generate-out");
    const inputFolder = path.resolve(
      process.cwd(),
      "packages/fixtures/samples/solutions/dataverse-heavy"
    );
    const markerLines =
      "<!-- Generated by Power Exit. -->\n<!-- Do not edit directly unless you intend to own the generated file. -->\n";
    const existingGeneratedReport = `${markerLines}\nlegacy generated report`;

    expect(await runCli(["analyse", inputFolder, "--out", analyseOutput], () => undefined, () => undefined)).toBe(0);
    await mkdir(generateOutput, { recursive: true });
    await writeFile(
      path.join(generateOutput, "generation-report.md"),
      existingGeneratedReport,
      "utf-8"
    );

    expect(
      await runCli(
        [
          "generate",
          "sql",
          path.join(analyseOutput, "ir.json"),
          "--out",
          generateOutput,
          "--dry-run",
          "--clean"
        ],
        () => undefined,
        () => undefined
      )
    ).toBe(0);

    expect(await readFile(path.join(generateOutput, "generation-report.md"), "utf-8")).toBe(
      existingGeneratedReport
    );

    await rm(tempRoot, { recursive: true, force: true });
  });

  it("includes SQL planning details in generation-plan.json", async () => {
    const tempRoot = await createTempDirectory();
    const analyseOutput = path.join(tempRoot, "analyse-out");
    const generateOutput = path.join(tempRoot, "generate-out");
    const inputFolder = path.resolve(
      process.cwd(),
      "packages/fixtures/samples/solutions/dataverse-heavy"
    );

    expect(await runCli(["analyse", inputFolder, "--out", analyseOutput], () => undefined, () => undefined)).toBe(0);
    expect(
      await runCli(
        [
          "generate",
          "sql",
          path.join(analyseOutput, "ir.json"),
          "--out",
          generateOutput,
          "--dry-run"
        ],
        () => undefined,
        () => undefined
      )
    ).toBe(0);

    const plan = await readGenerationPlan(generateOutput);
    expect(plan.sqlPlan).not.toBeNull();
    expect((plan.sqlPlan?.tablesToCreate.length ?? 0) > 0).toBe(true);
    expect(Array.isArray(plan.sqlPlan?.columnsToCreate ?? [])).toBe(true);
    expect(Array.isArray(plan.sqlPlan?.foreignKeysToCreate ?? [])).toBe(true);
    expect(Array.isArray(plan.sqlPlan?.joinTablesToCreate ?? [])).toBe(true);
    expect(Array.isArray(plan.sqlPlan?.unsupportedColumns ?? [])).toBe(true);
    expect(Array.isArray(plan.sqlPlan?.unresolvedRelationships ?? [])).toBe(true);
    expect(Array.isArray(plan.sqlPlan?.namingCollisions ?? [])).toBe(true);

    await rm(tempRoot, { recursive: true, force: true });
  });

  it("matches SQL generation-plan markdown snapshot", async () => {
    const tempRoot = await createTempDirectory();
    const analyseOutput = path.join(tempRoot, "analyse-out");
    const generateOutput = path.join(tempRoot, "generate-out");
    const inputFolder = path.resolve(
      process.cwd(),
      "packages/fixtures/samples/solutions/dataverse-heavy"
    );

    expect(await runCli(["analyse", inputFolder, "--out", analyseOutput], () => undefined, () => undefined)).toBe(0);
    expect(
      await runCli(
        [
          "generate",
          "sql",
          path.join(analyseOutput, "ir.json"),
          "--out",
          generateOutput,
          "--dry-run"
        ],
        () => undefined,
        () => undefined
      )
    ).toBe(0);

    expect(await readFile(path.join(generateOutput, "generation-plan.md"), "utf-8")).toMatchSnapshot();

    await rm(tempRoot, { recursive: true, force: true });
  });
});

describe("power-exit generate react command", () => {
  it("validates IR input and writes Next.js skeleton files", async () => {
    const tempRoot = await createTempDirectory();
    const analyseOutput = path.join(tempRoot, "analyse-out");
    const generateOutput = path.join(tempRoot, "generate-react-out");
    const inputFolder = path.resolve(
      process.cwd(),
      "packages/fixtures/samples/solutions/canvas-heavy"
    );
    const analyseStdOut: string[] = [];
    const analyseStdErr: string[] = [];

    const analyseExitCode = await runCli(
      ["analyse", inputFolder, "--out", analyseOutput],
      analyseStdOut.push.bind(analyseStdOut),
      analyseStdErr.push.bind(analyseStdErr)
    );

    expect(analyseExitCode).toBe(0);
    expect(analyseStdErr).toEqual([]);

    const generateStdOut: string[] = [];
    const generateStdErr: string[] = [];
    const generateExitCode = await runCli(
      [
        "generate",
        "react",
        path.join(analyseOutput, "ir.json"),
        "--out",
        generateOutput
      ],
      generateStdOut.push.bind(generateStdOut),
      generateStdErr.push.bind(generateStdErr)
    );

    expect(generateExitCode).toBe(0);
    const reactReport = await readFile(path.join(generateOutput, "generation-report.md"), "utf-8");
    const migrationNotes = await readFile(path.join(generateOutput, "migration-notes.md"), "utf-8");
    const reactPlan = await readGenerationPlan(generateOutput);
    const tsxArtifactPath = reactPlan.plannedFiles.find((file) => file.path.endsWith(".tsx"))?.path;
    expect(reactReport).toContain("Generated by Power Exit.");
    expect(reactReport).toContain("# Power Exit React Generation Report");
    expect(migrationNotes).toContain("Generated by Power Exit.");
    expect(migrationNotes).toContain("manual conversion");
    expect(tsxArtifactPath).toBeDefined();
    expect(await readFile(path.join(generateOutput, tsxArtifactPath as string), "utf-8")).toContain(
      "Generated by Power Exit."
    );
    expect(generateStdOut[0]).toContain('"command":"generate-react"');
    expect(generateStdOut[0]).toContain('"appsGenerated"');
    expect(generateStdOut[0]).toContain('"screensGenerated"');
    expect(generateStdOut[0]).toContain('"controlsGenerated"');
    expect(generateStdOut[0]).toContain('"formulasPreserved"');
    expect(generateStdOut[0]).toContain('"formulasClassified"');
    expect(generateStdOut[0]).toContain('"stubsGenerated"');
    expect(generateStdOut[0]).toContain('"unsupportedFormulas"');
    expect(generateStdOut[0]).toContain('"manualConversionHotspots"');
    expect(generateStdOut[0]).toContain('"unsupportedControls"');
    expect(generateStdOut[0]).toContain('"warnings"');
    expect(generateStdErr).toEqual([]);

    await rm(tempRoot, { recursive: true, force: true });
  });

  it("prints a structured error when generate react input IR is missing", async () => {
    const tempRoot = await createTempDirectory();
    const output = path.join(tempRoot, "out");
    const stdOut: string[] = [];
    const stdErr: string[] = [];

    const exitCode = await runCli(
      ["generate", "react", path.join(tempRoot, "missing-ir.json"), "--out", output],
      stdOut.push.bind(stdOut),
      stdErr.push.bind(stdErr)
    );

    expect(exitCode).toBe(1);
    expect(stdOut).toEqual([]);
    expect(stdErr[0]).toContain('"code":"INPUT_FILE_NOT_FOUND"');

    await rm(tempRoot, { recursive: true, force: true });
  });

  it("supports --dry-run and writes only generation plan files for react", async () => {
    const tempRoot = await createTempDirectory();
    const analyseOutput = path.join(tempRoot, "analyse-out");
    const generateOutput = path.join(tempRoot, "generate-react-out");
    const inputFolder = path.resolve(
      process.cwd(),
      "packages/fixtures/samples/solutions/canvas-heavy"
    );
    const stdOut: string[] = [];
    const stdErr: string[] = [];

    expect(await runCli(["analyse", inputFolder, "--out", analyseOutput], () => undefined, () => undefined)).toBe(0);
    expect(
      await runCli(
        [
          "generate",
          "react",
          path.join(analyseOutput, "ir.json"),
          "--out",
          generateOutput,
          "--dry-run"
        ],
        stdOut.push.bind(stdOut),
        stdErr.push.bind(stdErr)
      )
    ).toBe(0);

    expect(await fileExists(path.join(generateOutput, "generation-report.md"))).toBe(false);
    expect(await fileExists(path.join(generateOutput, "migration-notes.md"))).toBe(false);
    expect(await fileExists(path.join(generateOutput, "generation-plan.json"))).toBe(true);
    expect(await fileExists(path.join(generateOutput, "generation-plan.md"))).toBe(true);
    expect(stdOut[0]).toContain('"dryRun":true');
    expect(stdOut[0]).toContain('"planSummary"');
    expect(stdErr).toEqual([]);

    await rm(tempRoot, { recursive: true, force: true });
  });

  it("includes formula hotspots in react generation plans", async () => {
    const tempRoot = await createTempDirectory();
    const analyseOutput = path.join(tempRoot, "analyse-out");
    const generateOutput = path.join(tempRoot, "generate-react-out");
    const inputFolder = path.resolve(
      process.cwd(),
      "packages/fixtures/samples/solutions/canvas-heavy"
    );

    expect(await runCli(["analyse", inputFolder, "--out", analyseOutput], () => undefined, () => undefined)).toBe(0);
    expect(
      await runCli(
        [
          "generate",
          "react",
          path.join(analyseOutput, "ir.json"),
          "--out",
          generateOutput,
          "--dry-run"
        ],
        () => undefined,
        () => undefined
      )
    ).toBe(0);

    const plan = await readGenerationPlan(generateOutput);
    expect(plan.formulaHotspots.length).toBeGreaterThan(0);
    const hotspot = plan.formulaHotspots[0];
    expect(hotspot.screen.length).toBeGreaterThan(0);
    expect(hotspot.property.length).toBeGreaterThan(0);
    expect(hotspot.formulaBucket.length).toBeGreaterThan(0);
    expect(hotspot.originalPowerFx.length).toBeGreaterThan(0);
    expect(hotspot.generatedStubName.length).toBeGreaterThan(0);
    expect(hotspot.likelyManualImplementationArea.length).toBeGreaterThan(0);
    expect(hotspot.recommendation.length).toBeGreaterThan(0);

    await rm(tempRoot, { recursive: true, force: true });
  });

  it("matches react generation-plan markdown snapshot", async () => {
    const tempRoot = await createTempDirectory();
    const analyseOutput = path.join(tempRoot, "analyse-out");
    const generateOutput = path.join(tempRoot, "generate-react-out");
    const inputFolder = path.resolve(
      process.cwd(),
      "packages/fixtures/samples/solutions/canvas-heavy"
    );

    expect(await runCli(["analyse", inputFolder, "--out", analyseOutput], () => undefined, () => undefined)).toBe(0);
    expect(
      await runCli(
        [
          "generate",
          "react",
          path.join(analyseOutput, "ir.json"),
          "--out",
          generateOutput,
          "--dry-run"
        ],
        () => undefined,
        () => undefined
      )
    ).toBe(0);

    expect(await readFile(path.join(generateOutput, "generation-plan.md"), "utf-8")).toMatchSnapshot();

    await rm(tempRoot, { recursive: true, force: true });
  });
});

describe("power-exit generate functions command", () => {
  it("validates IR input and writes Azure Functions scaffold files", async () => {
    const tempRoot = await createTempDirectory();
    const analyseOutput = path.join(tempRoot, "analyse-out");
    const generateOutput = path.join(tempRoot, "generate-functions-out");
    const inputFolder = path.resolve(
      process.cwd(),
      "packages/fixtures/samples/solutions/flow-heavy"
    );
    const stdOut: string[] = [];
    const stdErr: string[] = [];

    expect(await runCli(["analyse", inputFolder, "--out", analyseOutput], () => undefined, () => undefined)).toBe(0);
    expect(
      await runCli(
        [
          "generate",
          "functions",
          path.join(analyseOutput, "ir.json"),
          "--out",
          generateOutput
        ],
        stdOut.push.bind(stdOut),
        stdErr.push.bind(stdErr)
      )
    ).toBe(0);

    expect(await fileExists(path.join(generateOutput, "host.json"))).toBe(true);
    expect(await fileExists(path.join(generateOutput, "package.json"))).toBe(true);
    expect(await fileExists(path.join(generateOutput, "generation-report.md"))).toBe(true);
    expect(await fileExists(path.join(generateOutput, "migration-notes.md"))).toBe(true);
    expect(await fileExists(path.join(generateOutput, "src/services/dataverseService.ts"))).toBe(true);
    expect(stdOut[0]).toContain('"command":"generate-functions"');
    expect(stdOut[0]).toContain('"functionsGenerated"');
    expect(stdOut[0]).toContain('"flowFunctionsGenerated"');
    expect(stdOut[0]).toContain('"canvasApiFunctionsGenerated"');
    expect(stdErr).toEqual([]);

    await rm(tempRoot, { recursive: true, force: true });
  });

  it("supports --dry-run and writes only generation plan files", async () => {
    const tempRoot = await createTempDirectory();
    const analyseOutput = path.join(tempRoot, "analyse-out");
    const generateOutput = path.join(tempRoot, "generate-functions-out");
    const inputFolder = path.resolve(
      process.cwd(),
      "packages/fixtures/samples/solutions/flow-heavy"
    );

    expect(await runCli(["analyse", inputFolder, "--out", analyseOutput], () => undefined, () => undefined)).toBe(0);
    expect(
      await runCli(
        [
          "generate",
          "functions",
          path.join(analyseOutput, "ir.json"),
          "--out",
          generateOutput,
          "--dry-run"
        ],
        () => undefined,
        () => undefined
      )
    ).toBe(0);

    expect(await fileExists(path.join(generateOutput, "host.json"))).toBe(false);
    expect(await fileExists(path.join(generateOutput, "generation-plan.json"))).toBe(true);
    expect(await fileExists(path.join(generateOutput, "generation-plan.md"))).toBe(true);

    const plan = await readGenerationPlan(generateOutput);
    expect(plan.functionsPlan).not.toBeNull();
    expect((plan.functionsPlan?.plannedFunctions.length ?? 0) > 0).toBe(true);

    await rm(tempRoot, { recursive: true, force: true });
  });

  it("skips conflicting files by default and overwrites with --force", async () => {
    const tempRoot = await createTempDirectory();
    const analyseOutput = path.join(tempRoot, "analyse-out");
    const generateOutput = path.join(tempRoot, "generate-functions-out");
    const inputFolder = path.resolve(
      process.cwd(),
      "packages/fixtures/samples/solutions/flow-heavy"
    );
    const existingUserContent = "{\n  \"version\": \"custom\"\n}\n";

    expect(await runCli(["analyse", inputFolder, "--out", analyseOutput], () => undefined, () => undefined)).toBe(0);
    await mkdir(generateOutput, { recursive: true });
    await writeFile(path.join(generateOutput, "host.json"), existingUserContent, "utf-8");

    expect(
      await runCli(
        [
          "generate",
          "functions",
          path.join(analyseOutput, "ir.json"),
          "--out",
          generateOutput
        ],
        () => undefined,
        () => undefined
      )
    ).toBe(0);
    expect(await readFile(path.join(generateOutput, "host.json"), "utf-8")).toBe(existingUserContent);
    const skippedPlan = await readGenerationPlan(generateOutput);
    expect(skippedPlan.skippedFiles.some((entry) => entry.path === "host.json")).toBe(true);

    expect(
      await runCli(
        [
          "generate",
          "functions",
          path.join(analyseOutput, "ir.json"),
          "--out",
          generateOutput,
          "--force"
        ],
        () => undefined,
        () => undefined
      )
    ).toBe(0);
    expect(await readFile(path.join(generateOutput, "host.json"), "utf-8")).toContain("version");
    const forcedPlan = await readGenerationPlan(generateOutput);
    expect(forcedPlan.overwrittenFiles.some((entry) => entry.path === "host.json")).toBe(true);

    await rm(tempRoot, { recursive: true, force: true });
  });

  it("supports --clean for marker-tagged generated function files only", async () => {
    const tempRoot = await createTempDirectory();
    const analyseOutput = path.join(tempRoot, "analyse-out");
    const generateOutput = path.join(tempRoot, "generate-functions-out");
    const inputFolder = path.resolve(
      process.cwd(),
      "packages/fixtures/samples/solutions/flow-heavy"
    );
    const markerLines =
      "/* Generated by Power Exit. */\n/* Do not edit directly unless you intend to own the generated file. */\n";
    const userOwnedHost = "{\n  \"version\": \"user\"\n}\n";

    expect(await runCli(["analyse", inputFolder, "--out", analyseOutput], () => undefined, () => undefined)).toBe(0);
    await mkdir(path.join(generateOutput, "src/services"), { recursive: true });
    await writeFile(path.join(generateOutput, "host.json"), userOwnedHost, "utf-8");
    await writeFile(
      path.join(generateOutput, "src/services/httpClient.ts"),
      `${markerLines}\nexport const httpClient = {};`,
      "utf-8"
    );

    expect(
      await runCli(
        [
          "generate",
          "functions",
          path.join(analyseOutput, "ir.json"),
          "--out",
          generateOutput,
          "--clean"
        ],
        () => undefined,
        () => undefined
      )
    ).toBe(0);

    expect(await readFile(path.join(generateOutput, "host.json"), "utf-8")).toBe(userOwnedHost);
    expect(await readFile(path.join(generateOutput, "src/services/httpClient.ts"), "utf-8")).toContain(
      "Generated by Power Exit."
    );

    await rm(tempRoot, { recursive: true, force: true });
  });
});
