import {
	AST_NODE_TYPES,
	ESLintUtils,
	type TSESTree,
} from "@typescript-eslint/utils"
import ts from "typescript"

type Options = []
type MessageIds = "redundantReturnType"

type SupportedNode =
	TSESTree.FunctionDeclaration |
	TSESTree.FunctionExpression |
	TSESTree.ArrowFunctionExpression

interface Candidate {
	readonly returnType: TSESTree.TSTypeAnnotation,
	readonly tsNode: ts.FunctionLikeDeclaration,
	readonly start: number,
	readonly kind: ts.SyntaxKind,
	readonly range: readonly [number, number],
	readonly baselineFingerprint: string,
}

interface Evaluation {
	readonly pass: boolean,
}

const createRule = ESLintUtils.RuleCreator(
	name =>
		`https://www.npmjs.com/package/eslint-plugin-type-inference#${name}`,
)

const programCaches = new WeakMap<
	ts.Program,
	Map<string, Map<string, Evaluation>>
>()

interface IsolatedProgramState {
	readonly program: WeakRef<ts.Program>,
	readonly overlayFileName: string,
}

const isolatedProgramChains = new WeakMap<ts.Program, IsolatedProgramState>()

function sourceHash(text: string) {
	let hash = 2166136261
	for (let index = 0; index < text.length; index += 1) {
		hash ^= text.charCodeAt(index)
		hash = Math.imul(hash, 16777619)
	}
	return `${text.length}:${hash >>> 0}`
}

const TYPE_FORMAT_FLAGS: ts.TypeFormatFlags =
	ts.TypeFormatFlags.NoTruncation |
	ts.TypeFormatFlags.UseFullyQualifiedType |
	ts.TypeFormatFlags.WriteTypeArgumentsOfSignature

function diagnosticFingerprint(diagnostic: ts.Diagnostic) {
	return JSON.stringify([
		diagnostic.file?.fileName ?? "",
		diagnostic.code,
		diagnostic.category,
		diagnostic.start ?? -1,
		diagnostic.length ?? -1,
		ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
	])
}

function getFileDiagnostics(program: ts.Program, sourceFile: ts.SourceFile) {
	return [
		...program.getSyntacticDiagnostics(sourceFile),
		...program.getSemanticDiagnostics(sourceFile),
		...program.getDeclarationDiagnostics(sourceFile),
	]
		.map(diagnosticFingerprint)
		.sort()
}

function returnTypeContainsAny(
	checker: ts.TypeChecker,
	returnType: ts.Type,
	node: ts.FunctionLikeDeclaration,
) {
	if ((returnType.flags & ts.TypeFlags.Any) !== 0) return true

	const typeNode = checker.typeToTypeNode(
		returnType,
		node,
		ts.NodeBuilderFlags.NoTruncation | ts.NodeBuilderFlags.UseFullyQualifiedType,
	)
	if (!typeNode) return true

	let containsAny = false
	const visit = (current: ts.Node): void => {
		if (current.kind === ts.SyntaxKind.AnyKeyword) {
			containsAny = true
			return
		}
		if (!containsAny) ts.forEachChild(current, visit)
	}
	visit(typeNode)
	return containsAny
}

function signatureFingerprint(
	checker: ts.TypeChecker,
	node: ts.FunctionLikeDeclaration,
) {
	const signature = checker.getSignatureFromDeclaration(node)
	if (!signature) return undefined

	const returnType = checker.getReturnTypeOfSignature(signature)
	const signatureText = checker.signatureToString(
		signature,
		node,
		TYPE_FORMAT_FLAGS,
		ts.SignatureKind.Call,
	)
	const returnText = checker.typeToString(returnType, node, TYPE_FORMAT_FLAGS)
	if (returnTypeContainsAny(checker, returnType, node)) return undefined

	return JSON.stringify({ signatureText, returnText, flags: returnType.flags })
}

function preserveLinesAsWhitespace(text: string) {
	return text.replace(/[^\r\n]/gu, " ")
}

function applyVirtualRemovals(
	sourceText: string,
	candidates: readonly Candidate[],
) {
	let result = sourceText
	for (const candidate of [...candidates].sort((a, b) => b.range[0] - a.range[0])) {
		const [start, end] = candidate.range
		result =
			result.slice(0, start) +
			preserveLinesAsWhitespace(result.slice(start, end)) +
			result.slice(end)
	}
	return result
}

