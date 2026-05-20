import { CustomEditor, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey } from "@earendil-works/pi-tui";

/**
 * Pi already has a built-in searchable model picker on /model and Ctrl+L.
 * This extension remaps Ctrl+P / Ctrl+Shift+P to open that same picker
 * instead of cycling models.
 */
class ModelPickerHotkeyEditor extends CustomEditor {
	handleInput(data: string): void {
		if (matchesKey(data, Key.ctrl("p")) || matchesKey(data, Key.ctrlShift("p"))) {
			this.actionHandlers.get("app.model.select")?.();
			return;
		}

		super.handleInput(data);
	}
}

export default function modelPickerCtrlPExtension(pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		ctx.ui.setEditorComponent((tui, theme, keybindings) => new ModelPickerHotkeyEditor(tui, theme, keybindings));
	});
}
