const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../src/kaijuChronoblade/webview.js"), "utf8");
const context = vm.createContext({});
function loadHelper(name) {
	const marker = `\t\tfunction ${name}(`;
	const start = source.indexOf(marker);
	const end = source.indexOf("\n\t\t}", start) + "\n\t\t}".length;
	assert.ok(start >= 0 && end > start, name);
	vm.runInContext(source.slice(start, end), context);
}
loadHelper("groupRepeatedLabelSections");
const group = context.groupRepeatedLabelSections;

function sections(labels) {
	let total = 0;
	return labels.map(([line, name, seconds], sectionId) => {
		total += seconds;
		return {
			label: {
				sectionId,
				accumulatedLabelTimeSeconds: total,
				row: { type: "label", sourceLineNumber: line, instruction: name, labelTotalTimeSeconds: seconds }
			},
			rows: []
		};
	});
}

test("Chronoblade groups consecutive occurrences and sums their actual times", () => {
	const result = group(sections([[103, "N103", 1], [103, "N103", 2], [103, "N103", 4]]));
	assert.equal(result.length, 1);
	assert.equal(result[0].patternLength, 1);
	assert.equal(result[0].repeatCount, 3);
	assert.equal(result[0].timeSeconds, 7);
	assert.equal(result[0].accumulatedLabelTimeSeconds, 7);
	assert.equal(result[0].sections.length, 3);
});

test("Chronoblade groups repeated label sequences and leaves unrelated sections alone", () => {
	const cycle = [[102, "N102", 1], [103, "N103", 2], [104, "N104", 3]];
	const result = group(sections([...cycle, ...cycle, [105, "N105", 5]]));
	assert.equal(result.length, 2);
	assert.equal(result[0].patternLength, 3);
	assert.equal(result[0].repeatCount, 2);
	assert.equal(result[0].timeSeconds, 12);
	assert.equal(result[0].accumulatedLabelTimeSeconds, 12);
	assert.equal(result[1].label.row.instruction, "N105");
});

test("Chronoblade keeps distinct source labels and nonconsecutive visits separate", () => {
	const result = group(sections([[10, "N103", 1], [20, "N103", 2], [30, "N104", 3], [10, "N103", 4]]));
	assert.equal(result.length, 4);
	assert.ok(result.every(item => item.kind !== "group"));
});

test("Chronoblade group expansion retains each label occurrence and motion row", () => {
	loadHelper("rebuildVisibleRows");
	const sourceSections = sections([[102, "N102", 1], [103, "N103", 2], [102, "N102", 3], [103, "N103", 4]]);
	context.chronobladeData = { rows: sourceSections.flatMap((section, index) => [
		section.label.row,
		{ type: "motion", instruction: "G1", timeSeconds: index + 1 }
	]) };
	context.groupLabelsInput = { checked: true };
	context.hideZeroTimeLabelsInput = { checked: false };
	context.collapsedSections = new Set();
	context.expandedGroups = new Set();
	context.tableWrap = null;
	context.renderVirtualRows = () => {};
	context.rebuildVisibleRows();
	assert.equal(context.visibleRows.length, 1);
	assert.equal(context.visibleRows[0].patternLength, 2);
	assert.equal(context.visibleRows[0].repeatCount, 2);
	context.expandedGroups.add(context.visibleRows[0].id);
	context.rebuildVisibleRows();
	assert.equal(context.visibleRows.filter(row => row.kind === "label").length, 4);
	assert.equal(context.visibleRows.filter(row => row.kind === "row").length, 4);
	assert.equal(context.visibleRows.at(-1).accumulatedTimeSeconds, 10);
});

test("Chronoblade group row shows label names while keeping the count separate", () => {
	loadHelper("renderVirtualGroupRow");
	context.expandedGroups = new Set();
	context.escapeHtml = text => String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;");
	context.escapeAttribute = context.escapeHtml;
	context.formatVirtualSignificant = text => text;
	context.formatVirtualTime = seconds => `${seconds} s`;
	context.formatVirtualAccumulatedTime = seconds => `${seconds} s`;
	const sourceSections = sections([[123, "N123", 1], [123, "N123", 2]]);
	for (const section of sourceSections) section.label.row.comment = "(CIRCLE MILLING LOOP)";
	const html = context.renderVirtualGroupRow(group(sourceSections)[0]);
	assert.match(html, /class="group-label-names">N123 \(CIRCLE MILLING LOOP\)<\/code>/);
	assert.match(html, /class="group-repeat-count">×2<\/code>/);
	assert.match(html, /title="Expand repeated labels: N123 \(CIRCLE MILLING LOOP\)"/);
});
