import { z } from "zod";

import {
  sortByStableKey,
  validatePowerPlatformIR,
  type CanvasApp,
  type CanvasFormula,
  type CloudFlow,
  type FlowAction
} from "@power-exit/ir";

import {
  createGenerationResultSchema,
  functionsGenerationPlanDetailsSchema,
  type FunctionsGenerationPlanDetails,
  type FunctionsManualReviewHotspot,
  type FunctionsPlannedFunction,
  type FunctionsUnresolvedDependency,
  type FunctionsUnsupportedAction,
  type GeneratedArtifact,
  type GenerationResult,
  type GenerationUnsupportedFeature,
  type GenerationWarning,
  type GeneratorContext
} from "./contracts";

const azureFunctionsGenerationOutputSchema = z
  .object({
    functionsGenerated: z.number().int().nonnegative(),
    flowFunctionsGenerated: z.number().int().nonnegative(),
    canvasApiFunctionsGenerated: z.number().int().nonnegative(),
    flowsProcessed: z.number().int().nonnegative(),
    formulasProcessed: z.number().int().nonnegative(),
    unsupportedActions: z.number().int().nonnegative(),
    unresolvedDependencies: z.number().int().nonnegative(),
    manualReviewHotspots: z.number().int().nonnegative(),
    functionsPlan: functionsGenerationPlanDetailsSchema
  })
  .strict();

export type AzureFunctionsGenerationOutput = z.infer<typeof azureFunctionsGenerationOutputSchema>;

export interface AzureFunctionsGeneratorInput {
  cloudFlows: CloudFlow[];
  canvasApps: CanvasApp[];
}

type FlowFunctionTriggerType =
  | "http"
  | "timer"
  | "dataverse-webhook-todo"
  | "email-queue-webhook-todo"
  | "unknown-trigger-todo";

interface CanvasFormulaRecord {
  appName: string;
  screenName: string;
  controlName: string | null;
  formula: CanvasFormula;
}

interface CanvasFormulaOperationRecord {
  record: CanvasFormulaRecord;
  operation: string;
  dataSource: string | null;
}

const defaultContext = (): GeneratorContext => ({
  invocationProvenance: {
    sourcePath: "generators/functions",
    sourceType: "generator"
  }
});

const slugify = (value: string): string => {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return slug.length > 0 ? slug : "item";
};

const toPascalCase = (value: string): string => {
  const words = value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0);
  if (words.length === 0) {
    return "Generated";
  }

  return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join("");
};

const createWarning = (
  input: Omit<GenerationWarning, "severity" | "confidence">
): GenerationWarning => ({
  severity: "warning",
  confidence: 0.85,
  ...input
});

const createUnsupportedFeature = (
  input: Omit<GenerationUnsupportedFeature, "confidence">
): GenerationUnsupportedFeature => ({
  confidence: 0.9,
  ...input
});

const mapFlowTriggerType = (flow: CloudFlow): FlowFunctionTriggerType => {
  const classification = flow.trigger.triggerClassification;
  if (classification === "manual" || classification === "http") {
    return "http";
  }
  if (classification === "recurrence") {
    return "timer";
  }
  if (classification === "dataverse") {
    return "dataverse-webhook-todo";
  }
  if (classification === "email") {
    return "email-queue-webhook-todo";
  }

  return "unknown-trigger-todo";
};

const isDataverseAction = (action: FlowAction): boolean => {
  const connector = action.connectorApi?.toLowerCase() ?? "";
  const actionType = action.actionType.toLowerCase();
  return connector.includes("commondataservice") || connector.includes("dataverse") || actionType.includes("dataverse");
};

const isHttpAction = (action: FlowAction): boolean => {
  const connector = action.connectorApi?.toLowerCase() ?? "";
  const actionType = action.actionType.toLowerCase();
  return connector.includes("http") || actionType.includes("http");
};

const isApprovalAction = (action: FlowAction): boolean => {
  const connector = action.connectorApi?.toLowerCase() ?? "";
  const actionType = action.actionType.toLowerCase();
  return connector.includes("approval") || actionType.includes("approval") || actionType.includes("human");
};

