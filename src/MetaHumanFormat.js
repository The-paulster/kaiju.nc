// Role: format numeric values for human-facing KAIJU UI. Keep calculation and
// machine-state math in the owning meta engines; this file only formats display text.

function formatHumanNumber(value, options = {}) {
	if (!Number.isFinite(value)) {
		return "unknown";
	}

	const minimumDecimalPlaces = clampInteger(options.minimumDecimalPlaces, 0, 9, 3);
	const maximumDecimalPlaces = Math.max(
		minimumDecimalPlaces,
		clampInteger(options.maximumDecimalPlaces, 0, 9, minimumDecimalPlaces)
	);
	const roundedText = value.toFixed(maximumDecimalPlaces);

	if (maximumDecimalPlaces === minimumDecimalPlaces) {
		if (minimumDecimalPlaces === 0) {
			return `${roundedText}.`;
		}

		return roundedText;
	}

	const [whole, decimal = ""] = roundedText.split(".");
	const trimmedDecimal = decimal.replace(/0+$/, "");
	const paddedDecimal = trimmedDecimal.padEnd(minimumDecimalPlaces, "0");

	if (minimumDecimalPlaces === 0 && !paddedDecimal) {
		return `${whole}.`;
	}

	return paddedDecimal ? `${whole}.${paddedDecimal}` : whole;
}

function formatHumanPosition(position, options = {}) {
	return ["x", "y", "z"]
		.filter(axis => Number.isFinite(position[axis]))
		.map(axis => `${axis.toUpperCase()}${formatHumanNumber(position[axis], options)}`)
		.join(" ");
}

function formatSignedHumanNumber(value, options = {}) {
	if (!Number.isFinite(value)) {
		return "unknown";
	}

	const formatted = formatHumanNumber(value, options);
	return value > 0 ? `+${formatted}` : formatted;
}

function formatHumanTime(seconds) {
	if (!Number.isFinite(seconds)) {
		return "unknown";
	}

	if (seconds < 60) {
		return `${seconds.toFixed(2)} s`;
	}

	const minutes = Math.floor(seconds / 60);
	const remainingSeconds = seconds - minutes * 60;

	return `${minutes} min ${remainingSeconds.toFixed(1)} s`;
}

function clampInteger(value, min, max, fallback) {
	const number = Number(value);

	if (!Number.isFinite(number)) {
		return fallback;
	}

	return Math.max(min, Math.min(max, Math.trunc(number)));
}

module.exports = {
	formatHumanNumber,
	formatHumanPosition,
	formatHumanTime,
	formatSignedHumanNumber
};
