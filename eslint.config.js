import sharedConfig from "@chris-shaw-2011/lint/without-type-inference"
import globals from "globals"
import localTypeInference from "./dist/index.js"

export default [
	{
		ignores: [
			"benchmarks/fixtures/**",
			"tests/fixtures/**",
		],
	},
	...sharedConfig,
	{
		files: ["**/*.{js,mjs,cjs,jsx,mjsx,ts,mts,cts,tsx,mtsx}"],
		languageOptions: {
			globals: globals.node,
		},
	},
	{
		files: ["tests/no-inferrable-return-type.test.ts"],
		rules: {
			// TypeScript 6 overflows while evaluating this large RuleTester case.
			"@typescript-eslint/no-floating-promises": "off",
		},
	},
	{
		files: ["src/**/*.ts", "tests/**/*.ts"],
		plugins: {
			"type-inference": localTypeInference,
		},
		rules: {
			"type-inference/no-inferrable-return-type": "error",
		},
	},
]
