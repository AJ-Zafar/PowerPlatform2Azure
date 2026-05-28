import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  createUnsupportedFeature,
  createWarning,
  type CloudFlow,
  type FlowAction,
  type FlowActionChild,
  type FlowConnectorCategory,
  type FlowDependencyReference,
  type FlowExpression,
  type FlowExpressionReference,
  type FlowMigrationReadiness,
  type FlowTrigger,
  type FlowTriggerClassification,
  type FlowVariable,
  type ParseResult,
  type ParserWarning,
  type SourceProvenance,
  type UnsupportedFeature
} from "@power-exit/ir";

import { parseXmlDocument } from "./xml";
import type { SolutionDiscoveryData } from "./solution-discovery";
import {
  buildArtifactId,
  clampConfidence,
  getNestedValue,
  getTextAt,
  sorted
} from "./utils";

interface ActionParseAccumulator {
  action: FlowAction;
  childActions: FlowActionChild[];
  warnings: ParserWarning[];
  unsupported: UnsupportedFeature[];
  expressions: FlowExpression[];
  dependencyReferences: FlowDependencyReference[];
}

const PREMIUM_CONNECTOR_MARKERS = [
  "shared_http",
  "shared_approvals",
  "shared_logicflows",
  "shared_customapi"
];

const KNOWN_ACTION_TYPES = new Set([
  "ApiConnection",
  "ApiConnectionWebhook",
  "Compose",
  "If",
  "Switch",
  "Scope",
  "Foreach",
  "Until",
  "Http",
  "Response",
  "InitializeVariable",
  "SetVariable",
  "AppendToArrayVariable",
  "IncrementVariable",
  "Terminate",
  "Workflow"
]);

const normalizeString = (value: string): string => value.trim().replace(/\s+/g, " ");

const connectorCategoryFromApi = (connectorApi: string | undefined): FlowConnectorCategory => {
  if (!connectorApi) {
    return "unknown";
  }

  const normalized = connectorApi.toLowerCase();

  if (normalized.includes("custom_")) {
    return "custom";
  }

  if (PREMIUM_CONNECTOR_MARKERS.some((marker) => normalized.includes(marker))) {
    return "premium";
  }

  if (normalized.includes("shared_")) {
    return "standard";
  }

  return "unknown";
};

const connectorNameFromApiId = (apiId: string | undefined): string | undefined => {
  if (!apiId) {
    return undefined;
  }

  const normalized = apiId.trim();
  const marker = "/apis/";
  const index = normalized.toLowerCase().lastIndexOf(marker);

  if (index === -1) {
    return normalized.split("/").filter(Boolean).pop();
  }

  return normalized.slice(index + marker.length).split(/[/?]/)[0];
};

const triggerClassification = (
  triggerType: string,
  connectorApi: string | undefined
): FlowTriggerClassification => {
  const type = triggerType.toLowerCase();
  const connector = connectorApi?.toLowerCase() ?? "";

  if (type.includes("recurrence")) {
    return "recurrence";
  }

  if (type.includes("request") || type.includes("manual")) {
    return "manual";
  }

  if (type.includes("http")) {
    return "http";
  }

  if (
    connector.includes("commondataservice") ||
    connector.includes("dataverse") ||
    type.includes("webhook")
  ) {
    return "dataverse";
  }

  if (connector.includes("office365") || connector.includes("outlook")) {
    return "email";
  }

  if (connector.includes("sharepoint")) {
    return "sharepoint";
  }

  if (type.includes("api")) {
    return "event";
  }

  return "unknown";
};

const expressionReferenceFromPattern = (
  referenceType: FlowExpressionReference["referenceType"],
  name: string,
  resolved = false
): FlowExpressionReference => ({
  referenceType,
  name,
  resolved
});

