// Role: parse macro aliases and evaluate macro expressions shared by
// Decomposition, motion analysis, aliases, KAIJU Sense macro hovers, and tool
// modeling. Keep UI behavior out; UI commands/hovers belong in kaijuAlias/ and
// kaijuSense/macro.js.
const {
	getCommentRanges,
	maskProtectedRanges
} = require("./MetaTextRanges");

const MACRO_REGEX = /#(?:\d+|[A-Za-z_][A-Za-z0-9_]*)/g;
const FANUC_FUNCTIONS = new Map([
	["SIN", "sinDeg"],
	["COS", "cosDeg"],
	["TAN", "tanDeg"],
	["ASIN", "asinDeg"],
	["ACOS", "acosDeg"],
	["ATAN", "atanDeg"],
	["SQRT", "sqrt"],
	["ABS", "abs"],
	["ROUND", "round"],
	["FIX", "fix"],
	["FUP", "fup"]
]);

const FUNCTION_CONTEXT = {
	sinDeg: value => Math.sin(toRadians(value)),
	cosDeg: value => Math.cos(toRadians(value)),
	tanDeg: value => Math.tan(toRadians(value)),
	asinDeg: value => toDegrees(Math.asin(value)),
	acosDeg: value => toDegrees(Math.acos(value)),
	atanDeg: value => toDegrees(Math.atan(value)),
	sqrt: value => Math.sqrt(value),
	abs: value => Math.abs(value),
	round: value => Math.round(value),
	fix: value => Math.floor(value),
	fup: value => Math.ceil(value)
};

function buildAliasEntries(document) {
	const aliases = new Map();
	const macros = new Set();

	for (let lineNumber = 0; lineNumber < document.lineCount; lineNumber++) {
		const line = document.lineAt(lineNumber).text;

		if (hasExecutableGMCode(line)) {
			break;
		}

		for (const macro of collectNumericMacros(line)) {
			macros.add(macro);
		}

		for (const candidate of findAliasCandidatesInLine(line, lineNumber)) {
			if (!aliases.has(candidate.macro)) {
				aliases.set(candidate.macro, candidate);
			}
		}
	}

	return [...macros]
		.sort(compareMacroNames)
		.map(macro => {
			const alias = aliases.get(macro);

			return {
				macro,
				alias: alias ? alias.alias : "",
				comment: alias ? alias.comment : "",
				phrase: alias ? alias.phrase : "",
				sourceLine: alias ? alias.lineNumber : -1
			};
		});
}

function collectNumericMacros(text) {
	const macros = new Set();
	const macroRegex = /#\d+/g;
	let match;

	while ((match = macroRegex.exec(text)) !== null) {
		macros.add(match[0]);
	}

	return macros;
}

function hasExecutableGMCode(line) {
	const searchableLine = maskProtectedRanges(line);

	return /(^|[^A-Za-z0-9_])[GgMm]\d+/.test(searchableLine);
}

function findAliasCandidatesInLine(line, lineNumber) {
	const candidates = [];
	const commentRanges = getCommentRanges(line);

	for (const range of commentRanges) {
		const commentText = line.slice(range.start + 1, range.end);
		const commentCandidate = makeCommentAliasCandidate(commentText, lineNumber);

		if (commentCandidate) {
			candidates.push(commentCandidate);
			continue;
		}

		const inlineCandidate = makeInlineAssignmentAliasCandidate(line, range, lineNumber);

		if (inlineCandidate) {
			candidates.push(inlineCandidate);
		}
	}

	return candidates;
}

