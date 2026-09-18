const test = require("node:test");
const assert = require("node:assert/strict");
const { makeDocument } = require("./helpers");
const { configurationValues } = require("./helpers");
const machineMode = require("../src/MetaMachineMode");
const dialect = require("../src/MetaGCodeDialect");
const { reloadConfiguredGCodeDialectProfiles } = require("../src/kaijuMachineMode/profileEditor");

test("machine and dialect state persist per document behind the Meta read contract", async () => {
	let stored = {};
	machineMode.initializeMachineMode({
		workspaceState: {
			get(key, fallback) { return Object.prototype.hasOwnProperty.call(stored, key) ? stored[key] : fallback; },
			async update(key, value) { stored[key] = value; }
		}
	});
	const document = makeDocument("G1 X1", { uri: "machine-test.nc" });
	await machineMode.setMachineMode(document, "latheRadius");
	await machineMode.setGCodeDialect(document, "fanucIso");
	const result = machineMode.getMachineModeForDocument(document);
	assert.equal(result.profile.id, "latheRadius");
	assert.equal(result.xAxisMode, "radius");
	assert.equal(result.gCodeDialectId, "fanucIso");
});

test("Settings default G-code profile applies before a program selects one", () => {
	configurationValues.set("kaijuNC.gCodeDialect.defaultProfile", "dmgMori");
	try {
		const result = machineMode.getMachineModeForDocument(makeDocument("G1 X1"));
		assert.equal(result.gCodeDialectId, "dmgMori");
	} finally {
		configurationValues.delete("kaijuNC.gCodeDialect.defaultProfile");
	}
});

test("automatic machine mode detects strong mill and lathe evidence but ignores comments", () => {
	assert.equal(machineMode.getMachineModeForDocument(makeDocument("G43 H01\nG81 Z-10 R2 F100")).profile.id, "mill");
	assert.equal(machineMode.getMachineModeForDocument(makeDocument("G50 S3000\nG96 S180\nG1 X50 Z-20 F0.2")).profile.id, "latheDiameter");
	assert.equal(machineMode.getMachineModeForDocument(makeDocument("(G96 G50 S3000 T0101)\nG1 X1 Z1")).machineModeSource, "fallback");
	assert.equal(machineMode.getMachineModeForDocument(makeDocument("G1 Y1\nG1 Y2\nG1 Y3")).machineModeSource, "fallback");
});

test("automatic machine mode recognizes radius programming and explicit Settings override it", () => {
	assert.equal(machineMode.getMachineModeForDocument(makeDocument("G08\nG1 X20 Z-5")).profile.id, "latheRadius");
	configurationValues.set("kaijuNC.chronoblade.machineMode", "mill");
	try {
		const result = machineMode.getMachineModeForDocument(makeDocument("G96 S180\nG1 X50 Z-20"));
		assert.equal(result.profile.id, "mill");
		assert.equal(result.machineModeSource, "fallback");
	} finally {
		configurationValues.delete("kaijuNC.chronoblade.machineMode");
	}
});

test("automatic Mill mode ignores a stale legacy Diameter X-axis setting", () => {
	configurationValues.set("kaijuNC.chronoblade.xAxisMode", "diameter");
	try {
		const result = machineMode.getMachineModeForDocument(makeDocument("M06\nG43 H01\nG1 X10 Y10"));
		assert.equal(result.profile.id, "mill");
		assert.equal(result.xAxisMode, "radius");
	} finally {
		configurationValues.delete("kaijuNC.chronoblade.xAxisMode");
	}
});

test("custom profiles load from Settings before documents select them", () => {
	const operations = dialect.G_CODE_OPERATIONS;
	configurationValues.set("kaijuNC.gCodeDialect.customProfiles", [{
		id: "settings-profile",
		label: "Settings Profile",
		bindings: {
			mill: { [operations.FEED_PER_MINUTE]: { code: 94 } },
			lathe: { [operations.FEED_PER_MINUTE]: { code: 98 } }
		}
	}]);
	try {
		assert.equal(reloadConfiguredGCodeDialectProfiles(makeDocument("G1 X1")), undefined);
		assert.equal(dialect.getGCodeDialectProfile("settings-profile").label, "Settings Profile");
	} finally {
		configurationValues.delete("kaijuNC.gCodeDialect.customProfiles");
		dialect.setCustomGCodeDialectProfiles([]);
	}
});
