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
  type FunctionsConnectorAdapterMapping,
  type FunctionsGenerationPlanDetails,
  type FunctionsHandlerSignature,
  type FunctionsManualReviewHotspot,
  type FunctionsPlannedAdapterFile,
  type FunctionsPlannedFunction,
  type FunctionsTriggerStrategy,
  type FunctionsTriggerStrategyMode,
  type FunctionsUnresolvedAdapterRequirement,
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
    adapterFilesGenerated: z.number().int().nonnegative(),
    flowsProcessed: z.number().int().nonnegative(),
    formulasProcessed: z.number().int().nonnegative(),
    unsupportedActions: z.number().int().nonnegative(),
    unresolvedDependencies: z.number().int().nonnegative(),
    manualReviewHotspots: z.number().int().nonnegative(),
    packagingWarnings: z.number().int().nonnegative(),
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
  | "dataverse-event-placeholder-http-fallback"
  | "email-ingestion-placeholder-http-fallback"
  | "event-grid-placeholder-http-fallback"
  | "unknown-trigger-http-manual-fallback";

type AdapterName =
  | "connectorAdapter"
  | "dataverseAdapter"
  | "httpAdapter"
  | "emailAdapter"
  | "approvalAdapter"
  | "customConnectorAdapter";

interface TriggerMapping {
  triggerType: FlowFunctionTriggerType;
  strategy: FunctionsTriggerStrategyMode;
  registerType: "http" | "timer";
  methods: string[];
  timerSchedule: string;
  notes: string[];
  warning?: string;
}

interface AdapterMethodSpec {
  methodName: string;
  actionName: string;
  actionType: string;
  operationId: string;
  connectorKey: string;
  sourceArtifactIds: string[];
}

interface AdapterDiscovery {
  methodsByAdapter: Record<Exclude<AdapterName, "connectorAdapter">, AdapterMethodSpec[]>;
  mappings: FunctionsConnectorAdapterMapping[];
  unresolvedAdapterRequirements: FunctionsUnresolvedAdapterRequirement[];
  actionMethodLookup: Map<string, { adapterName: Exclude<AdapterName, "connectorAdapter">; methodName: string }>;
}

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

