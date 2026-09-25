// Role: own the editable G-code profile/keybinding-table webview. Profile
// validation and interpretation remain in MetaGCodeDialect.
const vscode = require("vscode");
const {
	G_CODE_OPERATION_DEFINITIONS,
	getGCodeDialectProfiles,
	getGCodeDialectProfile,
	getBuiltInGCodeDialectProfiles,
	setCustomGCodeDialectProfiles,
	normalizeCustomGCodeDialectProfiles
} = require("../MetaGCodeDialect");
const { setGCodeDialect } = require("../MetaMachineMode");

const CUSTOM_PROFILES_SETTING = "customProfiles";
let profilesPanel;
let profilesPanelDocument;

function registerGCodeProfileEditor(context) {
	context.subscriptions.push(vscode.commands.registerCommand("kaijuNC.gCodeDialect.manage", async () => {
		const editor = vscode.window.activeTextEditor;
		if (!editor || editor.document.languageId !== "gcode") {
			vscode.window.showWarningMessage("Open a G-code document before editing G-code profiles.");
			return;
		}
		await showGCodeProfileEditor(editor.document);
	}));
}

function reloadConfiguredGCodeDialectProfiles(document) {
	const configured = vscode.workspace.getConfiguration("kaijuNC.gCodeDialect", document ? document.uri : null).get(CUSTOM_PROFILES_SETTING, []);
	try {
		setCustomGCodeDialectProfiles(configured);
		return undefined;
	} catch (error) {
		setCustomGCodeDialectProfiles([]);
		return error instanceof Error ? error.message : String(error);
	}
}

async function showGCodeProfileEditor(document) {
	if (!document) return;
	profilesPanelDocument = document;
	const loadError = reloadConfiguredGCodeDialectProfiles(document);
	if (!profilesPanel) {
		profilesPanel = vscode.window.createWebviewPanel("kaijuGCodeProfiles", "KAIJU G-code Profiles", vscode.ViewColumn.Beside, { enableScripts: true });
		profilesPanel.onDidDispose(() => { profilesPanel = undefined; profilesPanelDocument = undefined; });
		profilesPanel.webview.onDidReceiveMessage(async message => {
			if (!message || !["saveGCodeProfiles", "useGCodeProfile"].includes(message.type)) return;
			const targetDocument = profilesPanelDocument;
			try {
				if (!targetDocument) throw new Error("The profile editor no longer has an associated G-code document. Reopen it and try again.");
				const profiles = normalizeCustomGCodeDialectProfiles(message.profiles);
				await vscode.workspace.getConfiguration("kaijuNC.gCodeDialect", targetDocument.uri).update(CUSTOM_PROFILES_SETTING, serializeProfiles(profiles), true);
				setCustomGCodeDialectProfiles(profiles);
				if (message.type === "useGCodeProfile") {
					const selected = getGCodeDialectProfile(message.profileId);
					await setGCodeDialect(targetDocument, selected.id);
					await renderGCodeProfileEditor(targetDocument, undefined, `Profile set to ${selected.label}.`);
				} else {
					await renderGCodeProfileEditor(targetDocument, undefined, "Profiles saved.");
				}
			} catch (error) {
				profilesPanel.webview.postMessage({ type: "error", message: error instanceof Error ? error.message : String(error) });
			}
		});
	} else {
		profilesPanel.reveal(vscode.ViewColumn.Beside);
	}
	await renderGCodeProfileEditor(document, loadError);
}

async function renderGCodeProfileEditor(document, loadError, notice) {
	if (!profilesPanel) return;
	const builtInIds = new Set(getBuiltInGCodeDialectProfiles().map(profile => profile.id));
	const profiles = getGCodeDialectProfiles().map(profile => Object.assign(serializeProfile(profile), { builtIn: builtInIds.has(profile.id) }));
	const current = getCurrentDialectId(document);
	profilesPanel.webview.html = renderGCodeProfilesHtml(profiles, current, loadError, notice);
}

function getCurrentDialectId(document) {
	try {
		return require("../MetaMachineMode").getMachineModeForDocument(document).gCodeDialectId;
	} catch {
		return "fanucIso";
	}
}

function serializeProfiles(profiles) {
	return profiles.map(serializeProfile);
}

function serializeProfile(profile) {
	return {
		id: profile.id,
		label: profile.label,
		description: profile.description || "",
		bindings: {
			mill: serializeBindingTable(profile.bindings && profile.bindings.mill),
			lathe: serializeBindingTable(profile.bindings && profile.bindings.lathe)
		}
	};
}

