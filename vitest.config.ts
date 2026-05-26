import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@power-exit/assessment": path.resolve(
        __dirname,
        "packages/assessment/src/index.ts"
      ),
      "@power-exit/fixtures": path.resolve(
        __dirname,
        "packages/fixtures/src/index.ts"
      ),
      "@power-exit/generators": path.resolve(
        __dirname,
        "packages/generators/src/index.ts"
      ),
      "@power-exit/ir": path.resolve(__dirname, "packages/ir/src/index.ts"),
      "@power-exit/parsers": path.resolve(
        __dirname,
        "packages/parsers/src/index.ts"
      ),
      "@power-exit/powerfx": path.resolve(
        __dirname,
        "packages/powerfx/src/index.ts"
      )
    }
  },
  test: {
    include: ["apps/**/*.test.ts", "packages/**/*.test.ts"],
    environment: "node",
    globals: true
  }
});
