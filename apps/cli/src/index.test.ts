import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { validatePowerPlatformIR } from "@power-exit/ir";

import { runCli } from "./index";

const createTempDirectory = async (): Promise<string> =>
  mkdtemp(path.join(os.tmpdir(), "power-exit-cli-"));

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
});