function makeCommentAliasCandidate(commentText, lineNumber) {
	const match = commentText.match(/^\s*(#\d+)\s*(?:=\s*)?(.+)$/);

	if (!match) {
		return undefined;
	}

	return makeAliasCandidate(match[1], match[2], lineNumber);
}

function makeInlineAssignmentAliasCandidate(line, commentRange, lineNumber) {
	const codeBeforeComment = line.slice(0, commentRange.start);
	const assignments = [...codeBeforeComment.matchAll(/#\d+\s*=/g)];

	if (!assignments.length) {
		return undefined;
	}

	const macro = assignments[assignments.length - 1][0].match(/#\d+/)[0];
	const commentText = line.slice(commentRange.start + 1, commentRange.end);

	return makeAliasCandidate(macro, commentText, lineNumber);
}

function makeAliasCandidate(macro, phrase, lineNumber) {
	const alias = makeAliasName(phrase);

	if (!alias) {
		return undefined;
	}

	return {
		macro,
		alias,
		comment: cleanAliasComment(phrase),
		phrase: cleanAliasPhrase(phrase),
		lineNumber
	};
}

function makeAliasName(phrase) {
	const cleanedPhrase = cleanAliasPhrase(phrase);

	if (!cleanedPhrase) {
		return "";
	}

	const alias = cleanedPhrase
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "_")
		.replace(/^_+|_+$/g, "")
		.replace(/_+/g, "_");

	if (!alias) {
		return "";
	}

	return /^[a-z_]/.test(alias) ? alias : `var_${alias}`;
}

function cleanAliasPhrase(phrase) {
	return phrase
		.split(/[\[{]/)[0]
		.replace(/\s+/g, " ")
		.trim();
}

function cleanAliasComment(phrase) {
	return phrase
		.replace(/\s+/g, " ")
		.trim();
}

function buildMacroAliasMap(document) {
	const macroAliases = new Map();

	for (const entry of buildAliasEntries(document)) {
		if (!entry.alias) {
			continue;
		}

		const numericMacro = normalizeMacro(entry.macro);
		const aliasMacro = normalizeMacro(`#${entry.alias}`);

		macroAliases.set(aliasMacro, numericMacro);
		macroAliases.set(numericMacro, numericMacro);
	}

	return macroAliases;
}

function buildInitialMacroDefaults(document, macroAliases = buildMacroAliasMap(document)) {
	const defaults = new Map();

	for (const entry of buildAliasEntries(document)) {
		const match = String(entry.comment || "").match(/\{\s*([-+]?(?:\d+(?:\.\d*)?|\.\d+))\s*\}\s*$/);
		if (match) {
			setMacroValue(defaults, entry.macro, Number(match[1]), macroAliases);
		}
	}

	return defaults;
}

// Balanced tokens are shared by motion, tool, and trace consumers.
function readBracketToken(text, start) {
	if (text[start] !== "[") return undefined;
	let depth = 0;
	for (let index = start; index < text.length; index++) {
		if (text[index] === "[") depth++;
		if (text[index] === "]" && --depth === 0) {
			return { text: text.slice(start, index + 1), start, end: index + 1 };
		}
	}
	return undefined;
}

function readMacroToken(text, start = 0) {
	if (text[start] !== "#") return undefined;
	if (text[start + 1] === "[") {
		const bracket = readBracketToken(text, start + 1);
		return bracket ? { text: text.slice(start, bracket.end), start, end: bracket.end } : undefined;
	}
	const match = text.slice(start).match(/^#(?:\d+|[A-Za-z_][A-Za-z0-9_]*)/);
	return match ? { text: match[0], start, end: start + match[0].length } : undefined;
}

function readNumericValueToken(text, start = 0) {
	if (text[start] === "[") return readBracketToken(text, start);
	const valueStart = /[-+]/.test(text[start] || "") ? start + 1 : start;
	const macro = readMacroToken(text, valueStart);
	if (macro) return { text: text.slice(start, macro.end), start, end: macro.end };
	const match = text.slice(start).match(/^[-+]?(?:\d+(?:\.\d*)?|\.\d+)/);
	return match ? { text: match[0], start, end: start + match[0].length } : undefined;
}

function findMacroAssignments(codeLine) {
	const text = String(codeLine || "");
	const matches = [];
	for (let index = 0; index < text.length; index++) {
		const token = readMacroToken(text, index);
		if (!token) {
			if (text[index] === "#" && text[index + 1] === "[") break;
			continue;
		}
		const suffix = text.slice(token.end).match(/^\s*=/);
		if (suffix) matches.push({ token, valueStart: token.end + suffix[0].length });
		index = token.end - 1;
	}
	return matches.map(({ token, valueStart }, index) => {
		const semicolon = text.indexOf(";", valueStart);
		const valueEnd = Math.min(matches[index + 1]?.token.start ?? text.length,
			semicolon === -1 ? text.length : semicolon);
		return { macro: normalizeMacro(token.text), value: text.slice(valueStart, valueEnd).trim() };
	});
}

function resolveMacroReference(macro, macroValues, macroAliases = new Map(), onMacroRead, depth = 0) {
	const text = String(macro).trim();
	const token = readMacroToken(text);
	if (!token || token.end !== text.length || depth > 64) return undefined;
	if (!text.startsWith("#[")) return resolveMacroAlias(text, macroAliases);
	const index = evaluateNumericExpression(text.slice(2, -1), macroValues, macroAliases, onMacroRead, depth + 1);
	// Keep invalid addresses unresolved instead of guessing a rounding rule.
	return Number.isSafeInteger(index) && index >= 0 ? `#${index}` : undefined;
}

function getExpressionMacroReferences(expression, macroValues, macroAliases = new Map()) {
	const macros = new Set();
	evaluateNumericExpression(expression, macroValues, macroAliases, macro => macros.add(macro));
	return [...macros];
}

function replaceMacroReads(expression, macroValues, macroAliases, onMacroRead, depth) {
	let result = "";
	for (let index = 0; index < expression.length;) {
		const token = readMacroToken(expression, index);
		if (!token) { result += expression[index++]; continue; }
		const macro = resolveMacroReference(token.text, macroValues, macroAliases, onMacroRead, depth);
		if (macro && onMacroRead) onMacroRead(token.text.startsWith("#[") ? macro : normalizeMacro(token.text));
		const value = macro ? getMacroValue(macro, macroValues, macroAliases) : NaN;
		result += Number.isFinite(value) ? `(${value})` : "NaN";
		index = token.end;
	}
	return result;
}

function evaluateNumericExpression(expression, macroValues, macroAliases = new Map(), onMacroRead, depth = 0) {
	if (depth > 64) return NaN;
	const normalizedExpression = String(expression || "").trim();
	const expressionBody = normalizedExpression.startsWith("[") && normalizedExpression.endsWith("]")
		? normalizedExpression.slice(1, -1)
		: normalizedExpression;
	const jsExpression = normalizeNumericLiterals(replaceMacroReads(expressionBody, macroValues, macroAliases, onMacroRead, depth)
		.replace(/\b(SIN|COS|TAN|ASIN|ACOS|ATAN|SQRT|ABS|ROUND|FIX|FUP)\s*\[/gi, (_, name) => {
			return `${FANUC_FUNCTIONS.get(name.toUpperCase())}(`;
		})
		.replace(/\[/g, "(")
		.replace(/\]/g, ")")
		.replace(/\bMOD\b/gi, "%"));

	if (jsExpression.includes("NaN")) {
		return NaN;
	}

	if (!/^[\d+\-*/%().,\sA-Za-z_]+$/.test(jsExpression)) {
		return NaN;
	}

	if (hasUnsupportedIdentifier(jsExpression)) {
		return NaN;
	}

	if (/^\s*[-+]?\d+(?:\.\d*)?\s*$/.test(jsExpression) || /^\s*[-+]?\.\d+\s*$/.test(jsExpression)) {
		return Number(jsExpression);
	}

	try {
		const names = Object.keys(FUNCTION_CONTEXT);
		const functions = Object.values(FUNCTION_CONTEXT);
		const value = Function(...names, `"use strict"; return (${jsExpression});`)(...functions);

		return Number.isFinite(value) ? value : NaN;
	} catch {
		return NaN;
	}
}

function hasUnsupportedIdentifier(expression) {
	for (const match of expression.matchAll(/\b[A-Za-z_][A-Za-z0-9_]*\b/g)) {
		if (!Object.prototype.hasOwnProperty.call(FUNCTION_CONTEXT, match[0])) {
			return true;
		}
	}

	return false;
}

function normalizeNumericLiterals(expression) {
	const numberRegex = /(^|[^#A-Za-z0-9_.])((?:\d+(?:\.\d*)?|\.\d+))(?![.\dA-Za-z_])/g;

	return expression.replace(numberRegex, (fullMatch, prefix, numberText) => {
		const value = Number(numberText);

		if (!Number.isFinite(value)) {
			return fullMatch;
		}

		return prefix + String(value);
	});
}

function toRadians(degrees) {
	return degrees * Math.PI / 180;
}

function toDegrees(radians) {
	return radians * 180 / Math.PI;
}

function getMacroValue(macro, macroValues, macroAliases) {
	const normalizedMacro = normalizeMacro(macro);
	const directValue = macroValues.get(normalizedMacro);

	if (Number.isFinite(directValue)) {
		return directValue;
	}

	const resolvedMacro = resolveMacroAlias(normalizedMacro, macroAliases);

	if (resolvedMacro === normalizedMacro) {
		return NaN;
	}

	const resolvedValue = macroValues.get(resolvedMacro);

	return Number.isFinite(resolvedValue) ? resolvedValue : NaN;
}

function setMacroValue(macroValues, macro, value, macroAliases) {
	const normalizedMacro = String(macro).startsWith("#[")
		? resolveMacroReference(macro, macroValues, macroAliases) : normalizeMacro(macro);
	if (!normalizedMacro) return;
	const resolvedMacro = resolveMacroAlias(normalizedMacro, macroAliases);

	if (Number.isFinite(value)) {
		macroValues.set(normalizedMacro, value);
		macroValues.set(resolvedMacro, value);
		return;
	}

	macroValues.delete(normalizedMacro);
	macroValues.delete(resolvedMacro);
}

function resolveMacroAlias(macro, macroAliases) {
	const normalizedMacro = normalizeMacro(macro);

	return macroAliases.get(normalizedMacro) || normalizedMacro;
}

function normalizeMacro(macro) {
	return String(macro).toUpperCase();
}

function makeMacroRegex(macro, options = {}) {
	const flags = options.caseSensitive ? "g" : "gi";

	return new RegExp(`${escapeRegex(macro)}(?![A-Za-z0-9_])`, flags);
}

function compareMacroNames(left, right) {
	return Number(left.slice(1)) - Number(right.slice(1));
}

function escapeRegex(text) {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

module.exports = {
	MACRO_REGEX,
	readMacroToken,
	readNumericValueToken,
	resolveMacroReference,
	getExpressionMacroReferences,
	buildAliasEntries,
	buildMacroAliasMap,
	buildInitialMacroDefaults,
	evaluateNumericExpression,
	findMacroAssignments,
	makeMacroRegex,
	normalizeMacro,
	resolveMacroAlias,
	setMacroValue
};