const extractExpressionReferences = (rawExpression: string): FlowExpressionReference[] => {
  const references: FlowExpressionReference[] = [];
  const pushUnique = (reference: FlowExpressionReference): void => {
    if (
      references.some(
        (entry) =>
          entry.referenceType === reference.referenceType && entry.name === reference.name
      )
    ) {
      return;
    }

    references.push(reference);
  };

  for (const match of rawExpression.matchAll(/variables\(\s*'([^']+)'\s*\)/gi)) {
    if (match[1]) {
      pushUnique(expressionReferenceFromPattern("variable", match[1]));
    }
  }

  for (const match of rawExpression.matchAll(/actions\(\s*'([^']+)'\s*\)/gi)) {
    if (match[1]) {
      pushUnique(expressionReferenceFromPattern("action", match[1]));
    }
  }

  if (/(triggerOutputs|triggerBody)\s*\(/i.test(rawExpression)) {
    pushUnique(expressionReferenceFromPattern("trigger", "trigger"));
  }

  for (const match of rawExpression.matchAll(/\b(ENV_[A-Z0-9_]+)\b/g)) {
    if (match[1]) {
      pushUnique(expressionReferenceFromPattern("environmentVariable", match[1]));
    }
  }

  for (const match of rawExpression.matchAll(/\/tables\/([A-Za-z0-9_]+)/g)) {
    if (match[1]) {
      pushUnique(expressionReferenceFromPattern("entity", match[1]));
    }
  }

  return sorted(references, (reference) => `${reference.referenceType}:${reference.name}`);
};

const collectExpressions = (
  source: unknown,
  baseName: string,
  provenance: SourceProvenance
): FlowExpression[] => {
  const expressions: FlowExpression[] = [];
  const visit = (value: unknown, pathSegments: string[]): void => {
    if (typeof value === "string") {
      if (!value.includes("@") && !/variables\(|actions\(/i.test(value)) {
        return;
      }

      const expressionPath = pathSegments.join(".") || "expression";
      expressions.push({
        artifactId: buildArtifactId(
          "flow-expression",
          `${baseName}-${expressionPath}-${expressions.length + 1}`
        ),
        expressionName: expressionPath,
        rawExpression: value,
        references: extractExpressionReferences(value),
        provenance,
        confidence: 0.85
      });
      return;
    }

    if (Array.isArray(value)) {
      value.forEach((entry, index) => visit(entry, [...pathSegments, String(index)]));
      return;
    }

    if (value && typeof value === "object") {
      for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
        visit(entry, [...pathSegments, key]);
      }
    }
  };

  visit(source, []);
  return sorted(expressions, (expression) => expression.artifactId);
};

const extractEntityReferencesFromObject = (source: unknown): string[] => {
  const references = new Set<string>();

  const visit = (value: unknown, keyPath: string[]): void => {
    if (typeof value === "string") {
      const key = keyPath[keyPath.length - 1]?.toLowerCase() ?? "";
      if (key.includes("entity") || key.includes("table")) {
        references.add(value.toLowerCase());
      }

      const tableMatch = /\/tables\/([A-Za-z0-9_]+)/i.exec(value);
      if (tableMatch?.[1]) {
        references.add(tableMatch[1].toLowerCase());
      }
      return;
    }

    if (Array.isArray(value)) {
      value.forEach((entry, index) => visit(entry, [...keyPath, String(index)]));
      return;
    }

    if (value && typeof value === "object") {
      for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
        visit(entry, [...keyPath, key]);
      }
    }
  };

  visit(source, []);
  return sorted(Array.from(references), (entry) => entry);
};

const extractConnectionReferencesFromAction = (actionDefinition: unknown): string[] => {
  const references = new Set<string>();
  const hostConnectionName = getTextAt(actionDefinition, [
    "inputs.host.connection.referenceName",
    "inputs.host.connection.name",
    "host.connection.referenceName",
    "host.connection.name"
  ]);

  if (hostConnectionName) {
    references.add(hostConnectionName);
  }

  const visit = (value: unknown): void => {
    if (typeof value === "string") {
      const match = value.match(/\b[a-z0-9]+_[a-z0-9_]+\b/gi);
      if (match) {
        for (const token of match) {
          if (token.includes("_")) {
            references.add(token);
          }
        }
      }
      return;
    }

    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }

    if (value && typeof value === "object") {
      Object.values(value as Record<string, unknown>).forEach(visit);
    }
  };

  visit(actionDefinition);
  return sorted(Array.from(references), (entry) => entry);
};

const parseRunAfter = (actionDefinition: unknown): FlowAction["runAfter"] => {
  const runAfterRaw = getNestedValue(actionDefinition, ["runAfter"]);

  if (!runAfterRaw || typeof runAfterRaw !== "object" || Array.isArray(runAfterRaw)) {
    return [];
  }

  return sorted(
    Object.entries(runAfterRaw as Record<string, unknown>).map(([actionName, statuses]) => ({
      actionName,
      statuses: Array.isArray(statuses)
        ? statuses.filter((status): status is string => typeof status === "string")
        : []
    })),
    (entry) => entry.actionName
  );
};

