// Role: provide shared protected-text range helpers for comments and angle
// brackets. Keep feature-specific parsing decisions in the owning KAIJU modules.
function getCommentRanges(line) {
	const ranges = [];
	let start = -1;

	for (let i = 0; i < line.length; i++) {
		if (line[i] === "(" && start === -1) {
			start = i;
		} else if (line[i] === ")" && start !== -1) {
			ranges.push({ start, end: i });
			start = -1;
		}
	}

	return ranges;
}

function getAngleBracketRanges(line) {
	const ranges = [];
	let start = -1;

	for (let i = 0; i < line.length; i++) {
		if (line[i] === "<" && start === -1) {
			start = i;
		} else if (line[i] === ">" && start !== -1) {
			ranges.push({ start, end: i });
			start = -1;
		}
	}

	return ranges;
}

function isInsideRange(index, ranges) {
	return ranges.some(range => index >= range.start && index <= range.end);
}

module.exports = {
	getCommentRanges,
	getAngleBracketRanges,
	isInsideRange
};