function samePath(left: string, right: string) {
	if (ts.sys.useCaseSensitiveFileNames) return left === right
	return left.toLowerCase() === right.toLowerCase()
}

function scriptKindForFile(fileName: string): ts.ScriptKind {
	if (fileName.endsWith(".tsx")) return ts.ScriptKind.TSX
	if (fileName.endsWith(".jsx")) return ts.ScriptKind.JSX
	if (/\.[cm]?js$/u.test(fileName)) return ts.ScriptKind.JS
	return ts.ScriptKind.TS
}

export function createOverlayProgram(
	originalProgram: ts.Program,
	originalSourceFile: ts.SourceFile,
	sourceText: string,
) {
	const options = originalProgram.getCompilerOptions()
	const host = ts.createCompilerHost(options, true)
	const storedState = isolatedProgramChains.get(originalProgram)
	const previousProgram = storedState?.program.deref()
	const previousState = storedState && previousProgram ?
			{ program: previousProgram, overlayFileName: storedState.overlayFileName } :
		undefined
	const originalGetSourceFile = host.getSourceFile.bind(host)
	const originalReadFile = host.readFile.bind(host)
	const originalFileExists = host.fileExists.bind(host)
	const createFreshSourceFile = (
		fileName: string,
		text: string,
		languageVersionOrOptions: ts.ScriptTarget | ts.CreateSourceFileOptions,
	) => ts.createSourceFile(
		fileName,
		text,
		languageVersionOrOptions,
		true,
		scriptKindForFile(fileName),
	)

	host.fileExists = fileName =>
		samePath(fileName, originalSourceFile.fileName) || originalFileExists(fileName)
	host.readFile = fileName =>
		samePath(fileName, originalSourceFile.fileName) ?
			sourceText :
				originalReadFile(fileName)
	host.getSourceFile = (
		fileName,
		languageVersionOrOptions,
		onError,
		shouldCreateNewSourceFile,
	) => {
		if (samePath(fileName, originalSourceFile.fileName)) {
			return createFreshSourceFile(
				fileName,
				sourceText,
				languageVersionOrOptions,
			)
		}

		if (previousState) {
			if (samePath(fileName, previousState.overlayFileName)) {
				const original = originalProgram.getSourceFile(fileName)
				if (original) {
					return createFreshSourceFile(
						fileName,
						original.text,
						languageVersionOrOptions,
					)
				}
			}

			const previous = previousState.program.getSourceFile(fileName)
			if (previous) return previous
		}

		return originalGetSourceFile(
			fileName,
			languageVersionOrOptions,
			onError,
			shouldCreateNewSourceFile,
		)
	}
	host.writeFile = () => undefined

	const projectReferences = originalProgram.getProjectReferences()
	const overlayProgram = ts.createProgram({
		rootNames: originalProgram.getRootFileNames(),
		options,
		...(projectReferences ? { projectReferences } : {}),
		host,
		...(previousState ? { oldProgram: previousState.program } : {}),
		configFileParsingDiagnostics: originalProgram.getConfigFileParsingDiagnostics(),
	})
	// The chain may reuse its own previous SourceFiles because that Program is
	// never queried again. Parser-owned SourceFiles never enter this chain.
	isolatedProgramChains.set(originalProgram, {
		program: new WeakRef(overlayProgram),
		overlayFileName: originalSourceFile.fileName,
	})
	return overlayProgram
}

function functionNodesByLocation(sourceFile: ts.SourceFile) {
	const nodes = new Map<string, ts.FunctionLikeDeclaration>()
	const visit = (node: ts.Node): void => {
		if (
			ts.isFunctionDeclaration(node) ||
			ts.isFunctionExpression(node) ||
			ts.isArrowFunction(node)
		) {
			nodes.set(`${node.kind}:${node.getStart(sourceFile)}`, node)
		}
		ts.forEachChild(node, visit)
	}
	visit(sourceFile)
	return nodes
}

function arraysEqual(left: readonly string[], right: readonly string[]) {
	return left.length === right.length && left.every((value, index) => value === right[index])
}