const parseScopeControl = (actionType: string, actionDefinition: unknown): FlowAction["scopeControl"] => {
  const normalizedType = actionType.toLowerCase();
  const childActions = getNestedValue(actionDefinition, ["actions"]);
  const elseActions = getNestedValue(actionDefinition, ["else", "actions"]);
  const hasParallelBranches = Boolean(
    getNestedValue(actionDefinition, ["runtimeConfiguration", "concurrency"])
  );

  return {
    isScope: normalizedType === "scope",
    isCondition: normalizedType === "if" || normalizedType === "switch",
    isLoop: normalizedType === "foreach" || normalizedType === "until",
    hasParallelBranches,
    branchType:
      childActions && elseActions
        ? "ifElse"
        : hasParallelBranches
          ? "parallel"
          : undefined
  };
};

const parseActionChildren = (
  flowId: string,
  parentActionName: string,
  actionDefinition: unknown,
  provenance: SourceProvenance
): FlowActionChild[] => {
  const candidates: Array<[string, unknown]> = [];
  const directChildren = getNestedValue(actionDefinition, ["actions"]);
  const elseChildren = getNestedValue(actionDefinition, ["else", "actions"]);

  if (directChildren && typeof directChildren === "object" && !Array.isArray(directChildren)) {
    candidates.push(...Object.entries(directChildren as Record<string, unknown>));
  }

  if (elseChildren && typeof elseChildren === "object" && !Array.isArray(elseChildren)) {
    candidates.push(...Object.entries(elseChildren as Record<string, unknown>));
  }

  return sorted(
    candidates.map(([childName, childAction]) => ({
      artifactId: buildArtifactId("flow-action", `${flowId}-${parentActionName}-${childName}`),
      actionName: childName,
      actionType: getTextAt(childAction, ["type"]) ?? "Unknown",
      provenance,
      confidence: 0.75
    })),
    (child) => child.artifactId
  );
};