const structuredFlowActionTodo = (
  flow: CloudFlow,
  action: FlowAction,
  unsupportedActions: FunctionsUnsupportedAction[],
  manualReviewHotspots: FunctionsManualReviewHotspot[],
  warnings: GenerationWarning[],
  unsupportedFeatures: GenerationUnsupportedFeature[],
  context: GeneratorContext
): string[] => {
  const lines: string[] = [];
  lines.push(
    `  // Flow action ${action.actionName} (${action.actionType}${action.connectorApi ? `, connector=${action.connectorApi}` : ""})`
  );
  action.expressions.forEach((expression) => {
    lines.push(`  // Action expression: ${expression.rawExpression.replace(/\*\//g, "* /")}`);
  });

  if (action.scopeControl.isCondition) {
    lines.push("  // TODO: condition TODO - map Power Automate condition branches into explicit TypeScript control flow.");
    manualReviewHotspots.push({
      message: `Condition action "${action.actionName}" requires manual branch mapping.`,
      severity: "medium",
      sourceArtifactIds: [flow.artifactId, action.artifactId]
    });
    return lines;
  }

  if (action.scopeControl.isScope) {
    lines.push("  // TODO: scope TODO - model scope boundaries, retries, and error handling explicitly.");
    manualReviewHotspots.push({
      message: `Scope action "${action.actionName}" requires manual scope orchestration.`,
      severity: "medium",
      sourceArtifactIds: [flow.artifactId, action.artifactId]
    });
    return lines;
  }

  if (action.scopeControl.isLoop) {
    lines.push("  // TODO: loop TODO - map loop cardinality, batching, and idempotency safeguards.");
    manualReviewHotspots.push({
      message: `Loop action "${action.actionName}" requires manual iteration strategy.`,
      severity: "high",
      sourceArtifactIds: [flow.artifactId, action.artifactId]
    });
    return lines;
  }

  if (isDataverseAction(action)) {
    lines.push(
      `  await dataverseService.todoDataverseAction("${flow.name}", "${action.actionName}", context);`
    );
    return lines;
  }

  if (isHttpAction(action)) {
    lines.push(
      `  await httpClient.todoHttpAction("${flow.name}", "${action.actionName}", context);`
    );
    return lines;
  }

  if (isApprovalAction(action)) {
    lines.push("  // TODO: manual workflow TODO - approval/human interaction requires manual orchestration.");
    manualReviewHotspots.push({
      message: `Approval action "${action.actionName}" requires human workflow redesign.`,
      severity: "high",
      sourceArtifactIds: [flow.artifactId, action.artifactId]
    });
    return lines;
  }

  if (action.connectorApi) {
    lines.push(
      `  // TODO: connector service TODO - map connector "${action.connectorApi}" operation "${action.operationId ?? "unknown"}".`
    );
    manualReviewHotspots.push({
      message: `Connector action "${action.actionName}" requires service adapter implementation.`,
      severity: "medium",
      sourceArtifactIds: [flow.artifactId, action.artifactId]
    });
    return lines;
  }

  lines.push(
    `  // TODO: unsupported action "${action.actionType}" - manual migration implementation required.`
  );
  unsupportedActions.push({
    flowName: flow.name,
    actionName: action.actionName,
    actionType: action.actionType,
    sourceArtifactId: action.artifactId
  });
  warnings.push(
    createWarning({
      code: "FUNCTIONS_UNSUPPORTED_ACTION",
      message: `Flow action "${flow.name}.${action.actionName}" with type "${action.actionType}" is unsupported in scaffold mapping.`,
      sourceArtifactIds: [flow.artifactId, action.artifactId],
      sourceLocation: action.provenance.sourcePath,
      provenance: context.invocationProvenance
    })
  );
  unsupportedFeatures.push(
    createUnsupportedFeature({
      featureType: "flow.action.unsupported-for-functions-scaffold",
      sourceLocation: action.provenance.sourcePath,
      reason: `Action "${action.actionName}" (${action.actionType}) has no deterministic scaffold mapping yet.`,
      suggestedRemediation:
        "Implement a typed service adapter or manual orchestration function before production migration.",
      severity: "medium",
      sourceArtifactIds: [flow.artifactId, action.artifactId],
      provenance: context.invocationProvenance
    })
  );

  return lines;
};

