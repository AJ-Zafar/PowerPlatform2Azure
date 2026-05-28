import path from "node:path";

import { describe, expect, it } from "vitest";

import { parseCanvasApps } from "./canvas";
import { discoverSolutionFiles } from "./solution-discovery";

const solutionFixturePath = (fixtureName: string): string =>
  path.resolve(process.cwd(), "packages/fixtures/samples/solutions", fixtureName);

describe("parseCanvasApps", () => {
  it("extracts screens, controls, formulas, and references from canvas sources", async () => {
    const fixturePath = solutionFixturePath("canvas-heavy");
    const discovery = await discoverSolutionFiles(fixturePath);
    const result = await parseCanvasApps(fixturePath, discovery.data);

    expect(result.data.length).toBeGreaterThanOrEqual(8);
    expect(result.data.some((app) => app.screens.length > 1)).toBe(true);
    expect(
      result.data.some((app) =>
        app.screens.some((screen) =>
          screen.controls.some((control) => control.parentControl)
        )
      )
    ).toBe(true);
    expect(
      result.data.some((app) =>
        app.formulas.some((formula) => formula.formulaFeatures.includes("navigate"))
      )
    ).toBe(true);
    expect(
      result.data.some((app) =>
        app.formulas.some((formula) => formula.formulaFeatures.includes("patch"))
      )
    ).toBe(true);
    expect(
      result.data.some((app) =>
        app.formulas.some((formula) => formula.formulaFeatures.includes("clearCollect"))
      )
    ).toBe(true);
    expect(
      result.data.some((app) => app.variables.some((variable) => variable.name === "appMode"))
    ).toBe(true);
    expect(
      result.data.some((app) =>
        app.screens.some((screen) =>
          screen.controls.some(
            (control) => (control as unknown as { role?: string }).role === "button"
          )
        )
      )
    ).toBe(true);
    expect(
      result.data.some((app) =>
        app.screens.some((screen) =>
          screen.controls.some(
            (control) =>
              (control as unknown as { normalizedLayout?: { inferredLayoutMode?: string } })
                .normalizedLayout?.inferredLayoutMode === "absolute"
          )
        )
      )
    ).toBe(true);
    expect(
      result.data.some((app) =>
        app.screens.some((screen) =>
          screen.controls.some(
            (control) =>
              (control as unknown as { normalizedLayout?: { inferredLayoutMode?: string } })
                .normalizedLayout?.inferredLayoutMode === "verticalStack"
          )
        )
      )
    ).toBe(true);
    expect(
      result.data.some((app) =>
        app.screens.some((screen) =>
          screen.controls.some(
            (control) =>
              (control as unknown as { normalizedLayout?: { inferredLayoutMode?: string } })
                .normalizedLayout?.inferredLayoutMode === "horizontalStack"
          )
        )
      )
    ).toBe(true);
  });

  it("warns and continues for malformed canvas source files", async () => {
    const fixturePath = solutionFixturePath("canvas-malformed");
    const discovery = await discoverSolutionFiles(fixturePath);
    const result = await parseCanvasApps(fixturePath, discovery.data);

    expect(result.data).toHaveLength(1);
    expect(result.warnings.some((warning) => warning.code === "CANVAS_SOURCE_MALFORMED")).toBe(
      true
    );
  });

  it("preserves unknown control types as unsupported features", async () => {
    const fixturePath = solutionFixturePath("canvas-unknown-types");
    const discovery = await discoverSolutionFiles(fixturePath);
    const result = await parseCanvasApps(fixturePath, discovery.data);

    expect(
      result.unsupported.some((feature) =>
        feature.featureType.startsWith("canvas.control-type.quantumwidget")
      )
    ).toBe(true);
    expect(
      result.warnings.some((warning) => warning.code === "CANVAS_UNKNOWN_CONTROL_TYPE")
    ).toBe(true);
  });

  it("produces deterministic canvas output ordering", async () => {
    const fixturePath = solutionFixturePath("canvas-heavy");
    const discovery = await discoverSolutionFiles(fixturePath);
    const resultA = await parseCanvasApps(fixturePath, discovery.data);
    const resultB = await parseCanvasApps(fixturePath, discovery.data);

    expect(JSON.stringify(resultA.data)).toBe(JSON.stringify(resultB.data));
  });

  it("adds readiness metadata and migration readiness states", async () => {
    const fixturePath = solutionFixturePath("canvas-heavy");
    const discovery = await discoverSolutionFiles(fixturePath);
    const result = await parseCanvasApps(fixturePath, discovery.data);

    expect(
      result.data.some(
        (app) =>
          Boolean((app as unknown as { migrationReadiness?: string }).migrationReadiness) &&
          Boolean(
            (app as unknown as { layoutComplexity?: number }).layoutComplexity !== undefined
          )
      )
    ).toBe(true);
    expect(
      result.data.some((app) =>
        app.screens.some(
          (screen) =>
            Boolean((screen as unknown as { migrationReadiness?: string }).migrationReadiness) &&
            Boolean(
              (screen as unknown as { formulaComplexity?: number }).formulaComplexity !==
                undefined
            )
        )
      )
    ).toBe(true);
    expect(
      result.data.some((app) =>
        app.screens.some((screen) =>
          screen.controls.some((control) =>
            Boolean((control as unknown as { migrationReadiness?: string }).migrationReadiness)
          )
        )
      )
    ).toBe(true);
  });

  it("emits readiness warnings for layout risk and html/custom usage", async () => {
    const fixturePath = solutionFixturePath("canvas-heavy");
    const discovery = await discoverSolutionFiles(fixturePath);
    const result = await parseCanvasApps(fixturePath, discovery.data);

    expect(
      result.warnings.some((warning) => warning.code === "CANVAS_LAYOUT_ABSOLUTE_HEAVY")
    ).toBe(true);
    expect(result.warnings.some((warning) => warning.code === "CANVAS_HTML_TEXT_USAGE")).toBe(
      true
    );
    expect(
      result.warnings.some((warning) => warning.code === "CANVAS_CUSTOM_COMPONENT_USAGE")
    ).toBe(true);
    expect(
      result.warnings.some((warning) => warning.code === "CANVAS_DEEPLY_NESTED_CONTROLS")
    ).toBe(true);
  });
});