function candidateSetKey(candidates: readonly Candidate[]) {
	return candidates
		.map(candidate => `${candidate.range[0]}-${candidate.range[1]}`)
		.sort()
		.join(",")
}

function evaluateCandidateSet(
	originalProgram: ts.Program,
	originalSourceFile: ts.SourceFile,
	sourceText: string,
	baselineDiagnostics: readonly string[],
	candidates: readonly Candidate[],
) {
	if (candidates.length === 0) return { pass: true }

	let fileCache = programCaches.get(originalProgram)
	if (!fileCache) {
		fileCache = new Map()
		programCaches.set(originalProgram, fileCache)
	}
	const fileKey = `${originalSourceFile.fileName}:${sourceHash(sourceText)}`
	let evaluations = fileCache.get(fileKey)
	if (!evaluations) {
		evaluations = new Map()
		fileCache.set(fileKey, evaluations)
	}
	const key = candidateSetKey(candidates)
	const cached = evaluations.get(key)
	if (cached) return cached

	let evaluation: Evaluation = { pass: false }
	try {
		const overlayProgram = createOverlayProgram(
			originalProgram,
			originalSourceFile,
			applyVirtualRemovals(sourceText, candidates),
		)
		const overlaySourceFile = overlayProgram.getSourceFile(originalSourceFile.fileName)
		if (!overlaySourceFile) {
			evaluations.set(key, evaluation)
			return evaluation
		}

		if (!arraysEqual(baselineDiagnostics, getFileDiagnostics(overlayProgram, overlaySourceFile))) {
			evaluations.set(key, evaluation)
			return evaluation
		}

		const checker = overlayProgram.getTypeChecker()
		const overlayNodes = functionNodesByLocation(overlaySourceFile)
		evaluation = {
			pass: candidates.every(candidate => {
				const overlayNode = overlayNodes.get(`${candidate.kind}:${candidate.start}`)
				return Boolean(
					overlayNode &&
					!overlayNode.type &&
					signatureFingerprint(checker, overlayNode) === candidate.baselineFingerprint,
				)
			}),
		}
	}
	catch {
		// Reproduction failures are exclusions, never lint crashes.
	}

	evaluations.set(key, evaluation)
	return evaluation
}

function hasExportModifier(node: ts.Node) {
	return Boolean(
		ts.getCombinedModifierFlags(node as ts.Declaration) & ts.ModifierFlags.Export,
	)
}

function candidateSymbol(
	checker: ts.TypeChecker,
	node: ts.FunctionLikeDeclaration,
) {
	if ((ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)) && node.name) {
		return checker.getSymbolAtLocation(node.name)
	}
	if (
		(ts.isFunctionExpression(node) || ts.isArrowFunction(node)) &&
		ts.isVariableDeclaration(node.parent) &&
		ts.isIdentifier(node.parent.name)
	) {
		return checker.getSymbolAtLocation(node.parent.name)
	}
	return undefined
}

function resolveAlias(checker: ts.TypeChecker, symbol: ts.Symbol) {
	return (symbol.flags & ts.SymbolFlags.Alias) !== 0 ?
			checker.getAliasedSymbol(symbol) :
		symbol
}

function isExportedSymbol(
	checker: ts.TypeChecker,
	sourceFile: ts.SourceFile,
	symbol: ts.Symbol | undefined,
) {
	const moduleSymbol = checker.getSymbolAtLocation(sourceFile)
	if (!symbol || !moduleSymbol) return false
	const target = resolveAlias(checker, symbol)
	return checker
		.getExportsOfModule(moduleSymbol)
		.some(exported => resolveAlias(checker, exported) === target)
}

function exportAssignmentTargetsSymbol(
	checker: ts.TypeChecker,
	sourceFile: ts.SourceFile,
	symbol: ts.Symbol,
) {
	const target = resolveAlias(checker, symbol)
	return sourceFile.statements.some(statement => {
		if (!ts.isExportAssignment(statement)) return false
		const exported = checker.getSymbolAtLocation(statement.expression)
		return Boolean(exported && resolveAlias(checker, exported) === target)
	})
}

