import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  createEmptyPowerPlatformIR,
  type CanvasApp,
  type CanvasFormula,
  type CloudFlow,
  type FlowAction,
  type FlowDependencyReference
} from "@power-exit/ir";

import {
  generateAzureFunctionsArtifacts,
  generateAzureFunctionsFromPowerPlatformIR
} from "./index";

interface FunctionFixtureFlowAction {
  actionName: string;
  actionType: string;
  connectorApi?: string;
  operationId?: string;
  scopeControl?: {
    isScope?: boolean;
    isCondition?: boolean;
    isLoop?: boolean;
  };
}

interface FunctionFixtureFlow {
  name: string;
  displayName: string;
  triggerClassification: CloudFlow["trigger"]["triggerClassification"];
  triggerType: string;
  recurrence?: {
    frequency?: string;
    interval?: number;
  };
  actions: FunctionFixtureFlowAction[];
  expressions: string[];
  dependencyReferences: Array<{
    referenceType: FlowDependencyReference["referenceType"];
    referenceName: string;
    resolved: boolean;
  }>;
}

interface FunctionFixtureFormula {
  owner: string;
  propertyName: string;
  rawExpression: string;
  likelyDataSources: string[];
}

interface FunctionFixtureCase {
  flows: FunctionFixtureFlow[];
  canvasFormulas: FunctionFixtureFormula[];
}

type FunctionFixtureCatalog = Record<string, FunctionFixtureCase>;

const fixtureFile = path.resolve(
  process.cwd(),
  "packages/fixtures/samples/generators/functions/azure-functions-cases.json"
);

const slugify = (value: string): string => {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return slug.length > 0 ? slug : "item";
};

const detectFormulaFeatures = (expression: string): CanvasFormula["formulaFeatures"] => {
  const normalized = expression.toLowerCase();
  if (normalized.includes("patch(")) {
    return ["patch"];
  }
  if (normalized.includes("submitform(")) {
    return ["submitForm"];
  }
  if (normalized.includes("collect(")) {
    return ["collect"];
  }
  if (normalized.includes("clearcollect(")) {
    return ["clearCollect"];
  }
  return ["unknown"];
};

const createFlowAction = (flowSlug: string, action: FunctionFixtureFlowAction, actionIndex: number): FlowAction => ({
  artifactId: `flowaction:${flowSlug}:${slugify(action.actionName)}:${actionIndex}`,
  actionName: action.actionName,
  actionType: action.actionType,
  connectorApi: action.connectorApi,
  connectorCategory: action.connectorApi ? "standard" : "unknown",
  operationId: action.operationId,
  runAfter: [],
  inputs: {},
  expressions: [],
  referencedEntities: action.connectorApi?.includes("commondataservice") ? ["account"] : [],
  referencedConnectionReferences: [],
  childActions: [],
  scopeControl: {
    isScope: action.scopeControl?.isScope ?? false,
    isCondition: action.scopeControl?.isCondition ?? false,
    isLoop: action.scopeControl?.isLoop ?? false,
    hasParallelBranches: false
  },
  provenance: {
    sourcePath: `fixtures/functions/${flowSlug}.json`,
    sourceType: "flow" as const
  },
  confidence: 0.9
});

