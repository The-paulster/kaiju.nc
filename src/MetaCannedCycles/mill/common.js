function last(words, letter) { return words.filter(word => word.letter === letter).at(-1); }
function updateState(cycle, words, state) {
	const next = { ...cycle, retractMode: state.cannedCycleRetractMode };
	for (const key of ['z', 'r', 'q', 'p']) {
		const word = last(words, key.toUpperCase());
		if (!word) continue;
		// Never silently reuse a previous value after an unresolved authored word.
		next[key] = Number.isFinite(word.value) ? word.value : undefined;
	}
	return next;
}
function createState(entry, match, words, state) {
	return updateState({ ...(state.cannedCycle || {}), id: entry.id, code: match.code,
		coordinateSystem: state.cannedCycle?.coordinateSystem || state.coordinateSystem,
		initialZ: state.cannedCycle ? state.cannedCycle.initialZ : state.position.z }, words, state);
}
function depthMarker(entry) {
	return { ...entry, mode: 'mill', support: 'Depth marker only', createState, updateState };
}
function makeSite(position, words) {
	const site = { ...position };
	for (const axis of ['x', 'y']) {
		const word = last(words, axis.toUpperCase());
		if (word) site[axis] = word.value;
	}
	return site;
}
function makeCycleSitePosition(position, words, distanceMode) {
	const site = { ...position };
	const axes = [
		{ position: "X", incremental: "U", key: "x" },
		{ position: "Y", incremental: "V", key: "y" }
	];

	for (const axis of axes) {
		const positionWord = last(words, axis.position);
		const incrementalWord = last(words, axis.incremental);

		if (positionWord && Number.isFinite(positionWord.value)) {
			if (distanceMode === "incremental" && Number.isFinite(site[axis.key])) {
				site[axis.key] += positionWord.value;
			} else {
				site[axis.key] = positionWord.value;
			}
		}

		if (incrementalWord && Number.isFinite(incrementalWord.value) && Number.isFinite(site[axis.key])) {
			site[axis.key] += incrementalWord.value;
		}
	}

	return site;
}

function applyCannedCyclePositionUpdate(words, state) {
	const site = makeCycleSitePosition(state.position, words, state.distanceMode);
	const cycle = state.cannedCycle || {};
	const retractZ = cycle.retractMode === "r" && Number.isFinite(cycle.r)
		? cycle.r
		: Number.isFinite(cycle.initialZ) && Number.isFinite(cycle.r) ? Math.max(cycle.initialZ, cycle.r) : cycle.initialZ;

	state.position = Object.assign(site, {
		z: Number.isFinite(retractZ) ? retractZ : site.z
	});
}

function getCannedCycleTopZ(cycle, position) {
	if (Number.isFinite(cycle.r)) {
		return cycle.r;
	}

	return position.z;
}

module.exports = { last, createState, updateState, depthMarker, makeSite, makeCycleSitePosition, applyCannedCyclePositionUpdate, getCannedCycleTopZ };
