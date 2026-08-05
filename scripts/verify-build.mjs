import { access } from "node:fs/promises"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import packageJson from "../package.json" with { type: "json" }

const require = createRequire(import.meta.url)
const packageRoot = new URL("../", import.meta.url)
const resolveExport = path => new URL(path.replace(/^\.\//u, ""), packageRoot)
const importPath = packageJson.exports["."].import.default
const requirePath = packageJson.exports["."].require.default
const importTypes = packageJson.exports["."].import.types
const requireTypes = packageJson.exports["."].require.types

const esm = await import(resolveExport(importPath))
const cjs = require(fileURLToPath(resolveExport(requirePath)))
for (const [format, plugin] of [
	["ESM", esm.default],
	["CommonJS", cjs.default],
]) {
	if (
		plugin?.meta?.name !== packageJson.name
		|| plugin.meta.version !== packageJson.version
		|| !plugin.rules?.["no-inferrable-return-type"]
	) {
		throw new Error(`${format} build does not expose the expected plugin API.`)
	}
}

await Promise.all([
	access(resolveExport(importTypes)),
	access(resolveExport(requireTypes)),
])