const safeComment = (value: string): string => value.replace(/\*\//g, "* /");

const isDataverseAction = (action: FlowAction): boolean => {
  const connector = action.connectorApi?.toLowerCase() ?? "";
  const actionType = action.actionType.toLowerCase();
  return (
    connector.includes("commondataservice") ||
    connector.includes("dataverse") ||
    actionType.includes("dataverse")
  );
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

const isEmailAction = (action: FlowAction): boolean => {
  const connector = action.connectorApi?.toLowerCase() ?? "";
  const actionType = action.actionType.toLowerCase();
  return connector.includes("mail") || connector.includes("outlook") || actionType.includes("email");
};

const classifyAdapterForAction = (action: FlowAction): Exclude<AdapterName, "connectorAdapter"> | null => {
  if (isDataverseAction(action)) {
    return "dataverseAdapter";
  }
  if (isHttpAction(action)) {
    return "httpAdapter";
  }
  if (isApprovalAction(action)) {
    return "approvalAdapter";
  }
  if (isEmailAction(action)) {
    return "emailAdapter";
  }
  if (action.connectorApi) {
    return "customConnectorAdapter";
  }
  return null;
};

const mapFlowTrigger = (flow: CloudFlow): TriggerMapping => {
  const classification = flow.trigger.triggerClassification;
  const recurrenceSchedule =
    flow.trigger.recurrence?.frequency === "Day"
      ? "0 0 0 * * *"
      : flow.trigger.recurrence?.frequency === "Hour"
        ? "0 0 * * * *"
        : "0 */5 * * * *";

  if (classification === "manual" || classification === "http") {
    return {
      triggerType: "http",
      strategy: "http",
      registerType: "http",
      methods: ["GET", "POST"],
      timerSchedule: "",
      notes: ["HTTP trigger scaffold generated from Flow trigger metadata."]
    };
  }

  if (classification === "recurrence") {
    return {
      triggerType: "timer",
      strategy: "timer",
      registerType: "timer",
      methods: [],
      timerSchedule: recurrenceSchedule,
      notes: [
        "Timer trigger scaffold generated from recurrence metadata.",
        "TODO: validate schedule with production SLA requirements."
      ]
    };
  }

  if (classification === "dataverse") {
    return {
      triggerType: "dataverse-event-placeholder-http-fallback",
      strategy: "dataverse-event-placeholder",
      registerType: "http",
      methods: ["POST"],
      timerSchedule: "",
      notes: [
        "Dataverse/event trigger placeholder.",
        "Suggested placeholders: eventGridTrigger, webhookTrigger.",
        "TODO: map Dataverse trigger into queue/webhook/event grid ingestion."
      ],
      warning:
        "Dataverse trigger classified as scaffold-only; generated HTTP manual placeholder for safe local execution."
    };
  }

  if (classification === "email") {
    return {
      triggerType: "email-ingestion-placeholder-http-fallback",
      strategy: "email-ingestion-placeholder",
      registerType: "http",
      methods: ["POST"],
      timerSchedule: "",
      notes: [
        "Email ingestion placeholder.",
        "Suggested placeholders: queueTrigger, webhookTrigger.",
        "TODO: map email trigger into queue/webhook ingestion pipeline."
      ],
      warning:
        "Email trigger classification is scaffold-only; generated HTTP manual placeholder for safe testing."
    };
  }

  if (classification === "event") {
    return {
      triggerType: "event-grid-placeholder-http-fallback",
      strategy: "event-grid-placeholder",
      registerType: "http",
      methods: ["POST"],
      timerSchedule: "",
      notes: [
        "Event Grid placeholder.",
        "Suggested placeholders: eventGridTrigger.",
        "TODO: map Event trigger into Event Grid subscription scaffolding."
      ],
      warning: "Event trigger classification is uncertain; generated HTTP/manual placeholder."
    };
  }

  return {
    triggerType: "unknown-trigger-http-manual-fallback",
    strategy: "http-manual-fallback",
    registerType: "http",
    methods: ["POST"],
    timerSchedule: "",
    notes: [
      `Unsupported trigger classification "${classification}" uses safe HTTP/manual fallback.`,
      "TODO: map unsupported trigger into deterministic queue/webhook/event-grid trigger binding."
    ],
    warning: `Unsupported trigger classification "${classification}" generated as HTTP/manual fallback.`
  };
};

const addUniqueMethod = (
  methods: AdapterMethodSpec[],
  candidate: AdapterMethodSpec
): AdapterMethodSpec => {
  const used = new Set(methods.map((entry) => entry.methodName));
  if (!used.has(candidate.methodName)) {
    methods.push(candidate);
    return candidate;
  }

  let suffix = 2;
  while (used.has(`${candidate.methodName}${suffix}`)) {
    suffix += 1;
  }
  const withSuffix = {
    ...candidate,
    methodName: `${candidate.methodName}${suffix}`
  };
  methods.push(withSuffix);
  return withSuffix;
};

const discoverAdapterMethods = (
  flows: CloudFlow[],
  manualReviewHotspots: FunctionsManualReviewHotspot[]
): AdapterDiscovery => {
  const methodsByAdapter: AdapterDiscovery["methodsByAdapter"] = {
    dataverseAdapter: [],
    httpAdapter: [],
    emailAdapter: [],
    approvalAdapter: [],
    customConnectorAdapter: []
  };
  const mappingsByConnector = new Map<
    string,
    {
      connectorKey: string;
      adapterName: Exclude<AdapterName, "connectorAdapter">;
      adapterFilePath: string;
      actionNames: string[];
      sourceArtifactIds: string[];
    }
  >();
  const unresolvedAdapterRequirements: FunctionsUnresolvedAdapterRequirement[] = [];
  const actionMethodLookup = new Map<
    string,
    { adapterName: Exclude<AdapterName, "connectorAdapter">; methodName: string }
  >();

  flows.forEach((flow) => {
    flow.actions.forEach((action) => {
      const adapterName = classifyAdapterForAction(action);
      if (!adapterName) {
        unresolvedAdapterRequirements.push({
          connectorKey: action.connectorApi ?? `action-type:${action.actionType}`,
          requirement: `Action "${flow.name}.${action.actionName}" has no adapter mapping and requires manual handler logic.`,
          sourceArtifactIds: [flow.artifactId, action.artifactId]
        });
        return;
      }

      const connectorKey = action.connectorApi ?? `action-type:${action.actionType}`;
      const operationId = action.operationId ?? action.actionType;
      const methodSpec = addUniqueMethod(methodsByAdapter[adapterName], {
        methodName: `todo${toPascalCase(operationId)}`,
        actionName: action.actionName,
        actionType: action.actionType,
        operationId,
        connectorKey,
        sourceArtifactIds: [flow.artifactId, action.artifactId]
      });
      actionMethodLookup.set(action.artifactId, {
        adapterName,
        methodName: methodSpec.methodName
      });

      const mapping = mappingsByConnector.get(connectorKey) ?? {
        connectorKey,
        adapterName,
        adapterFilePath: `src/adapters/${adapterName}.ts`,
        actionNames: [],
        sourceArtifactIds: []
      };
      mapping.actionNames.push(action.actionName);
      mapping.sourceArtifactIds.push(flow.artifactId, action.artifactId);
      mappingsByConnector.set(connectorKey, mapping);

      if (adapterName === "approvalAdapter") {
        manualReviewHotspots.push({
          message: `Approval action "${flow.name}.${action.actionName}" needs human-in-the-loop workflow redesign.`,
          severity: "high",
          sourceArtifactIds: [flow.artifactId, action.artifactId]
        });
      }
      if (adapterName === "customConnectorAdapter") {
        manualReviewHotspots.push({
          message: `Custom connector action "${flow.name}.${action.actionName}" requires manual contract definition.`,
          severity: "medium",
          sourceArtifactIds: [flow.artifactId, action.artifactId]
        });
      }
    });
  });

  return {
    methodsByAdapter: {
      dataverseAdapter: sortByStableKey(methodsByAdapter.dataverseAdapter, (value) => value.methodName),
      httpAdapter: sortByStableKey(methodsByAdapter.httpAdapter, (value) => value.methodName),
      emailAdapter: sortByStableKey(methodsByAdapter.emailAdapter, (value) => value.methodName),
      approvalAdapter: sortByStableKey(methodsByAdapter.approvalAdapter, (value) => value.methodName),
      customConnectorAdapter: sortByStableKey(
        methodsByAdapter.customConnectorAdapter,
        (value) => value.methodName
      )
    },
    mappings: sortByStableKey(Array.from(mappingsByConnector.values()), (value) => value.connectorKey).map(
      (value) => ({
        connectorKey: value.connectorKey,
        adapterName: value.adapterName,
        adapterFilePath: value.adapterFilePath,
        actionNames: sortByStableKey(Array.from(new Set(value.actionNames)), (entry) => entry),
        sourceArtifactIds: sortByStableKey(Array.from(new Set(value.sourceArtifactIds)), (entry) => entry)
      })
    ),
    unresolvedAdapterRequirements: sortByStableKey(
      unresolvedAdapterRequirements,
      (value) => `${value.connectorKey}:${value.requirement}`
    ),
    actionMethodLookup
  };
};

const renderAdapterMethods = (
  adapterName: Exclude<AdapterName, "connectorAdapter">,
  requestType: string,
  responseType: string,
  methods: AdapterMethodSpec[]
): string => {
  if (methods.length === 0) {
    return `  async todoManualImplementation(
    request: ${requestType},
    principal: AdapterPrincipalContext,
    invocationContext: AdapterInvocationContext
  ): Promise<${responseType}> {
    void request;
    void principal;
    void invocationContext;
    // TODO: No inferred operations for ${adapterName}; define manual adapter contract.
    return { status: "todo", operation: "manual" };
  }`;
  }

  return methods
    .map(
      (method) => `  async ${method.methodName}(
    request: ${requestType},
    principal: AdapterPrincipalContext,
    invocationContext: AdapterInvocationContext
  ): Promise<${responseType}> {
    void request;
    void principal;
    void invocationContext;
    // TODO: Implement ${adapterName} operation "${method.operationId}" (${method.actionType}) for connector "${method.connectorKey}".
    // Unsupported/manual implementation area: wire retries, auth, and error mapping before production.
    return { status: "todo", operation: "${method.operationId}" };
  }`
    )
    .join(",\n");
};

const createAdapterArtifacts = (input: {
  sourceArtifactIds: string[];
  adapterDiscovery: AdapterDiscovery;
  context: GeneratorContext;
}): {
  artifacts: GeneratedArtifact[];
  plannedAdapterFiles: FunctionsPlannedAdapterFile[];
} => {
  const { sourceArtifactIds, adapterDiscovery, context } = input;
  const connectorAdapterContent = `export interface AdapterPrincipalContext {
  principalId?: string;
  tenantId?: string;
  roles?: string[];
}

export interface AdapterInvocationContext {
  invocationId?: string;
  functionName?: string;
  trace?: Record<string, unknown>;
}

export interface ConnectorOperationRequest {
  flowName: string;
  actionName: string;
  operationId: string;
  payload: Record<string, unknown>;
}

export interface ConnectorOperationResponse {
  status: "todo" | "manual-required";
  operation: string;
  details?: Record<string, unknown>;
}

export interface ConnectorAdapter {
  readonly adapterName: string;
  executeTodoOperation(
    request: ConnectorOperationRequest,
    principal: AdapterPrincipalContext,
    invocationContext: AdapterInvocationContext
  ): Promise<ConnectorOperationResponse>;
}
`;

  const dataverseAdapterContent = `import {
  AdapterInvocationContext,
  AdapterPrincipalContext,
  ConnectorAdapter,
  ConnectorOperationRequest
} from "./connectorAdapter";

export interface DataverseActionRequest extends ConnectorOperationRequest {
  entityLogicalName?: string;
}

export interface DataverseActionResponse {
  status: "todo" | "manual-required";
  operation: string;
  recordId?: string;
}

export interface DataverseAdapter extends ConnectorAdapter {
${adapterDiscovery.methodsByAdapter.dataverseAdapter
  .map(
    (method) =>
      `  ${method.methodName}(request: DataverseActionRequest, principal: AdapterPrincipalContext, invocationContext: AdapterInvocationContext): Promise<DataverseActionResponse>;`
  )
  .join("\n")}
}

export const dataverseAdapter: DataverseAdapter = {
  adapterName: "dataverseAdapter",
  async executeTodoOperation(request): Promise<DataverseActionResponse> {
    void request;
    // TODO: Manual Dataverse adapter implementation; no live API calls in scaffold mode.
    return { status: "manual-required", operation: "executeTodoOperation" };
  },
${renderAdapterMethods(
  "dataverseAdapter",
  "DataverseActionRequest",
  "DataverseActionResponse",
  adapterDiscovery.methodsByAdapter.dataverseAdapter
)}
};
`;

  const httpAdapterContent = `import {
  AdapterInvocationContext,
  AdapterPrincipalContext,
  ConnectorAdapter,
  ConnectorOperationRequest
} from "./connectorAdapter";

export interface HttpActionRequest extends ConnectorOperationRequest {
  methodHint?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  targetUrlHint?: string;
}

export interface HttpActionResponse {
  status: "todo" | "manual-required";
  operation: string;
  statusCodeHint?: number;
}

export interface HttpAdapter extends ConnectorAdapter {
${adapterDiscovery.methodsByAdapter.httpAdapter
  .map(
    (method) =>
      `  ${method.methodName}(request: HttpActionRequest, principal: AdapterPrincipalContext, invocationContext: AdapterInvocationContext): Promise<HttpActionResponse>;`
  )
  .join("\n")}
}

export const httpAdapter: HttpAdapter = {
  adapterName: "httpAdapter",
  async executeTodoOperation(request): Promise<HttpActionResponse> {
    void request;
    // TODO: Manual HTTP adapter implementation with retry/backoff policy.
    return { status: "manual-required", operation: "executeTodoOperation" };
  },
${renderAdapterMethods(
  "httpAdapter",
  "HttpActionRequest",
  "HttpActionResponse",
  adapterDiscovery.methodsByAdapter.httpAdapter
)}
};
`;

  const emailAdapterContent = `import {
  AdapterInvocationContext,
  AdapterPrincipalContext,
  ConnectorAdapter,
  ConnectorOperationRequest
} from "./connectorAdapter";

export interface EmailActionRequest extends ConnectorOperationRequest {
  mailboxHint?: string;
  subject?: string;
}

export interface EmailActionResponse {
  status: "todo" | "manual-required";
  operation: string;
  messageId?: string;
}

export interface EmailAdapter extends ConnectorAdapter {
${adapterDiscovery.methodsByAdapter.emailAdapter
  .map(
    (method) =>
      `  ${method.methodName}(request: EmailActionRequest, principal: AdapterPrincipalContext, invocationContext: AdapterInvocationContext): Promise<EmailActionResponse>;`
  )
  .join("\n")}
}

export const emailAdapter: EmailAdapter = {
  adapterName: "emailAdapter",
  async executeTodoOperation(request): Promise<EmailActionResponse> {
    void request;
    // TODO: Manual email ingestion implementation; do not embed credentials or direct provider tokens.
    return { status: "manual-required", operation: "executeTodoOperation" };
  },
${renderAdapterMethods(
  "emailAdapter",
  "EmailActionRequest",
  "EmailActionResponse",
  adapterDiscovery.methodsByAdapter.emailAdapter
)}
};
`;

  const approvalAdapterContent = `import {
  AdapterInvocationContext,
  AdapterPrincipalContext,
  ConnectorAdapter,
  ConnectorOperationRequest
} from "./connectorAdapter";

export interface ApprovalActionRequest extends ConnectorOperationRequest {
  approvalTypeHint?: string;
  assignedToHint?: string;
}

export interface ApprovalActionResponse {
  status: "todo" | "manual-required";
  operation: string;
  approvalId?: string;
}

export interface ApprovalAdapter extends ConnectorAdapter {
${adapterDiscovery.methodsByAdapter.approvalAdapter
  .map(
    (method) =>
      `  ${method.methodName}(request: ApprovalActionRequest, principal: AdapterPrincipalContext, invocationContext: AdapterInvocationContext): Promise<ApprovalActionResponse>;`
  )
  .join("\n")}
}

export const approvalAdapter: ApprovalAdapter = {
  adapterName: "approvalAdapter",
  async executeTodoOperation(request): Promise<ApprovalActionResponse> {
    void request;
    // TODO: Manual approval orchestration required; this scaffold intentionally avoids live workflow calls.
    return { status: "manual-required", operation: "executeTodoOperation" };
  },
${renderAdapterMethods(
  "approvalAdapter",
  "ApprovalActionRequest",
  "ApprovalActionResponse",
  adapterDiscovery.methodsByAdapter.approvalAdapter
)}
};
`;

  const customConnectorAdapterContent = `import {
  AdapterInvocationContext,
  AdapterPrincipalContext,
  ConnectorAdapter,
  ConnectorOperationRequest
} from "./connectorAdapter";

export interface CustomConnectorActionRequest extends ConnectorOperationRequest {
  connectorName: string;
}

export interface CustomConnectorActionResponse {
  status: "todo" | "manual-required";
  operation: string;
  connectorName: string;
}

export interface CustomConnectorAdapter extends ConnectorAdapter {
${adapterDiscovery.methodsByAdapter.customConnectorAdapter
  .map(
    (method) =>
      `  ${method.methodName}(request: CustomConnectorActionRequest, principal: AdapterPrincipalContext, invocationContext: AdapterInvocationContext): Promise<CustomConnectorActionResponse>;`
  )
  .join("\n")}
}

export const customConnectorAdapter: CustomConnectorAdapter = {
  adapterName: "customConnectorAdapter",
  async executeTodoOperation(request): Promise<CustomConnectorActionResponse> {
    // TODO: Custom connector execution contract must be implemented manually.
    return {
      status: "manual-required",
      operation: "executeTodoOperation",
      connectorName: request.operationId
    };
  },
${renderAdapterMethods(
  "customConnectorAdapter",
  "CustomConnectorActionRequest",
  "CustomConnectorActionResponse",
  adapterDiscovery.methodsByAdapter.customConnectorAdapter
)}
};
`;

  const adapterFileEntries: Array<{
    adapterName: AdapterName;
    artifactId: string;
    filePath: string;
    content: string;
    methodCount: number;
  }> = [
    {
      adapterName: "connectorAdapter",
      artifactId: "generated:functions:adapter-connector",
      filePath: "src/adapters/connectorAdapter.ts",
      content: connectorAdapterContent,
      methodCount: 1
    },
    {
      adapterName: "dataverseAdapter",
      artifactId: "generated:functions:adapter-dataverse",
      filePath: "src/adapters/dataverseAdapter.ts",
      content: dataverseAdapterContent,
      methodCount: Math.max(1, adapterDiscovery.methodsByAdapter.dataverseAdapter.length)
    },
    {
      adapterName: "httpAdapter",
      artifactId: "generated:functions:adapter-http",
      filePath: "src/adapters/httpAdapter.ts",
      content: httpAdapterContent,
      methodCount: Math.max(1, adapterDiscovery.methodsByAdapter.httpAdapter.length)
    },
    {
      adapterName: "emailAdapter",
      artifactId: "generated:functions:adapter-email",
      filePath: "src/adapters/emailAdapter.ts",
      content: emailAdapterContent,
      methodCount: Math.max(1, adapterDiscovery.methodsByAdapter.emailAdapter.length)
    },
    {
      adapterName: "approvalAdapter",
      artifactId: "generated:functions:adapter-approval",
      filePath: "src/adapters/approvalAdapter.ts",
      content: approvalAdapterContent,
      methodCount: Math.max(1, adapterDiscovery.methodsByAdapter.approvalAdapter.length)
    },
    {
      adapterName: "customConnectorAdapter",
      artifactId: "generated:functions:adapter-custom",
      filePath: "src/adapters/customConnectorAdapter.ts",
      content: customConnectorAdapterContent,
      methodCount: Math.max(1, adapterDiscovery.methodsByAdapter.customConnectorAdapter.length)
    }
  ];

  return {
    artifacts: sortByStableKey(adapterFileEntries, (entry) => entry.filePath).map((entry) => ({
      artifactId: entry.artifactId,
      artifactType: "typescript-adapter",
      filePath: entry.filePath,
      content: entry.content,
      sourceArtifactIds,
      warnings: [],
      provenance: context.invocationProvenance,
      confidence: 0.85
    })),
    plannedAdapterFiles: sortByStableKey(adapterFileEntries, (entry) => entry.filePath).map((entry) => ({
      adapterName: entry.adapterName,
      filePath: entry.filePath,
      methodCount: entry.methodCount,
      sourceArtifactIds
    }))
  };
};

const buildActionInvocationLines = (input: {
  flow: CloudFlow;
  action: FlowAction;
  adapterDiscovery: AdapterDiscovery;
  unsupportedActions: FunctionsUnsupportedAction[];
  manualReviewHotspots: FunctionsManualReviewHotspot[];
  warnings: GenerationWarning[];
  unsupportedFeatures: GenerationUnsupportedFeature[];
  context: GeneratorContext;
}): string[] => {
  const { flow, action, adapterDiscovery, unsupportedActions, manualReviewHotspots, warnings, unsupportedFeatures, context } =
    input;
  const lines: string[] = [];
  lines.push(
    `    // Flow action ${action.actionName} (${action.actionType}${action.connectorApi ? `, connector=${action.connectorApi}` : ""})`
  );
  action.expressions.forEach((expression) => {
    lines.push(`    // Action expression: ${safeComment(expression.rawExpression)}`);
  });

  if (action.scopeControl.isCondition) {
    lines.push(
      "    // TODO: condition TODO - map Power Automate condition branches into explicit TypeScript control flow."
    );
    manualReviewHotspots.push({
      message: `Condition action "${action.actionName}" requires manual branch mapping.`,
      severity: "medium",
      sourceArtifactIds: [flow.artifactId, action.artifactId]
    });
    return lines;
  }

  if (action.scopeControl.isScope) {
    lines.push("    // TODO: scope TODO - model scope boundaries, retries, and error handling explicitly.");
    manualReviewHotspots.push({
      message: `Scope action "${action.actionName}" requires manual scope orchestration.`,
      severity: "medium",
      sourceArtifactIds: [flow.artifactId, action.artifactId]
    });
    return lines;
  }

  if (action.scopeControl.isLoop) {
    lines.push("    // TODO: loop TODO - map loop cardinality, batching, and idempotency safeguards.");
    manualReviewHotspots.push({
      message: `Loop action "${action.actionName}" requires manual iteration strategy.`,
      severity: "high",
      sourceArtifactIds: [flow.artifactId, action.artifactId]
    });
    return lines;
  }

  const methodMapping = adapterDiscovery.actionMethodLookup.get(action.artifactId);
  if (methodMapping) {
    lines.push(
      `    await ${methodMapping.adapterName}.${methodMapping.methodName}({ flowName: "${flow.name}", actionName: "${action.actionName}", operationId: "${action.operationId ?? action.actionType}", payload: inputPayload }, principal, { invocationId: context.invocationId, functionName: context.functionName });`
    );
    return lines;
  }

  lines.push(`    // TODO: unsupported action "${action.actionType}" - manual migration implementation required.`);
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
        "Implement a typed adapter method or explicit manual orchestration before production migration.",
      severity: "medium",
      sourceArtifactIds: [flow.artifactId, action.artifactId],
      provenance: context.invocationProvenance
    })
  );
  return lines;
};

