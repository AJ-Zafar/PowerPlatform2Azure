import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { clientPackSchema } from "./client-pack";
import { runCli } from "./index";

const createTempDirectory = async (): Promise<string> =>
  mkdtemp(path.join(os.tmpdir(), "power-exit-pack-cli-"));

const fileExists = async (filePath: string): Promise<boolean> => {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
};

const collectFileHashes = async (
  rootFolder: string,
  currentFolder = rootFolder
): Promise<Array<{ path: string; hash: string }>> => {
  const entries = await readdir(currentFolder, { withFileTypes: true });
  const files: Array<{ path: string; hash: string }> = [];

  for (const entry of entries) {
    const absolutePath = path.join(currentFolder, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFileHashes(rootFolder, absolutePath)));
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }

    const relativePath = path.relative(rootFolder, absolutePath).replaceAll(path.sep, "/");
    files.push({
      path: relativePath,
      hash: createHash("sha256")
        .update(await readFile(absolutePath, "utf-8"), "utf-8")
        .digest("hex")
    });
  }

  return files.sort((left, right) => left.path.localeCompare(right.path));
};

const fixturePath = (fixtureName: string): string =>
  path.resolve(process.cwd(), "packages/fixtures/samples/solutions", fixtureName);

describe("power-exit pack command", () => {
  it("generates a complete client pack from migrate output", async () => {
    const tempRoot = await createTempDirectory();
    const migrateOutput = path.join(tempRoot, "migrate-out");
    const packOutput = path.join(tempRoot, "client-pack");

    expect(
      await runCli(
        ["migrate", fixturePath("migrate-e2e"), "--out", migrateOutput, "--gate"],
        () => undefined,
        () => undefined
      )
    ).toBe(0);
    expect(
      await runCli(["pack", migrateOutput, "--out", packOutput], () => undefined, () => undefined)
    ).toBe(0);

    for (const expectedFile of [
      "executive-summary.md",
      "technical-findings.md",
      "migration-roadmap.md",
      "risk-register.md",
      "quick-wins.md",
      "unsupported-features.md",
      "manual-review-log.md",
      "generated-assets-index.md",
      "client-pack.json"
    ]) {
      expect(await fileExists(path.join(packOutput, expectedFile))).toBe(true);
    }

    await rm(tempRoot, { recursive: true, force: true });
  });

  it("works when optional gate files are missing", async () => {
    const tempRoot = await createTempDirectory();
    const analyseOutput = path.join(tempRoot, "analyse-out");
    const packOutput = path.join(tempRoot, "client-pack");

    expect(
      await runCli(
        ["analyse", fixturePath("minimal-valid"), "--out", analyseOutput],
        () => undefined,
        () => undefined
      )
    ).toBe(0);
    expect(
      await runCli(["pack", analyseOutput, "--out", packOutput], () => undefined, () => undefined)
    ).toBe(0);

    const packJson = JSON.parse(
      await readFile(path.join(packOutput, "client-pack.json"), "utf-8")
    ) as {
      optionalInputs: { readinessGateAvailable: boolean; generationPlanAvailable: boolean };
    };
    expect(packJson.optionalInputs.readinessGateAvailable).toBe(false);
    expect(packJson.optionalInputs.generationPlanAvailable).toBe(false);

    await rm(tempRoot, { recursive: true, force: true });
  });

  it("produces deterministic pack outputs", async () => {
    const tempRoot = await createTempDirectory();
    const migrateOutput = path.join(tempRoot, "migrate-out");
    const packOutputA = path.join(tempRoot, "client-pack-a");
    const packOutputB = path.join(tempRoot, "client-pack-b");

    expect(
      await runCli(
        ["migrate", fixturePath("migrate-e2e"), "--out", migrateOutput, "--gate"],
        () => undefined,
        () => undefined
      )
    ).toBe(0);
    expect(await runCli(["pack", migrateOutput, "--out", packOutputA], () => undefined, () => undefined)).toBe(0);
    expect(await runCli(["pack", migrateOutput, "--out", packOutputB], () => undefined, () => undefined)).toBe(0);

    expect(await collectFileHashes(packOutputA)).toEqual(await collectFileHashes(packOutputB));

    await rm(tempRoot, { recursive: true, force: true });
  });

  it("writes executive summary with required board-facing content", async () => {
    const tempRoot = await createTempDirectory();
    const migrateOutput = path.join(tempRoot, "migrate-out");
    const packOutput = path.join(tempRoot, "client-pack");

    expect(
      await runCli(
        ["migrate", fixturePath("migrate-e2e"), "--out", migrateOutput, "--gate"],
        () => undefined,
        () => undefined
      )
    ).toBe(0);
    expect(await runCli(["pack", migrateOutput, "--out", packOutput], () => undefined, () => undefined)).toBe(0);

    const executiveSummary = await readFile(path.join(packOutput, "executive-summary.md"), "utf-8");
    expect(executiveSummary).toContain("## What was scanned");
    expect(executiveSummary).toContain("## Overall readiness snapshot");
    expect(executiveSummary).toContain("## Key blockers");
    expect(executiveSummary).toContain("## Top quick wins");
    expect(executiveSummary).toContain("## High-level recommendation");
    expect(executiveSummary).toContain("## Suggested next decision");

    await rm(tempRoot, { recursive: true, force: true });
  });

  it("writes migration roadmap with wave structure and required fields", async () => {
    const tempRoot = await createTempDirectory();
    const migrateOutput = path.join(tempRoot, "migrate-out");
    const packOutput = path.join(tempRoot, "client-pack");

    expect(
      await runCli(
        ["migrate", fixturePath("migrate-e2e"), "--out", migrateOutput, "--gate"],
        () => undefined,
        () => undefined
      )
    ).toBe(0);
    expect(await runCli(["pack", migrateOutput, "--out", packOutput], () => undefined, () => undefined)).toBe(0);

    const roadmap = await readFile(path.join(packOutput, "migration-roadmap.md"), "utf-8");
    expect(roadmap).toContain("## Wave 0 discovery/remediation");
    expect(roadmap).toContain("## Wave 1 Dataverse/schema");
    expect(roadmap).toContain("## Wave 2 simple Canvas/Flow");
    expect(roadmap).toContain("## Wave 3 complex Canvas/Flow");
    expect(roadmap).toContain("## Wave 4 manual architecture decisions");
    expect(roadmap).toContain("- objective:");
    expect(roadmap).toContain("- candidate artefacts:");
    expect(roadmap).toContain("- risks:");
    expect(roadmap).toContain("- prerequisites:");
    expect(roadmap).toContain("- suggested engineering outputs:");

    await rm(tempRoot, { recursive: true, force: true });
  });

  it("writes risk register with deterministic risk fields", async () => {
    const tempRoot = await createTempDirectory();
    const migrateOutput = path.join(tempRoot, "migrate-out");
    const packOutput = path.join(tempRoot, "client-pack");

    expect(
      await runCli(
        ["migrate", fixturePath("migrate-e2e"), "--out", migrateOutput, "--gate"],
        () => undefined,
        () => undefined
      )
    ).toBe(0);
    expect(await runCli(["pack", migrateOutput, "--out", packOutput], () => undefined, () => undefined)).toBe(0);

    const riskRegister = await readFile(path.join(packOutput, "risk-register.md"), "utf-8");
    expect(riskRegister).toContain("| risk id | title | severity | likelihood | impact | affected artefacts | mitigation | owner placeholder | status placeholder |");
    expect(riskRegister).toContain("RISK-");
    expect(riskRegister).toContain("| TBD | Open |");

    await rm(tempRoot, { recursive: true, force: true });
  });

  it("writes generated assets index grouped by category and purpose", async () => {
    const tempRoot = await createTempDirectory();
    const migrateOutput = path.join(tempRoot, "migrate-out");
    const packOutput = path.join(tempRoot, "client-pack");

    expect(
      await runCli(
        ["migrate", fixturePath("migrate-e2e"), "--out", migrateOutput, "--gate"],
        () => undefined,
        () => undefined
      )
    ).toBe(0);
    expect(await runCli(["pack", migrateOutput, "--out", packOutput], () => undefined, () => undefined)).toBe(0);

    const index = await readFile(path.join(packOutput, "generated-assets-index.md"), "utf-8");
    expect(index).toContain("## SQL outputs");
    expect(index).toContain("## React outputs");
    expect(index).toContain("## Functions outputs");
    expect(index).toContain("## Infra outputs");
    expect(index).toContain("## reports");
    expect(index).toContain("## plans");
    expect(index).toContain("## gate files");
    expect(index).toContain("`sql/schema.sql`");
    expect(index).toContain("`generation-plan.json`");

    await rm(tempRoot, { recursive: true, force: true });
  });

  it("emits client-pack.json matching schema", async () => {
    const tempRoot = await createTempDirectory();
    const migrateOutput = path.join(tempRoot, "migrate-out");
    const packOutput = path.join(tempRoot, "client-pack");

    expect(
      await runCli(
        ["migrate", fixturePath("migrate-e2e"), "--out", migrateOutput, "--gate"],
        () => undefined,
        () => undefined
      )
    ).toBe(0);
    expect(await runCli(["pack", migrateOutput, "--out", packOutput], () => undefined, () => undefined)).toBe(0);

    const packJsonPayload = JSON.parse(
      await readFile(path.join(packOutput, "client-pack.json"), "utf-8")
    ) as unknown;
    expect(() => clientPackSchema.parse(packJsonPayload)).not.toThrow();

    await rm(tempRoot, { recursive: true, force: true });
  });

  it("matches snapshots for executive summary and client-pack manifest", async () => {
    const tempRoot = await createTempDirectory();
    const migrateOutput = path.join(tempRoot, "migrate-out");
    const packOutput = path.join(tempRoot, "client-pack");

    expect(
      await runCli(
        ["migrate", fixturePath("migrate-e2e"), "--out", migrateOutput, "--gate"],
        () => undefined,
        () => undefined
      )
    ).toBe(0);
    expect(await runCli(["pack", migrateOutput, "--out", packOutput], () => undefined, () => undefined)).toBe(0);

    expect(await readFile(path.join(packOutput, "executive-summary.md"), "utf-8")).toMatchSnapshot();
    const packManifest = JSON.parse(
      await readFile(path.join(packOutput, "client-pack.json"), "utf-8")
    ) as {
      sourceOutputFolder: string;
    };
    packManifest.sourceOutputFolder = "<normalized-source-output-folder>";
    expect(`${JSON.stringify(packManifest)}\n`).toMatchSnapshot();

    await rm(tempRoot, { recursive: true, force: true });
  });
});