const createCloudFlows = (fixtureCase: FunctionFixtureCase): CloudFlow[] =>
  fixtureCase.flows.map((flow, flowIndex) => {
    const flowSlug = slugify(flow.name);
    const actions = flow.actions.map((action, actionIndex) =>
      createFlowAction(flowSlug, action, actionIndex)
    );
    return {
      artifactId: `cloudflow:${flowSlug}:${flowIndex}`,
      flowId: `${flowSlug}-${flowIndex}`,
      name: flow.name,
      displayName: flow.displayName,
      trigger: {
        artifactId: `flowtrigger:${flowSlug}`,
        triggerName: `${flow.name}Trigger`,
        triggerType: flow.triggerType,
        triggerClassification: flow.triggerClassification,
        connectorApi: undefined,
        inputs: {},
        recurrence: flow.recurrence
          ? {
              frequency: flow.recurrence.frequency,
              interval: flow.recurrence.interval
            }
          : undefined,
        expressions: flow.expressions.map((expression, expressionIndex) => ({
          artifactId: `flowexpr:${flowSlug}:trigger:${expressionIndex}`,
          expressionName: `triggerExpression${expressionIndex + 1}`,
          rawExpression: expression,
          references: [],
          provenance: {
            sourcePath: `fixtures/functions/${flowSlug}.json`,
            sourceType: "flow" as const
          },
          confidence: 0.9
        })),
        provenance: {
          sourcePath: `fixtures/functions/${flowSlug}.json`,
          sourceType: "flow" as const
        },
        confidence: 0.9
      },
      actions,
      connections: [],
      variables: [],
      expressions: [],
      dependencyReferences: flow.dependencyReferences.map((reference, referenceIndex) => ({
        referenceType: reference.referenceType,
        referenceName: reference.referenceName,
        resolved: reference.resolved,
        provenance: {
          sourcePath: `fixtures/functions/${flowSlug}.json`,
          sourceType: "flow" as const
        },
        confidence: 0.8,
        artifactId: reference.resolved
          ? `ref:${flowSlug}:${reference.referenceType}:${referenceIndex}`
          : undefined
      })),
      warnings: [],
      unsupportedFeatures: [],
      triggerComplexity: 0.4,
      actionComplexity: 0.6,
      connectorComplexity: 0.4,
      expressionComplexity: 0.5,
      controlFlowComplexity: 0.6,
      unsupportedFeatureCount: 0,
      migrationReadiness: "medium",
      provenance: {
        sourcePath: `fixtures/functions/${flowSlug}.json`,
        sourceType: "flow" as const
      },
      confidence: 0.88
    };
  });

const createCanvasApps = (fixtureCase: FunctionFixtureCase): CanvasApp[] => {
  if (fixtureCase.canvasFormulas.length === 0) {
    return [];
  }

  const appSlug = "functions-formula-app";
  const controls = fixtureCase.canvasFormulas.map((formula, formulaIndex) => {
    const formulaArtifactId = `canvasformula:${appSlug}:${formulaIndex}`;
    return {
      artifactId: `canvascontrol:${appSlug}:${formulaIndex}`,
      controlName: `${formula.owner}-${formulaIndex}`,
      controlType: "Button",
      children: [],
      properties: {},
      formulasByProperty: [
        {
          propertyName: formula.propertyName,
          formulaArtifactId
        }
      ],
      formulas: [
        {
          artifactId: formulaArtifactId,
          ownerArtifactId: `canvascontrol:${appSlug}:${formulaIndex}`,
          ownerType: "control" as const,
          propertyName: formula.propertyName,
          rawExpression: formula.rawExpression,
          functionNames: [],
          likelyDataSources: formula.likelyDataSources,
          likelyVariables: [],
          likelyCollections: [],
          formulaFeatures: detectFormulaFeatures(formula.rawExpression),
          complexityScore: 0.7,
          complexity: "complex" as const,
          provenance: {
            sourcePath: "fixtures/functions/canvas-formulas.yaml",
            sourceType: "canvas" as const
          },
          confidence: 0.9
        }
      ],
      layoutProperties: {},
      normalizedLayout: {
        parentRelativePosition: {},
        inferredLayoutMode: "absolute" as const,
        responsiveHint: "fixed" as const,
        rawLayoutProperties: {}
      },
      dataBindingHints: [],
      role: "button" as const,
      roleConfidence: 0.9,
      layoutComplexity: 0.2,
      formulaComplexity: 0.8,
      dataBindingComplexity: 0.4,
      unsupportedFeatureCount: 0,
      migrationReadiness: "medium" as const,
      provenance: {
        sourcePath: "fixtures/functions/canvas-formulas.yaml",
        sourceType: "canvas" as const
      },
      confidence: 0.9
    };
  });

  return [
    {
      artifactId: `canvasapp:${appSlug}`,
      appId: appSlug,
      appName: "Functions Formula App",
      appProperties: {},
      screens: [
        {
          artifactId: `canvasscreen:${appSlug}:main`,
          screenName: "Main",
          sourceFile: "fixtures/functions/canvas-formulas.yaml",
          controls,
          formulas: [],
          layoutMetadata: {},
          layoutComplexity: 0.3,
          formulaComplexity: 0.8,
          dataBindingComplexity: 0.4,
          unsupportedFeatureCount: 0,
          migrationReadiness: "medium",
          provenance: {
            sourcePath: "fixtures/functions/canvas-formulas.yaml",
            sourceType: "canvas" as const
          },
          confidence: 0.9
        }
      ],
      components: [],
      resources: [],
      dataSources: [],
      variables: [],
      collections: [],
      navigationReferences: [],
      formulas: [],
      layoutComplexity: 0.3,
      formulaComplexity: 0.8,
      dataBindingComplexity: 0.4,
      unsupportedFeatureCount: 0,
      migrationReadiness: "medium",
      unsupportedFeatures: [],
      warnings: [],
      provenance: {
        sourcePath: "fixtures/functions/canvas-formulas.yaml",
        sourceType: "canvas" as const
      },
      confidence: 0.9
    }
  ];
};

