import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  createEmptyPowerPlatformIR,
  type CanvasApp,
  type CanvasControl,
  type CanvasFormula,
  type CanvasMigrationReadiness,
  type CanvasScreen,
  type CanvasLayoutMode,
  type CanvasResponsiveHint,
  type PowerPlatformIR
} from "@power-exit/ir";

import {
  generateCanvasReactArtifacts,
  generateCanvasReactFromPowerPlatformIR
} from "./index";

interface ReactFixtureFormula {
  propertyName: string;
  rawExpression: string;
}

interface ReactFixtureControl {
  controlName: string;
  controlType: string;
  role: CanvasControl["role"];
  layoutMode: CanvasLayoutMode;
  responsiveHint: CanvasResponsiveHint;
  parent?: string;
  migrationReadiness?: CanvasMigrationReadiness;
  layoutProperties?: Record<string, unknown>;
  properties?: Record<string, unknown>;
  formulas?: ReactFixtureFormula[];
}

interface ReactFixtureScreen {
  screenName: string;
  migrationReadiness: CanvasMigrationReadiness;
  layoutMode: CanvasLayoutMode;
  controls: ReactFixtureControl[];
  formulas?: ReactFixtureFormula[];
}

interface ReactFixtureApp {
  appName: string;
  appId: string;
  migrationReadiness?: CanvasMigrationReadiness;
  screens: ReactFixtureScreen[];
  formulas?: ReactFixtureFormula[];
}

interface ReactFixtureCase {
  apps: ReactFixtureApp[];
}

type ReactFixtureCatalog = Record<string, ReactFixtureCase>;

const fixtureFile = path.resolve(
  process.cwd(),
  "packages/fixtures/samples/generators/react/canvas-react-cases.json"
);

const slugify = (value: string): string => {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return slug.length > 0 ? slug : "item";
};

const inferFeatures = (expression: string): CanvasFormula["formulaFeatures"] => {
  const features: CanvasFormula["formulaFeatures"] = [];
  const checks: Array<{ token: string; feature: CanvasFormula["formulaFeatures"][number] }> = [
    { token: "navigate(", feature: "navigate" },
    { token: "patch(", feature: "patch" },
    { token: "submitform(", feature: "submitForm" },
    { token: "collect(", feature: "collect" },
    { token: "clearcollect(", feature: "clearCollect" },
    { token: "set(", feature: "set" },
    { token: "updatecontext(", feature: "updateContext" }
  ];
  const normalized = expression.toLowerCase();

  for (const check of checks) {
    if (normalized.includes(check.token)) {
      features.push(check.feature);
    }
  }

  return features.length > 0 ? features : ["unknown"];
};

const inferComplexity = (
  expression: string
): { score: number; complexity: CanvasFormula["complexity"] } => {
  if (expression.includes("Patch(") || expression.includes("Collect(")) {
    return {
      score: 0.85,
      complexity: "complex"
    };
  }

  if (expression.includes("Set(") || expression.includes("UpdateContext(")) {
    return {
      score: 0.5,
      complexity: "moderate"
    };
  }

  return {
    score: 0.2,
    complexity: "simple"
  };
};

const createFormula = (input: {
  appSlug: string;
  screenSlug: string;
  controlSlug?: string;
  formulaIndex: number;
  ownerArtifactId: string;
  ownerType: CanvasFormula["ownerType"];
  propertyName: string;
  rawExpression: string;
}): CanvasFormula => {
  const complexity = inferComplexity(input.rawExpression);
  return {
    artifactId: `canvasformula:${input.appSlug}:${input.screenSlug}${input.controlSlug ? `:${input.controlSlug}` : ""}:${input.formulaIndex}`,
    ownerArtifactId: input.ownerArtifactId,
    ownerType: input.ownerType,
    propertyName: input.propertyName,
    rawExpression: input.rawExpression,
    functionNames: [],
    likelyDataSources: [],
    likelyVariables: [],
    likelyCollections: [],
    formulaFeatures: inferFeatures(input.rawExpression),
    complexityScore: complexity.score,
    complexity: complexity.complexity,
    provenance: {
      sourcePath: `fixtures/${input.appSlug}/${input.screenSlug}.yaml`,
      sourceType: "canvas"
    },
    confidence: 0.9
  };
};