function declarationSymbol(
	checker: ts.TypeChecker,
	node: ts.Node,
) {
	if (
		(ts.isVariableDeclaration(node) ||
			ts.isClassDeclaration(node) ||
			ts.isClassExpression(node) ||
			ts.isModuleDeclaration(node)) &&
			node.name &&
			ts.isIdentifier(node.name)
	) {
		return checker.getSymbolAtLocation(node.name)
	}
	return undefined
}

function exportModifierReachesRoot(
	checker: ts.TypeChecker,
	sourceFile: ts.SourceFile,
	node: ts.Node,
): boolean {
	let current = node.parent
	while (current !== sourceFile && !ts.isModuleBlock(current)) {
		current = current.parent
	}
	if (current === sourceFile) return true

	const namespace = current.parent
	const symbol = declarationSymbol(checker, namespace)
	return (
		isExportedSymbol(checker, sourceFile, symbol) ||
		(hasExportModifier(namespace) &&
			exportModifierReachesRoot(checker, sourceFile, namespace))
	)
}

function isPublicCandidate(
	checker: ts.TypeChecker,
	sourceFile: ts.SourceFile,
	candidate: Candidate,
) {
	const ownSymbol = candidateSymbol(checker, candidate.tsNode)
	if (
		isExportedSymbol(checker, sourceFile, ownSymbol) ||
		(ownSymbol && exportAssignmentTargetsSymbol(checker, sourceFile, ownSymbol)) ||
		(hasExportModifier(candidate.tsNode) &&
			exportModifierReachesRoot(checker, sourceFile, candidate.tsNode))
	) {
		return true
	}

	let current = candidate.tsNode.parent
	while (current !== sourceFile) {
		if (ts.isFunctionLike(current) || ts.isBlock(current) || ts.isModuleBlock(current)) {
			return false
		}
		if (
			ts.isExportAssignment(current) ||
			(hasExportModifier(current) &&
				exportModifierReachesRoot(checker, sourceFile, current))
		) {
			return true
		}

		const symbol = declarationSymbol(checker, current)
		if (isExportedSymbol(checker, sourceFile, symbol)) return true
		current = current.parent
	}
	return false
}

function isMethodLikeExpression(node: SupportedNode) {
	if (node.type !== AST_NODE_TYPES.FunctionExpression) return false
	return (
		(node.parent.type === AST_NODE_TYPES.Property && node.parent.method) ||
		node.parent.type === AST_NODE_TYPES.MethodDefinition ||
		node.parent.type === AST_NODE_TYPES.TSAbstractMethodDefinition
	)
}

function hasOverloads(symbol: ts.Symbol | undefined) {
	return (symbol?.declarations?.filter(declaration => ts.isFunctionLike(declaration)).length ?? 0) > 1
}

function typeParameterAppearsOnlyInReturnType(
	checker: ts.TypeChecker,
	node: ts.FunctionLikeDeclaration,
) {
	if (!node.type || !node.typeParameters?.length) return false

	const returned = new Set<ts.Symbol>()
	const parameterized = new Set<ts.Symbol>()
	const collect = (root: ts.Node, into: Set<ts.Symbol>) => {
		const visit = (child: ts.Node): void => {
			if (ts.isIdentifier(child)) {
				const symbol = checker.getSymbolAtLocation(child)
				if (symbol) into.add(symbol)
			}
			ts.forEachChild(child, visit)
		}
		visit(root)
	}
	collect(node.type, returned)
	for (const parameter of node.parameters) {
		if (parameter.type) collect(parameter.type, parameterized)
	}

	return node.typeParameters.some(typeParameter => {
		const symbol = checker.getSymbolAtLocation(typeParameter.name)
		return Boolean(symbol && returned.has(symbol) && !parameterized.has(symbol))
	})
}

function rangesContain(ranges: readonly (readonly [number, number])[], position: number) {
	return ranges.some(([start, end]) => position >= start && position < end)
}

