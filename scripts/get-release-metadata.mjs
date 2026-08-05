import { execFileSync } from "node:child_process"
import { appendFileSync } from "node:fs"

import packageLock from "../package-lock.json" with { type: "json" }
import packageJson from "../package.json" with { type: "json" }

const semverPattern
	= /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/

const version = packageJson.version
if (!semverPattern.test(version)) {
	throw new Error(`package.json contains an invalid version: ${version}`)
}

if (packageLock.version !== version || packageLock.packages?.[""]?.version !== version) {
	throw new Error(
		`package-lock.json must use the same version as package.json (${version}).`,
	)
}

const tag = `v${version}`
let tagExists = true

try {
	execFileSync("git", ["show-ref", "--verify", "--quiet", `refs/tags/${tag}`], {
		stdio: "ignore",
	})
}
catch (error) {
	if (error?.status !== 1) {
		throw error
	}

	tagExists = false
}

const shouldRelease = !tagExists
const output = [
	`version=${version}`,
	`tag=${tag}`,
	`should-release=${shouldRelease}`,
].join("\n")

if (process.env.GITHUB_OUTPUT) {
	appendFileSync(process.env.GITHUB_OUTPUT, `${output}\n`)
}

console.log(
	shouldRelease
		? `Version ${version} has no ${tag} tag and will be released.`
		: `Version ${version} is already represented by ${tag}; skipping release.`,
)
