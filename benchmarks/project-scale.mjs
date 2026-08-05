import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { performance } from "node:perf_hooks"
import { setImmediate } from "node:timers/promises"
import { isMainThread, parentPort, Worker, workerData } from "node:worker_threads"
import { ESLint } from "eslint"
import parser from "@typescript-eslint/parser"

async function measureProject(projectDirectory, fileCount, enableRule) {
	const plugin = enableRule ? (await import("../dist/index.js")).default : undefined
	const eslint = new ESLint({
		cwd: projectDirectory,
		overrideConfigFile: true,
		overrideConfig: [
			{
				files: ["**/*.ts"],
				languageOptions: {
					parser,
					parserOptions: {
						projectService: true,
						tsconfigRootDir: projectDirectory,
					},
				},
				...(plugin ? { plugins: { "type-inference": plugin } } : {}),
				rules: plugin
					? { "type-inference/no-inferrable-return-type": "error" }
					: {},
			},
		],
	})
	const started = performance.now()
	const results = await eslint.lintFiles(["*.ts"])
	const elapsedMilliseconds = performance.now() - started
	const messages = results.reduce(
		(total, result) => total + result.messages.length,
		0,
	)
	const candidateFiles = Math.ceil(fileCount / 100)
	const expected = enableRule ? candidateFiles : 0
	if (messages !== expected) throw new Error(`Expected ${expected} messages, got ${messages}.`)

	// WeakRef targets are retained until the end of the current job.
	await setImmediate()
	globalThis.gc?.()
	globalThis.gc?.()
	const memory = process.memoryUsage()
	return {
		fileCount,
		candidateFiles,
		enableRule,
		elapsedMilliseconds,
		heapUsedBytes: memory.heapUsed,
		rssBytes: memory.rss,
		messages,
	}
}

function runWorker(projectDirectory, fileCount, enableRule) {
	return new Promise((resolve, reject) => {
		let measurement
		const worker = new Worker(new URL(import.meta.url), {
			workerData: { projectDirectory, fileCount, enableRule },
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
	const scales = process.env.TYPE_INFERENCE_BENCHMARK_LARGE === "true"
		? [100, 1_000, 10_000]
		: [100, 1_000]
	const measurements = []

	for (const fileCount of scales) {
		const projectDirectory = await mkdtemp(
			join(tmpdir(), `type-inference-${fileCount}-`),
		)
		try {
			await writeFile(
				join(projectDirectory, "tsconfig.json"),
				JSON.stringify({
					compilerOptions: {
						target: "ES2022",
						module: "NodeNext",
						moduleResolution: "NodeNext",
						strict: true,
						noEmit: true,
						skipLibCheck: true,
					},
					include: ["./*.ts"],
				}),
			)

			await Promise.all(
				Array.from({ length: fileCount }, (_, index) => {
					const annotation = index % 100 === 0 ? ": number" : ""
					return writeFile(
						join(projectDirectory, `file-${index}.ts`),
						`function value${index}()${annotation} { return ${index}; }\nvoid value${index};\nexport {};\n`,
					)
				}),
			)

			measurements.push(
				await runWorker(projectDirectory, fileCount, false),
				await runWorker(projectDirectory, fileCount, true),
			)
		}
		finally {
			await rm(projectDirectory, { recursive: true, force: true })
		}
	}

	for (const fileCount of scales) {
		const baseline = measurements.find(
			measurement => measurement.fileCount === fileCount && !measurement.enableRule,
		)
		const rule = measurements.find(
			measurement => measurement.fileCount === fileCount && measurement.enableRule,
		)
		if (
			baseline
			&& rule
			&& (rule.elapsedMilliseconds > baseline.elapsedMilliseconds * 2
				|| rule.heapUsedBytes > baseline.heapUsedBytes * 1.5)
		) {
			process.exitCode = 1
		}
	}

	console.log(JSON.stringify(measurements, null, 2))
}

if (!isMainThread) {
	const measurement = await measureProject(
		workerData.projectDirectory,
		workerData.fileCount,
		workerData.enableRule,
	)
	parentPort.postMessage(measurement)
}
else {
	await runBenchmark()
}
