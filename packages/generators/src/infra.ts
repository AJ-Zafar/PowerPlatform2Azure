import { createHash } from "node:crypto";

import { z } from "zod";

import { sortByStableKey, validatePowerPlatformIR, type PowerPlatformIR } from "@power-exit/ir";

import {
  createGenerationResultSchema,
  infraGenerationPlanDetailsSchema,
  type GenerationResult,
  type GenerationUnsupportedFeature,
  type GenerationWarning,
  type GeneratedArtifact,
  type GeneratorContext,
  type InfraGenerationPlanDetails
} from "./contracts";

const azureInfraGenerationOutputSchema = z
  .object({
    resourcesPlanned: z.number().int().nonnegative(),
    modulesPlanned: z.number().int().nonnegative(),
    parameterFilesGenerated: z.number().int().nonnegative(),
    warnings: z.number().int().nonnegative(),
    infraPlan: infraGenerationPlanDetailsSchema
  })
  .strict();

export type AzureInfraGenerationOutput = z.infer<typeof azureInfraGenerationOutputSchema>;

const modulePaths = sortByStableKey(
  [
    "infra/modules/app-insights.bicep",
    "infra/modules/app-service.bicep",
    "infra/modules/function-app.bicep",
    "infra/modules/key-vault.bicep",
    "infra/modules/managed-identity.bicep",
    "infra/modules/sql-database.bicep",
    "infra/modules/sql-server.bicep",
    "infra/modules/storage.bicep"
  ],
  (value) => value
);

const parameterFilePaths = sortByStableKey(
  [
    "infra/parameters.dev.json",
    "infra/parameters.prod.json",
    "infra/parameters.test.json"
  ],
  (value) => value
);

const securityManualReviewItems = sortByStableKey(
  [
    "TODO: configure networking/private endpoints and deny public ingress where required.",
    "TODO: enforce Entra ID authentication strategy for application and SQL access.",
    "TODO: tighten SQL firewall and connectivity rules before non-dev rollout.",
    "TODO: assign least-privilege RBAC role assignments for managed identities.",
    "TODO: configure monitoring, diagnostics, and actionable alerts.",
    "TODO: define backup and retention policy for SQL, storage, and app telemetry.",
    "TODO: document environment promotion strategy and release gates."
  ],
  (value) => value
);

const unresolvedConfigurationItems = sortByStableKey(
  [
    "Azure region selection is placeholder-only and requires environment-specific values.",
    "DNS, private endpoint zones, and routing boundaries are not configured in scaffold.",
    "Non-production and production naming/sku policies require manual confirmation.",
    "Key Vault access policy and RBAC assignment details require tenant-specific identities."
  ],
  (value) => value
);

const defaultContext = (): GeneratorContext => ({
  invocationProvenance: {
    sourcePath: "generators/infra",
    sourceType: "generator"
  }
});

const sanitizeToken = (value: string): string => {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return normalized.length > 0 ? normalized : "solution";
};

const createWarning = (
  input: Omit<GenerationWarning, "severity" | "confidence">
): GenerationWarning => ({
  severity: "warning",
  confidence: 0.85,
  ...input
});

const hasMissingSolutionMetadata = (ir: PowerPlatformIR): boolean => {
  const name = ir.solution.name.trim().toLowerCase();
  const uniqueName = ir.solution.uniqueName.trim().toLowerCase();
  const publisherName = ir.solution.publisher.uniqueName.trim().toLowerCase();
  return (
    name.length === 0 ||
    uniqueName.length === 0 ||
    publisherName.length === 0 ||
    name === "unknown solution" ||
    uniqueName === "unknown_solution" ||
    publisherName === "unknown_publisher"
  );
};