function serializeBindingTable(table) {
	return Object.fromEntries(Object.keys(G_CODE_OPERATION_DEFINITIONS).map(operation => {
		const binding = table && table[operation];
		return [operation, binding ? {
			letter: binding.letter || "G",
			code: binding.code,
			requiredWords: [...(binding.requiredWords || [])],
			argumentWord: binding.argumentWord
		} : null];
	}));
}

function renderGCodeProfilesHtml(profiles, currentProfileId, loadError, notice) {
	const nonce = makeWebviewNonce();
	const initialData = JSON.stringify({ profiles, currentProfileId, operations: G_CODE_OPERATION_DEFINITIONS, loadError, notice }).replace(/</g, "\\u003c");
	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<title>KAIJU G-code Profiles</title>
<style>
	:root { color-scheme: dark light; }
	body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); margin: 0; }
	main { display: grid; grid-template-columns: minmax(13rem, 22rem) minmax(34rem, 1fr); height: 100vh; }
	aside { border-right: 1px solid var(--vscode-panel-border); padding: 12px; overflow: auto; }
	section { min-width: 0; padding: 14px 18px; overflow: auto; }
	h1 { font-size: 1.15rem; margin: 0 0 10px; }
	h2 { font-size: 1rem; margin: 0; }
	button, input, textarea, select { font: inherit; color: inherit; background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border); border-radius: 2px; }
	button { cursor: pointer; background: var(--vscode-button-secondaryBackground); padding: 5px 8px; }
	button.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
	button:disabled { opacity: .55; cursor: default; }
	input, textarea { box-sizing: border-box; padding: 5px; width: 100%; }
	textarea { resize: vertical; min-height: 3.4rem; }
	.actions, .profile-actions, .tabs { display: flex; gap: 7px; flex-wrap: wrap; }
	.actions { margin: 10px 0; }
	.profile-list { display: grid; gap: 4px; }
	.profile-choice { text-align: left; width: 100%; }
	.profile-choice.selected { outline: 1px solid var(--vscode-focusBorder); background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
	.profile-choice small { display: block; opacity: .72; margin-top: 2px; }
	.field { display: grid; gap: 4px; margin: 10px 0; max-width: 44rem; }
	.field label { font-weight: 600; }
	.notice { padding: 8px; margin: 0 0 10px; border-left: 3px solid var(--vscode-editorWarning-foreground); background: color-mix(in srgb, var(--vscode-editorWarning-foreground) 10%, transparent); }
	.notice.error { border-color: var(--vscode-editorError-foreground); }
	.key-help { margin: 12px 0; color: var(--vscode-descriptionForeground); max-width: 60rem; }
	.table-wrap { overflow: auto; border: 1px solid var(--vscode-panel-border); }
	table { border-collapse: collapse; width: 100%; min-width: 44rem; }
	th, td { border-bottom: 1px solid var(--vscode-panel-border); padding: 6px 8px; text-align: left; vertical-align: middle; }
	th { position: sticky; top: 0; background: var(--vscode-editor-background); }
	td:first-child { width: 43%; }
	.binding-input { max-width: 16rem; font-family: var(--vscode-editor-font-family); }
	.operation-code { color: var(--vscode-descriptionForeground); font-family: var(--vscode-editor-font-family); font-size: .9em; }
	.hidden { display: none; }
</style>
</head>
<body>
<script nonce="${nonce}" id="profileData" type="application/json">${initialData}</script>
<main>
	<aside>
		<h1>G-code profiles</h1>
		<div class="actions"><button id="newProfile" type="button">New</button><button id="duplicateProfile" type="button">Duplicate</button></div>
		<div id="profileList" class="profile-list"></div>
	</aside>
	<section>
		<div id="notice" class="notice hidden" role="status"></div>
		<div class="profile-actions"><h2 id="profileHeading"></h2><button id="deleteProfile" type="button">Delete</button><button id="saveProfile" class="primary" type="button" disabled>Save profiles</button><button id="useProfile" class="primary" type="button">Use for this program</button></div>
		<div class="field"><label for="profileName">Profile name</label><input id="profileName" maxlength="80" placeholder="My controller"></div>
		<div class="field"><label for="profileDescription">Description</label><textarea id="profileDescription" maxlength="240" placeholder="Optional notes about this controller."></textarea></div>
		<p class="key-help">Each row is one KAIJU function. Enter a G word such as <code>G98</code>, or an M word such as <code>M45</code> for C-axis mode. Use <code>G50 S</code> when the function reads an <code>S</code> companion word. Leave a cell blank to leave that function unbound. Reusing a word in this table clears its previous binding.</p>
		<div class="tabs"><button class="mode-tab primary" data-mode="mill" type="button">Mill bindings</button><button class="mode-tab" data-mode="lathe" type="button">Lathe bindings</button></div>
		<div class="table-wrap"><table><thead><tr><th>Function</th><th>Binding</th></tr></thead><tbody id="bindingsBody"></tbody></table></div>
	</section>
</main>
<script nonce="${nonce}">
	const vscode = acquireVsCodeApi();
	const initial = JSON.parse(document.getElementById('profileData').textContent);
	const builtInProfiles = initial.profiles.filter(profile => profile.builtIn);
	let customProfiles = initial.profiles.filter(profile => !profile.builtIn).map(copy);
	let selectedId = initial.profiles.some(profile => profile.id === initial.currentProfileId) ? initial.currentProfileId : (customProfiles[0] && customProfiles[0].id || builtInProfiles[0] && builtInProfiles[0].id);
	let mode = 'mill';
	let sequence = 0;
	const profileList = document.getElementById('profileList');
	const bindingsBody = document.getElementById('bindingsBody');
	const notice = document.getElementById('notice');
	const profileName = document.getElementById('profileName');
	const profileDescription = document.getElementById('profileDescription');
	const deleteProfile = document.getElementById('deleteProfile');
	const heading = document.getElementById('profileHeading');
	const saveProfile = document.getElementById('saveProfile');
	const useProfile = document.getElementById('useProfile');
	let dirty = false;

	function copy(value) { return JSON.parse(JSON.stringify(value)); }
	function getSelected() { return customProfiles.find(profile => profile.id === selectedId) || builtInProfiles.find(profile => profile.id === selectedId); }
	function isCustom(profile) { return profile && !profile.builtIn; }
	function showNotice(message, error) { notice.textContent = message || ''; notice.classList.toggle('hidden', !message); notice.classList.toggle('error', Boolean(error)); }
	function markDirty() { dirty = true; saveProfile.disabled = false; }
	function makeId() { sequence += 1; return 'custom-profile-' + Date.now().toString(36) + '-' + sequence; }
	function render() {
		const selected = getSelected();
		profileList.innerHTML = [...builtInProfiles, ...customProfiles].map(profile => '<button class="profile-choice' + (profile.id === selectedId ? ' selected' : '') + '" data-profile-id="' + escapeAttribute(profile.id) + '" type="button">' + escapeHtml(profile.label) + '<small>' + (profile.builtIn ? 'Built in - duplicate to edit' : 'Custom profile') + '</small></button>').join('');
		heading.textContent = selected ? selected.label : 'No profile selected';
		profileName.value = selected ? selected.label : '';
		profileDescription.value = selected ? selected.description || '' : '';
		const editable = isCustom(selected);
		profileName.disabled = !editable;
		profileDescription.disabled = !editable;
		deleteProfile.disabled = !editable;
		saveProfile.disabled = !dirty;
		useProfile.disabled = !selected;
		for (const tab of document.querySelectorAll('.mode-tab')) tab.classList.toggle('primary', tab.dataset.mode === mode);
		renderBindings(selected, editable);
	}
	function renderBindings(profile, editable) {
		if (!profile) { bindingsBody.innerHTML = ''; return; }
		bindingsBody.innerHTML = Object.entries(initial.operations).map(([operation, definition]) => {
			const binding = profile.bindings[mode][operation];
			const letter = definition.wordLetter || 'G';
			const value = binding ? (binding.letter || 'G') + formatCode(binding.code) + (binding.requiredWords && binding.requiredWords.length ? ' ' + binding.requiredWords.join(' ') : '') : '';
			return '<tr><td><strong>' + escapeHtml(definition.label || operation) + '</strong><div class="operation-code">' + escapeHtml(operation) + '</div></td><td><input class="binding-input" data-operation="' + escapeAttribute(operation) + '" value="' + escapeAttribute(value) + '" placeholder="Unbound" title="' + letter + ' word, optionally followed by one companion letter"' + (editable ? '' : ' disabled') + '></td></tr>';
		}).join('');
	}
	function formatCode(code) { return Number.isInteger(Number(code)) ? String(Number(code)) : String(code); }
	function parseBinding(value, operation) {
		const text = String(value || '').trim();
		if (!text) return null;
		const letter = initial.operations[operation].wordLetter || 'G';
		const match = /^([GM])\\s*(\\d+(?:\\.\\d+)?)\\s*(?:([A-Z])\\s*)?$/i.exec(text);
		if (!match || match[1].toUpperCase() !== letter) throw new Error('Use a ' + letter + ' word or leave the cell blank.');
		const companion = match[3] ? match[3].toUpperCase() : undefined;
		return { letter, code: Number(match[2]), requiredWords: companion ? [companion] : [], argumentWord: companion };
	}
	function bindingKey(binding) { return binding ? (binding.letter || 'G') + String(binding.code) : ''; }
	function setBinding(operation, value) {
		const selected = getSelected();
		if (!isCustom(selected)) return;
		const binding = parseBinding(value, operation);
		selected.bindings[mode][operation] = binding;
		if (binding) {
			for (const [otherOperation, otherBinding] of Object.entries(selected.bindings[mode])) {
				if (otherOperation !== operation && bindingKey(otherBinding) === bindingKey(binding)) selected.bindings[mode][otherOperation] = null;
			}
		}
	}
	function escapeHtml(value) { return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
	function escapeAttribute(value) { return escapeHtml(value); }
	profileList.addEventListener('click', event => { const button = event.target.closest('[data-profile-id]'); if (!button) return; selectedId = button.dataset.profileId; showNotice(''); render(); });
	document.getElementById('newProfile').addEventListener('click', () => { const profile = { id: makeId(), label: 'New profile', description: '', bindings: { mill: {}, lathe: {} } }; customProfiles.push(profile); selectedId = profile.id; markDirty(); showNotice(''); render(); });
	document.getElementById('duplicateProfile').addEventListener('click', () => { const source = getSelected(); if (!source) return; const profile = copy(source); profile.id = makeId(); profile.label = source.label + ' copy'; delete profile.builtIn; customProfiles.push(profile); selectedId = profile.id; markDirty(); showNotice(''); render(); });
	deleteProfile.addEventListener('click', () => { const selected = getSelected(); if (!isCustom(selected)) return; customProfiles = customProfiles.filter(profile => profile.id !== selected.id); selectedId = customProfiles[0] && customProfiles[0].id || builtInProfiles[0] && builtInProfiles[0].id; markDirty(); showNotice(''); render(); });
	profileName.addEventListener('input', () => { const selected = getSelected(); if (isCustom(selected)) { selected.label = profileName.value; heading.textContent = selected.label || 'Unnamed profile'; markDirty(); } });
	profileDescription.addEventListener('input', () => { const selected = getSelected(); if (isCustom(selected)) { selected.description = profileDescription.value; markDirty(); } });
	bindingsBody.addEventListener('change', event => { const input = event.target.closest('.binding-input'); if (!input) return; try { setBinding(input.dataset.operation, input.value); markDirty(); showNotice(''); renderBindings(getSelected(), true); } catch (error) { showNotice(error.message, true); input.focus(); } });
	for (const tab of document.querySelectorAll('.mode-tab')) tab.addEventListener('click', () => { mode = tab.dataset.mode; render(); });
	saveProfile.addEventListener('click', () => { if (dirty) vscode.postMessage({ type: 'saveGCodeProfiles', profiles: customProfiles }); });
	useProfile.addEventListener('click', () => { const selected = getSelected(); if (selected) vscode.postMessage({ type: 'useGCodeProfile', profiles: customProfiles, profileId: selected.id }); });
	window.addEventListener('message', event => { const message = event.data || {}; if (message.type === 'error') showNotice(message.message, true); });
	showNotice(initial.loadError ? 'Configured custom profiles could not be loaded: ' + initial.loadError : initial.notice || '');
	render();
</script>
</body>
</html>`;
}

function makeWebviewNonce() {
	let nonce = "";
	const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
	for (let index = 0; index < 32; index++) nonce += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
	return nonce;
}

module.exports = {
	CUSTOM_PROFILES_SETTING,
	registerGCodeProfileEditor,
	reloadConfiguredGCodeDialectProfiles,
	showGCodeProfileEditor,
	renderGCodeProfilesHtml
};
