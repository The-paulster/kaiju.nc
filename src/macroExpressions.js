const { buildAliasEntries } = require("./macroAlias");

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
	const numberRegex = /(^|[^#A-Za-z0-9_.])([-+]?(?:\d+(?:\.\d*)?|\.\d+))(?![.\dA-Za-z_])/g;

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

module.exports = {
	MACRO_REGEX,
	buildMacroAliasMap,
	evaluateNumericExpression,
	normalizeMacro,
	resolveMacroAlias,
	setMacroValue
};