const buildCanvasApps = (fixtureCase: ReactFixtureCase): CanvasApp[] =>
  fixtureCase.apps.map((fixtureApp, appIndex) => {
    const appSlug = slugify(fixtureApp.appName);
    const appArtifactId = `canvasapp:${appSlug}:${appIndex}`;
    const appFormulaRecords = (fixtureApp.formulas ?? []).map((formula, formulaIndex) =>
      createFormula({
        appSlug,
        screenSlug: "app",
        formulaIndex,
        ownerArtifactId: appArtifactId,
        ownerType: "app",
        propertyName: formula.propertyName,
        rawExpression: formula.rawExpression
      })
    );

    const screens: CanvasScreen[] = fixtureApp.screens.map((fixtureScreen, screenIndex) => {
      const screenSlug = slugify(fixtureScreen.screenName);
      const screenArtifactId = `canvasscreen:${appSlug}:${screenSlug}:${screenIndex}`;
      const controlIdByName = new Map<string, string>();

      fixtureScreen.controls.forEach((control, controlIndex) => {
        controlIdByName.set(
          control.controlName,
          `canvascontrol:${appSlug}:${screenSlug}:${slugify(control.controlName)}:${controlIndex}`
        );
      });

      const controlRecords: CanvasControl[] = fixtureScreen.controls.map((control, controlIndex) => {
        const controlArtifactId =
          controlIdByName.get(control.controlName) ??
          `canvascontrol:${appSlug}:${screenSlug}:${slugify(control.controlName)}:${controlIndex}`;
        const formulas = (control.formulas ?? []).map((formula, formulaIndex) =>
          createFormula({
            appSlug,
            screenSlug,
            controlSlug: slugify(control.controlName),
            formulaIndex,
            ownerArtifactId: controlArtifactId,
            ownerType: "control",
            propertyName: formula.propertyName,
            rawExpression: formula.rawExpression
          })
        );

        return {
          artifactId: controlArtifactId,
          controlName: control.controlName,
          controlType: control.controlType,
          parentControl: control.parent ? controlIdByName.get(control.parent) : undefined,
          children: fixtureScreen.controls
            .filter((candidate) => candidate.parent === control.controlName)
            .map((child) => controlIdByName.get(child.controlName))
            .filter((childId): childId is string => Boolean(childId)),
          properties: control.properties ?? {},
          formulasByProperty: formulas.map((formula) => ({
            propertyName: formula.propertyName ?? "Unknown",
            formulaArtifactId: formula.artifactId
          })),
          formulas,
          layoutProperties: {
            X: control.layoutProperties?.X as number | string | undefined,
            Y: control.layoutProperties?.Y as number | string | undefined,
            Width: control.layoutProperties?.Width as number | string | undefined,
            Height: control.layoutProperties?.Height as number | string | undefined,
            Visible: control.layoutProperties?.Visible as boolean | string | undefined,
            DisplayMode: control.layoutProperties?.DisplayMode as string | undefined,
            Fill: control.layoutProperties?.Fill as string | undefined,
            Color: control.layoutProperties?.Color as string | undefined,
            Align: control.layoutProperties?.Align as string | undefined
          },
          normalizedLayout: {
            parentRelativePosition: {},
            inferredLayoutMode: control.layoutMode,
            responsiveHint: control.responsiveHint,
            rawLayoutProperties: {}
          },
          dataBindingHints: [],
          role: control.role,
          roleConfidence: 0.9,
          layoutComplexity: 0.4,
          formulaComplexity: formulas.length > 0 ? 0.6 : 0.1,
          dataBindingComplexity: 0.2,
          unsupportedFeatureCount: control.role === "unknown" || control.role === "customComponent" || control.role === "html" ? 1 : 0,
          migrationReadiness: control.migrationReadiness ?? fixtureScreen.migrationReadiness,
          provenance: {
            sourcePath: `fixtures/${appSlug}/${screenSlug}.yaml`,
            sourceType: "canvas"
          },
          confidence: 0.9
        };
      });

      const screenFormulas = (fixtureScreen.formulas ?? []).map((formula, formulaIndex) =>
        createFormula({
          appSlug,
          screenSlug,
          formulaIndex,
          ownerArtifactId: screenArtifactId,
          ownerType: "screen",
          propertyName: formula.propertyName,
          rawExpression: formula.rawExpression
        })
      );

      return {
        artifactId: screenArtifactId,
        screenName: fixtureScreen.screenName,
        sourceFile: `fixtures/${appSlug}/${screenSlug}.yaml`,
        controls: controlRecords,
        formulas: screenFormulas,
        layoutMetadata: {},
        order: screenIndex,
        layoutComplexity: fixtureScreen.layoutMode === "absolute" ? 0.7 : 0.4,
        formulaComplexity: screenFormulas.length > 0 ? 0.6 : 0.2,
        dataBindingComplexity: 0.2,
        unsupportedFeatureCount: controlRecords.reduce(
          (count, control) => count + control.unsupportedFeatureCount,
          0
        ),
        migrationReadiness: fixtureScreen.migrationReadiness,
        provenance: {
          sourcePath: `fixtures/${appSlug}/${screenSlug}.yaml`,
          sourceType: "canvas"
        },
        confidence: 0.9
      };
    });

    return {
      artifactId: appArtifactId,
      appId: fixtureApp.appId,
      appName: fixtureApp.appName,
      appProperties: {},
      screens,
      components: [],
      resources: [],
      dataSources: [],
      variables: [],
      collections: [],
      navigationReferences: [],
      formulas: appFormulaRecords,
      layoutComplexity: 0.4,
      formulaComplexity: appFormulaRecords.length > 0 ? 0.5 : 0.2,
      dataBindingComplexity: 0.2,
      unsupportedFeatureCount: screens.reduce((count, screen) => count + screen.unsupportedFeatureCount, 0),
      migrationReadiness: fixtureApp.migrationReadiness ?? "medium",
      unsupportedFeatures: [],
      warnings: [],
      provenance: {
        sourcePath: `fixtures/${appSlug}/app.yaml`,
        sourceType: "canvas"
      },
      confidence: 0.9
    };
  });