const createFlowFunctionArtifact = (input: {
  flow: CloudFlow;
  triggerMapping: TriggerMapping;
  adapterDiscovery: AdapterDiscovery;
  warnings: GenerationWarning[];
  unsupportedFeatures: GenerationUnsupportedFeature[];
  unsupportedActions: FunctionsUnsupportedAction[];
  manualReviewHotspots: FunctionsManualReviewHotspot[];
  unresolvedAdapterRequirements: FunctionsUnresolvedAdapterRequirement[];
  context: GeneratorContext;
}): {
  artifact: GeneratedArtifact;
  plannedFunction: FunctionsPlannedFunction;
  triggerStrategy: FunctionsTriggerStrategy;
  handlerSignature: FunctionsHandlerSignature;
} => {
  const {
    flow,
    triggerMapping,
    adapterDiscovery,
    warnings,
    unsupportedFeatures,
    unsupportedActions,
    manualReviewHotspots,
    unresolvedAdapterRequirements,
    context
  } = input;
  const functionSlug = `flow-${slugify(flow.name)}`;
  const functionName = `flow${toPascalCase(flow.name)}`;
  const handlerName = `${functionName}Handler`;
  const sortedActions = sortByStableKey(flow.actions, (action) => action.actionName);
  const sourceArtifactIds = [flow.artifactId, flow.trigger.artifactId, ...sortedActions.map((action) => action.artifactId)];

  if (triggerMapping.warning) {
    warnings.push(
      createWarning({
        code: "FUNCTIONS_UNSUPPORTED_TRIGGER_PLACEHOLDER",
        message: `Flow "${flow.name}" trigger classification "${flow.trigger.triggerClassification}" uses scaffold placeholder strategy.`,
        sourceArtifactIds: [flow.artifactId, flow.trigger.artifactId],
        sourceLocation: flow.trigger.provenance.sourcePath,
        provenance: context.invocationProvenance
      })
    );
    manualReviewHotspots.push({
      message: triggerMapping.warning,
      severity: "high",
      sourceArtifactIds: [flow.artifactId, flow.trigger.artifactId]
    });
    unresolvedAdapterRequirements.push({
      connectorKey: `trigger:${flow.trigger.triggerClassification}`,
      requirement: triggerMapping.warning,
      sourceArtifactIds: [flow.artifactId, flow.trigger.artifactId]
    });
    unsupportedFeatures.push(
      createUnsupportedFeature({
        featureType: `flow.trigger.${flow.trigger.triggerClassification}.manual-functions-mapping`,
        sourceLocation: flow.trigger.provenance.sourcePath,
        reason: triggerMapping.warning,
        suggestedRemediation:
          "Implement concrete trigger bindings and integration adapters before deployment.",
        severity: "medium",
        sourceArtifactIds: [flow.artifactId, flow.trigger.artifactId],
        provenance: context.invocationProvenance
      })
    );
  }

  const actionLines = sortedActions
    .map((action) =>
      buildActionInvocationLines({
        flow,
        action,
        adapterDiscovery,
        unsupportedActions,
        manualReviewHotspots,
        warnings,
        unsupportedFeatures,
        context
      }).join("\n")
    )
    .join("\n");

  const triggerComments = [
    `// Source provenance: ${flow.provenance.sourcePath}`,
    `// Trigger provenance: ${flow.trigger.provenance.sourcePath}`,
    ...flow.trigger.expressions.map(
      (expression) => `// Original Flow trigger snippet: ${safeComment(expression.rawExpression)}`
    ),
    ...triggerMapping.notes.map((note) => `// ${note}`)
  ];

  const imports = `import { app, HttpRequest, HttpResponseInit, InvocationContext, Timer } from "@azure/functions";
import { approvalAdapter } from "../adapters/approvalAdapter";
import { customConnectorAdapter } from "../adapters/customConnectorAdapter";
import { dataverseAdapter } from "../adapters/dataverseAdapter";
import { emailAdapter } from "../adapters/emailAdapter";
import { httpAdapter } from "../adapters/httpAdapter";
import { authContext } from "../services/authContext";
import { validation } from "../services/validation";
import { logger } from "../utils/logger";
`;

  const httpHandler = `interface FlowHttpRequest {
  body: Record<string, unknown>;
  query: Record<string, string | undefined>;
}

export async function ${handlerName}(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  const principal = authContext.fromInvocation(context);
  const requestContract: FlowHttpRequest = {
    body: await request.json().catch(() => ({} as Record<string, unknown>)),
    query: Object.fromEntries(request.query.entries())
  };
  const inputPayload: Record<string, unknown> = requestContract.body;
  logger.info("functions.handler.start", { functionName: "${functionName}", flowName: "${flow.name}" });
${triggerComments.map((line) => `  ${line}`).join("\n")}
  try {
    validation.ensureRequestShape(requestContract);
    validation.ensureAuthContext(principal);
    // TODO: migrated flow logic starts here.
${actionLines || "    // TODO: no mapped actions found."}
    return {
      status: 202,
      jsonBody: {
        message: "Flow scaffold executed.",
        flowName: "${flow.name}",
        triggerStrategy: "${triggerMapping.strategy}"
      }
    };
  } catch (error) {
    logger.error("functions.handler.error", { functionName: "${functionName}", error });
    return {
      status: 500,
      jsonBody: { error: "Flow scaffold handler failed.", functionName: "${functionName}" }
    };
  }
}
`;

  const timerHandler = `interface FlowTimerRequest {
  isPastDue?: boolean;
  schedule: string;
}

export async function ${handlerName}(timer: Timer, context: InvocationContext): Promise<void> {
  const principal = authContext.fromInvocation(context);
  const timerContract: FlowTimerRequest = {
    isPastDue: timer.isPastDue,
    schedule: "${triggerMapping.timerSchedule}"
  };
  const inputPayload: Record<string, unknown> = {};
  logger.info("functions.handler.start", { functionName: "${functionName}", flowName: "${flow.name}" });
${triggerComments.map((line) => `  ${line}`).join("\n")}
  try {
    validation.ensureTimerShape(timerContract);
    validation.ensureAuthContext(principal);
    // TODO: migrated flow logic starts here.
${actionLines || "    // TODO: no mapped actions found."}
  } catch (error) {
    logger.error("functions.handler.error", { functionName: "${functionName}", error });
    throw error;
  }
}
`;

  const registration =
    triggerMapping.registerType === "timer"
      ? `app.timer("${functionName}", {
  schedule: "${triggerMapping.timerSchedule}",
  handler: ${handlerName}
});
`
      : `app.http("${functionName}", {
  route: "${functionSlug}",
  methods: [${triggerMapping.methods.map((method) => `"${method}"`).join(", ")}],
  authLevel: "function",
  handler: ${handlerName}
});
`;

  const functionContent = `${imports}
${triggerMapping.registerType === "timer" ? timerHandler : httpHandler}
${registration}`;

  return {
    artifact: {
      artifactId: `generated:functions:${functionSlug}`,
      artifactType: "azure-function",
      filePath: `src/functions/${functionSlug}.ts`,
      content: functionContent,
      sourceArtifactIds,
      warnings: [],
      provenance: context.invocationProvenance,
      confidence: 0.85
    },
    plannedFunction: {
      functionName,
      triggerType: triggerMapping.triggerType,
      sourceArtifactIds,
      sourceFlowArtifactId: flow.artifactId,
      sourceActionArtifactIds: sortedActions.map((action) => action.artifactId),
      sourceFormulaArtifactIds: []
    },
    triggerStrategy: {
      functionName,
      triggerClassification: flow.trigger.triggerClassification,
      strategy: triggerMapping.strategy,
      warning: triggerMapping.warning
    },
    handlerSignature: {
      functionName,
      exportedHandler: handlerName,
      requestType: triggerMapping.registerType === "timer" ? "Timer" : "HttpRequest",
      responseType:
        triggerMapping.registerType === "timer" ? "Promise<void>" : "Promise<HttpResponseInit>",
      contextType: "InvocationContext"
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
  canvasOperationNames.filter((operation) => new RegExp(`\\b${operation}\\s*\\(`, "i").test(formula.rawExpression));

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
      records.push({ appName: app.appName, screenName: "(app)", controlName: null, formula });
    });
    sortByStableKey(app.screens, (screen) => screen.screenName).forEach((screen) => {
      screen.formulas.forEach((formula) => {
        records.push({ appName: app.appName, screenName: screen.screenName, controlName: null, formula });
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
}): Array<{
  artifact: GeneratedArtifact;
  plannedFunction: FunctionsPlannedFunction;
  triggerStrategy: FunctionsTriggerStrategy;
  handlerSignature: FunctionsHandlerSignature;
}> => {
  const { records, warnings, manualReviewHotspots, unresolvedDependencies, context } = input;
  const operationRecords: CanvasFormulaOperationRecord[] = [];

  records.forEach((record) => {
    parseCanvasFormulaOperations(record.formula).forEach((operation) => {
      const inferredDataSource = inferFormulaDataSource(record.formula);
      const resolvedDataSource = record.formula.likelyDataSources.length > 0 ? inferredDataSource : null;
      operationRecords.push({ record, operation, dataSource: resolvedDataSource });
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
      const handlerName = `${functionName}Handler`;
      const operationLines = sortByStableKey(dataSourceRecords, (entry) => `${entry.operation}:${entry.record.formula.artifactId}`)
        .map((entry) => {
          const formulaComment = safeComment(entry.record.formula.rawExpression);
          const ownerLabel = `${entry.record.appName}/${entry.record.screenName}/${entry.record.controlName ?? "(screen)"}`;
          if (["Patch", "SubmitForm", "Remove", "RemoveIf"].includes(entry.operation)) {
            return `    // ${entry.operation} from ${ownerLabel}\n    // Original Power Fx snippet: ${formulaComment}\n    await dataverseAdapter.executeTodoOperation({ flowName: "${entry.record.appName}", actionName: "${entry.operation}", operationId: "${entry.operation}", payload: requestContract.body }, principal, { invocationId: context.invocationId, functionName: context.functionName });`;
          }
          if (["LookUp", "Filter", "Search", "SortByColumns"].includes(entry.operation)) {
            return `    // ${entry.operation} from ${ownerLabel}\n    // Original Power Fx snippet: ${formulaComment}\n    await httpAdapter.executeTodoOperation({ flowName: "${entry.record.appName}", actionName: "${entry.operation}", operationId: "${entry.operation}", payload: requestContract.body }, principal, { invocationId: context.invocationId, functionName: context.functionName });`;
          }
          return `    // ${entry.operation} from ${ownerLabel}\n    // Original Power Fx snippet: ${formulaComment}\n    // TODO: map collection operation "${entry.operation}" to manual stateful API orchestration.`;
        })
        .join("\n");

      const content = `import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { dataverseAdapter } from "../adapters/dataverseAdapter";
import { httpAdapter } from "../adapters/httpAdapter";
import { authContext } from "../services/authContext";
import { validation } from "../services/validation";
import { logger } from "../utils/logger";

interface CanvasApiRequest {
  body: Record<string, unknown>;
}

export async function ${handlerName}(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  const principal = authContext.fromInvocation(context);
  const requestContract: CanvasApiRequest = {
    body: await request.json().catch(() => ({} as Record<string, unknown>))
  };
  logger.info("functions.handler.start", { functionName: "${functionName}", dataSource: "${dataSource}" });
  // Source provenance: ${dataSourceRecords[0]?.record.formula.provenance.sourcePath ?? "unknown"}
  try {
    validation.ensureRequestShape(requestContract);
    validation.ensureAuthContext(principal);
    // TODO: migrated canvas formula logic starts here.
${operationLines || "    // TODO: no operations mapped."}
    return {
      status: 202,
      jsonBody: {
        message: "Canvas API scaffold executed.",
        dataSource: "${dataSource}"
      }
    };
  } catch (error) {
    logger.error("functions.handler.error", { functionName: "${functionName}", error });
    return { status: 500, jsonBody: { error: "Canvas API scaffold failed." } };
  }
}

app.http("${functionName}", {
  route: "${functionSlug}",
  methods: ["POST"],
  authLevel: "function",
  handler: ${handlerName}
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
        },
        triggerStrategy: {
          functionName,
          triggerClassification: "canvas-formula",
          strategy: "http",
          warning: undefined
        },
        handlerSignature: {
          functionName,
          exportedHandler: handlerName,
          requestType: "HttpRequest",
          responseType: "Promise<HttpResponseInit>",
          contextType: "InvocationContext"
        }
      };
    }
  );
};

const createScaffoldArtifacts = (sourceArtifactIds: string[], context: GeneratorContext): GeneratedArtifact[] => {
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
    "POWER_EXIT_SQL_CONNECTION_STRING": "TODO_CONNECTION_STRING",
    "POWER_EXIT_DATAVERSE_URL": "TODO_DATAVERSE_URL",
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
  const functionsReadme = `# Generated Functions

This folder contains scaffold-only Azure Function handlers.

- Handler signatures are contract-first and typed.
- Trigger bindings are placeholders where runtime mapping is uncertain.
- Manual implementation is required before deployment.
`;
  const authContext = `export interface AuthPrincipalContext {
  principalId?: string;
  tenantId?: string;
  roles: string[];
}

export const authContext = {
  fromInvocation(context: unknown): AuthPrincipalContext {
    // TODO: extract auth principal and tenant context from invocation.
    void context;
    return { roles: [] };
  }
};
`;
  const validation = `export const validation = {
  ensureRequestShape(request: unknown): void {
    // TODO: validate payload contracts and required fields.
    void request;
  },
  ensureTimerShape(timerPayload: unknown): void {
    // TODO: validate timer trigger envelope.
    void timerPayload;
  },
  ensureAuthContext(principal: unknown): void {
    // TODO: validate auth principal requirements.
    void principal;
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
    {
      artifactId: "generated:functions:package-json",
      artifactType: "json-config",
      filePath: "package.json",
      content: packageJson
    },
    {
      artifactId: "generated:functions:tsconfig",
      artifactType: "json-config",
      filePath: "tsconfig.json",
      content: tsconfigJson
    },
    {
      artifactId: "generated:functions:host-json",
      artifactType: "json-config",
      filePath: "host.json",
      content: hostJson
    },
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
      artifactId: "generated:functions:functions-readme",
      artifactType: "markdown-report",
      filePath: "src/functions/README.md",
      content: functionsReadme
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

const expectedFunctionsScaffoldFiles = [
  "package.json",
  "host.json",
  "tsconfig.json",
  "local.settings.example.json"
] as const;

const expectedFunctionsScaffoldDirectories = [
  "src/functions",
  "src/services",
  "src/adapters",
  "src/utils"
] as const;

export const validateFunctionsPackagingScaffold = (
  artifactPaths: string[],
  context: GeneratorContext
): GenerationWarning[] => {
  const warnings: GenerationWarning[] = [];
  const artifactSet = new Set(artifactPaths);

  expectedFunctionsScaffoldFiles.forEach((requiredPath) => {
    if (!artifactSet.has(requiredPath)) {
      warnings.push(
        createWarning({
          code: "FUNCTIONS_PACKAGING_MISSING_FILE",
          message: `Expected scaffold file "${requiredPath}" is missing from generated artifacts.`,
          sourceArtifactIds: [],
          sourceLocation: requiredPath,
          provenance: context.invocationProvenance
        })
      );
    }
  });

  expectedFunctionsScaffoldDirectories.forEach((directory) => {
    const hasDirectory = artifactPaths.some((artifactPath) => artifactPath.startsWith(`${directory}/`));
    if (!hasDirectory) {
      warnings.push(
        createWarning({
          code: "FUNCTIONS_PACKAGING_MISSING_DIRECTORY",
          message: `Expected scaffold directory "${directory}" has no generated files.`,
          sourceArtifactIds: [],
          sourceLocation: directory,
          provenance: context.invocationProvenance
        })
      );
    }
  });

  return sortByStableKey(warnings, (warning) => `${warning.code}:${warning.sourceLocation}`);
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
  lines.push(`- Adapter files generated: ${output.adapterFilesGenerated}`);
  lines.push(`- Total functions generated: ${output.functionsGenerated}`);
  lines.push(`- Unsupported actions: ${output.unsupportedActions}`);
  lines.push(`- Unresolved dependencies: ${output.unresolvedDependencies}`);
  lines.push(`- Manual review hotspots: ${output.manualReviewHotspots}`);
  lines.push(`- Packaging warnings: ${output.packagingWarnings}`);
  lines.push("");
  lines.push("Generated output is scaffold-only and requires manual implementation before production.");
  return `${lines.join("\n")}\n`;
};

const buildMigrationNotes = (functionsPlan: FunctionsGenerationPlanDetails, warnings: GenerationWarning[]): string => {
  const lines: string[] = [];
  lines.push("# Azure Functions Migration Notes");
  lines.push("");
  lines.push("This scaffold preserves migration intent but omits production business logic.");
  lines.push("");
  lines.push("## Adapter boundary strategy");
  lines.push("");
  lines.push(
    ...functionsPlan.plannedAdapterFiles.map(
      (adapter) => `- ${adapter.adapterName} -> ${adapter.filePath} (methods: ${adapter.methodCount})`
    )
  );
  lines.push("");
  lines.push("## Trigger strategy");
  lines.push("");
  lines.push(
    ...functionsPlan.triggerStrategy.map(
      (strategy) =>
        `- ${strategy.functionName}: ${strategy.triggerClassification} -> ${strategy.strategy}${strategy.warning ? ` (warning: ${strategy.warning})` : ""}`
    )
  );
  lines.push("");
  lines.push("## Handler signatures");
  lines.push("");
  lines.push(
    ...functionsPlan.handlerSignatures.map(
      (signature) =>
        `- ${signature.exportedHandler}(${signature.requestType}, ${signature.contextType}) => ${signature.responseType}`
    )
  );
  lines.push("");
  lines.push("## Manual review hotspots");
  lines.push("");
  if (functionsPlan.manualReviewHotspots.length === 0) {
    lines.push("- None.");
  } else {
    lines.push(
      ...functionsPlan.manualReviewHotspots.map(
        (hotspot) => `[${hotspot.severity}] ${hotspot.message}`
      )
    );
  }
  lines.push("");
  lines.push("## Unresolved adapter requirements");
  lines.push("");
  if (functionsPlan.unresolvedAdapterRequirements.length === 0) {
    lines.push("- None.");
  } else {
    lines.push(
      ...functionsPlan.unresolvedAdapterRequirements.map(
        (requirement) => `${requirement.connectorKey}: ${requirement.requirement}`
      )
    );
  }
  lines.push("");
  lines.push("## Generator warnings");
  lines.push("");
  if (warnings.length === 0) {
    lines.push("- None.");
  } else {
    lines.push(
      ...sortByStableKey(warnings, (warning) => `${warning.code}:${warning.message}`).map(
        (warning) => `[${warning.code}] ${warning.message}`
      )
    );
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
  const unresolvedAdapterRequirements: FunctionsUnresolvedAdapterRequirement[] = [];
  const plannedFunctions: FunctionsPlannedFunction[] = [];
  const triggerStrategy: FunctionsTriggerStrategy[] = [];
  const handlerSignatures: FunctionsHandlerSignature[] = [];
  const artifacts: GeneratedArtifact[] = [];
  const sortedFlows = sortByStableKey(input.cloudFlows, (flow) => flow.name);

  const adapterDiscovery = discoverAdapterMethods(sortedFlows, manualReviewHotspots);
  unresolvedAdapterRequirements.push(...adapterDiscovery.unresolvedAdapterRequirements);

  sortedFlows.forEach((flow) => {
    const mappedTrigger = mapFlowTrigger(flow);
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
      triggerMapping: mappedTrigger,
      adapterDiscovery,
      warnings,
      unsupportedFeatures,
      unsupportedActions,
      manualReviewHotspots,
      unresolvedAdapterRequirements,
      context
    });
    artifacts.push(flowArtifact.artifact);
    plannedFunctions.push(flowArtifact.plannedFunction);
    triggerStrategy.push(flowArtifact.triggerStrategy);
    handlerSignatures.push(flowArtifact.handlerSignature);
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
    triggerStrategy.push(entry.triggerStrategy);
    handlerSignatures.push(entry.handlerSignature);
  });

  const sourceArtifactIds = sortByStableKey(
    Array.from(
      new Set([
        ...input.cloudFlows.map((flow) => flow.artifactId),
        ...input.cloudFlows.flatMap((flow) => [flow.trigger.artifactId, ...flow.actions.map((action) => action.artifactId)]),
        ...canvasFormulaRecords.map((record) => record.formula.artifactId)
      ])
    ),
    (value) => value
  );

  const adapterArtifacts = createAdapterArtifacts({
    sourceArtifactIds,
    adapterDiscovery,
    context
  });

  artifacts.push(...adapterArtifacts.artifacts, ...createScaffoldArtifacts(sourceArtifactIds, context));

  const packagingWarnings = validateFunctionsPackagingScaffold(
    artifacts.map((artifact) => artifact.filePath),
    context
  );
  warnings.push(...packagingWarnings);

  const functionsPlan: FunctionsGenerationPlanDetails = {
    plannedFunctions: sortByStableKey(plannedFunctions, (plannedFunction) => plannedFunction.functionName),
    plannedAdapterFiles: adapterArtifacts.plannedAdapterFiles,
    connectorAdapterMappings: adapterDiscovery.mappings,
    triggerStrategy: sortByStableKey(
      triggerStrategy,
      (strategy) => `${strategy.functionName}:${strategy.strategy}`
    ),
    handlerSignatures: sortByStableKey(
      handlerSignatures,
      (signature) => `${signature.functionName}:${signature.exportedHandler}`
    ),
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
    ),
    unresolvedAdapterRequirements: sortByStableKey(
      unresolvedAdapterRequirements,
      (requirement) => `${requirement.connectorKey}:${requirement.requirement}`
    ),
    deploymentReadiness: {
      scaffoldOnly: true,
      needsConfig: true,
      needsManualLogic: true,
      blocked: unresolvedAdapterRequirements.some((requirement) =>
        requirement.connectorKey.startsWith("trigger:")
      )
    }
  };

  const output: AzureFunctionsGenerationOutput = {
    functionsGenerated: functionsPlan.plannedFunctions.length,
    flowFunctionsGenerated: sortedFlows.length,
    canvasApiFunctionsGenerated: canvasArtifacts.length,
    adapterFilesGenerated: functionsPlan.plannedAdapterFiles.length,
    flowsProcessed: sortedFlows.length,
    formulasProcessed: canvasFormulaRecords.length,
    unsupportedActions: functionsPlan.unsupportedActions.length,
    unresolvedDependencies: functionsPlan.unresolvedDependencies.length,
    manualReviewHotspots: functionsPlan.manualReviewHotspots.length,
    packagingWarnings: packagingWarnings.length,
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

  artifacts.push(reportArtifact, notesArtifact);

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
