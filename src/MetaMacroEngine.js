// Role: parse macro aliases and evaluate macro expressions shared by
// Decomposition, motion analysis, aliases, KAIJU Sense macro hovers, and tool
// modeling. Keep UI behavior out; UI commands/hovers belong in kaijuAlias/ and
// kaijuSense/macro.js.
const {
	getCommentRanges,
	getAngleBracketRanges
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

function maskProtectedRanges(line) {
	const characters = line.split("");
	const protectedRanges = [
		...getCommentRanges(line),
		...getAngleBracketRanges(line)
	];

	for (const range of protectedRanges) {
		for (let i = range.start; i <= range.end; i++) {
			characters[i] = " ";
		}
	}

	return characters.join("");
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
		.split("[")[0]
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

function evaluateNumericExpression(expression, macroValues, macroAliases = new Map()) {
	const normalizedExpression = String(expression || "").trim();
	const expressionBody = normalizedExpression.startsWith("[") && normalizedExpression.endsWith("]")
		? normalizedExpression.slice(1, -1)
		: normalizedExpression;
	const jsExpression = normalizeNumericLiterals(expressionBody
		.replace(/\b(SIN|COS|TAN|ASIN|ACOS|ATAN|SQRT|ABS|ROUND|FIX|FUP)\s*\[/gi, (_, name) => {
			return `${FANUC_FUNCTIONS.get(name.toUpperCase())}(`;
		})
		.replace(/\[/g, "(")
		.replace(/\]/g, ")")
		.replace(/\bMOD\b/gi, "%")
		.replace(MACRO_REGEX, macro => {
			const value = getMacroValue(macro, macroValues, macroAliases);
			return Number.isFinite(value) ? String(value) : "NaN";
		}));

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
	const normalizedMacro = normalizeMacro(macro);
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
	buildAliasEntries,
	buildMacroAliasMap,
	evaluateNumericExpression,
	makeMacroRegex,
	normalizeMacro,
	resolveMacroAlias,
	setMacroValue
};