const parseAction = (
  flowId: string,
  actionName: string,
  actionDefinition: unknown,
  provenance: SourceProvenance
): ActionParseAccumulator => {
  const warnings: ParserWarning[] = [];
  const unsupported: UnsupportedFeature[] = [];
  const actionType = getTextAt(actionDefinition, ["type"]) ?? "Unknown";
  const connectorApi =
    connectorNameFromApiId(
      getTextAt(actionDefinition, ["inputs.host.apiId", "host.apiId", "inputs.apiId"])
    ) ?? getTextAt(actionDefinition, ["inputs.host.api.name", "host.api.name"]);
  const connectorCategory = connectorCategoryFromApi(connectorApi);
  const expressions = collectExpressions(
    actionDefinition,
    `${flowId}-${actionName}`,
    provenance
  );
  const referencedEntities = extractEntityReferencesFromObject(actionDefinition);
  const referencedConnectionReferences = extractConnectionReferencesFromAction(actionDefinition);
  const childActions = parseActionChildren(flowId, actionName, actionDefinition, provenance);
  const runAfter = parseRunAfter(actionDefinition);

  if (!KNOWN_ACTION_TYPES.has(actionType)) {
    warnings.push(
      createWarning({
        code: "FLOW_ACTION_UNSUPPORTED_TYPE",
        message: `Flow action "${actionName}" has unsupported type "${actionType}".`,
        sourceLocation: provenance.sourcePath,
        provenance,
        confidence: 0.95
      })
    );
    unsupported.push(
      createUnsupportedFeature({
        featureType: `flow.action.unsupported-type.${actionType.toLowerCase()}`,
        sourceLocation: provenance.sourcePath,
        reason: `Action type "${actionType}" is not supported by the current flow parser.`,
        suggestedRemediation:
          "Replace unsupported actions with supported equivalents or mark for manual migration.",
        severity: "medium",
        confidence: 0.9,
        provenance
      })
    );
  }

  if (
    connectorCategory !== "standard" &&
    connectorCategory !== "unknown" &&
    connectorApi !== undefined
  ) {
    warnings.push(
      createWarning({
        code: "FLOW_PREMIUM_OR_CUSTOM_CONNECTOR",
        message: `Flow action "${actionName}" uses ${connectorCategory} connector "${connectorApi}".`,
        sourceLocation: provenance.sourcePath,
        provenance,
        confidence: 0.85
      })
    );
  }

  if (actionType === "Http") {
    warnings.push(
      createWarning({
        code: "FLOW_HTTP_ACTION",
        message: `Flow action "${actionName}" uses HTTP and may require manual migration hardening.`,
        sourceLocation: provenance.sourcePath,
        provenance,
        confidence: 0.8
      })
    );
  }

  const operationId = getTextAt(actionDefinition, [
    "inputs.host.operationId",
    "host.operationId",
    "operationId"
  ]);

  if (operationId?.toLowerCase().includes("approval")) {
    warnings.push(
      createWarning({
        code: "FLOW_HUMAN_IN_THE_LOOP_ACTION",
        message: `Flow action "${actionName}" appears to require human approval.`,
        sourceLocation: provenance.sourcePath,
        provenance,
        confidence: 0.9
      })
    );
  }

  if (["Foreach", "Until"].includes(actionType)) {
    warnings.push(
      createWarning({
        code: "FLOW_LOOP_ACTION",
        message: `Flow action "${actionName}" introduces loop control flow.`,
        sourceLocation: provenance.sourcePath,
        provenance,
        confidence: 0.85
      })
    );
  }

  if (actionType === "Workflow" || operationId?.toLowerCase().includes("child_flow")) {
    warnings.push(
      createWarning({
        code: "FLOW_CHILD_FLOW_ACTION",
        message: `Flow action "${actionName}" runs a child flow.`,
        sourceLocation: provenance.sourcePath,
        provenance,
        confidence: 0.9
      })
    );
  }

  if (connectorApi?.includes("commondataservice") && referencedEntities.length === 0) {
    warnings.push(
      createWarning({
        code: "FLOW_UNRESOLVED_DATAVERSE_REFERENCE",
        message: `Dataverse action "${actionName}" does not expose a table/entity reference.`,
        sourceLocation: provenance.sourcePath,
        provenance,
        confidence: 0.8
      })
    );
  }

  if (
    connectorApi &&
    connectorApi.includes("shared_") &&
    referencedConnectionReferences.length === 0
  ) {
    warnings.push(
      createWarning({
        code: "FLOW_MISSING_CONNECTION_REFERENCE",
        message: `Action "${actionName}" uses connector "${connectorApi}" without a connection reference.`,
        sourceLocation: provenance.sourcePath,
        provenance,
        confidence: 0.85
      })
    );
  }

  const dependencyReferences: FlowDependencyReference[] = [
    ...referencedConnectionReferences.map((referenceName) => ({
      referenceType: "connectionReference" as const,
      referenceName,
      resolved: false,
      provenance,
      confidence: 0.8
    })),
    ...referencedEntities.map((referenceName) => ({
      referenceType: "entity" as const,
      referenceName,
      resolved: false,
      provenance,
      confidence: 0.8
    })),
    ...expressions.flatMap((expression) =>
      expression.references.map((reference) => {
        const referenceType: FlowDependencyReference["referenceType"] =
          reference.referenceType === "environmentVariable"
            ? "environmentVariable"
            : reference.referenceType === "variable"
              ? "variable"
              : reference.referenceType === "action"
                ? "action"
                : reference.referenceType === "trigger"
                  ? "trigger"
                  : "unknown";

        return {
          referenceType,
          referenceName: reference.name,
          resolved: false,
          provenance,
          confidence: 0.75
        };
      })
    )
  ];

  const action: FlowAction = {
    artifactId: buildArtifactId("flow-action", `${flowId}-${actionName}`),
    actionName,
    actionType,
    connectorApi,
    connectorCategory,
    operationId,
    runAfter,
    inputs: getNestedValue(actionDefinition, ["inputs"]),
    expressions,
    referencedEntities,
    referencedConnectionReferences,
    childActions,
    scopeControl: parseScopeControl(actionType, actionDefinition),
    provenance,
    confidence: clampConfidence(1 - (warnings.length + unsupported.length) * 0.08)
  };

  return {
    action,
    childActions,
    warnings,
    unsupported,
    expressions,
    dependencyReferences
  };
};

