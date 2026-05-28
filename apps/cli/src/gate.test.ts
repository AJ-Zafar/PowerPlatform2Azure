import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { createUnsupportedFeature } from "@power-exit/ir";

import { runCli } from "./index";

const createTempDirectory = async (): Promise<string> =>
  mkdtemp(path.join(os.tmpdir(), "power-exit-gate-cli-"));

interface GatePayload {
  status: "pass" | "warn" | "fail";
  thresholds: {
    maxRiskScore: number;
    maxComplexityScore: number;
    minConfidence: number;
    allowCriticalUnsupported: boolean;
    maxUnresolvedDependencies: number;
    maxHighSeverityFindings: number;
    requireNoBlockers: boolean;
  };
  statusReasons: string[];
}

interface GateCommandPayload {
  command: "gate";
  gateStatus: "pass" | "warn" | "fail";
  ci: boolean;
  strict: boolean;
  ciExitCode: number;
  generationPlanAvailable: boolean;
  statusReasons: string[];
}

const fixturePath = (fixtureName: string): string =>
  path.resolve(process.cwd(), "packages/fixtures/samples/solutions", fixtureName);

const parseGateCommandPayload = (output: string): GateCommandPayload =>
  JSON.parse(output) as GateCommandPayload;

const parseReadinessGate = async (outputFolder: string): Promise<GatePayload> =>
  JSON.parse(await readFile(path.join(outputFolder, "readiness-gate.json"), "utf-8")) as GatePayload;

const writeMinimalGenerationPlan = async (outputFolder: string): Promise<void> => {
  const generationPlan = {
    plannedFiles: [],
    plannedDirectories: [],
    skippedFiles: [],
    overwrittenFiles: [],
    warnings: [],
    unsupportedFeatures: [],
    formulaHotspots: [],
    manualReviewItems: [],
    summary: {
      totalPlannedFiles: 0,
      totalPlannedDirectories: 0,
      creates: 0,
      overwrites: 0,
      skips: 0,
      unchanged: 0,
      warnings: 0,
      unsupportedFeatures: 0,
      formulaHotspots: 0,
      manualReviewItems: 0
    },
    sqlPlan: null,
    functionsPlan: null,
    infraPlan: null
  };
  await writeFile(
    path.join(outputFolder, "generation-plan.json"),
    `${JSON.stringify(generationPlan, null, 2)}\n`,
    "utf-8"
  );
};

