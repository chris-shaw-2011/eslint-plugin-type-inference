# `no-inferrable-return-type`

Reports and removes an explicit function return type only after TypeScript
rechecks the source without it and produces the same callable signature and
diagnostics.

```ts
// reported and fixed
function add(a: number, b: number): number {
  return a + b;
}

// result
function add(a: number, b: number) {
  return a + b;
}
```

The rule requires typed parser services. Configure
`parserOptions.projectService: true`; it deliberately does not fall back to an
AST heuristic.

## Conservative v1 boundaries

The rule checks function declarations, function expressions, and arrow
functions in TypeScript modules. It ignores:

- exported or otherwise directly public functions;
- global-script declarations;
- methods, accessors, overloads, declarations without bodies, and generators;
- recursive and mutually recursive candidates;
- predicates, assertion signatures, return-only generics, and return types
  containing `any` or error types;
- annotations containing comments;
- removals that would orphan a local or imported type binding; and
- any removal that changes a TypeScript syntactic, semantic, or declaration
  diagnostic.

Async functions, contextual callbacks, JSX, `void`, `unknown`, and `never` are
eligible only when their complete callable signatures remain identical.

## Fix safety

Every reported annotation is checked alone. All annotations fixed in the same
file are also checked together. The fixer removes only the `: ReturnType`
annotation. It does not remove imports or local declarations.