const parseTrigger = (
  flowId: string,
  triggerName: string,
  triggerDefinition: unknown,
  provenance: SourceProvenance
): { trigger: FlowTrigger; warnings: ParserWarning[]; dependencyReferences: FlowDependencyReference[] } => {
  const warnings: ParserWarning[] = [];
  const triggerType = getTextAt(triggerDefinition, ["type"]) ?? "Unknown";
  const connectorApi =
    connectorNameFromApiId(
      getTextAt(triggerDefinition, ["inputs.host.apiId", "host.apiId", "inputs.apiId"])
    ) ?? getTextAt(triggerDefinition, ["inputs.host.api.name", "host.api.name"]);
  const classification = triggerClassification(triggerType, connectorApi);
  const expressions = collectExpressions(
    triggerDefinition,
    `${flowId}-${triggerName}-trigger`,
    provenance
  );
  const recurrence = getNestedValue(triggerDefinition, ["recurrence"]);
  const recurrenceMetadata =
    recurrence && typeof recurrence === "object" && !Array.isArray(recurrence)
      ? {
          frequency: getTextAt(recurrence, ["frequency"]),
          interval:
            typeof getNestedValue(recurrence, ["interval"]) === "number"
              ? (getNestedValue(recurrence, ["interval"]) as number)
              : undefined,
          schedule: getNestedValue(recurrence, ["schedule"]),
          timeZone: getTextAt(recurrence, ["timeZone", "timezone"])
        }
      : undefined;

  if (classification === "http" || triggerType.toLowerCase().includes("webhook")) {
    warnings.push(
      createWarning({
        code: "FLOW_HTTP_OR_WEBHOOK_TRIGGER",
        message: `Trigger "${triggerName}" uses HTTP/webhook semantics and may require manual migration.`,
        sourceLocation: provenance.sourcePath,
        provenance,
        confidence: 0.85
      })
    );
  }

  if (connectorCategoryFromApi(connectorApi) !== "standard" && connectorApi) {
    warnings.push(
      createWarning({
        code: "FLOW_PREMIUM_OR_CUSTOM_CONNECTOR",
        message: `Trigger "${triggerName}" uses connector "${connectorApi}" requiring additional migration checks.`,
        sourceLocation: provenance.sourcePath,
        provenance,
        confidence: 0.85
      })
    );
  }

  const trigger: FlowTrigger = {
    artifactId: buildArtifactId("flow-trigger", `${flowId}-${triggerName}`),
    triggerName,
    triggerType,
    connectorApi,
    triggerClassification: classification,
    inputs: getNestedValue(triggerDefinition, ["inputs"]),
    recurrence: recurrenceMetadata,
    authenticationHint: getTextAt(triggerDefinition, [
      "inputs.authentication.type",
      "inputs.authentication.scheme",
      "authentication.type"
    ]),
    expressions,
    provenance,
    confidence: clampConfidence(1 - warnings.length * 0.08)
  };

  const dependencyReferences: FlowDependencyReference[] = expressions.flatMap((expression) =>
    expression.references.map((reference) => ({
      referenceType:
        reference.referenceType === "environmentVariable"
          ? "environmentVariable"
          : reference.referenceType === "trigger"
            ? "trigger"
            : "unknown",
      referenceName: reference.name,
      resolved: false,
      provenance,
      confidence: 0.75
    }))
  );

  return { trigger, warnings, dependencyReferences };
};

const parseConnections = (
  flowId: string,
  flowObject: unknown,
  provenance: SourceProvenance
): CloudFlow["connections"] => {
  const rawReferences = getNestedValue(flowObject, ["properties", "connectionReferences"]);
  if (!rawReferences || typeof rawReferences !== "object" || Array.isArray(rawReferences)) {
    return [];
  }

  return sorted(
    Object.entries(rawReferences as Record<string, unknown>).map(([referenceName, value]) => {
      const connectorApi = getTextAt(value, ["api.name", "api.id"]) ?? "unknown";
      return {
        artifactId: buildArtifactId("flow-connection", `${flowId}-${referenceName}`),
        referenceName,
        connectorApi,
        connectionName: getTextAt(value, ["connectionName", "connection.name"]),
        connectorCategory: connectorCategoryFromApi(connectorApi),
        provenance,
        confidence: 0.85
      };
    }),
    (connection) => connection.artifactId
  );
};

const parseVariables = (
  flowId: string,
  actions: FlowAction[],
  provenance: SourceProvenance
): FlowVariable[] => {
  const variables = new Map<string, FlowVariable>();

  for (const action of actions) {
    if (
      ![
        "InitializeVariable",
        "SetVariable",
        "AppendToArrayVariable",
        "IncrementVariable"
      ].includes(action.actionType)
    ) {
      continue;
    }

    const variableName = getTextAt(action.inputs, [
      "name",
      "variables.0.name",
      "inputs.name"
    ]);

    if (!variableName) {
      continue;
    }

    variables.set(variableName, {
      artifactId: buildArtifactId("flow-variable", `${flowId}-${variableName}`),
      variableName,
      variableType: getTextAt(action.inputs, ["type", "variables.0.type"]) ?? "unknown",
      initialValue: getNestedValue(action.inputs, ["value"]),
      provenance,
      confidence: 0.8
    });
  }

  return sorted(Array.from(variables.values()), (variable) => variable.artifactId);
};

