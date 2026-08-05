import { defineConfig } from "tsup"
import packageJson from "./package.json" with { type: "json" }

export default defineConfig({
	entry: ["src/index.ts"],
	format: ["esm", "cjs"],
	target: "node20",
	define: {
		__PACKAGE_VERSION__: JSON.stringify(packageJson.version),
	},
	dts: {
		// tsup 8.5 injects the deprecated `baseUrl` option while bundling
		// declarations. Keep this workaround scoped to its DTS worker.
		// https://github.com/egoist/tsup/issues/1388
		compilerOptions: { ignoreDeprecations: "6.0" },
	},
	sourcemap: true,
	clean: true,
	splitting: false,
	external: [
		"eslint",
		"typescript",
		"@typescript-eslint/utils",
	],
	outExtension({ format }) {
		return { js: format === "cjs" ? ".cjs" : ".js" }
	},
})
