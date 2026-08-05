import { defineConfig } from "vitest/config"
import packageJson from "./package.json" with { type: "json" }

export default defineConfig({
	define: {
		__PACKAGE_VERSION__: JSON.stringify(packageJson.version),
	},
})