describe("power-exit gate command", () => {
  it("produces pass status when thresholds pass and generation plan is available", async () => {
    const tempRoot = await createTempDirectory();
    const outputFolder = path.join(tempRoot, "gate-pass");
    const stdOut: string[] = [];
    const stdErr: string[] = [];

    expect(
      await runCli(
        ["analyse", fixturePath("minimal-valid"), "--out", outputFolder],
        () => undefined,
        stdErr.push.bind(stdErr)
      )
    ).toBe(0);
    await writeMinimalGenerationPlan(outputFolder);

    const exitCode = await runCli(
      [
        "gate",
        outputFolder,
        "--max-risk",
        "100",
        "--max-complexity",
        "100",
        "--min-confidence",
        "0"
      ],
      stdOut.push.bind(stdOut),
      stdErr.push.bind(stdErr)
    );

    expect(exitCode).toBe(0);
    const gate = await parseReadinessGate(outputFolder);
    expect(gate.status).toBe("pass");
    expect(await readFile(path.join(outputFolder, "readiness-gate.md"), "utf-8")).toContain(
      "## Threshold summary"
    );
    expect(parseGateCommandPayload(stdOut[0]).generationPlanAvailable).toBe(true);
    expect(stdErr).toEqual([]);

    await rm(tempRoot, { recursive: true, force: true });
  });

  it("falls back when generation-plan is missing and emits warn status", async () => {
    const tempRoot = await createTempDirectory();
    const outputFolder = path.join(tempRoot, "gate-warn");
    const stdOut: string[] = [];
    const stdErr: string[] = [];

    expect(
      await runCli(
        ["analyse", fixturePath("minimal-valid"), "--out", outputFolder],
        () => undefined,
        stdErr.push.bind(stdErr)
      )
    ).toBe(0);

    expect(await runCli(["gate", outputFolder], stdOut.push.bind(stdOut), stdErr.push.bind(stdErr))).toBe(
      0
    );
    const gate = await parseReadinessGate(outputFolder);
    expect(gate.status).toBe("warn");
    expect(gate.statusReasons.some((reason) => reason.includes("high/critical items"))).toBe(true);
    expect(parseGateCommandPayload(stdOut[0]).generationPlanAvailable).toBe(false);
    expect(stdErr).toEqual([]);

    await rm(tempRoot, { recursive: true, force: true });
  });

  it("fails when critical unsupported features are present", async () => {
    const tempRoot = await createTempDirectory();
    const outputFolder = path.join(tempRoot, "gate-fail");
    const stdOut: string[] = [];
    const stdErr: string[] = [];

    expect(
      await runCli(
        ["analyse", fixturePath("minimal-valid"), "--out", outputFolder],
        () => undefined,
        stdErr.push.bind(stdErr)
      )
    ).toBe(0);
    await writeMinimalGenerationPlan(outputFolder);
    const irPath = path.join(outputFolder, "ir.json");
    const ir = JSON.parse(await readFile(irPath, "utf-8")) as {
      unsupportedFeatures: unknown[];
    };
    ir.unsupportedFeatures = [
      ...ir.unsupportedFeatures,
      createUnsupportedFeature({
        featureType: "critical.synthetic.feature",
        sourceLocation: "synthetic/source",
        reason: "Critical unsupported synthetic feature.",
        suggestedRemediation: "Manual redesign required.",
        severity: "critical",
        confidence: 0.9,
        provenance: {
          sourcePath: "synthetic/source",
          sourceType: "unknown"
        }
      })
    ];
    await writeFile(irPath, `${JSON.stringify(ir, null, 2)}\n`, "utf-8");

    expect(await runCli(["gate", outputFolder], stdOut.push.bind(stdOut), stdErr.push.bind(stdErr))).toBe(
      0
    );
    const gate = await parseReadinessGate(outputFolder);
    expect(gate.status).toBe("fail");
    expect(gate.statusReasons.some((reason) => reason.includes("critical unsupported"))).toBe(true);
    expect(stdErr).toEqual([]);

    await rm(tempRoot, { recursive: true, force: true });
  });

  it("supports threshold overrides and unresolved dependency threshold failure", async () => {
    const tempRoot = await createTempDirectory();
    const outputFolder = path.join(tempRoot, "gate-overrides");
    const stdOut: string[] = [];
    const stdErr: string[] = [];

    expect(
      await runCli(
        ["migrate", fixturePath("migrate-e2e"), "--out", outputFolder],
        () => undefined,
        stdErr.push.bind(stdErr)
      )
    ).toBe(0);

    const generationPlanPath = path.join(outputFolder, "generation-plan.json");
    const generationPlan = JSON.parse(await readFile(generationPlanPath, "utf-8")) as {
      functionsPlan: {
        unresolvedDependencies: Array<{
          referenceType: string;
          referenceName: string;
          sourceArtifactId: string;
        }>;
      } | null;
    };
    if (generationPlan.functionsPlan) {
      generationPlan.functionsPlan.unresolvedDependencies = [
        {
          referenceType: "flow-action",
          referenceName: "dependency-1",
          sourceArtifactId: "flow:1"
        },
        {
          referenceType: "flow-action",
          referenceName: "dependency-2",
          sourceArtifactId: "flow:2"
        },
        {
          referenceType: "flow-action",
          referenceName: "dependency-3",
          sourceArtifactId: "flow:3"
        },
        {
          referenceType: "flow-action",
          referenceName: "dependency-4",
          sourceArtifactId: "flow:4"
        },
        {
          referenceType: "flow-action",
          referenceName: "dependency-5",
          sourceArtifactId: "flow:5"
        }
      ];
    }
    await writeFile(generationPlanPath, `${JSON.stringify(generationPlan, null, 2)}\n`, "utf-8");

    expect(
      await runCli(
        [
          "gate",
          outputFolder,
          "--max-risk",
          "95",
          "--max-complexity",
          "95",
          "--min-confidence",
          "0.1",
          "--max-unresolved",
          "0"
        ],
        stdOut.push.bind(stdOut),
        stdErr.push.bind(stdErr)
      )
    ).toBe(0);

    const gate = await parseReadinessGate(outputFolder);
    expect(gate.thresholds.maxRiskScore).toBe(95);
    expect(gate.thresholds.maxComplexityScore).toBe(95);
    expect(gate.thresholds.minConfidence).toBe(0.1);
    expect(gate.thresholds.maxUnresolvedDependencies).toBe(0);
    expect(gate.status).toBe("fail");
    expect(gate.statusReasons.some((reason) => reason.includes("Unresolved dependencies"))).toBe(true);
    expect(stdErr).toEqual([]);

    await rm(tempRoot, { recursive: true, force: true });
  });

  it("implements CI exit behavior for pass/warn/fail and strict mode", async () => {
    const tempRoot = await createTempDirectory();
    const passFolder = path.join(tempRoot, "gate-pass-ci");
    const warnFolder = path.join(tempRoot, "gate-warn-ci");
    const failFolder = path.join(tempRoot, "gate-fail-ci");
    const passStdOut: string[] = [];
    const warnStdOut: string[] = [];
    const warnStrictStdOut: string[] = [];
    const failStdOut: string[] = [];

    expect(await runCli(["analyse", fixturePath("minimal-valid"), "--out", passFolder], () => undefined, () => undefined)).toBe(0);
    await writeMinimalGenerationPlan(passFolder);
    expect(
      await runCli(
        ["gate", passFolder, "--ci", "--max-risk", "100", "--max-complexity", "100", "--min-confidence", "0"],
        passStdOut.push.bind(passStdOut),
        () => undefined
      )
    ).toBe(0);
    expect(parseGateCommandPayload(passStdOut[0]).gateStatus).toBe("pass");

    expect(await runCli(["analyse", fixturePath("minimal-valid"), "--out", warnFolder], () => undefined, () => undefined)).toBe(0);
    expect(await runCli(["gate", warnFolder, "--ci"], warnStdOut.push.bind(warnStdOut), () => undefined)).toBe(0);
    expect(parseGateCommandPayload(warnStdOut[0]).gateStatus).toBe("warn");
    expect(
      await runCli(
        ["gate", warnFolder, "--ci", "--strict"],
        warnStrictStdOut.push.bind(warnStrictStdOut),
        () => undefined
      )
    ).toBe(1);
    expect(parseGateCommandPayload(warnStrictStdOut[0]).ciExitCode).toBe(1);

    expect(await runCli(["analyse", fixturePath("minimal-valid"), "--out", failFolder], () => undefined, () => undefined)).toBe(0);
    await writeMinimalGenerationPlan(failFolder);
    const failIrPath = path.join(failFolder, "ir.json");
    const failIr = JSON.parse(await readFile(failIrPath, "utf-8")) as {
      unsupportedFeatures: unknown[];
    };
    failIr.unsupportedFeatures = [
      ...failIr.unsupportedFeatures,
      createUnsupportedFeature({
        featureType: "critical.synthetic.feature",
        sourceLocation: "synthetic/source",
        reason: "Critical unsupported synthetic feature.",
        suggestedRemediation: "Manual redesign required.",
        severity: "critical",
        confidence: 0.9,
        provenance: {
          sourcePath: "synthetic/source",
          sourceType: "unknown"
        }
      })
    ];
    await writeFile(failIrPath, `${JSON.stringify(failIr, null, 2)}\n`, "utf-8");

    expect(await runCli(["gate", failFolder, "--ci"], failStdOut.push.bind(failStdOut), () => undefined)).toBe(1);
    expect(parseGateCommandPayload(failStdOut[0]).gateStatus).toBe("fail");

    await rm(tempRoot, { recursive: true, force: true });
  });

  it("is deterministic across repeated runs and supports migrate --gate", async () => {
    const tempRoot = await createTempDirectory();
    const outputA = path.join(tempRoot, "run-a");
    const outputB = path.join(tempRoot, "run-b");
    const stdOut: string[] = [];
    const stdErr: string[] = [];

    expect(
      await runCli(
        ["migrate", fixturePath("migrate-e2e"), "--out", outputA, "--gate"],
        stdOut.push.bind(stdOut),
        stdErr.push.bind(stdErr)
      )
    ).toBe(0);
    expect(await runCli(["gate", outputA], () => undefined, stdErr.push.bind(stdErr))).toBe(0);
    const gateJsonA = await readFile(path.join(outputA, "readiness-gate.json"), "utf-8");
    const gateMarkdownA = await readFile(path.join(outputA, "readiness-gate.md"), "utf-8");

    expect(
      await runCli(
        ["migrate", fixturePath("migrate-e2e"), "--out", outputB, "--gate"],
        () => undefined,
        stdErr.push.bind(stdErr)
      )
    ).toBe(0);
    expect(await runCli(["gate", outputB], () => undefined, stdErr.push.bind(stdErr))).toBe(0);
    const gateJsonB = await readFile(path.join(outputB, "readiness-gate.json"), "utf-8");
    const gateMarkdownB = await readFile(path.join(outputB, "readiness-gate.md"), "utf-8");

    expect(gateJsonA).toBe(gateJsonB);
    expect(gateMarkdownA).toBe(gateMarkdownB);
    expect(await readFile(path.join(outputA, "readiness-gate.json"), "utf-8")).toContain(
      "\"status\""
    );
    expect(await readFile(path.join(outputA, "readiness-gate.md"), "utf-8")).toContain(
      "## Recommended next action"
    );
    expect(JSON.parse(stdOut[0]) as { gate: boolean }).toEqual(
      expect.objectContaining({ gate: true })
    );
    expect(stdErr).toEqual([]);

    await rm(tempRoot, { recursive: true, force: true });
  });

  it("accepts --allow-critical-unsupported override", async () => {
    const tempRoot = await createTempDirectory();
    const outputFolder = path.join(tempRoot, "gate-allow-critical");

    expect(await runCli(["analyse", fixturePath("minimal-valid"), "--out", outputFolder], () => undefined, () => undefined)).toBe(0);
    await writeMinimalGenerationPlan(outputFolder);
    const irPath = path.join(outputFolder, "ir.json");
    const ir = JSON.parse(await readFile(irPath, "utf-8")) as {
      unsupportedFeatures: unknown[];
    };
    ir.unsupportedFeatures = [
      ...ir.unsupportedFeatures,
      createUnsupportedFeature({
        featureType: "critical.synthetic.feature",
        sourceLocation: "synthetic/source",
        reason: "Critical unsupported synthetic feature.",
        suggestedRemediation: "Manual redesign required.",
        severity: "critical",
        confidence: 0.9,
        provenance: {
          sourcePath: "synthetic/source",
          sourceType: "unknown"
        }
      })
    ];
    await writeFile(irPath, `${JSON.stringify(ir, null, 2)}\n`, "utf-8");

    expect(
      await runCli(
        [
          "gate",
          outputFolder,
          "--allow-critical-unsupported",
          "--max-risk",
          "100",
          "--max-complexity",
          "100",
          "--min-confidence",
          "0"
        ],
        () => undefined,
        () => undefined
      )
    ).toBe(0);
    const gate = await parseReadinessGate(outputFolder);
    expect(gate.thresholds.allowCriticalUnsupported).toBe(true);
    expect(gate.status).toBe("pass");

    await rm(tempRoot, { recursive: true, force: true });
  });

  it("returns structured error for missing output folder input", async () => {
    const stdOut: string[] = [];
    const stdErr: string[] = [];
    expect(
      await runCli(
        ["gate", "/tmp/power-exit-gate-missing-folder"],
        stdOut.push.bind(stdOut),
        stdErr.push.bind(stdErr)
      )
    ).toBe(1);
    expect(stdOut).toEqual([]);
    expect(stdErr[0]).toContain('"code":"INPUT_FOLDER_NOT_FOUND"');
  });
});

