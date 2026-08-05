import type { TSESLint } from "@typescript-eslint/utils"
import { noInferrableReturnType } from "./rules/no-inferrable-return-type.js"

declare const __PACKAGE_VERSION__: string

export const rules = {
	"no-inferrable-return-type": noInferrableReturnType,
}

export const configs = {}

const plugin = {
	meta: {
		name: "eslint-plugin-type-inference",
		version: __PACKAGE_VERSION__,
	},
	rules,
	configs,
} satisfies TSESLint.FlatConfig.Plugin

export { noInferrableReturnType }
export default plugin
