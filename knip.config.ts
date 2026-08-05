import { createKnipConfig } from "@chris-shaw-2011/lint/knip"

const config: object = createKnipConfig({
	entry: ["benchmarks/*.mjs", "tests/**/*.test.ts"],
	ignore: [
		"benchmarks/fixtures/**",
		"tests/fixtures/**",
	],
})

export default config