const classifyFlowReadiness = (
  triggerComplexity: number,
  actionComplexity: number,
  connectorComplexity: number,
  expressionComplexity: number,
  controlFlowComplexity: number,
  unsupportedFeatureCount: number
): FlowMigrationReadiness => {
  if (
    unsupportedFeatureCount > 0 ||
    connectorComplexity >= 0.75 ||
    actionComplexity >= 0.75 ||
    controlFlowComplexity >= 0.8
  ) {
    return "blocked";
  }

  if (
    triggerComplexity >= 0.65 ||
    actionComplexity >= 0.55 ||
    expressionComplexity >= 0.55 ||
    controlFlowComplexity >= 0.6
  ) {
    return "low";
  }

  if (
    triggerComplexity >= 0.35 ||
    actionComplexity >= 0.35 ||
    expressionComplexity >= 0.35 ||
    connectorComplexity >= 0.35
  ) {
    return "medium";
  }

  return "high";
};

const parseFlowFromJson = (
  relativePath: string,
  rawPayload: unknown
): {
  flow: CloudFlow;
  warnings: ParserWarning[];
  unsupported: UnsupportedFeature[];
} => {
  const provenance: SourceProvenance = {
    sourcePath: relativePath,
    sourceType: "flow"
  };
  const flowId =
    getTextAt(rawPayload, ["name", "id", "properties.workflowName"]) ??
    path.parse(relativePath).name;
  const displayName =
    getTextAt(rawPayload, ["properties.displayName", "displayName", "name"]) ?? flowId;
  const name = getTextAt(rawPayload, ["name"]) ?? flowId;
  const status = getTextAt(rawPayload, ["properties.state", "properties.status", "state"]);
  const definition =
    getNestedValue(rawPayload, ["properties", "definition"]) ??
    getNestedValue(rawPayload, ["definition"]) ??
    {};
  const triggerEntries =
    definition && typeof definition === "object" && !Array.isArray(definition)
      ? Object.entries(
          (getNestedValue(definition, ["triggers"]) as Record<string, unknown>) ?? {}
        )
      : [];
  const [triggerName, triggerDefinition] = triggerEntries[0] ?? [
    "unknown_trigger",
    { type: "Unknown" }
  ];
  const triggerParse = parseTrigger(flowId, triggerName, triggerDefinition, provenance);
  const actionEntries =
    definition && typeof definition === "object" && !Array.isArray(definition)
      ? Object.entries(
          (getNestedValue(definition, ["actions"]) as Record<string, unknown>) ?? {}
        )
      : [];
  const actionParses = actionEntries.map(([actionName, actionDefinition]) =>
    parseAction(flowId, actionName, actionDefinition, provenance)
  );
  const actions = sorted(
    actionParses.map((parsed) => parsed.action),
    (action) => action.artifactId
  );
  const actionWarnings = actionParses.flatMap((parsed) => parsed.warnings);
  const actionUnsupported = actionParses.flatMap((parsed) => parsed.unsupported);
  const actionExpressions = actionParses.flatMap((parsed) => parsed.expressions);
  const actionDependencyReferences = actionParses.flatMap(
    (parsed) => parsed.dependencyReferences
  );
  const connections = parseConnections(flowId, rawPayload, provenance);
  const variables = parseVariables(flowId, actions, provenance);
  const expressions = sorted(
    [...triggerParse.trigger.expressions, ...actionExpressions],
    (expression) => expression.artifactId
  );
  const dependencyReferences = sorted(
    [
      ...connections.map((connection) => ({
        referenceType: "connectionReference" as const,
        referenceName: connection.referenceName,
        resolved: false,
        provenance,
        confidence: 0.85
      })),
      ...actionDependencyReferences,
      ...triggerParse.dependencyReferences
    ],
    (reference) => `${reference.referenceType}:${reference.referenceName}`
  );
  const allWarnings = [...triggerParse.warnings, ...actionWarnings];
  const unsupported = actionUnsupported;
  const connectorNames = new Set(
    [
      ...connections.map((connection) => connection.connectorApi),
      ...actions
        .map((action) => action.connectorApi)
        .filter((connector): connector is string => Boolean(connector)),
      triggerParse.trigger.connectorApi
    ].filter((connector): connector is string => Boolean(connector))
  );
  const premiumConnectorCount = Array.from(connectorNames).filter((connector) =>
    ["premium", "custom"].includes(connectorCategoryFromApi(connector))
  ).length;
  const controlFlowActionCount = actions.filter(
    (action) =>
      action.scopeControl.isCondition ||
      action.scopeControl.isLoop ||
      action.scopeControl.isScope
  ).length;
  const triggerComplexity = (() => {
    switch (triggerParse.trigger.triggerClassification) {
      case "manual":
        return 0.2;
      case "recurrence":
        return 0.3;
      case "event":
      case "email":
      case "sharepoint":
        return 0.45;
      case "dataverse":
        return 0.6;
      case "http":
        return 0.75;
      default:
        return 0.5;
    }
  })();
  const actionComplexity = clampConfidence(
    actions.length / 12 +
      controlFlowActionCount * 0.08 +
      unsupported.length * 0.2 +
      actions.filter((action) => action.actionType === "Http").length * 0.1
  );
  const connectorComplexity = clampConfidence(
    premiumConnectorCount * 0.3 + connectorNames.size / 10
  );
  const expressionComplexity = clampConfidence(expressions.length / 15);
  const controlFlowComplexity = clampConfidence(
    controlFlowActionCount * 0.2 +
      actions.filter((action) => action.scopeControl.hasParallelBranches).length * 0.2
  );
  const migrationReadiness = classifyFlowReadiness(
    triggerComplexity,
    actionComplexity,
    connectorComplexity,
    expressionComplexity,
    controlFlowComplexity,
    unsupported.length
  );

  if (actions.filter((action) => action.scopeControl.hasParallelBranches).length > 0) {
    allWarnings.push(
      createWarning({
        code: "FLOW_PARALLEL_BRANCHES",
        message: "Flow includes runtime parallel branch configuration.",
        sourceLocation: relativePath,
        provenance,
        confidence: 0.85
      })
    );
  }

  const flow: CloudFlow = {
    artifactId: buildArtifactId("flow", flowId),
    flowId,
    name: normalizeString(name),
    displayName: normalizeString(displayName),
    status: status ? normalizeString(status) : undefined,
    trigger: triggerParse.trigger,
    actions,
    connections,
    variables,
    inputs: getNestedValue(definition, ["inputs"]),
    outputs: getNestedValue(definition, ["outputs"]),
    expressions,
    dependencyReferences,
    warnings: sorted(allWarnings, (warning) => `${warning.code}:${warning.message}`),
    unsupportedFeatures: sorted(
      unsupported,
      (feature) => `${feature.featureType}:${feature.sourceLocation}`
    ),
    triggerComplexity,
    actionComplexity,
    connectorComplexity,
    expressionComplexity,
    controlFlowComplexity,
    unsupportedFeatureCount: unsupported.length,
    migrationReadiness,
    provenance,
    confidence: clampConfidence(1 - (allWarnings.length + unsupported.length) * 0.05)
  };

  return {
    flow,
    warnings: flow.warnings,
    unsupported: flow.unsupportedFeatures
  };
};

