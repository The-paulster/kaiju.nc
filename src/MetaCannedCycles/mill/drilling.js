const { createState, updateState, makeSite } = require('./common');
module.exports = {
	id: 'cycle.mill.fanuc.drilling', label: 'Drilling - FANUC', mode: 'mill', commonCode: 81,
	support: 'Basic G17/G90 drilling', createState, updateState,
	expand(cycle, words, state) {
		const warnings = [];
		if (words.some(word => ['X', 'Y', 'Z', 'R', 'F'].includes(word.letter) && !Number.isFinite(word.value))) warnings.push('Cycle contains an unresolved axis, depth, retract or feed word.');
		if (cycle.coordinateSystem !== state.coordinateSystem) warnings.push('Cancel and restart the cycle after changing work coordinates.');
		if (state.arcPlane !== 'xy' || state.distanceMode !== 'absolute') warnings.push('Drilling expansion currently requires G17 and G90.');
		if (words.some(word => ['L', 'K', 'U', 'V', 'W', 'C', 'H'].includes(word.letter))) warnings.push('Cycle repetition, parallel axes and rotary words are not supported.');
		const site = makeSite(state.position, words);
		if (![site.x, site.y, state.position.z, cycle.initialZ, cycle.r, cycle.z].every(Number.isFinite)) warnings.push('Drilling needs known X/Y/Z, an initial plane, R and Z depth.');
		if (cycle.z >= cycle.r) warnings.push('Drilling expansion requires Z depth below R.');
		if (warnings.length) return { steps: [], warnings };
		const steps = [];
		// Retract to R before lateral travel when the current position is below R.
		if (state.position.z < cycle.r) steps.push({ motionCode: 0, end: { z: cycle.r } });
		if (site.x !== state.position.x || site.y !== state.position.y) steps.push({ motionCode: 0, end: { x: site.x, y: site.y } });
		if (Math.max(state.position.z, cycle.r) !== cycle.r) steps.push({ motionCode: 0, end: { z: cycle.r } });
		steps.push({ motionCode: 1, end: { z: cycle.z } });
		steps.push({ motionCode: 0, end: { z: cycle.retractMode === 'r' ? cycle.r : Math.max(cycle.initialZ, cycle.r) } });
		return { steps, warnings };
	}
};