const createFlowFunctionArtifact = (input: {
  flow: CloudFlow;
  triggerType: FlowFunctionTriggerType;
  warnings: GenerationWarning[];
  unsupportedFeatures: GenerationUnsupportedFeature[];
  unsupportedActions: FunctionsUnsupportedAction[];
  manualReviewHotspots: FunctionsManualReviewHotspot[];
  context: GeneratorContext;
}): {
  artifact: GeneratedArtifact;
  plannedFunction: FunctionsPlannedFunction;
} => {
  const { flow, triggerType, warnings, unsupportedFeatures, unsupportedActions, manualReviewHotspots, context } =
    input;
  const actionLines = sortByStableKey(flow.actions, (action) => action.actionName)
    .map((action) =>
      structuredFlowActionTodo(
        flow,
        action,
        unsupportedActions,
        manualReviewHotspots,
        warnings,
        unsupportedFeatures,
        context
      ).join("\n")
    )
    .join("\n");
  const functionSlug = `flow-${slugify(flow.name)}`;
  const functionName = `flow${toPascalCase(flow.name)}`;
  const triggerExpressionComments =
    flow.trigger.expressions.length > 0
      ? flow.trigger.expressions
          .map((expression) => `// Trigger expression: ${expression.rawExpression.replace(/\*\//g, "* /")}`)
          .join("\n")
      : "// Trigger expressions: none";
  const triggerNote =
    triggerType === "dataverse-webhook-todo"
      ? "// TODO: map Dataverse trigger into webhook or event-grid pipeline."
      : triggerType === "email-queue-webhook-todo"
        ? "// TODO: map email trigger into queue/webhook ingestion pipeline."
        : triggerType === "unknown-trigger-todo"
          ? "// TODO: map unsupported trigger into a deterministic integration pattern."
          : "";

  const functionContent =
    triggerType === "timer"
      ? `import { app, InvocationContext, Timer } from "@azure/functions";
import { authContext } from "../services/authContext";
import { dataverseService } from "../services/dataverseService";
import { httpClient } from "../services/httpClient";
import { logger } from "../utils/logger";

export async function ${functionName}(timer: Timer, context: InvocationContext): Promise<void> {
  void timer;
  const principal = authContext.fromInvocation(context);
  logger.info("Executing flow scaffold", { flowName: "${flow.name}", principal });
${triggerExpressionComments}
${triggerNote ? `  ${triggerNote}\n` : ""}${actionLines || "  // No mapped actions found."}
}

app.timer("${functionName}", {
  schedule: "0 */5 * * * *",
  handler: ${functionName}
});
`
      : `import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { authContext } from "../services/authContext";
import { dataverseService } from "../services/dataverseService";
import { httpClient } from "../services/httpClient";
import { logger } from "../utils/logger";

export async function ${functionName}(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  void request;
  const principal = authContext.fromInvocation(context);
  logger.info("Executing flow scaffold", { flowName: "${flow.name}", principal });
${triggerExpressionComments}
${triggerNote ? `  ${triggerNote}\n` : ""}${actionLines || "  // No mapped actions found."}
  return {
    status: 202,
    jsonBody: {
      message: "Flow scaffold executed.",
      flowName: "${flow.name}"
    }
  };
}

app.http("${functionName}", {
  route: "${functionSlug}",
  methods: ["GET", "POST"],
  authLevel: "function",
  handler: ${functionName}
});
`;

  return {
    artifact: {
      artifactId: `generated:functions:${functionSlug}`,
      artifactType: "azure-function",
      filePath: `src/functions/${functionSlug}.ts`,
      content: functionContent,
      sourceArtifactIds: [
        flow.artifactId,
        flow.trigger.artifactId,
        ...flow.actions.map((action) => action.artifactId)
      ],
      warnings: [],
      provenance: context.invocationProvenance,
      confidence: 0.85
    },
    plannedFunction: {
      functionName,
      triggerType,
      sourceArtifactIds: [
        flow.artifactId,
        flow.trigger.artifactId,
        ...flow.actions.map((action) => action.artifactId)
      ],
      sourceFlowArtifactId: flow.artifactId,
      sourceActionArtifactIds: flow.actions.map((action) => action.artifactId),
      sourceFormulaArtifactIds: []
    }
  };
};

const canvasOperationNames = [
  "Patch",
  "SubmitForm",
  "Remove",
  "RemoveIf",
  "Collect",
  "ClearCollect",
  "LookUp",
  "Filter",
  "Search",
  "SortByColumns"
] as const;

const parseCanvasFormulaOperations = (formula: CanvasFormula): string[] =>
  canvasOperationNames.filter((operation) =>
    new RegExp(`\\b${operation}\\s*\\(`, "i").test(formula.rawExpression)
  );