const parseFlowFromXmlMetadata = (
  relativePath: string,
  rawXmlPayload: string
): {
  flow: CloudFlow;
  warnings: ParserWarning[];
} => {
  const provenance: SourceProvenance = {
    sourcePath: relativePath,
    sourceType: "flow"
  };

  let parsed: unknown;
  try {
    parsed = parseXmlDocument(rawXmlPayload);
  } catch {
    return {
      flow: {
        artifactId: buildArtifactId("flow", path.parse(relativePath).name),
        flowId: path.parse(relativePath).name,
        name: path.parse(relativePath).name,
        displayName: path.parse(relativePath).name,
        trigger: {
          artifactId: buildArtifactId("flow-trigger", `${path.parse(relativePath).name}-unknown`),
          triggerName: "unknown_trigger",
          triggerType: "Unknown",
          triggerClassification: "unknown",
          expressions: [],
          provenance,
          confidence: 0.4
        },
        actions: [],
        connections: [],
        variables: [],
        expressions: [],
        dependencyReferences: [],
        warnings: [
          createWarning({
            code: "FLOW_XML_INVALID",
            message: "Flow XML metadata is malformed and could not be fully parsed.",
            sourceLocation: relativePath,
            provenance,
            confidence: 0.95
          })
        ],
        unsupportedFeatures: [],
        triggerComplexity: 0.5,
        actionComplexity: 0,
        connectorComplexity: 0,
        expressionComplexity: 0,
        controlFlowComplexity: 0,
        unsupportedFeatureCount: 0,
        migrationReadiness: "low",
        provenance,
        confidence: 0.4
      },
      warnings: [
        createWarning({
          code: "FLOW_XML_INVALID",
          message: "Flow XML metadata is malformed and could not be fully parsed.",
          sourceLocation: relativePath,
          provenance,
          confidence: 0.95
        })
      ]
    };
  }

  const flowId = getTextAt(parsed, ["Workflow.Name"]) ?? path.parse(relativePath).name;
  const displayName =
    getTextAt(parsed, ["Workflow.DisplayName", "Workflow.Name"]) ?? flowId;
  const triggerType = getTextAt(parsed, ["Workflow.TriggerType"]) ?? "Unknown";
  const triggerClassificationValue = triggerClassification(triggerType, undefined);
  const warning = createWarning({
    code: "FLOW_XML_PARTIAL_METADATA",
    message: "Flow XML metadata was parsed using best-effort extraction.",
    sourceLocation: relativePath,
    provenance,
    confidence: 0.8
  });

  return {
    flow: {
      artifactId: buildArtifactId("flow", flowId),
      flowId,
      name: flowId,
      displayName,
      status: getTextAt(parsed, ["Workflow.State"]),
      trigger: {
        artifactId: buildArtifactId("flow-trigger", `${flowId}-legacy-trigger`),
        triggerName: "legacy_trigger",
        triggerType,
        triggerClassification: triggerClassificationValue,
        expressions: [],
        provenance,
        confidence: 0.7
      },
      actions: [],
      connections: [],
      variables: [],
      expressions: [],
      dependencyReferences: [],
      warnings: [warning],
      unsupportedFeatures: [],
      triggerComplexity: triggerClassificationValue === "recurrence" ? 0.3 : 0.5,
      actionComplexity: 0,
      connectorComplexity: 0,
      expressionComplexity: 0,
      controlFlowComplexity: 0,
      unsupportedFeatureCount: 0,
      migrationReadiness: "medium",
      provenance,
      confidence: 0.7
    },
    warnings: [warning]
  };
};

