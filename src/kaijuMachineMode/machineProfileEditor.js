// Role: own machine-profile webview presentation. Shared profiles, validation,
// defaults, and per-program selection belong to MetaMachineMode.
const vscode = require("vscode");
const { randomBytes } = require("crypto");
const { getGCodeDialectProfiles } = require("../MetaGCodeDialect");
const {
	getMachineProfiles, getDefaultMachineProfileId, getMachineModeForDocument,
	saveMachineProfiles, setMachineProfile, setDefaultMachineProfile
} = require("../MetaMachineMode");
const { reloadConfiguredGCodeDialectProfiles } = require("./profileEditor");

function registerMachineProfileEditor(context) {
	const panels = new Map();
	context.subscriptions.push(vscode.commands.registerCommand("kaijuNC.machineProfiles.manage", (options = {}) => {
		const document = options.document || vscode.window.activeTextEditor && vscode.window.activeTextEditor.document;
		if (!document || document.languageId !== "gcode") {
			vscode.window.showWarningMessage("Open a G-code document before editing machine profiles.");
			return;
		}
		const key = document.uri.toString();
		if (panels.has(key)) {
			const panel = panels.get(key); panel.reveal(vscode.ViewColumn.Beside);
			if (options.tab === "timing") void panel.webview.postMessage({ type: "showTab", tab: "timing" });
			return;
		}
		const loadError = reloadConfiguredGCodeDialectProfiles(document);
		if (loadError) { vscode.window.showErrorMessage(loadError); return; }
		let profiles;
		try { profiles = getMachineProfiles(document); }
		catch (error) { vscode.window.showErrorMessage(error.message); return; }
		const mode = getMachineModeForDocument(document);
		const panel = vscode.window.createWebviewPanel("kaijuMachineProfiles", "KAIJU Machine Profiles", vscode.ViewColumn.Beside, { enableScripts: true, retainContextWhenHidden: true });
		panels.set(key, panel);
		context.subscriptions.push(panel);
		panel.onDidDispose(() => panels.delete(key));
		panel.webview.html = renderMachineProfilesHtml({ profiles, dialects: getGCodeDialectProfiles().map(({ id, label }) => ({ id, label })),
			defaultId: getDefaultMachineProfileId(document), currentId: mode.machineProfile.id, tab: options.tab });
		let busy = false;
		panel.webview.onDidReceiveMessage(async message => {
			if (!message || !["save", "use", "default"].includes(message.type) || busy) return;
			busy = true;
			try {
				// Revalidate against the current controller registry before writing.
				const error = reloadConfiguredGCodeDialectProfiles(document);
				if (error) throw new Error(error);
				if (!["generic", ...(Array.isArray(message.profiles) ? message.profiles.map(profile => profile && profile.id) : [])].includes(message.selectedId)) throw new Error("Select an existing machine profile.");
				await saveMachineProfiles(document, message.profiles);
				let notice = "Profiles saved.";
				if (message.type === "use") {
					const selected = await setMachineProfile(document, message.selectedId);
					notice = `Machine for this program set to ${selected.label}.`;
				}
				if (message.type === "default") {
					await setDefaultMachineProfile(document, message.selectedId);
					notice = "Default machine profile saved.";
				}
				await panel.webview.postMessage({ type: "saved", notice, defaultId: getDefaultMachineProfileId(document), currentId: getMachineModeForDocument(document).machineProfile.id });
			} catch (error) {
				await panel.webview.postMessage({ type: "error", notice: error instanceof Error ? error.message : String(error) });
			} finally { busy = false; }
		});
	}));
}

