import { type Generator } from "./contracts";

export interface GeneratorRegistry {
  register<TInput, TOutput>(generator: Generator<TInput, TOutput>): void;
  get<TInput, TOutput>(generatorId: string): Generator<TInput, TOutput> | undefined;
  list(): Generator<unknown, unknown>[];
}

class InMemoryGeneratorRegistry implements GeneratorRegistry {
  private readonly generators = new Map<string, Generator<unknown, unknown>>();

  register<TInput, TOutput>(generator: Generator<TInput, TOutput>): void {
    if (this.generators.has(generator.id)) {
      throw new Error(`Generator "${generator.id}" is already registered.`);
    }

    this.generators.set(generator.id, generator as Generator<unknown, unknown>);
  }

  get<TInput, TOutput>(generatorId: string): Generator<TInput, TOutput> | undefined {
    return this.generators.get(generatorId) as Generator<TInput, TOutput> | undefined;
  }

  list(): Generator<unknown, unknown>[] {
    return Array.from(this.generators.values());
  }
}

export const createGeneratorRegistry = (): GeneratorRegistry =>
  new InMemoryGeneratorRegistry();