export const parseCloudFlows = async (
  solutionPath: string,
  discovery: SolutionDiscoveryData
): Promise<ParseResult<CloudFlow[]>> => {
  const flowMap = new Map<string, CloudFlow>();
  const warnings: ParserWarning[] = [];
  const unsupported: UnsupportedFeature[] = [];

  for (const file of discovery.files) {
    if (file.classification !== "workflows-folder") {
      continue;
    }

    const absolutePath = path.join(solutionPath, file.path);
    const extension = path.extname(file.path).toLowerCase();
    let content = "";

    try {
      content = await readFile(absolutePath, "utf-8");
    } catch {
      warnings.push(
        createWarning({
          code: "FLOW_READ_FAILED",
          message: "Flow file could not be read.",
          sourceLocation: file.path,
          provenance: file.provenance,
          confidence: 1
        })
      );
      continue;
    }

    if (extension === ".json") {
      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(content) as unknown;
      } catch {
        warnings.push(
          createWarning({
            code: "FLOW_JSON_INVALID",
            message: "Flow JSON definition is malformed and was skipped.",
            sourceLocation: file.path,
            provenance: file.provenance,
            confidence: 1
          })
        );
        continue;
      }

      const parsedFlow = parseFlowFromJson(file.path, parsedJson);
      flowMap.set(parsedFlow.flow.artifactId, parsedFlow.flow);
      warnings.push(...parsedFlow.warnings);
      unsupported.push(...parsedFlow.unsupported);
      continue;
    }

    if (extension === ".xml" || extension === ".xaml") {
      const parsedFlow = parseFlowFromXmlMetadata(file.path, content);
      flowMap.set(parsedFlow.flow.artifactId, parsedFlow.flow);
      warnings.push(...parsedFlow.warnings);
      continue;
    }

    warnings.push(
      createWarning({
        code: "FLOW_FILE_UNSUPPORTED_FORMAT",
        message: "Workflow file format is not supported yet.",
        sourceLocation: file.path,
        provenance: file.provenance,
        confidence: 0.95
      })
    );
  }

  const flows = sorted(Array.from(flowMap.values()), (flow) => flow.artifactId);
  const confidencePenalty =
    flows.length === 0 ? 0.2 : (warnings.length + unsupported.length) / (flows.length * 20);

  return {
    data: flows,
    warnings: sorted(warnings, (warning) => `${warning.code}:${warning.message}`),
    unsupported: sorted(
      unsupported,
      (feature) => `${feature.featureType}:${feature.sourceLocation}`
    ),
    confidence: clampConfidence(1 - confidencePenalty),
    provenance: {
      sourcePath: solutionPath,
      sourceType: "flow"
    }
  };
};