function isOrphanableDeclaration(declaration: ts.Declaration) {
	const orphanable =
		ts.isImportSpecifier(declaration) ||
		ts.isImportClause(declaration) ||
		ts.isNamespaceImport(declaration) ||
		ts.isImportEqualsDeclaration(declaration) ||
		ts.isTypeParameterDeclaration(declaration) ||
		ts.isTypeAliasDeclaration(declaration) ||
		ts.isInterfaceDeclaration(declaration) ||
		ts.isClassDeclaration(declaration) ||
		ts.isClassExpression(declaration) ||
		ts.isFunctionDeclaration(declaration) ||
		ts.isFunctionExpression(declaration) ||
		ts.isVariableDeclaration(declaration) ||
		ts.isParameter(declaration) ||
		ts.isBindingElement(declaration) ||
		ts.isEnumDeclaration(declaration) ||
		ts.isModuleDeclaration(declaration)
	if (!orphanable) return false

	let current: ts.Node = declaration
	while (!ts.isSourceFile(current)) {
		if (
			(ts.getCombinedModifierFlags(current as ts.Declaration) &
				ts.ModifierFlags.Ambient) !==
				0
		) {
			return false
		}
		current = current.parent
	}
	return true
}

function isBindingDeclarationName(identifier: ts.Identifier) {
	const parent = identifier.parent
	return (
		isOrphanableDeclaration(parent as ts.Declaration) &&
		"name" in parent &&
		parent.name === identifier
	)
}

function removalWouldOrphanLocalBinding(
	checker: ts.TypeChecker,
	sourceFile: ts.SourceFile,
	candidate: Candidate,
	allAnnotationRanges: readonly (readonly [number, number])[],
) {
	if (!candidate.tsNode.type) return true
	const referencedLocalSymbols = new Set<ts.Symbol>()
	const collectReferenced = (node: ts.Node): void => {
		if (ts.isIdentifier(node)) {
			const symbol = checker.getSymbolAtLocation(node)
			if (
				symbol?.declarations?.some(
					declaration =>
						declaration.getSourceFile() === sourceFile &&
						isOrphanableDeclaration(declaration) &&
						!rangesContain([candidate.range], declaration.getStart(sourceFile)),
				)
			) {
				referencedLocalSymbols.add(symbol)
			}
		}
		ts.forEachChild(node, collectReferenced)
	}
	collectReferenced(candidate.tsNode.type)
	if (referencedLocalSymbols.size === 0) return false

	const symbolsUsedOutsideAnnotations = new Set<ts.Symbol>()
	const findUses = (node: ts.Node): void => {
		if (ts.isIdentifier(node) && !isBindingDeclarationName(node)) {
			const symbol = checker.getSymbolAtLocation(node)
			if (
				symbol &&
				referencedLocalSymbols.has(symbol) &&
				!rangesContain(allAnnotationRanges, node.getStart(sourceFile))
			) {
				symbolsUsedOutsideAnnotations.add(symbol)
			}
		}
		ts.forEachChild(node, findUses)
	}
	findUses(sourceFile)

	return [...referencedLocalSymbols].some(symbol => !symbolsUsedOutsideAnnotations.has(symbol))
}

function cyclicCandidates(
	checker: ts.TypeChecker,
	candidates: readonly Candidate[],
) {
	const bySymbol = new Map<ts.Symbol, Candidate>()
	for (const candidate of candidates) {
		const symbol = candidateSymbol(checker, candidate.tsNode)
		if (symbol) bySymbol.set(resolveAlias(checker, symbol), candidate)
	}

	const edges = new Map<Candidate, Set<Candidate>>()
	for (const candidate of candidates) {
		const dependencies = new Set<Candidate>()
		const visit = (node: ts.Node): void => {
			if (ts.isIdentifier(node)) {
				const symbol = checker.getSymbolAtLocation(node)
				if (symbol) {
					const dependency = bySymbol.get(resolveAlias(checker, symbol))
					if (dependency) dependencies.add(dependency)
				}
			}
			ts.forEachChild(node, visit)
		}
		if (candidate.tsNode.body) visit(candidate.tsNode.body)
		edges.set(candidate, dependencies)
	}

	const cyclic = new Set<Candidate>()
	const reachesSelf = (
		origin: Candidate,
		current: Candidate,
		seen: Set<Candidate>,
	): boolean => {
		if (seen.has(current)) return false
		seen.add(current)
		for (const dependency of edges.get(current) ?? []) {
			if (dependency === origin || reachesSelf(origin, dependency, seen)) return true
		}
		return false
	}
	for (const candidate of candidates) {
		if (reachesSelf(candidate, candidate, new Set())) cyclic.add(candidate)
	}
	return cyclic
}

