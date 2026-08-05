import packageJson from "../package.json" with { type: "json" }

const serialized = JSON.stringify(packageJson)
if (serialized.includes("OWNER")) {
	throw new Error(
		"Replace the OWNER placeholders in package.json before publishing.",
	)
}

if (!packageJson.repository?.url || !packageJson.homepage || !packageJson.bugs?.url) {
	throw new Error("Repository, homepage, and bugs metadata are required to publish.")
}
