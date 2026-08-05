import tseslintPlugin from "@typescript-eslint/eslint-plugin"
import parser from "@typescript-eslint/parser"
import { ESLint } from "eslint"
import { describe, expect, it } from "vitest"
import plugin from "../src/index.js"

async function lintFixtureProject(
	directory: string,
	filePattern: string,
	fileName: string,
) {
	const projectDirectory = new URL(directory, import.meta.url).pathname
	const eslint = new ESLint({
		cwd: projectDirectory,
		fix: true,
		overrideConfigFile: true,
		overrideConfig: [
			{
				files: [filePattern],
				languageOptions: {
					parser,
					parserOptions: {
						projectService: true,
						tsconfigRootDir: projectDirectory,
					},
				},
				plugins: { "type-inference": plugin as never },
				rules: {
					"type-inference/no-inferrable-return-type": "error",
				},
			},
		],
	})
	const [result] = await eslint.lintFiles([fileName])
	return result
}

describe("typed project integration", () => {
	it("does not corrupt the shared parser program between files", async () => {
		const projectDirectory = new URL("./fixtures/", import.meta.url).pathname
		const eslint = new ESLint({
			cwd: projectDirectory,
			overrideConfigFile: true,
			overrideConfig: [
				{
					files: ["**/*.ts"],
					languageOptions: {
						parser,
						parserOptions: {
							projectService: true,
							tsconfigRootDir: projectDirectory,
						},
					},
					plugins: {
						"@typescript-eslint": tseslintPlugin as never,
						"type-inference": plugin as never,
					},
					rules: {
						"@typescript-eslint/no-unsafe-argument": "error",
						"@typescript-eslint/no-unsafe-member-access": "error",
						"type-inference/no-inferrable-return-type": "error",
					},
				},
			],
		})

		const results = await eslint.lintFiles([
			"order/first.ts",
			"order/second.ts",
		])
		const second = results.find(result => result.filePath.endsWith("/second.ts"))

		expect(second?.messages).toEqual([])
	})

	it("rechecks and fixes a file owned by a referenced project", async () => {
		const result = await lintFixtureProject(
			"./fixtures/references/app/",
			"**/*.ts",
			"file.ts",
		)
		expect(result?.messages).toEqual([])
		expect(result?.output).toContain("function value()")
		expect(result?.output).not.toContain("function value(): number")
	})

	it("fixes an exact JSX return type", async () => {
		const result = await lintFixtureProject(
			"./fixtures/jsx/",
			"**/*.tsx",
			"component.tsx",
		)
		expect(result?.messages).toEqual([])
		expect(result?.output).toContain("const view = () => <div />;")
	})
})