const detectRequirements = (ir: PowerPlatformIR): {
  sql: boolean;
  functions: boolean;
  react: boolean;
} => ({
  sql: ir.dataverse.entities.length > 0 || ir.analysisSummary.entities > 0,
  functions: ir.cloudFlows.length > 0 || ir.analysisSummary.flows > 0,
  react: ir.canvasApps.length > 0 || ir.analysisSummary.canvasApps > 0
});

const computeHash = (content: string): string =>
  createHash("sha256").update(content, "utf-8").digest("hex");

const createArtifact = (
  filePath: string,
  artifactType: string,
  content: string,
  sourceArtifactIds: string[],
  context: GeneratorContext
): GeneratedArtifact => ({
  artifactId: `generated:infra:${sanitizeToken(filePath.replace(/\//g, "-").replace(/\./g, "-"))}`,
  artifactType,
  filePath,
  content,
  sourceArtifactIds,
  warnings: [],
  provenance: context.invocationProvenance,
  confidence: 0.85
});

const renderMainBicep = (baseName: string): string => `targetScope = 'resourceGroup'

@description('Deterministic scaffold base name derived from solution metadata.')
param baseName string = '${baseName}'

@description('Environment short name (dev/test/prod).')
param environmentName string

@description('Deployment location placeholder. Set per environment parameter file.')
param location string = resourceGroup().location

@description('Enable React web workload resources.')
param deployReact bool = true

@description('Enable Azure Functions workload resources.')
param deployFunctions bool = true

@description('Enable Azure SQL workload resources.')
param deploySql bool = true

@description('Optional tags applied to all resources.')
param tags object = {}

@description('App Service plan SKU placeholder.')
param appServiceSkuName string = 'B1'

@description('SQL SKU placeholder.')
param sqlSkuName string = 'S0'

module managedIdentity './modules/managed-identity.bicep' = {
  name: 'managedIdentity-\${baseName}-\${environmentName}'
  params: {
    baseName: baseName
    environmentName: environmentName
    location: location
    tags: tags
  }
}

module keyVault './modules/key-vault.bicep' = {
  name: 'keyVault-\${baseName}-\${environmentName}'
  params: {
    baseName: baseName
    environmentName: environmentName
    location: location
    managedIdentityPrincipalId: managedIdentity.outputs.principalId
    tags: tags
  }
}

module appInsights './modules/app-insights.bicep' = {
  name: 'appInsights-\${baseName}-\${environmentName}'
  params: {
    baseName: baseName
    environmentName: environmentName
    location: location
    tags: tags
  }
}

module storage './modules/storage.bicep' = if (deployFunctions) {
  name: 'storage-\${baseName}-\${environmentName}'
  params: {
    baseName: baseName
    environmentName: environmentName
    location: location
    tags: tags
  }
}

module functionApp './modules/function-app.bicep' = if (deployFunctions) {
  name: 'functionApp-\${baseName}-\${environmentName}'
  params: {
    baseName: baseName
    environmentName: environmentName
    location: location
    storageAccountName: storage.outputs.storageAccountName
    appInsightsConnectionSettingName: appInsights.outputs.connectionSettingName
    keyVaultUri: keyVault.outputs.keyVaultUri
    managedIdentityId: managedIdentity.outputs.resourceId
    tags: tags
  }
}

module appService './modules/app-service.bicep' = if (deployReact) {
  name: 'appService-\${baseName}-\${environmentName}'
  params: {
    baseName: baseName
    environmentName: environmentName
    location: location
    appServiceSkuName: appServiceSkuName
    keyVaultUri: keyVault.outputs.keyVaultUri
    managedIdentityId: managedIdentity.outputs.resourceId
    tags: tags
  }
}

module sqlServer './modules/sql-server.bicep' = if (deploySql) {
  name: 'sqlServer-\${baseName}-\${environmentName}'
  params: {
    baseName: baseName
    environmentName: environmentName
    location: location
    managedIdentityPrincipalId: managedIdentity.outputs.principalId
    tags: tags
  }
}

module sqlDatabase './modules/sql-database.bicep' = if (deploySql) {
  name: 'sqlDatabase-\${baseName}-\${environmentName}'
  params: {
    sqlServerName: sqlServer.outputs.sqlServerName
    baseName: baseName
    environmentName: environmentName
    location: location
    sqlSkuName: sqlSkuName
    tags: tags
  }
}

// TODO: configure networking/private endpoints for Key Vault, Storage, SQL, and App resources.
// TODO: enforce Entra ID auth settings for application and data-plane access.
// TODO: validate SQL firewall rules and private routing strategy per environment.
// TODO: assign least-privilege RBAC role assignments to managed identities.
// TODO: configure monitoring, alerting, backup, and retention policies.
// TODO: define environment promotion strategy and release governance.

output keyVaultName string = keyVault.outputs.keyVaultName
output managedIdentityPrincipalId string = managedIdentity.outputs.principalId
output appInsightsName string = appInsights.outputs.appInsightsName
output functionAppName string = deployFunctions ? functionApp.outputs.functionAppName : ''
output webAppName string = deployReact ? appService.outputs.webAppName : ''
output sqlServerName string = deploySql ? sqlServer.outputs.sqlServerName : ''
output sqlDatabaseName string = deploySql ? sqlDatabase.outputs.sqlDatabaseName : ''
`;

