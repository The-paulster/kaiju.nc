const test = require("node:test");
const assert = require("node:assert/strict");
const { makeDocument, configurationValues } = require("./helpers");
const machineMode = require("../src/MetaMachineMode");
const dialect = require("../src/MetaGCodeDialect");
const { updateDiagnostics } = require("../src/kaijuAlert/diagnostics");

test.beforeEach(() => configurationValues.set("kaijuNC.alerts.unboundGCodes.enabled", true));
test.afterEach(() => configurationValues.delete("kaijuNC.alerts.unboundGCodes.enabled"));

test("unbound G-code alerts are off when the setting is unconfigured", () => {
	configurationValues.delete("kaijuNC.alerts.unboundGCodes.enabled");
	assert.equal(getUnboundWarnings("G123").length, 0);
	assert.equal(require("../package.json").contributes.configuration.find(section => section.properties["kaijuNC.alerts.unboundGCodes.enabled"]).properties["kaijuNC.alerts.unboundGCodes.enabled"].default, false);
});

function getDiagnostics(document) {
	let warnings = [];
	updateDiagnostics(document, {
		set(uri, value) { warnings = value; },
		delete() {}
	});
	return warnings;
}

function getUnboundWarnings(source) {
	return getDiagnostics(makeDocument(source)).filter(warning => warning.code === "unboundGCode");
}

test("unbound G codes warn on exact ranges, including compact and decimal words", () => {
	const warnings = getUnboundWarnings("N10G123X1. g 012.2 G001 G12.10 G50 M123");
	assert.deepEqual(warnings.map(warning => [warning.range.start.character, warning.range.end.character]), [[3, 7], [11, 18]]);
	assert.equal(warnings[0].severity, 1);
	assert.equal(warnings[0].source, "Kaiju Alert");
	assert.match(warnings[0].message, /Lathe bindings.*FANUC \/ ISO/);
});

test("unbound G-code scanning excludes protected text, macro names, expressions and GOTO", () => {
	assert.equal(getUnboundWarnings("(G123) <G124>\n#G125 = 1.\n#100 = [G126]\nG#100 G[123] G#[#100] GOTO110\nN110 G01 X1.").length, 0);
});

test("unbound G-code alerts can be disabled and reenabled", () => {
	configurationValues.set("kaijuNC.alerts.unboundGCodes.enabled", false);
	try { assert.equal(getUnboundWarnings("G123").length, 0); }
	finally { configurationValues.set("kaijuNC.alerts.unboundGCodes.enabled", true); }
	assert.equal(getUnboundWarnings("G123").length, 1);
});

test("unbound G-code alerts use the active mode table", () => {
	configurationValues.set("kaijuNC.chronoblade.machineMode", "mill");
	try {
		assert.deepEqual(getUnboundWarnings("G94 G12.1").map(warning => warning.message.split(" ")[0]), ["G12.1"]);
	} finally { configurationValues.delete("kaijuNC.chronoblade.machineMode"); }
	assert.deepEqual(getUnboundWarnings("G94 G12.1").map(warning => warning.message.split(" ")[0]), ["G94"]);
});

test("per-document custom G-code selection controls bindings and null cells", async () => {
	let stored = {};
	machineMode.initializeMachineMode({ workspaceState: {
		get(key, fallback) { return stored[key] || fallback; },
		async update(key, value) { stored[key] = value; }
	} });
	dialect.setCustomGCodeDialectProfiles([{
		id: "alert-custom", label: "Alert Custom",
		bindings: { mill: {}, lathe: { [dialect.G_CODE_OPERATIONS.MOTION_LINEAR]: { code: 123 } } }
	}]);
	const document = makeDocument("G1 G123", { uri: "alert-custom.nc" });
	try {
		await machineMode.setMachineMode(document, "latheDiameter");
		await machineMode.setGCodeDialect(document, "alert-custom");
		const warnings = getDiagnostics(document).filter(warning => warning.code === "unboundGCode");
		assert.equal(warnings.length, 1);
		assert.match(warnings[0].message, /^G1 .*Alert Custom/);
		await machineMode.setGCodeDialect(document, "fanucIso");
		assert.match(getDiagnostics(document).find(warning => warning.code === "unboundGCode").message, /^G123 .*FANUC \/ ISO/);
	} finally {
		dialect.setCustomGCodeDialectProfiles([]);
		machineMode.initializeMachineMode({ workspaceState: { get(key, fallback) { return fallback; }, async update() {} } });
	}
});

test("unresolved GOTO targets are checked with or without a separating space", () => {
	const warnings = getDiagnostics(makeDocument("GOTO 110\nGOTO110\nN100"));

	assert.equal(warnings.length, 2);
	assert.deepEqual(
		warnings.map(warning => ({
			line: warning.range.start.line,
			start: warning.range.start.character,
			end: warning.range.end.character,
			message: warning.message
		})),
		[
			{ line: 0, start: 5, end: 8, message: 'GOTO target "110" has no matching N label.' },
			{ line: 1, start: 4, end: 7, message: 'GOTO target "110" has no matching N label.' }
		]
	);
});

test("spaceless GOTO targets accept matching N labels", () => {
	const warnings = getDiagnostics(makeDocument("GOTO110\nN110"));

	assert.equal(warnings.length, 0);
});
