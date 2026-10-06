// Shared cycle catalog. Controller words belong to MetaGCodeDialect;
// these entries own cycle parameter/state behavior, never motion math or UI.
const entries = [
	require('./mill/drilling'), require('./mill/spotDrilling'),
	require('./mill/peckDrilling'), require('./mill/highSpeedPeck'),
	require('./mill/leftTapping'), require('./mill/tapping'),
	require('./mill/fineBoring'), require('./mill/feedBoring'),
	require('./mill/stopBoring'), require('./mill/backBoring'),
	require('./mill/manualBoring'), require('./mill/dwellBoring'),
	...require('./lathe/catalog')
];
const CANNED_CYCLES = Object.freeze(entries.map(entry => Object.freeze(entry)));
const byId = new Map(CANNED_CYCLES.map(entry => [entry.id, entry]));
function getCannedCycle(id) { return byId.get(id); }
function getCannedCycles(mode) { return CANNED_CYCLES.filter(entry => !mode || entry.mode === mode); }
function getCycleOperationDefinitions() {
	return Object.fromEntries(CANNED_CYCLES.filter(entry => entry.createState).map(entry => [entry.id, Object.freeze({
		label: entry.label, statusGroup: 'motion', cycleId: entry.id,
		mode: entry.mode, commonCode: entry.commonCode, support: entry.support, codexTopic: entry.id
	})]));
}
function getDefaultCycleBindings(mode) {
	return Object.fromEntries(getCannedCycles(mode).filter(entry => entry.createState).map(entry => [entry.id, { code: entry.commonCode }]));
}
module.exports = { CANNED_CYCLES, getCannedCycle, getCannedCycles, getCycleOperationDefinitions, getDefaultCycleBindings };
