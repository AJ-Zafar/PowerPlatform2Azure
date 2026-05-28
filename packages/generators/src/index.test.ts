import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  createEmptyPowerPlatformIR,
  type DataverseAttribute,
  type DataverseEntity,
  type DataverseOptionSet,
  type DataverseRelationship,
  type PowerPlatformIR
} from "@power-exit/ir";

import {
  createGenerator,
  createGeneratorRegistry,
  generateDataverseSqlArtifacts,
  generateDataverseSqlFromPowerPlatformIR
} from "./index";

interface SqlFixtureAttribute {
  logicalName: string;
  schemaName: string;
  type: DataverseAttribute["type"];
  requiredLevel: DataverseAttribute["requiredLevel"];
  maxLength?: number;
  precision?: number;
  scale?: number;
}

interface SqlFixtureEntity {
  logicalName: string;
  schemaName: string;
  displayName: string;
  ownershipType: string;
  primaryNameAttribute: string;
  primaryIdAttribute: string;
  attributes: SqlFixtureAttribute[];
}

interface SqlFixtureRelationship {
  schemaName: string;
  relationshipType: DataverseRelationship["relationshipType"];
  fromEntityLogicalName: string;
  toEntityLogicalName: string;
}

interface SqlFixtureOptionSet {
  logicalName: string;
  isGlobal: boolean;
  options: Array<{
    value: number;
    label: string;
  }>;
}

interface SqlFixtureCase {
  entities: SqlFixtureEntity[];
  relationships: SqlFixtureRelationship[];
  optionSets: SqlFixtureOptionSet[];
}

type SqlFixtureCatalog = Record<string, SqlFixtureCase>;

const fixtureFile = path.resolve(
  process.cwd(),
  "packages/fixtures/samples/generators/sql/dataverse-sql-cases.json"
);

