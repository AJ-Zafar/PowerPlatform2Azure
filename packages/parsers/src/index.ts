import { z } from "zod";

import {
  confidenceScoreSchema,
  createParseResultSchema,
  sourceProvenanceSchema,
  type ParseResult,
  parserWarningSchema,
  unsupportedFeatureSchema
} from "@power-exit/ir";

export const parserCapabilitySchema = z.enum([
  "solution-discovery",
  "dataverse",
  "canvas",
  "flow",
  "security",
  "environment-variables",
  "connection-references"
]);

export type ParserCapability = z.infer<typeof parserCapabilitySchema>;

const parserIdSchema = z
  .string()
  .min(1)
  .regex(/^[a-z0-9][a-z0-9-]*$/);

export const parserContextSchema = z
  .object({
    solutionPath: z.string().min(1),
    invocationProvenance: sourceProvenanceSchema
      .default({
        sourcePath: "parser-context",
        sourceType: "parser"
      })
      .optional()
  })
  .strict();

export type ParserContext = z.infer<typeof parserContextSchema>;

export const parserErrorSchema = z
  .object({
    parserId: parserIdSchema,
    code: z.string().min(1),
    message: z.string().min(1),
    sourceLocation: z.string().min(1).optional(),
    provenance: sourceProvenanceSchema.optional()
  })
  .strict();

export type ParserError = z.infer<typeof parserErrorSchema>;

export const fileDiscoveryEntrySchema = z
  .object({
    path: z.string().min(1),
    classification: z.string().min(1),
    provenance: sourceProvenanceSchema
  })
  .strict();

export const fileDiscoveryResultSchema = z
  .object({
    rootPath: z.string().min(1),
    files: z.array(fileDiscoveryEntrySchema),
    warnings: z.array(parserWarningSchema),
    unsupported: z.array(unsupportedFeatureSchema),
    confidence: confidenceScoreSchema,
    provenance: sourceProvenanceSchema
  })
  .strict();

export type FileDiscoveryResult = z.infer<typeof fileDiscoveryResultSchema>;

export const parseExecutionSummarySchema = z
  .object({
    parserId: parserIdSchema,
    capability: parserCapabilitySchema,
    durationMs: z.number().nonnegative(),
    warningCount: z.number().int().nonnegative(),
    unsupportedCount: z.number().int().nonnegative(),
    confidence: confidenceScoreSchema,
    success: z.boolean(),
    errors: z.array(parserErrorSchema)
  })
  .strict();

export type ParseExecutionSummary = z.infer<typeof parseExecutionSummarySchema>;

const parserDefinitionSchema = z
  .object({
    id: parserIdSchema,
    capabilities: z.array(parserCapabilitySchema).min(1)
  })
  .strict();

type ParserParseFunction<T> = (context: ParserContext) => Promise<ParseResult<T>>;

export interface Parser<T> extends z.infer<typeof parserDefinitionSchema> {
  parse: ParserParseFunction<T>;
}

export const createParser = <T>(input: {
  id: string;
  capabilities: ParserCapability[];
  parse: ParserParseFunction<T>;
}): Parser<T> => {
  const definition = parserDefinitionSchema.parse({
    id: input.id,
    capabilities: input.capabilities
  });

  return {
    ...definition,
    parse: input.parse
  };
};

export const validateParserResult = <TSchema extends z.ZodType>(
  dataSchema: TSchema,
  result: unknown
): ParseResult<z.infer<TSchema>> =>
  createParseResultSchema(dataSchema).parse(result) as ParseResult<z.infer<TSchema>>;

export interface ParserRegistry {
  register<T>(parser: Parser<T>): void;
  get<T>(parserId: string): Parser<T> | undefined;
  list(): Parser<unknown>[];
}

class InMemoryParserRegistry implements ParserRegistry {
  private readonly parsers = new Map<string, Parser<unknown>>();

  register<T>(parser: Parser<T>): void {
    if (this.parsers.has(parser.id)) {
      throw new Error(`Parser "${parser.id}" is already registered.`);
    }

    this.parsers.set(parser.id, parser as Parser<unknown>);
  }

  get<T>(parserId: string): Parser<T> | undefined {
    return this.parsers.get(parserId) as Parser<T> | undefined;
  }

  list(): Parser<unknown>[] {
    return Array.from(this.parsers.values());
  }
}

export const createParserRegistry = (): ParserRegistry =>
  new InMemoryParserRegistry();

export {
  analyseSolutionFolder,
  type AnalyseResult,
  type AnalyseSummary
} from "./analyse";
export { parseDataverseMetadata } from "./dataverse";
export {
  parseSolutionInfrastructure,
  type InfrastructureParseData
} from "./infrastructure";
export { parseSolutionManifest } from "./manifest";
export {
  discoverSolutionFiles,
  type DiscoveredFile,
  type FileClassification,
  type SolutionDiscoveryData
} from "./solution-discovery";
