// Role: provide shared protected-text range helpers for comments and angle
// brackets. Keep feature-specific parsing decisions in the owning KAIJU modules.
function getCommentRanges(line) {
	line = String(line || "");
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
	line = String(line || "");
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

function maskProtectedRanges(line) {
	const text = String(line || "");
	const characters = text.split("");

	for (const range of [...getCommentRanges(text), ...getAngleBracketRanges(text)]) {
		for (let index = range.start; index <= range.end; index++) {
			characters[index] = " ";
		}
	}

	return characters.join("");
}

module.exports = {
	getCommentRanges,
	getAngleBracketRanges,
	isInsideRange,
	maskProtectedRanges
};