const renderAppServiceModule = (): string => `param baseName string
param environmentName string
param location string
param appServiceSkuName string
param keyVaultUri string
param managedIdentityId string
param tags object = {}

var appServicePlanName = '${'${baseName}'}-${'${environmentName}'}-asp'
var webAppName = '${'${baseName}'}-${'${environmentName}'}-web'

resource appServicePlan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: appServicePlanName
  location: location
  sku: {
    name: appServiceSkuName
    tier: 'Basic'
  }
  kind: 'linux'
  tags: tags
  properties: {
    reserved: true
  }
}

resource webApp 'Microsoft.Web/sites@2023-12-01' = {
  name: webAppName
  location: location
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${'${managedIdentityId}'}': {}
    }
  }
  tags: tags
  properties: {
    serverFarmId: appServicePlan.id
    httpsOnly: true
    siteConfig: {
      appSettings: [
        {
          name: 'KEY_VAULT_URI'
          value: keyVaultUri
        }
        {
          name: 'TODO_APP_CONFIG'
          value: 'TODO_PLACEHOLDER'
        }
      ]
    }
  }
}

// TODO: evaluate Azure Static Web Apps vs App Service hosting per React workload.
// TODO: restrict ingress and enforce private networking where required.
// TODO: add diagnostic settings and alert rules for web app resource.

output webAppName string = webApp.name
`;

const renderFunctionAppModule = (): string => `param baseName string
param environmentName string
param location string
param storageAccountName string
param appInsightsConnectionSettingName string
param keyVaultUri string
param managedIdentityId string
param tags object = {}

var functionAppName = '${'${baseName}'}-${'${environmentName}'}-func'

resource functionApp 'Microsoft.Web/sites@2023-12-01' = {
  name: functionAppName
  location: location
  kind: 'functionapp,linux'
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${'${managedIdentityId}'}': {}
    }
  }
  tags: tags
  properties: {
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: 'Node|20'
      appSettings: [
        {
          name: 'AzureWebJobsStorage'
          value: '@Microsoft.KeyVault(SecretUri=${'${keyVaultUri}'}secrets/function-storage-connection/)'
        }
        {
          name: appInsightsConnectionSettingName
          value: '@Microsoft.KeyVault(SecretUri=${'${keyVaultUri}'}secrets/app-insights-connection/)'
        }
        {
          name: 'FUNCTIONS_EXTENSION_VERSION'
          value: '~4'
        }
      ]
    }
  }
}

// TODO: assign RBAC roles for Storage and Key Vault access to this managed identity.
// TODO: configure private endpoints and outbound restrictions before production use.
// TODO: configure retry/dead-letter/poison handling for trigger integrations.

output functionAppName string = functionApp.name
`;

