const Module = require("module");
const { EventEmitter: NodeEventEmitter } = require("events");

const configurationValues = new Map();
const vscode = {
	EventEmitter: class EventEmitter {
		constructor() {
			this.emitter = new NodeEventEmitter();
			this.event = listener => {
				this.emitter.on("event", listener);
				return { dispose: () => this.emitter.off("event", listener) };
			};
		}
		fire(value) { this.emitter.emit("event", value); }
		dispose() { this.emitter.removeAllListeners(); }
	},
	ConfigurationTarget: { Global: 1 },
	workspace: {
		getConfiguration(section) {
			return {
				get(key, fallback) {
					const fullKey = `${section}.${key}`;
					return configurationValues.has(fullKey) ? configurationValues.get(fullKey) : fallback;
				},
				async update(key, value) { configurationValues.set(`${section}.${key}`, value); }
			};
		}
	},
	window: {
		showInputBox: async () => undefined
	}
};

const originalLoad = Module._load;
if (!global.__kaijuVscodeStubInstalled) {
	Module._load = function loadWithVscodeStub(request, parent, isMain) {
		return request === "vscode" ? vscode : originalLoad(request, parent, isMain);
	};
	global.__kaijuVscodeStubInstalled = true;
}

function makeDocument(source, options = {}) {
	const lines = String(source).replace(/^\n|\n$/g, "").split(/\r?\n/);
	const uriText = options.uri || "test.nc";
	return {
		languageId: "gcode",
		version: options.version || 1,
		fileName: options.fileName || uriText,
		uri: { toString: () => uriText },
		lineCount: lines.length,
		lineAt(index) { return { text: lines[index] }; }
	};
}

module.exports = { configurationValues, makeDocument, vscode };
