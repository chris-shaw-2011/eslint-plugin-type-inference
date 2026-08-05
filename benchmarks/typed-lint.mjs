import { performance } from "node:perf_hooks"
import { setImmediate } from "node:timers/promises"
import { isMainThread, parentPort, Worker, workerData } from "node:worker_threads"
import { ESLint } from "eslint"
import parser from "@typescript-eslint/parser"

const fixturePath = new URL("./fixtures/candidates.ts", import.meta.url).pathname

function sourceWithCandidates(count) {
	const functions = Array.from(
		{ length: count },
		(_, index) => `function value${index}(): number { return ${index}; }`,
	)
	return `${functions.join("\n")}\nexport {};\n`
}

async function measureFile(count, enableRule) {
	const plugin = enableRule ? (await import("../dist/index.js")).default : undefined
	const eslint = new ESLint({
		overrideConfigFile: true,
		overrideConfig: [
			{
				files: ["**/*.ts"],
				languageOptions: {
					parser,
					parserOptions: {
						projectService: true,
						tsconfigRootDir: new URL("./fixtures/", import.meta.url).pathname,
					},
				},
				...(plugin ? { plugins: { "type-inference": plugin } } : {}),
				rules: plugin
					? { "type-inference/no-inferrable-return-type": "error" }
					: {},
			},
		],
	})
	const source = sourceWithCandidates(count)
	const coldStarted = performance.now()
	const [coldResult] = await eslint.lintText(source, { filePath: fixturePath })
	const coldMilliseconds = performance.now() - coldStarted
	const warmStarted = performance.now()
	const [warmResult] = await eslint.lintText(source, { filePath: fixturePath })
	const warmMilliseconds = performance.now() - warmStarted
	const expected = enableRule ? count : 0
	const messages = warmResult?.messages.length ?? 0
	if (messages !== expected || coldResult?.messages.length !== expected) {
		throw new Error(`Expected ${expected} messages, got ${messages}.`)
	}

	// WeakRef targets are retained until the end of the current job.
	await setImmediate()
	globalThis.gc?.()
	globalThis.gc?.()
	const memory = process.memoryUsage()
	return {
		count,
		enableRule,
		coldMilliseconds,
		warmMilliseconds,
		messages,
		heapUsedBytes: memory.heapUsed,
		rssBytes: memory.rss,
	}
}

function runWorker(count, enableRule) {
	return new Promise((resolve, reject) => {
		let measurement
		const worker = new Worker(new URL(import.meta.url), {
			workerData: { count, enableRule },
		})
		worker.once("message", (result) => {
			measurement = result
		})
		worker.once("error", reject)
		worker.once("exit", (code) => {
			if (code !== 0) {
				reject(new Error(`Benchmark worker exited with code ${code}.`))
			}
			else if (measurement) {
				resolve(measurement)
			}
			else {
				reject(new Error("Benchmark worker exited without a measurement."))
			}
		})
	})
}

async function runBenchmark() {
	const measurements = []
	for (const count of [1, 10, 100]) {
		measurements.push(
			await runWorker(count, false),
			await runWorker(count, true),
		)
	}

	const baseline100 = measurements.find(
		measurement => measurement.count === 100 && !measurement.enableRule,
	)
	const rule100 = measurements.find(
		measurement => measurement.count === 100 && measurement.enableRule,
	)
	if (
		baseline100
		&& rule100
		&& (rule100.coldMilliseconds > Math.max(35, baseline100.coldMilliseconds * 2)
			|| rule100.heapUsedBytes > baseline100.heapUsedBytes * 1.5)
	) {
		process.exitCode = 1
	}

	console.log(JSON.stringify(measurements, null, 2))
}

if (!isMainThread) {
	const measurement = await measureFile(
		workerData.count,
		workerData.enableRule,
	)
	parentPort.postMessage(measurement)
}
else {
	await runBenchmark()
}
