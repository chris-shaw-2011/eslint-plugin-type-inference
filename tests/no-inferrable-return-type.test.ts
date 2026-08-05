import parser from "@typescript-eslint/parser"
import { RuleTester } from "@typescript-eslint/rule-tester"
import { afterAll, describe, it } from "vitest"
import { noInferrableReturnType } from "../src/rules/no-inferrable-return-type.js"

RuleTester.afterAll = afterAll
RuleTester.describe = describe
RuleTester.it = it

const ruleTester = new RuleTester({
	languageOptions: {
		parser,
		parserOptions: {
			projectService: {
				allowDefaultProject: ["*.ts", "*.tsx", "*.cts", "*.mts"],
			},
			tsconfigRootDir: new URL("./fixtures/", import.meta.url).pathname,
		},
	},
})

const error = { messageId: "redundantReturnType" as const }

ruleTester.run("no-inferrable-return-type", noInferrableReturnType, {
	valid: [
		{
			name: "has no explicit return type",
			code: "function add(a: number, b: number) { return a + b; } export {};",
		},
		{
			name: "ignores exported declarations",
			code: "export function add(a: number, b: number): number { return a + b; }",
		},
		{
			name: "ignores declarations exported later",
			code: "function add(a: number, b: number): number { return a + b; } export { add };",
		},
		{
			name: "ignores export assignments",
			filename: "export-assignment.cts",
			code: "function add(a: number, b: number): number { return a + b; } export = add;",
		},
		{
			name: "ignores callbacks in an object exported later",
			code: "const api = { add: (a: number, b: number): number => a + b }; export { api };",
		},
		{
			name: "ignores fields in a class exported later",
			code: "class Calculator { add = (a: number, b: number): number => a + b; } export { Calculator };",
		},
		{
			name: "ignores an anonymous default export",
			code: "export default (): number => 1;",
		},
		{
			name: "ignores callbacks inside a directly exported object",
			code: "export const api = { value: (): number => 1 };",
		},
		{
			name: "ignores an exported member of an exported namespace",
			code: "namespace Public { export const value = (): number => 1; } export { Public };",
		},
		{
			name: "ignores global script declarations",
			filename: "script/file.ts",
			code: "function add(a: number, b: number): number { return a + b; }",
		},
		{
			name: "keeps a literal annotation that prevents widening",
			code: "function status(): 'ok' { return 'ok'; } export {};",
		},
		{
			name: "keeps a tuple contract that changes inference",
			code: "function pair(): [number, number] { return [1, 2]; } export {};",
		},
		{
			name: "ignores any",
			code: "function unsafe(): any { return JSON.parse(\"null\"); } export {};",
		},
		{
			name: "ignores nested any",
			code: "async function unsafe(): Promise<any> { return JSON.parse(\"null\"); } export {};",
		},
		{
			name: "keeps unknown when it intentionally widens the implementation",
			code: "function hidden(): unknown { return 1; } export {};",
		},
		{
			name: "ignores return-only generics",
			code: "function make<T>(): T { throw new Error(); } export {};",
		},
		{
			name: "ignores predicates",
			code: "function isString(value: unknown): value is string { return typeof value === \"string\"; } export {};",
		},
		{
			name: "ignores assertion signatures",
			code: "function assertString(value: unknown): asserts value is string { if (typeof value !== \"string\") throw new Error(); } export {};",
		},
		{
			name: "ignores direct recursion",
			code: "function factorial(n: number): number { return n < 2 ? 1 : n * factorial(n - 1); } export {};",
		},
		{
			name: "ignores mutual recursion",
			code: [
				"function even(n: number): boolean { return n === 0 || odd(n - 1); }",
				"function odd(n: number): boolean { return n !== 0 && even(n - 1); }",
				"export {};",
			].join("\n"),
		},
		{
			name: "ignores overload sets",
			code: [
				"function convert(value: string): number;",
				"function convert(value: number): string;",
				"function convert(value: string | number): string | number {",
				"  return typeof value === \"string\" ? value.length : String(value);",
				"}",
				"export {};",
			].join("\n"),
		},
		{
			name: "ignores generators",
			code: "function* values(): Generator<number, void, unknown> { yield 1; } export {};",
		},
		{
			name: "ignores async generators",
			code: "async function* values(): AsyncGenerator<number, void, unknown> { yield 1; } export {};",
		},
		{
			name: "ignores methods",
			code: "class Calculator { add(a: number, b: number): number { return a + b; } } export {};",
		},
		{
			name: "ignores comments embedded in annotations",
			code: "const value = (): /* public contract */ number => 1; export {};",
		},
		{
			name: "keeps an annotation that changes body diagnostics",
			code: "function value(): { a: number } { return { a: 1, b: 2 }; } export {};",
		},
		{
			name: "keeps void when removing it changes body diagnostics",
			code: "function value(): void { return 1; } export {};",
		},
		{
			name: "does not orphan an imported type binding",
			filename: "orphan-import.ts",
			code: [
				"import type { User } from './types.js';",
				"const make = (): User => ({ id: '1' });",
				"void make;",
			].join("\n"),
		},
		{
			name: "does not orphan a default type import",
			filename: "orphan-default-import.ts",
			code: [
				"import type DefaultUser from './types.js';",
				"const make = (): DefaultUser => ({ id: '1' });",
				"void make;",
			].join("\n"),
		},
		{
			name: "does not orphan a namespace type import",
			filename: "orphan-namespace-import.ts",
			code: [
				"import type * as Types from './types.js';",
				"const make = (): Types.User => ({ id: '1' });",
				"void make;",
			].join("\n"),
		},
		{
			name: "does not orphan a local type binding",
			code: [
				"interface User { id: string; }",
				"const make = (): User => ({ id: '1' });",
				"void make;",
				"export {};",
			].join("\n"),
		},
	],
	invalid: [
		{
			name: "fixes a primitive function declaration",
			code: "function add(a: number, b: number): number { return a + b; } export {};",
			output: "function add(a: number, b: number) { return a + b; } export {};",
			errors: [error],
		},
		{
			name: "fixes an arrow function",
			code: "const greet = (name: string): string => `Hello ${name}`; export {};",
			output: "const greet = (name: string) => `Hello ${name}`; export {};",
			errors: [error],
		},
		{
			name: "fixes a function expression",
			code: "const add = function (a: number, b: number): number { return a + b; }; export {};",
			output: "const add = function (a: number, b: number) { return a + b; }; export {};",
			errors: [error],
		},
		{
			name: "fixes an exact inline object return type",
			code: "function value(): { a: number } { return { a: 1 }; } export {};",
			output: "function value() { return { a: 1 }; } export {};",
			errors: [error],
		},
		{
			name: "fixes a rest-parameter function",
			code: "function count(...values: number[]): number { return values.length; } export {};",
			output: "function count(...values: number[]) { return values.length; } export {};",
			errors: [error],
		},
		{
			name: "does not confuse a parameter named any with the any type",
			code: "function value(any: number): number { return any; } export {};",
			output: "function value(any: number) { return any; } export {};",
			errors: [error],
		},
		{
			name: "allows any in an unchanged parameter type",
			code: "function value(input: any): number { void input; return 1; } export {};",
			output: "function value(input: any) { void input; return 1; } export {};",
			errors: [error],
		},
		{
			name: "does not confuse a property named any with the any type",
			code: "function value(): { any: number } { return { any: 1 }; } export {};",
			output: "function value() { return { any: 1 }; } export {};",
			errors: [error],
		},
		{
			name: "fixes an inferable generic return",
			code: "function identity<T>(value: T): T { return value; } export {};",
			output: "function identity<T>(value: T) { return value; } export {};",
			errors: [error],
		},
		{
			name: "fixes an async Promise return",
			code: "async function count(): Promise<number> { return 1; } export {};",
			output: "async function count() { return 1; } export {};",
			errors: [error],
		},
		{
			name: "fixes exact void",
			code: "function log(): void { console.log(\"ok\"); } export {};",
			output: "function log() { console.log(\"ok\"); } export {};",
			errors: [error],
		},
		{
			name: "fixes exact unknown",
			code: "function pass(value: unknown): unknown { return value; } export {};",
			output: "function pass(value: unknown) { return value; } export {};",
			errors: [error],
		},
		{
			name: "fixes exact never",
			code: "const fail = (): never => { throw new Error(\"failure\"); }; export {};",
			output: "const fail = () => { throw new Error(\"failure\"); }; export {};",
			errors: [error],
		},
		{
			name: "fixes exact Promise void",
			code: "async function run(): Promise<void> { await Promise.resolve(); } export {};",
			output: "async function run() { await Promise.resolve(); } export {};",
			errors: [error],
		},
		{
			name: "fixes a contextually typed callback",
			code: "const increment: (value: number) => number = (value): number => value + 1; export {};",
			output: "const increment: (value: number) => number = (value) => value + 1; export {};",
			errors: [error],
		},
		{
			name: "fixes a private nested function inside an exported function",
			code: "export function outer(): void { function inner(): number { return 1; } void inner; }",
			output: "export function outer(): void { function inner() { return 1; } void inner; }",
			errors: [error],
		},
		{
			name: "fixes an exported member of a private namespace",
			code: "namespace Local { export const value = (): number => 1; } void Local; export {};",
			output: "namespace Local { export const value = () => 1; } void Local; export {};",
			errors: [error],
		},
		{
			name: "supports mts modules",
			filename: "module.mts",
			code: "function value(): number { return 1; } export {};",
			output: "function value() { return 1; } export {};",
			errors: [error],
		},
		{
			name: "supports cts modules",
			filename: "module.cts",
			code: "function value(): number { return 1; } export {};",
			output: "function value() { return 1; } export {};",
			errors: [error],
		},
		{
			name: "keeps only a jointly unsafe annotation in a recursive object",
			code: [
				"const pair = {",
				"  first: (): number => pair.second(),",
				"  second: (): number => pair.first(),",
				"};",
				"void pair;",
				"export {};",
			].join("\n"),
			output: [
				"const pair = {",
				"  first: () => pair.second(),",
				"  second: (): number => pair.first(),",
				"};",
				"void pair;",
				"export {};",
			].join("\n"),
			errors: [error],
		},
		{
			name: "batch-validates and fixes multiple annotations",
			code: [
				"function add(a: number, b: number): number { return a + b; }",
				"const greet = (name: string): string => `Hello ${name}`;",
				"export {};",
			].join("\n"),
			output: [
				"function add(a: number, b: number) { return a + b; }",
				"const greet = (name: string) => `Hello ${name}`;",
				"export {};",
			].join("\n"),
			errors: [error, error],
		},
	],
})
