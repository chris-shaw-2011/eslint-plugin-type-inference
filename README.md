# eslint-plugin-type-inference

Type-aware ESLint rules that prefer TypeScript inference only when a
counterfactual compiler check shows the change is safe.

## Status

The initial rule is intentionally conservative and opt-in. It supports
typescript-eslint's JavaScript compiler-API range through TypeScript 6.0.
TypeScript 7 does not yet expose the stable API this rule needs.

## Installation

```sh
npm install --save-dev eslint-plugin-type-inference typescript-eslint typescript
```

## Flat configuration

Typed linting must be enabled. `projectService` is the recommended
typescript-eslint configuration:

```js
import typeInference from 'eslint-plugin-type-inference';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      'type-inference': typeInference,
    },
    rules: {
      'type-inference/no-inferrable-return-type': 'error',
    },
  },
);
```

## Rules

- [`type-inference/no-inferrable-return-type`](docs/rules/no-inferrable-return-type.md)

No rule is enabled by a recommended preset in v1.

## What the rule reports

The rule reports local function declarations, function expressions, and arrow
functions when removing the annotation preserves both TypeScript's complete
callable signature and its diagnostics. These examples are reported and
automatically fixed:

```ts
// Primitive return type
function add(a: number, b: number): number {
  return a + b;
}

// Arrow function and object return type
const makePoint = (x: number, y: number): { x: number; y: number } => ({ x, y });

// Generic inferred from a parameter
function identity<T>(value: T): T {
  return value;
}

// Async function
async function count(): Promise<number> {
  return 1;
}

// Contextually typed callback
const increment: (value: number) => number = (value): number => value + 1;

export {};
```

The resulting code is:

```ts
function add(a: number, b: number) {
  return a + b;
}

const makePoint = (x: number, y: number) => ({ x, y });

function identity<T>(value: T) {
  return value;
}

async function count() {
  return 1;
}

const increment: (value: number) => number = (value) => value + 1;

export {};
```

Exact `void`, `unknown`, `never`, and `Promise<void>` annotations can also be
reported. They are not special-cased as safe: each one must pass the same
compiler comparison.

## What the rule does not report

Public API annotations are retained in v1, including functions exported where
they are declared or exported later:

```ts
export function add(a: number, b: number): number {
  return a + b;
}

function subtract(a: number, b: number): number {
  return a - b;
}
export { subtract };
```

Annotations that affect inference or checking are also retained:

```ts
// Without the annotation, TypeScript widens the return type to string.
function status(): 'ok' {
  return 'ok';
}

// Without the annotation, TypeScript infers number[] rather than a tuple.
function pair(): [number, number] {
  return [1, 2];
}

// The annotation intentionally hides the concrete implementation type.
function hidden(): unknown {
  return 1;
}

// The annotation produces an excess-property diagnostic inside the body.
function invalidPoint(): { x: number } {
  return { x: 1, y: 2 };
}

export {};
```

The conservative v1 exclusions are not reported even when an individual case
might appear inferable:

```ts
// Recursive function
function factorial(n: number): number {
  return n < 2 ? 1 : n * factorial(n - 1);
}

// Return-only generic
function make<T>(): T {
  throw new Error();
}

// Type predicate
function isString(value: unknown): value is string {
  return typeof value === 'string';
}

// Method
class Calculator {
  add(a: number, b: number): number {
    return a + b;
  }
}

// `any` in the return type
async function unsafe(): Promise<any> {
  return JSON.parse('null');
}

export {};
```

The rule also retains an annotation when removing it would leave a type import
or local type declaration unused:

```ts
interface User {
  id: string;
}

const makeUser = (): User => ({ id: '1' });
void makeUser;

export {};
```