const renderStorageModule = (): string => `param baseName string
param environmentName string
param location string
param tags object = {}

var storageAccountName = take(replace('${'${baseName}'}${'${environmentName}'}stg', '-', ''), 24)

resource storageAccount 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageAccountName
  location: location
  sku: {
    name: 'Standard_LRS'
  }
  kind: 'StorageV2'
  tags: tags
  properties: {
    allowBlobPublicAccess: false
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
  }
}

// TODO: add lifecycle management, immutable retention, and private endpoint policies.
// TODO: enable detailed diagnostics and alerting.

output storageAccountName string = storageAccount.name
`;

const renderSqlServerModule = (): string => `param baseName string
param environmentName string
param location string
param managedIdentityPrincipalId string
param tags object = {}

var sqlServerName = '${'${baseName}'}-${'${environmentName}'}-sql'

resource sqlServer 'Microsoft.Sql/servers@2023-08-01-preview' = {
  name: sqlServerName
  location: location
  tags: tags
  properties: {
    administrators: {
      administratorType: 'ActiveDirectory'
      principalType: 'Application'
      sid: managedIdentityPrincipalId
      login: 'TODO_ENTRA_ADMIN_LOGIN'
      tenantId: subscription().tenantId
      azureADOnlyAuthentication: true
    }
    publicNetworkAccess: 'Enabled'
  }
}

// TODO: configure SQL firewall rules and private endpoint access.
// TODO: validate Entra ID admin principals for environment tenancy.
// TODO: disable public network access after private connectivity is verified.

output sqlServerName string = sqlServer.name
`;

const renderSqlDatabaseModule = (): string => `param sqlServerName string
param baseName string
param environmentName string
param location string
param sqlSkuName string
param tags object = {}

var sqlDatabaseName = '${'${baseName}'}-${'${environmentName}'}-sqldb'

resource sqlDatabase 'Microsoft.Sql/servers/databases@2023-08-01-preview' = {
  name: '${'${sqlServerName}'}/${'${sqlDatabaseName}'}'
  location: location
  tags: tags
  sku: {
    name: sqlSkuName
    tier: 'Standard'
  }
  properties: {
    zoneRedundant: false
  }
}

// TODO: configure backup retention policy and long-term retention rules.
// TODO: configure failover group and geo-replication if required by SLA.

output sqlDatabaseName string = sqlDatabase.name
`;

const renderKeyVaultModule = (): string => `param baseName string
param environmentName string
param location string
param managedIdentityPrincipalId string
param tags object = {}

var keyVaultName = take(replace('${'${baseName}'}-${'${environmentName}'}-kv', '_', '-'), 24)

resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: keyVaultName
  location: location
  tags: tags
  properties: {
    tenantId: subscription().tenantId
    sku: {
      family: 'A'
      name: 'standard'
    }
    enabledForTemplateDeployment: true
    enableRbacAuthorization: true
    publicNetworkAccess: 'Enabled'
    accessPolicies: []
  }
}

resource keyVaultManagedIdentityReader 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(keyVault.id, managedIdentityPrincipalId, 'key-vault-secrets-user')
  scope: keyVault
  properties: {
    principalId: managedIdentityPrincipalId
    roleDefinitionId: subscriptionResourceId(
      'Microsoft.Authorization/roleDefinitions',
      '4633458b-17de-408a-b874-0445c86b69e6'
    )
    principalType: 'ServicePrincipal'
  }
}

// TODO: configure secret lifecycle, rotation, and purge protection policy.
// TODO: move all sensitive connection settings to Key Vault secrets.
// TODO: restrict vault networking and private DNS integration.

output keyVaultName string = keyVault.name
output keyVaultUri string = 'https://${'${keyVault.name}'}.vault.azure.net/'
`;