export const noInferrableReturnType = createRule<Options, MessageIds>({
	name: "no-inferrable-return-type",
	meta: {
		type: "suggestion",
		docs: {
			description:
        "Remove explicit function return types only when TypeScript proves inference is equivalent.",
		},
		fixable: "code",
		schema: [],
		messages: {
			redundantReturnType:
        "This return type is redundant: removing it preserves TypeScript's inferred callable signature and diagnostics.",
		},
	},
	defaultOptions: [],
	create(context) {
		let services: ReturnType<typeof ESLintUtils.getParserServices>
		try {
			services = ESLintUtils.getParserServices(context)
		}
		catch (error) {
			throw new Error(
				"type-inference/no-inferrable-return-type requires typed parser services. " +
				"Configure @typescript-eslint/parser with parserOptions.projectService: true.",
				{ cause: error },
			)
		}

		const program = services.program
		const checker = program.getTypeChecker()
		const sourceFile = program.getSourceFile(context.filename)
		const candidates: Candidate[] = []
		const allReturnTypeRanges: (readonly [number, number])[] = []

		const collect = (node: SupportedNode) => {
			if (!node.returnType || !sourceFile) return
			allReturnTypeRanges.push(node.returnType.range)

			const tsNode = services.esTreeNodeToTSNodeMap.get(node)
			if (
				!(
					ts.isFunctionDeclaration(tsNode) ||
					ts.isFunctionExpression(tsNode) ||
					ts.isArrowFunction(tsNode)
				) ||
				!tsNode.body ||
				!tsNode.type ||
				tsNode.asteriskToken ||
				isMethodLikeExpression(node)
			) {
				return
			}

			const symbol = candidateSymbol(checker, tsNode)
			if (
				hasOverloads(symbol) ||
				ts.isTypePredicateNode(tsNode.type) ||
				typeParameterAppearsOnlyInReturnType(checker, tsNode) ||
				context.sourceCode.getCommentsInside(node.returnType).length > 0
			) {
				return
			}

			const baselineFingerprint = signatureFingerprint(checker, tsNode)
			if (!baselineFingerprint) return

			candidates.push({
				returnType: node.returnType,
				tsNode,
				start: tsNode.getStart(sourceFile),
				kind: tsNode.kind,
				range: node.returnType.range,
				baselineFingerprint,
			})
		}

		return {
			FunctionDeclaration: collect,
			FunctionExpression: collect,
			ArrowFunctionExpression: collect,
			"Program:exit"() {
				if (!sourceFile || !ts.isExternalModule(sourceFile)) return

				const cyclic = cyclicCandidates(checker, candidates)
				const eligible = candidates.filter(candidate => (
					!cyclic.has(candidate) &&
					!isPublicCandidate(checker, sourceFile, candidate) &&
					!removalWouldOrphanLocalBinding(
						checker,
						sourceFile,
						candidate,
						allReturnTypeRanges,
					)
				))
				if (eligible.length === 0) return

				const sourceText = context.sourceCode.text
				const baselineDiagnostics = getFileDiagnostics(program, sourceFile)
				let accepted: Candidate[] = []

				if (
					evaluateCandidateSet(
						program,
						sourceFile,
						sourceText,
						baselineDiagnostics,
						eligible,
					).pass
				) {
					accepted = eligible
				}
				else {
					const individuallySafe = eligible.filter(candidate =>
						evaluateCandidateSet(
							program,
							sourceFile,
							sourceText,
							baselineDiagnostics,
							[candidate],
						).pass,
					)
					for (const candidate of individuallySafe) {
						const proposed = [...accepted, candidate]
						if (
							evaluateCandidateSet(
								program,
								sourceFile,
								sourceText,
								baselineDiagnostics,
								proposed,
							).pass
						) {
							accepted = proposed
						}
					}
				}

				for (const candidate of accepted) {
					context.report({
						node: candidate.returnType,
						messageId: "redundantReturnType",
						fix: fixer => fixer.removeRange(candidate.range),
					})
				}
			},
		}
	},
})
