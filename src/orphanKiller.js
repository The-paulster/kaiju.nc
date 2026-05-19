const vscode = require("vscode");
const {
	getCommentRanges,
	getAngleBracketRanges,
	isInsideRange
} = require("./textRanges");

let orphanPanel;
let orphanState;

function registerOrphanKiller(context) {
	context.subscriptions.push(
		vscode.commands.registerCommand("kaijuNC.orphanKiller", async () => {
			await runOrphanKiller();
		})
	);
}

async function runOrphanKiller() {
	const editor = vscode.window.activeTextEditor;

	if (!editor || editor.document.languageId !== "gcode") {
		vscode.window.showWarningMessage("Open a G-code document before running Orphan Killer.");
		return;
	}

	orphanState = {
		documentUriText: editor.document.uri.toString()
	};

	if (!orphanPanel) {
		orphanPanel = vscode.window.createWebviewPanel(
			"kaijuOrphanKiller",
			"KAIJU Orphan Killer",
			vscode.ViewColumn.Beside,
			{
				enableScripts: true,
				retainContextWhenHidden: true
			}
		);

		orphanPanel.onDidDispose(() => {
			orphanPanel = undefined;
			orphanState = undefined;
		});

		orphanPanel.webview.onDidReceiveMessage(async message => {
			if (message && message.type === "refresh") {
				await refreshOrphanPanel();
			}
		});
	} else {
		orphanPanel.reveal(vscode.ViewColumn.Beside);
	}

	await renderOrphanPanel(editor.document);
}

async function refreshOrphanPanel() {
	if (!orphanState || !orphanState.documentUriText) {
		return;
	}

	const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(orphanState.documentUriText));
	await renderOrphanPanel(document);
}

async function renderOrphanPanel(document) {
	const result = inspectOrphanMacros(document);

	orphanPanel.title = "KAIJU Orphan Killer";
	orphanPanel.webview.html = renderOrphanHtml(document, result);
}

function inspectOrphanMacros(document) {
	const definitions = new Map();
	const references = new Map();

	for (let lineNumber = 0; lineNumber < document.lineCount; lineNumber++) {
		const line = document.lineAt(lineNumber).text;
		const protectedRanges = [
			...getCommentRanges(line),
			...getAngleBracketRanges(line)
		];
		const assignmentRanges = findAssignmentRanges(line, protectedRanges);

		for (const assignment of assignmentRanges) {
			addLine(definitions, assignment.macro, lineNumber);
		}

		for (const reference of findMacroReferences(line, protectedRanges, assignmentRanges)) {
			addLine(references, reference.macro, lineNumber);
		}
	}

	return {
		undefinedUses: [...references.keys()]
			.filter(macro => !definitions.has(macro))
			.sort(compareMacroNames)
			.map(macro => ({ macro, lines: references.get(macro) })),
		unusedDefinitions: [...definitions.keys()]
			.filter(macro => !references.has(macro))
			.sort(compareMacroNames)
			.map(macro => ({ macro, lines: definitions.get(macro) }))
	};
}