const renderAppInsightsModule = (): string => `param baseName string
param environmentName string
param location string
param tags object = {}

var appInsightsName = '${'${baseName}'}-${'${environmentName}'}-appi'

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: appInsightsName
  location: location
  kind: 'web'
  tags: tags
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: ''
  }
}

// TODO: connect Application Insights to Log Analytics workspace.
// TODO: define alert rules and telemetry retention policy.

output appInsightsName string = appInsights.name
output connectionSettingName string = 'APPLICATIONINSIGHTS_CONNECTION_STRING'
`;

const renderManagedIdentityModule = (): string => `param baseName string
param environmentName string
param location string
param tags object = {}

var managedIdentityName = '${'${baseName}'}-${'${environmentName}'}-mi'

resource managedIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: managedIdentityName
  location: location
  tags: tags
}

// TODO: assign RBAC roles for runtime services using least-privilege defaults.
// TODO: review identity sharing boundaries between web and function workloads.

output principalId string = managedIdentity.properties.principalId
output clientId string = managedIdentity.properties.clientId
output resourceId string = managedIdentity.id
`;

const renderParameterFile = (
  environmentName: "dev" | "test" | "prod",
  baseName: string,
  requirements: { react: boolean; functions: boolean; sql: boolean }
): string =>
  JSON.stringify(
    {
      $schema:
        "https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#",
      contentVersion: "1.0.0.0",
      parameters: {
        environmentName: {
          value: environmentName
        },
        baseName: {
          value: `${baseName}-${environmentName}`
        },
        location: {
          value: "TODO_LOCATION"
        },
        deployReact: {
          value: requirements.react
        },
        deployFunctions: {
          value: requirements.functions
        },
        deploySql: {
          value: requirements.sql
        },
        appServiceSkuName: {
          value: environmentName === "prod" ? "P1v3" : "B1"
        },
        sqlSkuName: {
          value: environmentName === "prod" ? "S1" : "S0"
        },
        tags: {
          value: {
            environment: environmentName,
            generatedBy: "power-exit",
            scaffoldOnly: "true"
          }
        }
      }
    },
    null,
    2
  );

