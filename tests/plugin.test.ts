import { createRequire } from "node:module"
import parser from "@typescript-eslint/parser"
import { Linter } from "eslint"
import { describe, expect, it } from "vitest"
import plugin, { configs, rules } from "../src/index.js"
import packageJson from "../package.json" with { type: "json" }

describe("plugin exports", () => {
	it("exports flat-config metadata and the rule", () => {
		expect(plugin.meta).toEqual({
			name: "eslint-plugin-type-inference",
			version: packageJson.version,
		})
		expect(plugin.rules).toBe(rules)
		expect(plugin.configs).toBe(configs)
		expect(rules["no-inferrable-return-type"]).toBeDefined()
	})

	it("declares a CommonJS export and runtime dependency", () => {
		const require = createRequire(import.meta.url)
		expect(require.resolve("@typescript-eslint/utils")).toBeTruthy()
		expect(packageJson.exports["."].require.default).toBe("./dist/index.cjs")
	})

	it("fails actionably when typed parser services are unavailable", () => {
		const linter = new Linter()
		expect(() =>
			linter.verify(
				"function value(): number { return 1; }",
				{
					files: ["**/*.ts"],
					languageOptions: { parser },
					plugins: { "type-inference": plugin as never },
					rules: {
						"type-inference/no-inferrable-return-type": "error",
					},
				},
				{ filename: "file.ts" },
			),
		).toThrow(/requires typed parser services/u)
	})
})