const loadFixtureCatalog = async (): Promise<FunctionFixtureCatalog> =>
  JSON.parse(await readFile(fixtureFile, "utf-8")) as FunctionFixtureCatalog;

const getArtifactContent = (
  result: Awaited<ReturnType<typeof generateAzureFunctionsArtifacts>>,
  filePath: string
): string => {
  const artifact = result.artifacts.find((entry) => entry.filePath === filePath);
  if (!artifact) {
    throw new Error(`Missing generated artifact: ${filePath}`);
  }

  return artifact.content;
};

describe("generateAzureFunctionsArtifacts", () => {
  it("produces deterministic generated artifacts", async () => {
    const fixtures = await loadFixtureCatalog();
    const fixtureCase = fixtures.mixedFlowCanvasCase;
    const cloudFlows = createCloudFlows(fixtureCase);
    const canvasApps = createCanvasApps(fixtureCase);

    const first = await generateAzureFunctionsArtifacts({
      cloudFlows,
      canvasApps
    });
    const second = await generateAzureFunctionsArtifacts({
      cloudFlows,
      canvasApps
    });

    expect(first).toEqual(second);
  });

  it("generates HTTP-triggered function for manual flow", async () => {
    const fixtures = await loadFixtureCatalog();
    const result = await generateAzureFunctionsArtifacts({
      cloudFlows: createCloudFlows(fixtures.manualFlowHttp),
      canvasApps: []
    });

    const content = getArtifactContent(
      result,
      "src/functions/flow-manual-account-update.ts"
    );
    expect(content).toContain("app.http(");
    expect(content).toContain("Manual Account Update");
  });

  it("generates timer-triggered function for recurrence flow", async () => {
    const fixtures = await loadFixtureCatalog();
    const result = await generateAzureFunctionsArtifacts({
      cloudFlows: createCloudFlows(fixtures.recurrenceFlowTimer),
      canvasApps: []
    });

    const content = getArtifactContent(
      result,
      "src/functions/flow-nightly-data-sync.ts"
    );
    expect(content).toContain("app.timer(");
    expect(content).toContain("Timer");
  });

  it("creates placeholder comments for unsupported triggers", async () => {
    const fixtures = await loadFixtureCatalog();
    const result = await generateAzureFunctionsArtifacts({
      cloudFlows: createCloudFlows(fixtures.unsupportedTrigger),
      canvasApps: []
    });

    const content = getArtifactContent(
      result,
      "src/functions/flow-mailbox-intake.ts"
    );
    expect(content).toContain("TODO: map email trigger into queue/webhook ingestion pipeline.");
  });

  it("preserves action migration TODO mapping comments", async () => {
    const fixtures = await loadFixtureCatalog();
    const result = await generateAzureFunctionsArtifacts({
      cloudFlows: createCloudFlows(fixtures.manualFlowHttp),
      canvasApps: []
    });

    const content = getArtifactContent(
      result,
      "src/functions/flow-manual-account-update.ts"
    );
    expect(content).toContain("dataverseService");
    expect(content).toContain("httpClient");
    expect(content).toContain("manual workflow TODO");
    expect(content).toContain("condition TODO");
    expect(content).toContain("scope TODO");
    expect(content).toContain("loop TODO");
    expect(content).toContain("unsupported action");
    expect(content).toContain("@equals(triggerBody()");
  });

  it("generates Canvas Patch API stubs grouped by data source", async () => {
    const fixtures = await loadFixtureCatalog();
    const result = await generateAzureFunctionsArtifacts({
      cloudFlows: [],
      canvasApps: createCanvasApps(fixtures.canvasPatchFormula)
    });

    const content = getArtifactContent(
      result,
      "src/functions/canvas-accounts-api.ts"
    );
    expect(content).toContain("Patch");
    expect(content).toContain("dataverseService");
  });

  it("emits warnings for unresolved canvas formula data sources", async () => {
    const fixtures = await loadFixtureCatalog();
    const result = await generateAzureFunctionsArtifacts({
      cloudFlows: [],
      canvasApps: createCanvasApps(fixtures.unresolvedDataSourceFormula)
    });

    expect(
      result.warnings.some(
        (warning) => warning.code === "FUNCTIONS_CANVAS_UNRESOLVED_DATASOURCE"
      )
    ).toBe(true);
  });

  it("emits functions plan metadata for generation planning", async () => {
    const fixtures = await loadFixtureCatalog();
    const result = await generateAzureFunctionsArtifacts({
      cloudFlows: createCloudFlows(fixtures.mixedFlowCanvasCase),
      canvasApps: createCanvasApps(fixtures.mixedFlowCanvasCase)
    });

    expect(result.output.functionsPlan.plannedFunctions.length).toBeGreaterThan(0);
    expect(result.output.functionsPlan.unsupportedActions.length).toBeGreaterThanOrEqual(0);
    expect(result.output.functionsPlan.unresolvedDependencies.length).toBeGreaterThanOrEqual(0);
    expect(result.output.functionsPlan.manualReviewHotspots.length).toBeGreaterThanOrEqual(0);
  });

  it("matches generated flow function snapshot output", async () => {
    const fixtures = await loadFixtureCatalog();
    const result = await generateAzureFunctionsArtifacts({
      cloudFlows: createCloudFlows(fixtures.manualFlowHttp),
      canvasApps: []
    });

    expect(
      getArtifactContent(result, "src/functions/flow-manual-account-update.ts")
    ).toMatchSnapshot();
  });
});

describe("generateAzureFunctionsFromPowerPlatformIR", () => {
  it("generates scaffold artifacts from validated PowerPlatformIR", async () => {
    const fixtures = await loadFixtureCatalog();
    const fixtureCase = fixtures.mixedFlowCanvasCase;
    const ir = createEmptyPowerPlatformIR({
      solutionFolder: "fixtures/functions"
    });
    const input = {
      ...ir,
      cloudFlows: createCloudFlows(fixtureCase),
      canvasApps: createCanvasApps(fixtureCase)
    };

    const result = await generateAzureFunctionsFromPowerPlatformIR(input);

    expect(result.artifacts.some((artifact) => artifact.filePath === "host.json")).toBe(true);
    expect(result.artifacts.some((artifact) => artifact.filePath === "generation-report.md")).toBe(
      true
    );
  });
});