const loadFixtureCatalog = async (): Promise<ReactFixtureCatalog> =>
  JSON.parse(await readFile(fixtureFile, "utf-8")) as ReactFixtureCatalog;

const getArtifactContent = (
  result: Awaited<ReturnType<typeof generateCanvasReactArtifacts>>,
  filePath: string
): string => {
  const artifact = result.artifacts.find((item) => item.filePath === filePath);
  if (!artifact) {
    throw new Error(`Missing generated artifact ${filePath}.`);
  }

  return artifact.content;
};

describe("generateCanvasReactArtifacts", () => {
  it("produces deterministic React artifacts", async () => {
    const fixtures = await loadFixtureCatalog();
    const canvasApps = buildCanvasApps(fixtures.formulas);

    const first = await generateCanvasReactArtifacts(canvasApps);
    const second = await generateCanvasReactArtifacts(canvasApps);

    expect(first).toEqual(second);
  });

  it("generates app and screen routes for multiple screens", async () => {
    const fixtures = await loadFixtureCatalog();
    const canvasApps = buildCanvasApps(fixtures.multipleScreens);
    const result = await generateCanvasReactArtifacts(canvasApps);

    expect(result.artifacts.some((artifact) => artifact.filePath === "routing-app/app/page.tsx")).toBe(
      true
    );
    expect(
      result.artifacts.some((artifact) => artifact.filePath === "routing-app/app/settings-screen/page.tsx")
    ).toBe(true);
  });

  it("generates screen components with role-based control rendering", async () => {
    const fixtures = await loadFixtureCatalog();
    const canvasApps = buildCanvasApps(fixtures.galleryAndForm);
    const result = await generateCanvasReactArtifacts(canvasApps);
    const browse = getArtifactContent(
      result,
      "data-app/components/generated/browse-screen.tsx"
    );
    const edit = getArtifactContent(
      result,
      "data-app/components/generated/edit-screen.tsx"
    );

    expect(browse).toContain("<ul>");
    expect(edit).toContain("<form");
    expect(edit).toContain("data-card");
  });

  it("renders placeholders for unsupported and unknown controls", async () => {
    const fixtures = await loadFixtureCatalog();
    const canvasApps = buildCanvasApps(fixtures.unsupportedControls);
    const result = await generateCanvasReactArtifacts(canvasApps);
    const screen = getArtifactContent(
      result,
      "unsupported-controls-app/components/generated/unsupported-screen.tsx"
    );

    expect(screen).toContain("TODO: Unsupported Canvas control role \"html\"");
    expect(screen).toContain("TODO: Unsupported Canvas control role \"customComponent\"");
    expect(screen).toContain("TODO: Unsupported Canvas control role \"unknown\"");
  });

  it("preserves Power Fx formulas as TODO comments and handlers", async () => {
    const fixtures = await loadFixtureCatalog();
    const canvasApps = buildCanvasApps(fixtures.formulas);
    const result = await generateCanvasReactArtifacts(canvasApps);
    const screen = getArtifactContent(
      result,
      "formula-app/components/generated/formula-screen.tsx"
    );

    expect(screen).toContain("TODO: Convert Power Fx");
    expect(screen).toContain("Patch(Accounts, Defaults(Accounts), { Name: \"A\" })");
    expect(screen).toContain("function handleSaveButtonOnSelect");
  });

  it("applies normalized layout class hints", async () => {
    const fixtures = await loadFixtureCatalog();
    const canvasApps = buildCanvasApps(fixtures.nestedLayout);
    const result = await generateCanvasReactArtifacts(canvasApps);
    const screen = getArtifactContent(
      result,
      "nested-layout-app/components/generated/nested-screen.tsx"
    );

    expect(screen).toContain("layout-grid");
    expect(screen).toContain("layout-vertical-stack");
  });

  it("writes migration notes including readiness and formula guidance", async () => {
    const fixtures = await loadFixtureCatalog();
    const canvasApps = buildCanvasApps(fixtures.blockedAndLowReadiness);
    const result = await generateCanvasReactArtifacts(canvasApps);
    const notes = getArtifactContent(result, "migration-notes.md");

    expect(notes).toContain("Blocked Screen");
    expect(notes).toContain("manual conversion");
  });

  it("maps supported visual properties into inline style and safe attributes", async () => {
    const fixtures = await loadFixtureCatalog();
    const canvasApps = buildCanvasApps(fixtures.visualProperties);
    const result = await generateCanvasReactArtifacts(canvasApps);
    const screen = getArtifactContent(
      result,
      "visual-mapping-app/components/generated/visual-screen.tsx"
    );

    expect(screen).toContain("style={{");
    expect(screen).toContain("position: \"absolute\"");
    expect(screen).toContain("left: 24");
    expect(screen).toContain("top: 36");
    expect(screen).toContain("width: 240");
    expect(screen).toContain("height: 56");
    expect(screen).toContain("backgroundColor: \"#112233\"");
    expect(screen).toContain("color: \"#ffffff\"");
    expect(screen).toContain("borderColor: \"#445566\"");
    expect(screen).toContain("borderWidth: 2");
    expect(screen).toContain("borderRadius: 8");
    expect(screen).toContain("fontFamily: \"Segoe UI\"");
    expect(screen).toContain("fontWeight: \"bold\"");
    expect(screen).toContain("fontSize: 18");
    expect(screen).toContain("padding: 12");
    expect(screen).toContain("textAlign: \"center\"");
    expect(screen).toContain("disabled");
    expect(screen).toContain("Visible=false");
  });

  it("preserves formula-based visual properties as TODO comments and warnings", async () => {
    const fixtures = await loadFixtureCatalog();
    const canvasApps = buildCanvasApps(fixtures.visualProperties);
    const result = await generateCanvasReactArtifacts(canvasApps);
    const screen = getArtifactContent(
      result,
      "visual-mapping-app/components/generated/visual-screen.tsx"
    );

    expect(screen).toContain("TODO: Convert Canvas property formula for X");
    expect(screen).toContain("TODO: Convert Canvas property formula for Fill");
    expect(result.warnings.some((warning) => warning.code === "REACT_VISUAL_PROPERTY_FORMULA_TODO")).toBe(
      true
    );
    expect(
      result.warnings.some((warning) => warning.code === "REACT_VISUAL_PROPERTY_UNCERTAIN")
    ).toBe(true);
  });

  it("generates shared service scaffolds for react migration stubs", async () => {
    const fixtures = await loadFixtureCatalog();
    const canvasApps = buildCanvasApps(fixtures.formulaRefinement);
    const result = await generateCanvasReactArtifacts(canvasApps);

    expect(
      result.artifacts.some(
        (artifact) =>
          artifact.filePath ===
          "formula-refinement-app/lib/generated/services/dataService.ts"
      )
    ).toBe(true);
    expect(
      result.artifacts.some(
        (artifact) =>
          artifact.filePath ===
          "formula-refinement-app/lib/generated/services/navigationService.ts"
      )
    ).toBe(true);
    expect(
      result.artifacts.some(
        (artifact) =>
          artifact.filePath ===
          "formula-refinement-app/lib/generated/services/stateService.ts"
      )
    ).toBe(true);
    expect(
      result.artifacts.some(
        (artifact) =>
          artifact.filePath ===
          "formula-refinement-app/lib/generated/services/queryHelpers.ts"
      )
    ).toBe(true);
  });

  it("classifies formulas and emits typed handler stubs", async () => {
    const fixtures = await loadFixtureCatalog();
    const canvasApps = buildCanvasApps(fixtures.formulaRefinement);
    const result = await generateCanvasReactArtifacts(canvasApps);
    const screen = getArtifactContent(
      result,
      "formula-refinement-app/components/generated/refine-screen.tsx"
    );

    expect(result.output.formulasClassified).toBeGreaterThan(0);
    expect(result.output.stubsGenerated).toBeGreaterThan(0);
    expect(screen).toContain("dataService");
    expect(screen).toContain("navigationService");
    expect(screen).toContain("stateService");
    expect(screen).toContain("queryHelpers");
    expect(screen).toContain("async function handlePatchButtonOnSelect");
    expect(screen).toContain("navigationService.navigate(router");
    expect(screen).toContain("stateService.updateContext");
  });

  it("adds complexity and unsupported-function warnings for difficult formulas", async () => {
    const fixtures = await loadFixtureCatalog();
    const canvasApps = buildCanvasApps(fixtures.formulaRefinement);
    const result = await generateCanvasReactArtifacts(canvasApps);

    expect(
      result.warnings.some((warning) => warning.code === "REACT_FORMULA_COMPLEXITY_NESTED_LOGIC")
    ).toBe(true);
    expect(
      result.warnings.some((warning) => warning.code === "REACT_FORMULA_COMPLEXITY_PATCH_CHAIN")
    ).toBe(true);
    expect(
      result.warnings.some((warning) => warning.code === "REACT_FORMULA_COMPLEXITY_MULTI_SOURCE_COLLECT")
    ).toBe(true);
    expect(
      result.warnings.some((warning) => warning.code === "REACT_FORMULA_UNSUPPORTED_FUNCTION")
    ).toBe(true);
    expect(result.output.unsupportedFormulas).toBeGreaterThan(0);
    expect(result.output.manualConversionHotspots).toBeGreaterThan(0);
  });

  it("upgrades migration notes with formula and implementation hotspot guidance", async () => {
    const fixtures = await loadFixtureCatalog();
    const canvasApps = buildCanvasApps(fixtures.formulaRefinement);
    const result = await generateCanvasReactArtifacts(canvasApps);
    const notes = getArtifactContent(result, "migration-notes.md");

    expect(notes).toContain("Formula conversion summary");
    expect(notes).toContain("manual implementation hotspots");
    expect(notes).toContain("likely Azure API requirements");
    expect(notes).toContain("state-management complexity");
    expect(notes).toContain("recommended implementation strategy");
  });

  it("matches generated data service scaffold snapshot", async () => {
    const fixtures = await loadFixtureCatalog();
    const canvasApps = buildCanvasApps(fixtures.formulaRefinement);
    const result = await generateCanvasReactArtifacts(canvasApps);

    expect(
      getArtifactContent(
        result,
        "formula-refinement-app/lib/generated/services/dataService.ts"
      )
    ).toMatchSnapshot();
  });

  it("matches screen component snapshot output", async () => {
    const fixtures = await loadFixtureCatalog();
    const canvasApps = buildCanvasApps(fixtures.simpleScreen);
    const result = await generateCanvasReactArtifacts(canvasApps);

    expect(
      getArtifactContent(result, "simple-app/components/generated/home-screen.tsx")
    ).toMatchSnapshot();
  });
});

describe("generateCanvasReactFromPowerPlatformIR", () => {
  it("generates React artifacts from validated IR canvas apps", async () => {
    const fixtures = await loadFixtureCatalog();
    const canvasApps = buildCanvasApps(fixtures.simpleScreen);
    const ir = createEmptyPowerPlatformIR({
      solutionFolder: "fixtures/react"
    });
    const input: PowerPlatformIR = {
      ...ir,
      canvasApps
    };

    const result = await generateCanvasReactFromPowerPlatformIR(input);

    expect(result.artifacts.some((artifact) => artifact.filePath.endsWith("app/page.tsx"))).toBe(
      true
    );
    expect(result.artifacts.some((artifact) => artifact.filePath === "generation-report.md")).toBe(
      true
    );
    expect(result.artifacts.some((artifact) => artifact.filePath === "migration-notes.md")).toBe(
      true
    );
  });
});
