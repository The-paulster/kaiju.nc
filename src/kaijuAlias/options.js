// Role: own KAIJU Alias configuration reads. Keep alias comment editing and
// alias parsing in index.js.
const vscode = require("vscode");

function getAliasOptions(document) {
	const config = vscode.workspace.getConfiguration("kaijuNC.alias", document.uri);

	return {
		caseSensitive: config.get("caseSensitive", false)
	};
}

module.exports = {
	getAliasOptions
};
