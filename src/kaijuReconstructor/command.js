// Role: own KAIJU Reconstructor command-palette formatting flow. Keep the
// formatting engine and default options in formatter.js/options.js.
const vscode = require("vscode");
const {
	formatDocumentText
} = require("./formatter");
const { getFormattingOptions } = require("./options");

function registerFormatCommand(context) {
	context.subscriptions.push(
		vscode.commands.registerCommand("kaijuNC.formatDocument", async () => {
			await runFormatCommand();
		})
	);
}

async function runFormatCommand() {
	const editor = vscode.window.activeTextEditor;

	if (!editor || editor.document.languageId !== "gcode") {
		vscode.window.showWarningMessage("Open a G-code document before formatting.");
		return;
	}

	const selectedOptions = await showFormatOptions(editor.document);

	if (!selectedOptions) {
		return;
	}

	const options = getFormattingOptions(editor.document, selectedOptions);
	const originalText = editor.document.getText();
	const formattedText = formatDocumentText(originalText, options);

	if (formattedText === originalText) {
		vscode.window.showInformationMessage("KAIJU.NC: No formatting changes needed.");
		return;
	}

	const fullRange = new vscode.Range(
		editor.document.positionAt(0),
		editor.document.positionAt(originalText.length)
	);

	await editor.edit(editBuilder => {
		editBuilder.replace(fullRange, formattedText);
	});
}

function showFormatOptions(document) {
	return new Promise(resolve => {
		const defaults = getFormattingOptions(document);
		const quickPick = vscode.window.createQuickPick();
		const decimalItems = Array.from({ length: 10 }, (_, decimalPlaces) => ({
			label: `Decimal places: ${decimalPlaces}`,
			description: `${decimalPlaces} digit${decimalPlaces === 1 ? "" : "s"} after the decimal`,
			decimalPlaces
		}));
		const semicolonItem = {
			label: "Auto semicolon inserter",
			description: "Add ; after code, before comments",
			autoSemicolon: true
		};
		let activeDecimalItem = decimalItems[defaults.decimalPlaces] || decimalItems[3];
		let accepted = false;

		quickPick.title = "KAIJU.NC Format Options";
		quickPick.placeholder = "Choose options, then press Enter. Escape cancels.";
		quickPick.canSelectMany = true;
		quickPick.items = [
			...decimalItems,
			semicolonItem
		];
		quickPick.selectedItems = [
			activeDecimalItem,
			...(defaults.autoSemicolon ? [semicolonItem] : [])
		];

		quickPick.onDidChangeSelection(selection => {
			const decimalSelections = selection.filter(item => typeof item.decimalPlaces === "number");
			const otherSelections = selection.filter(item => typeof item.decimalPlaces !== "number");

			if (decimalSelections.length === 0) {
				quickPick.selectedItems = [
					activeDecimalItem,
					...otherSelections
				];
				return;
			}

			const nextDecimalItem = decimalSelections.find(item => item !== activeDecimalItem) || decimalSelections[0];

			if (nextDecimalItem !== activeDecimalItem || decimalSelections.length > 1) {
				activeDecimalItem = nextDecimalItem;
				quickPick.selectedItems = [
					activeDecimalItem,
					...otherSelections
				];
			}
		});

		quickPick.onDidAccept(() => {
			accepted = true;
			const selectedItems = [...quickPick.selectedItems];
			const decimalItem = selectedItems.find(item => typeof item.decimalPlaces === "number") || activeDecimalItem;

			resolve({
				decimalPlaces: decimalItem.decimalPlaces,
				autoSemicolon: selectedItems.some(item => item.autoSemicolon)
			});

			quickPick.hide();
		});

		quickPick.onDidHide(() => {
			if (!accepted) {
				resolve(undefined);
			}

			quickPick.dispose();
		});

		quickPick.show();
	});
}

module.exports = {
	registerFormatCommand
};