const normalizeId = (value: string): string => {
  const collapsed = value
    .toLowerCase()
    .replace(/[^a-z0-9._:-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return collapsed.length > 0 ? collapsed : "artifact";
};

const loadFixtureCatalog = async (): Promise<SqlFixtureCatalog> =>
  JSON.parse(await readFile(fixtureFile, "utf-8")) as SqlFixtureCatalog;

const toDataverseSection = (
  fixtureName: string,
  fixtureCase: SqlFixtureCase
): PowerPlatformIR["dataverse"] => {
  const entities: DataverseEntity[] = fixtureCase.entities.map((entity) => {
    const entityArtifactId = `entity:${normalizeId(entity.logicalName)}`;
    return {
      artifactId: entityArtifactId,
      logicalName: entity.logicalName,
      schemaName: entity.schemaName,
      displayName: entity.displayName,
      ownershipType: entity.ownershipType,
      primaryNameAttribute: entity.primaryNameAttribute,
      primaryIdAttribute: entity.primaryIdAttribute,
      attributes: entity.attributes.map((attribute) => ({
        artifactId: `attribute:${normalizeId(entity.logicalName)}:${normalizeId(attribute.logicalName)}`,
        entityArtifactId,
        logicalName: attribute.logicalName,
        schemaName: attribute.schemaName,
        type: attribute.type,
        requiredLevel: attribute.requiredLevel,
        maxLength: attribute.maxLength,
        precision: attribute.precision,
        scale: attribute.scale,
        provenance: {
          sourcePath: `fixtures/${fixtureName}.json`,
          sourceType: "dataverse"
        },
        confidence: 0.95
      })),
      provenance: {
        sourcePath: `fixtures/${fixtureName}.json`,
        sourceType: "dataverse"
      },
      confidence: 0.95
    };
  });

  const relationships: DataverseRelationship[] = fixtureCase.relationships.map((relationship) => ({
    artifactId: `relationship:${normalizeId(relationship.schemaName)}`,
    schemaName: relationship.schemaName,
    relationshipType: relationship.relationshipType,
    fromEntityLogicalName: relationship.fromEntityLogicalName,
    toEntityLogicalName: relationship.toEntityLogicalName,
    provenance: {
      sourcePath: `fixtures/${fixtureName}.json`,
      sourceType: "dataverse"
    },
    confidence: 0.9
  }));

  const optionSets: DataverseOptionSet[] = fixtureCase.optionSets.map((optionSet) => ({
    artifactId: `optionset:${normalizeId(optionSet.logicalName)}`,
    logicalName: optionSet.logicalName,
    isGlobal: optionSet.isGlobal,
    options: optionSet.options,
    provenance: {
      sourcePath: `fixtures/${fixtureName}.json`,
      sourceType: "dataverse"
    },
    confidence: 0.9
  }));

  return {
    entities,
    relationships,
    optionSets
  };
};

const schemaContentFromResult = (result: Awaited<ReturnType<typeof generateDataverseSqlArtifacts>>): string => {
  const schemaArtifact = result.artifacts.find((artifact) => artifact.filePath === "schema.sql");
  if (!schemaArtifact) {
    throw new Error("Expected schema.sql artifact.");
  }

  return schemaArtifact.content;
};

describe("generator registry contracts", () => {
  it("registers and retrieves generators by id", async () => {
    const registry = createGeneratorRegistry();
    const generator = createGenerator({
      id: "azure-sql-ddl",
      capabilities: ["azure-sql-ddl"],
      generate: async (_input, context) => ({
        artifacts: [],
        output: {
          ok: true
        },
        warnings: [],
        unsupportedFeatures: [],
        confidence: 1,
        provenance: context.invocationProvenance
      })
    });

    registry.register(generator);

    const found = registry.get("azure-sql-ddl");

    expect(found).toBeDefined();
    expect(found?.id).toBe("azure-sql-ddl");
    expect(registry.list()).toHaveLength(1);
  });

  it("rejects duplicate generator registration", async () => {
    const registry = createGeneratorRegistry();
    const generator = createGenerator({
      id: "azure-sql-ddl",
      capabilities: ["azure-sql-ddl"],
      generate: async (_input, context) => ({
        artifacts: [],
        output: {
          ok: true
        },
        warnings: [],
        unsupportedFeatures: [],
        confidence: 1,
        provenance: context.invocationProvenance
      })
    });

    registry.register(generator);

    expect(() => registry.register(generator)).toThrowError(
      'Generator "azure-sql-ddl" is already registered.'
    );
  });
});

describe("generateDataverseSqlArtifacts", () => {
  it("produces deterministic generated artifacts for repeated runs", async () => {
    const fixtures = await loadFixtureCatalog();
    const dataverse = toDataverseSection("multipleColumnTypes", fixtures.multipleColumnTypes);

    const first = await generateDataverseSqlArtifacts(dataverse);
    const second = await generateDataverseSqlArtifacts(dataverse);

    expect(first).toEqual(second);
  });

  it("creates SQL table and primary key DDL", async () => {
    const fixtures = await loadFixtureCatalog();
    const dataverse = toDataverseSection("simpleTable", fixtures.simpleTable);
    const result = await generateDataverseSqlArtifacts(dataverse);
    const schema = schemaContentFromResult(result);

    expect(schema).toContain("CREATE TABLE [dbo].[account]");
    expect(schema).toContain("[accountid] UNIQUEIDENTIFIER NOT NULL");
    expect(schema).toContain("CONSTRAINT [pk_account] PRIMARY KEY ([accountid])");
  });

  it("maps supported Dataverse types to SQL column types", async () => {
    const fixtures = await loadFixtureCatalog();
    const dataverse = toDataverseSection("multipleColumnTypes", fixtures.multipleColumnTypes);
    const result = await generateDataverseSqlArtifacts(dataverse);
    const schema = schemaContentFromResult(result);

    expect(schema).toContain("[name] NVARCHAR(200)");
    expect(schema).toContain("[description] NVARCHAR(MAX)");
    expect(schema).toContain("[quantity] INT");
    expect(schema).toContain("[totalamount] DECIMAL(18,2)");
    expect(schema).toContain("[ratio] FLOAT");
    expect(schema).toContain("[revenue] DECIMAL(19,4)");
    expect(schema).toContain("[isactive] BIT");
    expect(schema).toContain("[duedate] DATETIME2");
    expect(schema).toContain("[invoicedate] DATE");
    expect(schema).toContain("[revisionnumber] BIGINT");
    expect(schema).toContain("[statuscode] INT");
  });

  it("generates foreign keys for resolvable one-to-many relationships", async () => {
    const fixtures = await loadFixtureCatalog();
    const dataverse = toDataverseSection("oneToManyRelationship", fixtures.oneToManyRelationship);
    const result = await generateDataverseSqlArtifacts(dataverse);
    const schema = schemaContentFromResult(result);

    expect(schema).toContain("ALTER TABLE [dbo].[contact]");
    expect(schema).toContain("CONSTRAINT [fk_contact_account_parentaccountid]");
    expect(schema).toContain("REFERENCES [dbo].[account]([accountid])");
  });

  it("generates join tables for resolvable many-to-many relationships", async () => {
    const fixtures = await loadFixtureCatalog();
    const dataverse = toDataverseSection("manyToManyRelationship", fixtures.manyToManyRelationship);
    const result = await generateDataverseSqlArtifacts(dataverse);
    const schema = schemaContentFromResult(result);

    expect(schema).toContain("CREATE TABLE [dbo].[systemuser_teams_join]");
    expect(schema).toContain("[systemuserid] UNIQUEIDENTIFIER NOT NULL");
    expect(schema).toContain("[teamid] UNIQUEIDENTIFIER NOT NULL");
    expect(schema).toContain("CONSTRAINT [pk_systemuser_teams_join] PRIMARY KEY ([systemuserid], [teamid])");
  });

  it("emits unsupported conversion records for unsupported column classes", async () => {
    const fixtures = await loadFixtureCatalog();
    const dataverse = toDataverseSection("unsupportedColumns", fixtures.unsupportedColumns);
    const result = await generateDataverseSqlArtifacts(dataverse);

    expect(result.unsupportedFeatures.some((feature) => feature.featureType.includes("calculated"))).toBe(
      true
    );
    expect(result.unsupportedFeatures.some((feature) => feature.featureType.includes("rollup"))).toBe(
      true
    );
    expect(result.unsupportedFeatures.some((feature) => feature.featureType.includes("file"))).toBe(true);
    expect(result.unsupportedFeatures.some((feature) => feature.featureType.includes("image"))).toBe(true);
    expect(
      result.unsupportedFeatures.some((feature) => feature.featureType.includes("activityparty"))
    ).toBe(true);
  });

  it("emits warnings for unresolved relationships", async () => {
    const fixtures = await loadFixtureCatalog();
    const dataverse = toDataverseSection("unresolvedRelationship", fixtures.unresolvedRelationship);
    const result = await generateDataverseSqlArtifacts(dataverse);

    expect(result.warnings.some((warning) => warning.code === "SQL_RELATIONSHIP_UNRESOLVED")).toBe(true);
  });

  it("handles SQL identifier collisions deterministically", async () => {
    const fixtures = await loadFixtureCatalog();
    const dataverse = toDataverseSection("duplicateSqlNames", fixtures.duplicateSqlNames);
    const result = await generateDataverseSqlArtifacts(dataverse);
    const schema = schemaContentFromResult(result);

    expect(schema).toContain("CREATE TABLE [dbo].[order_item]");
    expect(schema).toContain("CREATE TABLE [dbo].[order_item_2]");
    expect(schema).toContain("[line_item] NVARCHAR(255)");
    expect(schema).toContain("[line_item_2] NVARCHAR(255)");
    expect(result.warnings.some((warning) => warning.code === "SQL_NAME_COLLISION")).toBe(true);
  });

  it("matches the SQL schema snapshot for the relationship fixture", async () => {
    const fixtures = await loadFixtureCatalog();
    const dataverse = toDataverseSection("oneToManyRelationship", fixtures.oneToManyRelationship);
    const result = await generateDataverseSqlArtifacts(dataverse);

    expect(schemaContentFromResult(result)).toMatchSnapshot();
  });
});

describe("generateDataverseSqlFromPowerPlatformIR", () => {
  it("generates SQL artifacts from validated PowerPlatformIR input", async () => {
    const fixtures = await loadFixtureCatalog();
    const dataverse = toDataverseSection("choiceColumns", fixtures.choiceColumns);
    const ir = createEmptyPowerPlatformIR({
      solutionFolder: "fixtures/sql"
    });

    const validatedIr: PowerPlatformIR = {
      ...ir,
      dataverse
    };

    const result = await generateDataverseSqlFromPowerPlatformIR(validatedIr);

    expect(result.artifacts.some((artifact) => artifact.filePath === "schema.sql")).toBe(true);
    expect(result.artifacts.some((artifact) => artifact.filePath === "generation-report.md")).toBe(true);
  });
});