const buildGenerationReport = (output: AzureInfraGenerationOutput, warnings: GenerationWarning[]): string => {
  const lines: string[] = [];
  lines.push("# Power Exit Infra Generation Report");
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- Resources planned: ${output.resourcesPlanned}`);
  lines.push(`- Modules planned: ${output.modulesPlanned}`);
  lines.push(`- Parameter files generated: ${output.parameterFilesGenerated}`);
  lines.push(`- Warnings: ${output.warnings}`);
  lines.push("");
  lines.push("## Security-first defaults");
  lines.push("");
  lines.push("- Managed identity enabled for workload modules.");
  lines.push("- Key Vault references used for sensitive settings placeholders.");
  lines.push("- No embedded credentials or secret values generated.");
  lines.push("");
  lines.push("## Warnings");
  lines.push("");
  if (warnings.length === 0) {
    lines.push("- None.");
  } else {
    sortByStableKey(warnings, (warning) => `${warning.code}:${warning.message}`).forEach((warning) => {
      lines.push(`- [${warning.code}] ${warning.message}`);
    });
  }

  return `${lines.join("\n")}\n`;
};

const buildMigrationNotes = (
  plan: InfraGenerationPlanDetails,
  requirements: { react: boolean; functions: boolean; sql: boolean }
): string => {
  const lines: string[] = [];
  lines.push("# Azure Infrastructure Migration Notes");
  lines.push("");
  lines.push("Generated infrastructure is scaffold-only and intentionally non-deployable without review.");
  lines.push("");
  lines.push("## Workload mapping summary");
  lines.push("");
  lines.push(`- React workload detected: ${requirements.react}`);
  lines.push(`- Azure Functions workload detected: ${requirements.functions}`);
  lines.push(`- SQL workload detected: ${requirements.sql}`);
  lines.push("");
  lines.push("## Manual production hardening checklist");
  lines.push("");
  plan.securityManualReviewItems.forEach((item) => lines.push(`- ${item}`));
  lines.push("");
  lines.push("## Unresolved configuration items");
  lines.push("");
  plan.unresolvedConfigurationItems.forEach((item) => lines.push(`- ${item}`));
  lines.push("");
  lines.push("## Deployment readiness");
  lines.push("");
  lines.push(`- scaffoldOnly: ${plan.deploymentReadiness.scaffoldOnly}`);
  lines.push(`- needsConfig: ${plan.deploymentReadiness.needsConfig}`);
  lines.push(`- needsSecurityReview: ${plan.deploymentReadiness.needsSecurityReview}`);
  lines.push(`- blocked: ${plan.deploymentReadiness.blocked}`);

  return `${lines.join("\n")}\n`;
};

export const generateAzureInfraArtifacts = async (
  input: unknown,
  contextInput?: GeneratorContext
): Promise<GenerationResult<AzureInfraGenerationOutput>> => {
  const ir = validatePowerPlatformIR(input);
  const context = contextInput ?? defaultContext();
  const warnings: GenerationWarning[] = [];
  const unsupportedFeatures: GenerationUnsupportedFeature[] = [];
  const requirements = detectRequirements(ir);
  const metadataMissing = hasMissingSolutionMetadata(ir);
  const sourceArtifactIds = [ir.solution.artifactId];
  const baseName = sanitizeToken(
    ir.solution.uniqueName === "unknown_solution" ? ir.solution.name : ir.solution.uniqueName
  );
  const plannedResources = sortByStableKey(
    [
      "appInsights",
      "appService",
      "functionApp",
      "keyVault",
      "managedIdentity",
      "sqlDatabase",
      "sqlServer",
      "storageAccount"
    ],
    (value) => value
  );

  if (metadataMissing) {
    warnings.push(
      createWarning({
        code: "INFRA_MISSING_SOLUTION_METADATA",
        message:
          "Solution metadata is incomplete/placeholder and naming conventions are scaffold defaults.",
        sourceArtifactIds,
        sourceLocation: ir.solution.provenance.sourcePath,
        provenance: context.invocationProvenance
      })
    );
  }

  if (!requirements.react && !requirements.functions && !requirements.sql) {
    warnings.push(
      createWarning({
        code: "INFRA_NO_WORKLOAD_DETECTED",
        message:
          "No React/Functions/SQL workload was detected; scaffold includes placeholders only.",
        sourceArtifactIds,
        sourceLocation: ir.solution.provenance.sourcePath,
        provenance: context.invocationProvenance
      })
    );
  }

  const artifacts: GeneratedArtifact[] = [
    createArtifact("infra/main.bicep", "bicep-template", renderMainBicep(baseName), sourceArtifactIds, context),
    createArtifact(
      "infra/modules/app-service.bicep",
      "bicep-module",
      renderAppServiceModule(),
      sourceArtifactIds,
      context
    ),
    createArtifact(
      "infra/modules/function-app.bicep",
      "bicep-module",
      renderFunctionAppModule(),
      sourceArtifactIds,
      context
    ),
    createArtifact(
      "infra/modules/storage.bicep",
      "bicep-module",
      renderStorageModule(),
      sourceArtifactIds,
      context
    ),
    createArtifact(
      "infra/modules/sql-server.bicep",
      "bicep-module",
      renderSqlServerModule(),
      sourceArtifactIds,
      context
    ),
    createArtifact(
      "infra/modules/sql-database.bicep",
      "bicep-module",
      renderSqlDatabaseModule(),
      sourceArtifactIds,
      context
    ),
    createArtifact(
      "infra/modules/key-vault.bicep",
      "bicep-module",
      renderKeyVaultModule(),
      sourceArtifactIds,
      context
    ),
    createArtifact(
      "infra/modules/app-insights.bicep",
      "bicep-module",
      renderAppInsightsModule(),
      sourceArtifactIds,
      context
    ),
    createArtifact(
      "infra/modules/managed-identity.bicep",
      "bicep-module",
      renderManagedIdentityModule(),
      sourceArtifactIds,
      context
    ),
    createArtifact(
      "infra/parameters.dev.json",
      "arm-parameters",
      renderParameterFile("dev", baseName, requirements),
      sourceArtifactIds,
      context
    ),
    createArtifact(
      "infra/parameters.test.json",
      "arm-parameters",
      renderParameterFile("test", baseName, requirements),
      sourceArtifactIds,
      context
    ),
    createArtifact(
      "infra/parameters.prod.json",
      "arm-parameters",
      renderParameterFile("prod", baseName, requirements),
      sourceArtifactIds,
      context
    ),
    createArtifact(
      "infra/README.generated.md",
      "markdown-readme",
      `# Power Exit Azure Infra Scaffold

This folder contains deterministic Azure Bicep scaffolds generated from ` +
        `PowerPlatformIR.

- Scaffold-only output with placeholders.
- No credential or secret values are generated.
- Managed identity + Key Vault references are preferred defaults.

Workload detection:
- React: ${requirements.react}
- Functions: ${requirements.functions}
- SQL: ${requirements.sql}

Do not deploy this scaffold without completing manual hardening steps in ` +
        "`migration-notes.md`.\n",
      sourceArtifactIds,
      context
    )
  ];

  const contentHashes = sortByStableKey(
    artifacts.map((artifact) => ({
      path: artifact.filePath,
      contentHash: computeHash(artifact.content)
    })),
    (entry) => entry.path
  );
  const deploymentReadiness = {
    scaffoldOnly: true,
    needsConfig: true,
    needsSecurityReview: true,
    blocked: metadataMissing
  };
  const infraPlan: InfraGenerationPlanDetails = {
    plannedResources,
    plannedModules: modulePaths,
    environmentParameterFiles: parameterFilePaths,
    securityManualReviewItems,
    unresolvedConfigurationItems,
    contentHashes,
    deploymentReadiness
  };
  const output: AzureInfraGenerationOutput = {
    resourcesPlanned: plannedResources.length,
    modulesPlanned: modulePaths.length,
    parameterFilesGenerated: parameterFilePaths.length,
    warnings: warnings.length,
    infraPlan
  };
  const generationReport = buildGenerationReport(output, warnings);
  const migrationNotes = buildMigrationNotes(infraPlan, requirements);
  artifacts.push(
    createArtifact(
      "infra/generation-report.md",
      "markdown-report",
      generationReport,
      sourceArtifactIds,
      context
    ),
    createArtifact(
      "infra/migration-notes.md",
      "markdown-notes",
      migrationNotes,
      sourceArtifactIds,
      context
    )
  );

  const confidence = Math.max(0, Math.min(1, 0.92 - warnings.length * 0.05));
  const parsedResult = createGenerationResultSchema(azureInfraGenerationOutputSchema).parse({
    artifacts: sortByStableKey(artifacts, (artifact) => artifact.filePath),
    output,
    warnings: sortByStableKey(warnings, (warning) => `${warning.code}:${warning.message}`),
    unsupportedFeatures: sortByStableKey(
      unsupportedFeatures,
      (feature) => `${feature.severity}:${feature.featureType}`
    ),
    confidence,
    provenance: context.invocationProvenance
  });

  return parsedResult as GenerationResult<AzureInfraGenerationOutput>;
};

export const generateAzureInfraFromPowerPlatformIR = async (
  input: unknown,
  contextInput?: GeneratorContext
): Promise<GenerationResult<AzureInfraGenerationOutput>> =>
  generateAzureInfraArtifacts(validatePowerPlatformIR(input), contextInput);