function renderMachineProfilesHtml(data) {
	const nonce = randomBytes(18).toString("base64");
	const { program, ...profileData } = data;
	const initial = JSON.stringify(profileData).replace(/</g, "\\u003c");
	return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<title>KAIJU Machine Profiles</title><style>
:root { color-scheme: light dark; }
body { margin:0; font-family:var(--vscode-font-family); color:var(--vscode-foreground); background:var(--vscode-editor-background); }
main { display:grid; grid-template-columns:220px minmax(0,1fr); min-height:100vh; }
aside { padding:12px; border-right:1px solid var(--vscode-panel-border); }
section { padding:14px 18px; max-width:820px; min-width:0; }
h1 { font-size:1.1rem; margin:0 0 10px; } h2 { font-size:1rem; margin:18px 0 8px; }
button,input,select,textarea { font:inherit; color:var(--vscode-input-foreground); background:var(--vscode-input-background); border:1px solid var(--vscode-input-border); border-radius:2px; padding:5px 7px; }
button { cursor:pointer; background:var(--vscode-button-secondaryBackground); color:var(--vscode-button-secondaryForeground); }
button.primary { background:var(--vscode-button-background); color:var(--vscode-button-foreground); }
button:disabled { opacity:.5; cursor:default; } input,select,textarea { width:100%; box-sizing:border-box; }
input[type=checkbox] { width:auto; } textarea { resize:vertical; }
.actions { display:flex; gap:6px; flex-wrap:wrap; margin-bottom:12px; }
.choice { display:block; width:100%; text-align:left; margin:4px 0; overflow:hidden; text-overflow:ellipsis; }
.choice.selected { outline:1px solid var(--vscode-focusBorder); }
.choice small { display:block; color:var(--vscode-descriptionForeground); margin-top:3px; }
.field { display:grid; grid-template-columns:190px minmax(0,1fr); gap:10px; align-items:center; margin:8px 0; }
.help { color:var(--vscode-descriptionForeground); font-size:.92em; line-height:1.5; }
.tabs { display:flex; gap:6px; margin:14px 0 10px; border-bottom:1px solid var(--vscode-panel-border); padding-bottom:8px; }
.timing-row { display:grid; grid-template-columns:minmax(70px,120px) minmax(80px,150px) auto; gap:8px; margin:6px 0; align-items:center; }
#notice { margin:8px 0; } #notice.error { color:var(--vscode-errorForeground); }
#createForm { padding:8px; border:1px solid var(--vscode-panel-border); margin:8px 0; }
#createForm label { display:block; margin:6px 0; } [hidden] { display:none!important; }
@media(max-width:650px) { main { grid-template-columns:1fr; } aside { border-right:0; border-bottom:1px solid var(--vscode-panel-border); } .field { grid-template-columns:1fr; gap:4px; } }
</style></head><body>
<script nonce="${nonce}" type="application/json" id="profileData">${initial}</script>
<main><aside><h1>Machine profiles</h1><div class="actions"><button id="newProfile">New</button><button id="copyProfile">Duplicate</button></div>
<div id="createForm" hidden><label for="newName">Name</label><input id="newName" maxlength="80"><label for="copyFrom">Copy settings from</label><select id="copyFrom"></select><div class="actions"><button id="createProfile" class="primary">Create</button><button id="cancelCreate">Cancel</button></div></div>
<div id="profileList"></div></aside>
<section><h1 id="heading"></h1>
<div class="actions"><button id="save" class="primary" disabled>Save profiles</button><button id="use" class="primary">Use for this program</button><button id="default">Set as default</button></div>
<div id="notice" role="status" aria-live="polite"></div>
<form id="fields">
<div class="field"><label for="label">Profile name</label><input id="label" maxlength="80" required></div>
<div class="field"><label for="description">Description</label><textarea id="description" maxlength="240" rows="2"></textarea></div>
<div class="tabs" role="tablist" aria-label="Profile settings"><button id="machineTab" type="button" role="tab" aria-controls="machinePane" aria-selected="true" class="primary">Machine</button><button id="timingTab" type="button" role="tab" aria-controls="timingPane" aria-selected="false">Timing</button><button id="offsetsTab" type="button" role="tab" aria-controls="offsetsPane" aria-selected="false">Offsets</button></div>
<div id="machinePane" role="tabpanel" aria-labelledby="machineTab">
<h2>General</h2>
<div class="field"><label for="machineMode">Machine type</label><select id="machineMode"><option value="auto">Automatic</option><option value="mill">Mill</option><option value="latheDiameter">Lathe (Diameter)</option><option value="latheRadius">Lathe (Radius)</option></select></div>
<div class="field"><label for="gCodeDialectId">G-code profile</label><select id="gCodeDialectId"></select></div>
<div class="field"><label for="requiresSemicolons">Requires semicolons</label><div><input id="requiresSemicolons" type="checkbox"> <label for="requiresSemicolons">Add ; when formatting</label></div></div>
<div class="field"><label for="requiresPercentDelimiters">Requires % delimiters</label><div><input id="requiresPercentDelimiters" type="checkbox"> <label for="requiresPercentDelimiters">Add % at the start and end when formatting</label></div></div>
<div class="field"><label for="cssSurfaceSpeedUnit">CSS surface-speed units</label><select id="cssSurfaceSpeedUnit"><option value="mPerMin">m/min</option><option value="sfm">ft/min</option></select></div>
<div class="field"><label for="maxSpindleRpm">Maximum spindle RPM</label><input id="maxSpindleRpm" type="number" min="0" step="any" required></div>
<p class="help">Zero leaves the machine limit unspecified. Estimates use the lower of this limit and the program's spindle limit.</p>
<h2>C-axis</h2>
<div class="field"><label for="cAxisCoordinates">Coordinates after a move</label><select id="cAxisCoordinates"><option value="wrapped">Wrap angle to 0–360°</option><option value="continuous">Continuous angle (can exceed 360°)</option></select></div>
<div class="field"><label for="cAxisResetOnDisable">Reset on disengagement</label><div><input id="cAxisResetOnDisable" type="checkbox"> <label for="cAxisResetOnDisable">Reset C to zero</label></div></div>
<div class="field"><label for="cAxisTravel">Absolute C travel</label><select id="cAxisTravel"><option value="direct">Use programmed angle</option><option value="shortest">Shortest route</option><option value="positive">Positive direction</option><option value="negative">Negative direction</option></select></div>
<p class="help">From C350 to C10, the programmed route is -340 degrees; the shortest route is +20 degrees. Incremental H and G91 moves keep their commanded travel. These rules apply to lathe C motion outside polar interpolation.</p>
<div class="field"><label for="rotaryFeedRule">Rotary feed interpretation</label><select id="rotaryFeedRule"><option value="degrees">Degrees contribute to feed (current default)</option><option value="scaledDegrees">Scaled degrees contribute to feed</option><option value="physical">Physical swept distance</option><option value="linearOnly">Linear-axis distance only</option></select></div>
<div class="field"><label for="rotaryFeedScale">Units per C degree</label><input id="rotaryFeedScale" type="number" min="0" step="any" required></div>
<p id="rotaryFeedHelp" class="help"></p>
<p class="help">Disengagement uses the selected G-code profile's C-axis mode-off binding.</p>
<h2>Startup modes</h2>
<div class="field"><label for="startupFeedMode">Feed mode</label><select id="startupFeedMode"><option value="machine">Machine type default</option><option value="perMinute">Feed per minute</option><option value="perRev">Feed per revolution</option></select></div>
<div class="field"><label for="startupPlane">Arc plane</label><select id="startupPlane"><option value="xy">X-Y</option><option value="xz">X-Z</option><option value="yz">Y-Z</option></select></div>
<div class="field"><label for="startupDistanceMode">Distance mode</label><select id="startupDistanceMode"><option value="absolute">Absolute</option><option value="incremental">Incremental</option></select></div>
<div class="field"><label for="startupSpindleMode">Spindle mode</label><select id="startupSpindleMode"><option value="fixed">Fixed RPM</option><option value="css">Constant surface speed</option></select></div>
<p class="help">Used until the program commands another mode. Feed and spindle values still come from the program.</p>
</div>
<div id="timingPane" role="tabpanel" aria-labelledby="timingTab" hidden>
<h2>Motion &amp; tool timing</h2>
<div class="field"><label for="rapidRate">G0 rapid rate</label><input id="rapidRate" type="number" min="0" step="any" required></div>
<p class="help">Rapid rate is in machine units per minute. Zero leaves rapid time unknown.</p>
<div class="field"><label for="rapidX">X rapid rate</label><input id="rapidX" type="number" min="0" step="any" placeholder="Use G0 rapid rate"></div>
<div class="field"><label for="rapidY">Y rapid rate</label><input id="rapidY" type="number" min="0" step="any" placeholder="Use G0 rapid rate"></div>
<div class="field"><label for="rapidZ">Z rapid rate</label><input id="rapidZ" type="number" min="0" step="any" placeholder="Use G0 rapid rate"></div>
<div class="field"><label for="rapidC">C rapid rate (degrees/min)</label><input id="rapidC" type="number" min="0" step="any" placeholder="Unknown"></div>
<p class="help">X/Y/Z rates use physical axis travel in machine units/minute. With axis rates, the longest moving-axis time sets the rapid estimate. Acceleration is not included.</p>
<div class="field"><label for="toolChangeSeconds">Tool change (seconds)</label><input id="toolChangeSeconds" type="number" min="0" step="any" aria-describedby="toolChangeHelp" required></div>
<p id="toolChangeHelp" class="help">Base time for a tool change, including a move to an adjacent turret station.</p>
<div class="field"><label for="extraStationSeconds">Extra station (seconds)</label><input id="extraStationSeconds" type="number" min="0" step="any" aria-describedby="extraStationHelp" required></div>
<p id="extraStationHelp" class="help">Added for each indexing step beyond an adjacent move. A three-step move adds twice this value to the base time.</p>
<div class="field"><label for="turretStationCount">Turret station count</label><input id="turretStationCount" type="number" min="0" step="1" required></div>
<div class="field"><label for="turretIndexing">Turret indexing</label><select id="turretIndexing"><option value="shortest">Shortest route</option><option value="increasing">Increasing station numbers</option><option value="decreasing">Decreasing station numbers</option></select></div>
<p class="help">A station count enables wrap-around indexing: on a 12-station turret, 12 to 1 is adjacent in the increasing direction. Zero keeps the existing station-number difference estimate.</p>
<h2>Custom M-code timings</h2>
<p class="help">Add an M code and the seconds it takes, such as M05 or M86. Each executed occurrence contributes to Chronoblade's Other time.</p>
<div id="customTimes"></div><button id="addTiming" type="button">Add M code</button>
</div>
<div id="offsetsPane" role="tabpanel" aria-labelledby="offsetsTab" hidden>
<h2>Default work offsets</h2>
<p class="help">Frame origins relative to G53 machine zero. X/Y/Z use machine units and the selected radius/diameter convention; C uses degrees. Vision and Chronoblade use these unless this program has saved offset overrides. Offsets shift coordinates; selecting another frame does not itself move the tool.</p>
<table><thead><tr><th>Frame</th><th>X</th><th>Y</th><th>Z</th><th>C (degrees)</th></tr></thead><tbody>
${['G54','G55','G56','G57','G58','G59'].map(code => `<tr><th>${code}</th>${['x','y','z','c'].map(axis => `<td><input id="offset-${code}-${axis}" aria-label="${code} ${axis.toUpperCase()} offset" type="number" step="any" required></td>`).join('')}</tr>`).join('')}
</tbody></table>
</div>
</form></section></main>
<script nonce="${nonce}">
const api = acquireVsCodeApi();
const initial = JSON.parse(document.getElementById('profileData').textContent);
const byId = id => document.getElementById(id);
const copy = value => JSON.parse(JSON.stringify(value));
let profiles = copy(initial.profiles), selectedId = initial.currentId, defaultId = initial.defaultId, currentId = initial.currentId;
let dirty = false, busy = false;
const keys = ['label','description','machineMode','gCodeDialectId','rapidRate','toolChangeSeconds','extraStationSeconds','cAxisCoordinates','cAxisResetOnDisable','requiresSemicolons','requiresPercentDelimiters','cssSurfaceSpeedUnit','maxSpindleRpm','cAxisTravel','rotaryFeedRule','rotaryFeedScale','startupFeedMode','startupPlane','startupDistanceMode','startupSpindleMode','turretStationCount','turretIndexing','rapidX','rapidY','rapidZ','rapidC'];
const axisKeys = { rapidX: 'x', rapidY: 'y', rapidZ: 'z', rapidC: 'c' };
const offsetKeys = {};
for (const code of ['G54','G55','G56','G57','G58','G59']) for (const axis of ['x','y','z','c']) { const id = 'offset-' + code + '-' + axis; offsetKeys[id] = { code, axis }; keys.push(id); }
const checkboxes = new Set(['cAxisResetOnDisable','requiresSemicolons','requiresPercentDelimiters']);
const numeric = new Set(['rapidRate','toolChangeSeconds','extraStationSeconds','maxSpindleRpm','rotaryFeedScale','turretStationCount']);
const timingDrafts = new Map();
const selected = () => profiles.find(profile => profile.id === selectedId) || profiles[0];
function option(select, value, label) { const node = document.createElement('option'); node.value = value; node.textContent = label; select.append(node); }
function notice(text, error) { byId('notice').textContent = text || ''; byId('notice').classList.toggle('error', !!error); }
function controls() {
 byId('save').disabled = !dirty || busy;
 byId('use').disabled = busy;
 byId('default').disabled = busy || (selectedId === defaultId && !dirty);
 for (const id of ['newProfile','copyProfile','createProfile','cancelCreate']) byId(id).disabled = busy;
 for (const key of keys) byId(key).disabled = busy || selected().id === 'generic';
 byId('addTiming').disabled = busy || selected().id === 'generic';
 for (const row of byId('customTimes').children) for (const field of row.children) field.disabled = busy || selected().id === 'generic';
}
function list() {
 byId('profileList').replaceChildren();
 for (const profile of profiles) {
  const button = document.createElement('button'); button.type = 'button'; button.className = 'choice' + (profile.id === selectedId ? ' selected' : '');
  button.textContent = profile.label; button.title = profile.label; button.disabled = busy;
  const small = document.createElement('small');
  small.textContent = [profile.id === 'generic' ? 'Built in' : '', profile.id === defaultId ? 'Default' : '', profile.id === currentId ? 'This program' : ''].filter(Boolean).join(' · ');
  button.append(small); button.onclick = () => { selectedId = profile.id; render(); }; byId('profileList').append(button);
 }
}
function render() {
 const profile = selected(); selectedId = profile.id;
 byId('heading').textContent = profile.label;
 for (const key of keys) { if (offsetKeys[key]) { const {code, axis} = offsetKeys[key]; byId(key).value = profile.workOffsets?.[code]?.[axis] ?? 0; } else if (checkboxes.has(key)) byId(key).checked = profile[key] === true; else byId(key).value = axisKeys[key] ? (profile.rapidRates && profile.rapidRates[axisKeys[key]]) ?? '' : profile[key]; }
 feedHelp();
 renderTimes(); list(); controls();
}
function feedHelp() {
 const help = {
  degrees: 'Each C degree counts as one linear unit, combined with X/Y/Z travel. This preserves the current timing rule.',
  scaledDegrees: 'Each C degree counts as the configured number of linear units, combined with X/Y/Z travel.',
  physical: 'Feed follows the physical swept path, including rotation at the changing radius and simultaneous linear motion.',
  linearOnly: 'Feed follows X/Y/Z travel only. A pure C move has unknown time under this rule.'
 };
 byId('rotaryFeedHelp').textContent = help[selected().rotaryFeedRule] || help.degrees;
 byId('rotaryFeedScale').parentElement.hidden = selected().rotaryFeedRule !== 'scaledDegrees';
}
function setTab(tab) {
 for (const name of ['machine','timing','offsets']) {
  byId(name + 'Pane').hidden = name !== tab;
  byId(name + 'Tab').setAttribute('aria-selected', String(name === tab));
  byId(name + 'Tab').classList.toggle('primary', name === tab);
 }
}
byId('machineTab').onclick = () => setTab('machine');
byId('timingTab').onclick = () => setTab('timing');
byId('offsetsTab').onclick = () => setTab('offsets');
function draftTimes(profile) {
 if (!timingDrafts.has(profile.id)) timingDrafts.set(profile.id, Object.entries(profile.customTimes || {}).map(([code, seconds]) => ({ code, seconds })));
 return timingDrafts.get(profile.id);
}
function markDirty() { dirty = true; controls(); }
function renderTimes() {
 byId('customTimes').replaceChildren();
 draftTimes(selected()).forEach((entry, index) => {
  const row = document.createElement('div'); row.className = 'timing-row';
  const code = document.createElement('input'); code.value = entry.code; code.placeholder = 'M05'; code.setAttribute('aria-label', 'M code');
  const seconds = document.createElement('input'); seconds.type = 'number'; seconds.min = '0'; seconds.step = 'any'; seconds.value = entry.seconds; seconds.setAttribute('aria-label', 'Duration in seconds');
  const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Remove';
  code.addEventListener('input', () => { entry.code = code.value; markDirty(); });
  seconds.addEventListener('input', () => { entry.seconds = seconds.value === '' ? null : Number(seconds.value); markDirty(); });
  remove.onclick = () => { draftTimes(selected()).splice(index, 1); renderTimes(); markDirty(); };
  row.append(code, seconds, remove); byId('customTimes').append(row);
 });
}
byId('addTiming').onclick = () => { draftTimes(selected()).push({ code: '', seconds: 0 }); renderTimes(); markDirty(); };
function openCreate(duplicate) {
 byId('copyFrom').replaceChildren(); for (const profile of profiles) option(byId('copyFrom'), profile.id, profile.label);
 byId('copyFrom').value = duplicate ? selectedId : 'generic';
 byId('newName').value = duplicate ? selected().label + ' copy' : '';
 byId('createForm').hidden = false; byId('newName').focus();
}
byId('newProfile').onclick = () => openCreate(false);
byId('copyProfile').onclick = () => openCreate(true);
byId('cancelCreate').onclick = () => { byId('createForm').hidden = true; };
byId('createProfile').onclick = () => {
 const label = byId('newName').value.trim(); if (!label || label.length > 80) { notice('Enter a name of up to 80 characters.', true); return; }
 const source = profiles.find(profile => profile.id === byId('copyFrom').value); if (!source) return;
 const profile = copy(source); profile.id = 'machine-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2,8); profile.label = label;
 timingDrafts.set(profile.id, copy(draftTimes(source)));
 profiles.push(profile); selectedId = profile.id; dirty = true; byId('createForm').hidden = true; notice(''); render();
};
for (const key of keys) byId(key).addEventListener('input', () => {
 if (selected().id === 'generic' || busy) return;
 if (offsetKeys[key]) { const {code, axis} = offsetKeys[key]; selected().workOffsets = { ...selected().workOffsets, [code]: { ...selected().workOffsets?.[code], [axis]: byId(key).value === '' ? null : Number(byId(key).value) } }; }
 else if (axisKeys[key]) { selected().rapidRates = { ...selected().rapidRates, [axisKeys[key]]: byId(key).value === '' ? null : Number(byId(key).value) }; }
 else selected()[key] = checkboxes.has(key) ? byId(key).checked : numeric.has(key) ? (byId(key).value === '' ? null : Number(byId(key).value)) : byId(key).value;
 if (key === 'rotaryFeedRule') feedHelp();
 dirty = true; byId('heading').textContent = selected().label; list(); controls();
});
function send(type) {
 if (busy) return;
 if (profiles.some(profile => Object.values(profile.workOffsets || {}).some(offset => ['x','y','z','c'].some(axis => offset[axis] !== undefined && (typeof offset[axis] !== 'number' || !Number.isFinite(offset[axis])))))) { setTab('offsets'); notice('Each work offset needs finite X/Y/Z/C values.', true); return; }
 if (profiles.some(profile => !profile.label.trim() || [...numeric].some(key => typeof profile[key] !== 'number' || !Number.isFinite(profile[key]) || profile[key] < 0))) { notice('Each profile needs a name and valid non-negative timings.', true); return; }
 if (profiles.some(profile => !Number.isSafeInteger(profile.turretStationCount) || (profile.rotaryFeedRule === 'scaledDegrees' && profile.rotaryFeedScale <= 0) || Object.values(profile.rapidRates || {}).some(rate => rate !== null && (typeof rate !== 'number' || !Number.isFinite(rate) || rate < 0)))) { notice('Check the station count, axis rates, and angular feed scale.', true); return; }
 const output = [];
 for (const profile of profiles.filter(profile => profile.id !== 'generic')) {
  const customTimes = {};
  for (const entry of draftTimes(profile)) {
   const match = /^M0*([0-9]+)$/i.exec(entry.code.trim());
   if (!match || !Number.isSafeInteger(Number(match[1])) || typeof entry.seconds !== 'number' || !Number.isFinite(entry.seconds) || entry.seconds < 0) { setTab('timing'); notice('Each custom timing needs an M code and non-negative seconds (' + profile.label + ').', true); return; }
   const code = 'M' + Number(match[1]);
   if (Object.prototype.hasOwnProperty.call(customTimes, code)) { setTab('timing'); notice('Duplicate custom timing for ' + code + ' (' + profile.label + ').', true); return; }
   customTimes[code] = entry.seconds;
  }
  output.push({ ...profile, requiresSemicolons: profile.requiresSemicolons === true, requiresPercentDelimiters: profile.requiresPercentDelimiters === true, customTimes });
 }
 if (!byId('fields').reportValidity()) return;
 busy = true; notice('Saving…'); controls(); list();
 api.postMessage({ type, profiles: output, selectedId });
}
byId('save').onclick = () => send('save'); byId('use').onclick = () => send('use'); byId('default').onclick = () => send('default');
byId('fields').onsubmit = event => event.preventDefault();
window.addEventListener('message', event => {
 const message = event.data;
 if (message && message.type === 'showTab' && message.tab === 'timing') { setTab('timing'); return; }
 if (!message || !['saved','error'].includes(message.type)) return;
 busy = false; if (message.type === 'saved') { dirty = false; defaultId = message.defaultId; currentId = message.currentId; }
 notice(message.notice, message.type === 'error'); controls(); list();
});
for (const dialect of initial.dialects) option(byId('gCodeDialectId'), dialect.id, dialect.label);
for (const id of new Set(profiles.map(profile => profile.gCodeDialectId))) {
 if (!initial.dialects.some(dialect => dialect.id === id)) option(byId('gCodeDialectId'), id, 'Unavailable: ' + id);
}
render();
setTab(initial.tab === 'timing' ? 'timing' : 'machine');
</script></body></html>`;
}

module.exports = { registerMachineProfileEditor, renderMachineProfilesHtml };