function findAssignmentRanges(line, protectedRanges) {
	const assignments = [];
	const assignmentRegex = /#(?:\d+|[A-Za-z_][A-Za-z0-9_]*)\s*=/g;
	let match;

	while ((match = assignmentRegex.exec(line)) !== null) {
		if (isInsideRange(match.index, protectedRanges)) {
			continue;
		}

		assignments.push({
			macro: normalizeMacro(match[0].match(/#(?:\d+|[A-Za-z_][A-Za-z0-9_]*)/)[0]),
			start: match.index,
			end: match.index + match[0].length
		});
	}

	return assignments;
}

function findMacroReferences(line, protectedRanges, assignmentRanges) {
	const references = [];
	const macroRegex = /#(?:\d+|[A-Za-z_][A-Za-z0-9_]*)/g;
	let match;

	while ((match = macroRegex.exec(line)) !== null) {
		if (isInsideRange(match.index, protectedRanges)) {
			continue;
		}

		if (isInsideAssignmentTarget(match.index, assignmentRanges)) {
			continue;
		}

		references.push({
			macro: normalizeMacro(match[0]),
			start: match.index
		});
	}

	return references;
}

function isInsideAssignmentTarget(index, assignmentRanges) {
	return assignmentRanges.some(range => index >= range.start && index < range.end);
}

function addLine(map, macro, lineNumber) {
	if (!map.has(macro)) {
		map.set(macro, []);
	}

	const lines = map.get(macro);

	if (lines[lines.length - 1] !== lineNumber + 1) {
		lines.push(lineNumber + 1);
	}
}

function normalizeMacro(macro) {
	return macro.toUpperCase();
}

function renderOrphanHtml(document, result) {
	const undefinedRows = renderRows(result.undefinedUses);
	const unusedRows = renderRows(result.unusedDefinitions);
	const totalCount = result.undefinedUses.length + result.unusedDefinitions.length;
	const summary = totalCount === 0
		? "No orphan macros found."
		: `${result.undefinedUses.length} undefined used, ${result.unusedDefinitions.length} defined but unused.`;

	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<style>
		body {
			font-family: var(--vscode-font-family);
			color: var(--vscode-foreground);
			background: var(--vscode-editor-background);
			margin: 0;
			padding: 16px;
		}

		header {
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: 12px;
			border-bottom: 1px solid var(--vscode-panel-border);
			padding-bottom: 12px;
			margin-bottom: 16px;
		}

		h1 {
			font-size: 18px;
			margin: 0;
		}

		h2 {
			font-size: 13px;
			text-transform: uppercase;
			color: var(--vscode-descriptionForeground);
			margin: 18px 0 8px;
		}

		button {
			color: var(--vscode-button-foreground);
			background: var(--vscode-button-background);
			border: 0;
			border-radius: 4px;
			padding: 6px 10px;
			cursor: pointer;
		}

		button:hover {
			background: var(--vscode-button-hoverBackground);
		}

		.meta,
		.empty {
			color: var(--vscode-descriptionForeground);
			font-size: 12px;
			margin-top: 4px;
		}

		.row {
			display: grid;
			grid-template-columns: minmax(90px, 140px) minmax(0, 1fr);
			gap: 12px;
			border-bottom: 1px solid var(--vscode-panel-border);
			padding: 7px 0;
			align-items: baseline;
		}

		code {
			font-family: var(--vscode-editor-font-family);
			background: var(--vscode-textCodeBlock-background);
			padding: 1px 4px;
			border-radius: 3px;
		}
	</style>
</head>
<body>
	<header>
		<div>
			<h1>KAIJU Orphan Killer</h1>
			<div class="meta">${escapeHtml(summary)}</div>
			<div class="meta">${escapeHtml(document.fileName || document.uri.toString())}</div>
		</div>
		<button id="refresh">Refresh</button>
	</header>

	<section>
		<h2>Used But Not Defined</h2>
		${undefinedRows}
	</section>

	<section>
		<h2>Defined But Not Used</h2>
		${unusedRows}
	</section>

	<script>
		const vscode = acquireVsCodeApi();
		document.getElementById("refresh").addEventListener("click", () => {
			vscode.postMessage({ type: "refresh" });
		});
	</script>
</body>
</html>`;
}

function renderRows(items) {
	if (!items.length) {
		return "<p class=\"empty\">None found.</p>";
	}

	return items.map(item => {
		return `<div class="row">
			<code>${escapeHtml(item.macro)}</code>
			<div>Lines ${escapeHtml(item.lines.join(", "))}</div>
		</div>`;
	}).join("");
}

function escapeHtml(text) {
	return String(text)
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

function compareMacroNames(left, right) {
	const leftNumber = Number(left.slice(1));
	const rightNumber = Number(right.slice(1));

	if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
		return leftNumber - rightNumber;
	}

	return left.localeCompare(right);
}

module.exports = {
	registerOrphanKiller,
	inspectOrphanMacros
};
