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
