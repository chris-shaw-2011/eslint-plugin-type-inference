import { fileURLToPath } from "node:url"
import ts from "typescript"
import { describe, expect, it } from "vitest"
import { createOverlayProgram } from "../src/rules/no-inferrable-return-type.js"

function createFixtureProgram() {
	const configPath = fileURLToPath(
		new URL("./fixtures/tsconfig.json", import.meta.url),
	)
	const configFile = ts.readConfigFile(
		configPath,
		fileName => ts.sys.readFile(fileName),
	)
	const parsed = ts.parseJsonConfigFileContent(
		configFile.config,
		ts.sys,
		fileURLToPath(new URL("./fixtures/", import.meta.url)),
	)
	return ts.createProgram({
		rootNames: parsed.fileNames,
		options: parsed.options,
	})
}

function withoutReturnType(sourceText: string) {
	return sourceText.replace("): Row", ")     ")
}

describe("counterfactual program isolation", () => {
	it("does not reuse source files owned by the parser program", () => {
		const originalProgram = createFixtureProgram()
		const firstPath = fileURLToPath(
			new URL("./fixtures/order/first.ts", import.meta.url),
		)
		const originalFirst = originalProgram.getSourceFile(firstPath)
		expect(originalFirst).toBeDefined()
		if (!originalFirst) return

		const overlayProgram = createOverlayProgram(
			originalProgram,
			originalFirst,
			withoutReturnType(originalFirst.text),
		)

		for (const originalSourceFile of originalProgram.getSourceFiles()) {
			const overlaySourceFile = overlayProgram.getSourceFile(
				originalSourceFile.fileName,
			)
			expect(overlaySourceFile).not.toBe(originalSourceFile)
		}
	})

	it("restores the previous overlay before evaluating another file", () => {
		const originalProgram = createFixtureProgram()
		const firstPath = fileURLToPath(
			new URL("./fixtures/order/first.ts", import.meta.url),
		)
		const secondPath = fileURLToPath(
			new URL("./fixtures/order/second.ts", import.meta.url),
		)
		const originalFirst = originalProgram.getSourceFile(firstPath)
		const originalSecond = originalProgram.getSourceFile(secondPath)
		expect(originalFirst).toBeDefined()
		expect(originalSecond).toBeDefined()
		if (!originalFirst || !originalSecond) return

		const firstOverlay = createOverlayProgram(
			originalProgram,
			originalFirst,
			withoutReturnType(originalFirst.text),
		)
		const secondOverlay = createOverlayProgram(
			originalProgram,
			originalSecond,
			originalSecond.text,
		)
		const restoredFirst = secondOverlay.getSourceFile(firstPath)

		expect(firstOverlay.getSourceFile(firstPath)?.text).not.toBe(originalFirst.text)
		expect(restoredFirst?.text).toBe(originalFirst.text)
		expect(restoredFirst).not.toBe(originalFirst)
	})
})