const inferFormulaDataSource = (formula: CanvasFormula): string | null => {
  if (formula.likelyDataSources.length > 0) {
    return formula.likelyDataSources[0];
  }

  const match = formula.rawExpression.match(
    /\b(?:Patch|SubmitForm|Remove|RemoveIf|Collect|ClearCollect|LookUp|Filter|Search|SortByColumns)\s*\(\s*([A-Za-z_][A-Za-z0-9_]*)/i
  );
  return match?.[1] ?? null;
};

const collectCanvasFormulaRecords = (canvasApps: CanvasApp[]): CanvasFormulaRecord[] => {
  const records: CanvasFormulaRecord[] = [];
  sortByStableKey(canvasApps, (app) => app.appName).forEach((app) => {
    app.formulas.forEach((formula) => {
      records.push({
        appName: app.appName,
        screenName: "(app)",
        controlName: null,
        formula
      });
    });
    sortByStableKey(app.screens, (screen) => screen.screenName).forEach((screen) => {
      screen.formulas.forEach((formula) => {
        records.push({
          appName: app.appName,
          screenName: screen.screenName,
          controlName: null,
          formula
        });
      });
      sortByStableKey(screen.controls, (control) => control.controlName).forEach((control) => {
        control.formulas.forEach((formula) => {
          records.push({
            appName: app.appName,
            screenName: screen.screenName,
            controlName: control.controlName,
            formula
          });
        });
      });
    });
  });

  return records;
};

const createCanvasFunctionArtifacts = (input: {
  records: CanvasFormulaRecord[];
  warnings: GenerationWarning[];
  manualReviewHotspots: FunctionsManualReviewHotspot[];
  unresolvedDependencies: FunctionsUnresolvedDependency[];
  context: GeneratorContext;
}): Array<{ artifact: GeneratedArtifact; plannedFunction: FunctionsPlannedFunction }> => {
  const { records, warnings, manualReviewHotspots, unresolvedDependencies, context } = input;
  const operationRecords: CanvasFormulaOperationRecord[] = [];

  records.forEach((record) => {
    const operations = parseCanvasFormulaOperations(record.formula);
    operations.forEach((operation) => {
      const inferredDataSource = inferFormulaDataSource(record.formula);
      const resolvedDataSource =
        record.formula.likelyDataSources.length > 0 ? inferredDataSource : null;
      operationRecords.push({
        record,
        operation,
        dataSource: resolvedDataSource
      });
    });
  });

  const recordsByDataSource = new Map<string, CanvasFormulaOperationRecord[]>();
  operationRecords.forEach((operationRecord) => {
    if (!operationRecord.dataSource) {
      warnings.push(
        createWarning({
          code: "FUNCTIONS_CANVAS_UNRESOLVED_DATASOURCE",
          message: `Formula "${operationRecord.record.formula.artifactId}" has no resolvable data source for operation "${operationRecord.operation}".`,
          sourceArtifactIds: [operationRecord.record.formula.artifactId],
          sourceLocation: operationRecord.record.formula.provenance.sourcePath,
          provenance: context.invocationProvenance
        })
      );
      manualReviewHotspots.push({
        message: `Canvas formula ${operationRecord.record.formula.artifactId} requires manual data source binding.`,
        severity: "high",
        sourceArtifactIds: [operationRecord.record.formula.artifactId]
      });
      unresolvedDependencies.push({
        referenceType: "canvas-data-source",
        referenceName: `formula:${operationRecord.record.formula.artifactId}`,
        sourceArtifactId: operationRecord.record.formula.artifactId
      });
    }
    const key = operationRecord.dataSource ?? "manual-review";
    const current = recordsByDataSource.get(key) ?? [];
    current.push(operationRecord);
    recordsByDataSource.set(key, current);
  });

  return sortByStableKey(Array.from(recordsByDataSource.entries()), ([dataSource]) => dataSource).map(
    ([dataSource, dataSourceRecords]) => {
      const functionSlug = `canvas-${slugify(dataSource)}-api`;
      const functionName = `canvas${toPascalCase(dataSource)}Api`;
      const operationLines = sortByStableKey(
        dataSourceRecords,
        (entry) => `${entry.operation}:${entry.record.formula.artifactId}`
      )
        .map((entry) => {
          const formulaComment = entry.record.formula.rawExpression.replace(/\*\//g, "* /");
          const ownerLabel = `${entry.record.appName}/${entry.record.screenName}/${entry.record.controlName ?? "(screen)"}`;
          if (["Patch", "SubmitForm", "Remove", "RemoveIf"].includes(entry.operation)) {
            return `  // ${entry.operation} from ${ownerLabel}\n  // ${formulaComment}\n  await dataverseService.todoCanvasMutation("${dataSource}", "${entry.operation}", context);`;
          }
          if (["LookUp", "Filter", "Search", "SortByColumns"].includes(entry.operation)) {
            return `  // ${entry.operation} from ${ownerLabel}\n  // ${formulaComment}\n  await sqlService.todoCanvasQuery("${dataSource}", "${entry.operation}", context);`;
          }

          return `  // ${entry.operation} from ${ownerLabel}\n  // ${formulaComment}\n  // TODO: map collection operation "${entry.operation}" to stateful API pattern.`;
        })
        .join("\n");
      const content = `import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { dataverseService } from "../services/dataverseService";
import { sqlService } from "../services/sqlService";
import { validation } from "../services/validation";
import { logger } from "../utils/logger";

export async function ${functionName}(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  validation.ensureRequestShape(request);
  logger.info("Executing canvas API scaffold", { dataSource: "${dataSource}" });
${operationLines || "  // TODO: no operations mapped."}
  return {
    status: 202,
    jsonBody: {
      message: "Canvas API scaffold executed.",
      dataSource: "${dataSource}"
    }
  };
}

app.http("${functionName}", {
  route: "${functionSlug}",
  methods: ["POST"],
  authLevel: "function",
  handler: ${functionName}
});
`;

      const sourceFormulaArtifactIds = sortByStableKey(
        Array.from(new Set(dataSourceRecords.map((entry) => entry.record.formula.artifactId))),
        (value) => value
      );

      return {
        artifact: {
          artifactId: `generated:functions:${functionSlug}`,
          artifactType: "azure-function",
          filePath: `src/functions/${functionSlug}.ts`,
          content,
          sourceArtifactIds: sourceFormulaArtifactIds,
          warnings: [],
          provenance: context.invocationProvenance,
          confidence: 0.82
        },
        plannedFunction: {
          functionName,
          triggerType: "http-canvas-formula-api",
          sourceArtifactIds: sourceFormulaArtifactIds,
          sourceActionArtifactIds: [],
          sourceFormulaArtifactIds
        }
      };
    }
  );
};

const createScaffoldArtifacts = (
  sourceArtifactIds: string[],
  context: GeneratorContext
): GeneratedArtifact[] => {
  const packageJson = `{
  "name": "power-exit-functions-scaffold",
  "private": true,
  "version": "0.0.0",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "start": "func start",
    "test": "echo \\"TODO: add tests\\""
  },
  "dependencies": {
    "@azure/functions": "^4.5.0"
  },
  "devDependencies": {
    "typescript": "^5.8.3"
  }
}
`;
  const tsconfigJson = `{
  "compilerOptions": {
    "target": "ES2022",
    "module": "CommonJS",
    "moduleResolution": "Node",
    "strict": true,
    "outDir": "dist",
    "rootDir": "src",
    "esModuleInterop": true
  },
  "include": ["src/**/*.ts"]
}
`;
  const hostJson = `{
  "version": "2.0",
  "logging": {
    "applicationInsights": {
      "samplingSettings": {
        "isEnabled": true
      }
    }
  }
}
`;
  const localSettingsExample = `{
  "IsEncrypted": false,
  "Values": {
    "AzureWebJobsStorage": "UseDevelopmentStorage=true",
    "FUNCTIONS_WORKER_RUNTIME": "node",
    "POWER_EXIT_SQL_CONNECTION_STRING": "Server=TODO;Database=TODO;Authentication=Active Directory Default;",
    "POWER_EXIT_DATAVERSE_URL": "https://todo.crm.dynamics.com",
    "POWER_EXIT_CLIENT_ID": "TODO_CLIENT_ID"
  }
}
`;
  const readmeGenerated = `# Power Exit Azure Functions Scaffold

This scaffold is generated from Power Exit IR.

- No production business logic is included.
- No secrets are embedded.
- Replace TODO placeholders before deployment.
`;
  const dataverseService = `export const dataverseService = {
  async todoDataverseAction(flowName: string, actionName: string, context: unknown): Promise<void> {
    // TODO: implement Dataverse connector logic.
    void flowName;
    void actionName;
    void context;
  },
  async todoCanvasMutation(dataSource: string, operation: string, context: unknown): Promise<void> {
    // TODO: implement Canvas mutation API mapping.
    void dataSource;
    void operation;
    void context;
  }
};
`;
  const sqlService = `export const sqlService = {
  async todoCanvasQuery(dataSource: string, operation: string, context: unknown): Promise<void> {
    // TODO: implement SQL query mapping for Canvas formulas.
    void dataSource;
    void operation;
    void context;
  }
};
`;
  const httpClient = `export const httpClient = {
  async todoHttpAction(flowName: string, actionName: string, context: unknown): Promise<void> {
    // TODO: implement HTTP action adapter with retries and timeout policy.
    void flowName;
    void actionName;
    void context;
  }
};
`;
  const authContext = `export const authContext = {
  fromInvocation(context: unknown): Record<string, unknown> {
    // TODO: extract auth principal and tenant context from invocation.
    void context;
    return {};
  }
};
`;
  const validation = `export const validation = {
  ensureRequestShape(request: unknown): void {
    // TODO: validate payload contracts and required fields.
    void request;
  }
};
`;
  const logger = `export const logger = {
  info(message: string, metadata: Record<string, unknown> = {}): void {
    console.log(JSON.stringify({ level: "info", message, metadata }));
  },
  warn(message: string, metadata: Record<string, unknown> = {}): void {
    console.warn(JSON.stringify({ level: "warn", message, metadata }));
  },
  error(message: string, metadata: Record<string, unknown> = {}): void {
    console.error(JSON.stringify({ level: "error", message, metadata }));
  }
};
`;

  const scaffolds: Array<{ artifactId: string; artifactType: string; filePath: string; content: string }> = [
    { artifactId: "generated:functions:package-json", artifactType: "json-config", filePath: "package.json", content: packageJson },
    { artifactId: "generated:functions:tsconfig", artifactType: "json-config", filePath: "tsconfig.json", content: tsconfigJson },
    { artifactId: "generated:functions:host-json", artifactType: "json-config", filePath: "host.json", content: hostJson },
    {
      artifactId: "generated:functions:local-settings-example",
      artifactType: "json-config",
      filePath: "local.settings.example.json",
      content: localSettingsExample
    },
    {
      artifactId: "generated:functions:readme-generated",
      artifactType: "markdown-report",
      filePath: "README.generated.md",
      content: readmeGenerated
    },
    {
      artifactId: "generated:functions:service-dataverse",
      artifactType: "typescript-service",
      filePath: "src/services/dataverseService.ts",
      content: dataverseService
    },
    {
      artifactId: "generated:functions:service-sql",
      artifactType: "typescript-service",
      filePath: "src/services/sqlService.ts",
      content: sqlService
    },
    {
      artifactId: "generated:functions:service-http-client",
      artifactType: "typescript-service",
      filePath: "src/services/httpClient.ts",
      content: httpClient
    },
    {
      artifactId: "generated:functions:service-auth-context",
      artifactType: "typescript-service",
      filePath: "src/services/authContext.ts",
      content: authContext
    },
    {
      artifactId: "generated:functions:service-validation",
      artifactType: "typescript-service",
      filePath: "src/services/validation.ts",
      content: validation
    },
    {
      artifactId: "generated:functions:utils-logger",
      artifactType: "typescript-utility",
      filePath: "src/utils/logger.ts",
      content: logger
    }
  ];

  return sortByStableKey(scaffolds, (entry) => entry.filePath).map((entry) => ({
    artifactId: entry.artifactId,
    artifactType: entry.artifactType,
    filePath: entry.filePath,
    content: entry.content,
    sourceArtifactIds,
    warnings: [],
    provenance: context.invocationProvenance,
    confidence: 0.85
  }));
};

const buildGenerationReport = (output: AzureFunctionsGenerationOutput): string => {
  const lines: string[] = [];
  lines.push("# Power Exit Azure Functions Generation Report");
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- Flows processed: ${output.flowsProcessed}`);
  lines.push(`- Canvas formulas processed: ${output.formulasProcessed}`);
  lines.push(`- Flow functions generated: ${output.flowFunctionsGenerated}`);
  lines.push(`- Canvas API functions generated: ${output.canvasApiFunctionsGenerated}`);
  lines.push(`- Total functions generated: ${output.functionsGenerated}`);
  lines.push(`- Unsupported actions: ${output.unsupportedActions}`);
  lines.push(`- Unresolved dependencies: ${output.unresolvedDependencies}`);
  lines.push(`- Manual review hotspots: ${output.manualReviewHotspots}`);
  lines.push("");
  lines.push("Generated output is scaffold-only and requires manual implementation before production.");
  return `${lines.join("\n")}\n`;
};

const buildMigrationNotes = (
  functionsPlan: FunctionsGenerationPlanDetails,
  warnings: GenerationWarning[]
): string => {
  const lines: string[] = [];
  lines.push("# Azure Functions Migration Notes");
  lines.push("");
  lines.push("This scaffold preserves migration intent but omits production business logic.");
  lines.push("");
  lines.push("## Planned functions");
  lines.push("");
  if (functionsPlan.plannedFunctions.length === 0) {
    lines.push("- None.");
  } else {
    functionsPlan.plannedFunctions.forEach((plannedFunction) => {
      lines.push(
        `- ${plannedFunction.functionName} (trigger: ${plannedFunction.triggerType}, sourceIds: ${plannedFunction.sourceArtifactIds.length})`
      );
    });
  }
  lines.push("");
  lines.push("## Manual review hotspots");
  lines.push("");
  if (functionsPlan.manualReviewHotspots.length === 0) {
    lines.push("- None.");
  } else {
    functionsPlan.manualReviewHotspots.forEach((hotspot) => {
      lines.push(`- [${hotspot.severity}] ${hotspot.message}`);
    });
  }
  lines.push("");
  lines.push("## Unsupported actions");
  lines.push("");
  if (functionsPlan.unsupportedActions.length === 0) {
    lines.push("- None.");
  } else {
    functionsPlan.unsupportedActions.forEach((action) => {
      lines.push(`- ${action.flowName}.${action.actionName} (${action.actionType})`);
    });
  }
  lines.push("");
  lines.push("## Unresolved dependencies");
  lines.push("");
  if (functionsPlan.unresolvedDependencies.length === 0) {
    lines.push("- None.");
  } else {
    functionsPlan.unresolvedDependencies.forEach((dependency) => {
      lines.push(`- ${dependency.referenceType}:${dependency.referenceName}`);
    });
  }
  lines.push("");
  lines.push("## Generator warnings");
  lines.push("");
  if (warnings.length === 0) {
    lines.push("- None.");
  } else {
    sortByStableKey(warnings, (warning) => `${warning.code}:${warning.message}`).forEach((warning) => {
      lines.push(`- [${warning.code}] ${warning.message}`);
    });
  }
  lines.push("");
  lines.push("No secrets are embedded. Configure runtime settings manually in local.settings.json.");
  return `${lines.join("\n")}\n`;
};

const confidenceFromIssues = (warningCount: number, unsupportedCount: number): number =>
  Math.max(0, Math.min(1, 1 - warningCount * 0.01 - unsupportedCount * 0.03));

export const generateAzureFunctionsArtifacts = async (
  input: AzureFunctionsGeneratorInput,
  contextInput?: GeneratorContext
): Promise<GenerationResult<AzureFunctionsGenerationOutput>> => {
  const context = contextInput ?? defaultContext();
  const warnings: GenerationWarning[] = [];
  const unsupportedFeatures: GenerationUnsupportedFeature[] = [];
  const unsupportedActions: FunctionsUnsupportedAction[] = [];
  const unresolvedDependencies: FunctionsUnresolvedDependency[] = [];
  const manualReviewHotspots: FunctionsManualReviewHotspot[] = [];
  const plannedFunctions: FunctionsPlannedFunction[] = [];
  const artifacts: GeneratedArtifact[] = [];
  const sortedFlows = sortByStableKey(input.cloudFlows, (flow) => flow.name);

  sortedFlows.forEach((flow) => {
    const mappedTrigger = mapFlowTriggerType(flow);
    if (mappedTrigger !== "http" && mappedTrigger !== "timer") {
      warnings.push(
        createWarning({
          code: "FUNCTIONS_UNSUPPORTED_TRIGGER_PLACEHOLDER",
          message: `Flow "${flow.name}" trigger classification "${flow.trigger.triggerClassification}" requires TODO placeholder mapping.`,
          sourceArtifactIds: [flow.artifactId, flow.trigger.artifactId],
          sourceLocation: flow.trigger.provenance.sourcePath,
          provenance: context.invocationProvenance
        })
      );
      manualReviewHotspots.push({
        message: `Trigger "${flow.trigger.triggerClassification}" for flow "${flow.name}" requires manual integration design.`,
        severity: "high",
        sourceArtifactIds: [flow.artifactId, flow.trigger.artifactId]
      });
      unsupportedFeatures.push(
        createUnsupportedFeature({
          featureType: `flow.trigger.${flow.trigger.triggerClassification}.manual-functions-mapping`,
          sourceLocation: flow.trigger.provenance.sourcePath,
          reason: `Trigger classification "${flow.trigger.triggerClassification}" is scaffolded with TODO placeholders only.`,
          suggestedRemediation:
            "Implement trigger-specific integration adapter (queue/webhook/event grid) before go-live.",
          severity: "medium",
          sourceArtifactIds: [flow.artifactId, flow.trigger.artifactId],
          provenance: context.invocationProvenance
        })
      );
    }

    flow.dependencyReferences
      .filter((reference) => !reference.resolved)
      .forEach((reference) => {
        unresolvedDependencies.push({
          referenceType: reference.referenceType,
          referenceName: reference.referenceName,
          sourceArtifactId: flow.artifactId
        });
      });

    const flowArtifact = createFlowFunctionArtifact({
      flow,
      triggerType: mappedTrigger,
      warnings,
      unsupportedFeatures,
      unsupportedActions,
      manualReviewHotspots,
      context
    });
    artifacts.push(flowArtifact.artifact);
    plannedFunctions.push(flowArtifact.plannedFunction);
  });

  const canvasFormulaRecords = collectCanvasFormulaRecords(input.canvasApps);
  const canvasArtifacts = createCanvasFunctionArtifacts({
    records: canvasFormulaRecords,
    warnings,
    manualReviewHotspots,
    unresolvedDependencies,
    context
  });
  canvasArtifacts.forEach((entry) => {
    artifacts.push(entry.artifact);
    plannedFunctions.push(entry.plannedFunction);
  });

  const sourceArtifactIds = sortByStableKey(
    Array.from(
      new Set([
        ...input.cloudFlows.map((flow) => flow.artifactId),
        ...input.cloudFlows.flatMap((flow) => [
          flow.trigger.artifactId,
          ...flow.actions.map((action) => action.artifactId)
        ]),
        ...canvasFormulaRecords.map((record) => record.formula.artifactId)
      ])
    ),
    (value) => value
  );

  const functionsPlan: FunctionsGenerationPlanDetails = {
    plannedFunctions: sortByStableKey(plannedFunctions, (plannedFunction) => plannedFunction.functionName),
    manualReviewHotspots: sortByStableKey(
      manualReviewHotspots,
      (hotspot) => `${hotspot.severity}:${hotspot.message}`
    ),
    unsupportedActions: sortByStableKey(
      unsupportedActions,
      (action) => `${action.flowName}:${action.actionName}:${action.actionType}`
    ),
    unresolvedDependencies: sortByStableKey(
      unresolvedDependencies,
      (dependency) => `${dependency.referenceType}:${dependency.referenceName}:${dependency.sourceArtifactId}`
    )
  };

  const output: AzureFunctionsGenerationOutput = {
    functionsGenerated: functionsPlan.plannedFunctions.length,
    flowFunctionsGenerated: sortedFlows.length,
    canvasApiFunctionsGenerated: canvasArtifacts.length,
    flowsProcessed: sortedFlows.length,
    formulasProcessed: canvasFormulaRecords.length,
    unsupportedActions: functionsPlan.unsupportedActions.length,
    unresolvedDependencies: functionsPlan.unresolvedDependencies.length,
    manualReviewHotspots: functionsPlan.manualReviewHotspots.length,
    functionsPlan
  };

  const reportArtifact: GeneratedArtifact = {
    artifactId: "generated:functions:generation-report",
    artifactType: "markdown-report",
    filePath: "generation-report.md",
    content: buildGenerationReport(output),
    sourceArtifactIds,
    warnings: [],
    provenance: context.invocationProvenance,
    confidence: 0.85
  };
  const notesArtifact: GeneratedArtifact = {
    artifactId: "generated:functions:migration-notes",
    artifactType: "markdown-report",
    filePath: "migration-notes.md",
    content: buildMigrationNotes(functionsPlan, warnings),
    sourceArtifactIds,
    warnings: [],
    provenance: context.invocationProvenance,
    confidence: 0.85
  };

  artifacts.push(...createScaffoldArtifacts(sourceArtifactIds, context), reportArtifact, notesArtifact);

  const parsedResult = createGenerationResultSchema(azureFunctionsGenerationOutputSchema).parse({
    artifacts: sortByStableKey(artifacts, (artifact) => artifact.filePath),
    output,
    warnings: sortByStableKey(warnings, (warning) => `${warning.code}:${warning.message}`),
    unsupportedFeatures: sortByStableKey(
      unsupportedFeatures,
      (feature) => `${feature.severity}:${feature.featureType}:${feature.sourceLocation}`
    ),
    confidence: confidenceFromIssues(warnings.length, unsupportedFeatures.length),
    provenance: context.invocationProvenance
  });

  return parsedResult as GenerationResult<AzureFunctionsGenerationOutput>;
};

export const generateAzureFunctionsFromPowerPlatformIR = async (
  input: unknown,
  contextInput?: GeneratorContext
): Promise<GenerationResult<AzureFunctionsGenerationOutput>> => {
  const validatedIr = validatePowerPlatformIR(input);
  const context = contextInput ?? defaultContext();

  return generateAzureFunctionsArtifacts(
    {
      cloudFlows: validatedIr.cloudFlows,
      canvasApps: validatedIr.canvasApps
    },
    context
  );
};
