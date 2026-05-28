import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  createParserRegistry,
  createParser,
  validateParserResult
} from "./index";

describe("parser registry", () => {
  it("registers and resolves parser definitions", async () => {
    const registry = createParserRegistry();

    const parser = createParser({
      id: "solution-manifest-parser",
      capabilities: ["solution-discovery"],
      parse: async () =>
        validateParserResult(z.array(z.string()), {
          data: ["manifest.json"],
          warnings: [],
          unsupported: [],
          confidence: 0.9,
          provenance: {
            sourcePath: "solution/manifest.json",
            sourceType: "solution"
          }
        })
    });

    registry.register(parser);

    const resolved = registry.get("solution-manifest-parser");

    expect(resolved?.id).toBe("solution-manifest-parser");
    expect(await resolved?.parse({ solutionPath: "/tmp/solution" })).toEqual({
      data: ["manifest.json"],
      warnings: [],
      unsupported: [],
      confidence: 0.9,
      provenance: {
        sourcePath: "solution/manifest.json",
        sourceType: "solution"
      }
    });
  });

  it("rejects duplicate parser registration", () => {
    const registry = createParserRegistry();
    const parser = createParser({
      id: "duplicate-parser",
      capabilities: ["solution-discovery"],
      parse: async () =>
        validateParserResult(z.array(z.string()), {
          data: [],
          warnings: [],
          unsupported: [],
          confidence: 1,
          provenance: {
            sourcePath: "solution",
            sourceType: "solution"
          }
        })
    });

    registry.register(parser);
    expect(() => registry.register(parser)).toThrow(
      'Parser "duplicate-parser" is already registered.'
    );
  });
});

describe("parser contract validation", () => {
  it("rejects invalid parser definitions", () => {
    expect(() =>
      createParser({
        id: "INVALID_ID",
        capabilities: ["solution-discovery"],
        parse: async () =>
          validateParserResult(z.array(z.string()), {
            data: [],
            warnings: [],
            unsupported: [],
            confidence: 1,
            provenance: {
              sourcePath: "solution",
              sourceType: "solution"
            }
          })
      })
    ).toThrow();
  });

  it("rejects parse results that do not match ParseResult contract", () => {
    expect(() =>
      validateParserResult(z.array(z.string()), {
        data: ["manifest.xml"],
        warnings: [],
        unsupported: [],
        confidence: 1.5,
        provenance: {
          sourcePath: "solution",
          sourceType: "solution"
        }
      })
    ).toThrow();
  });
});
