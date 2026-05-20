import { execFile } from "node:child_process";
import { basename } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

function cleanText(text: string): string {
	return text.replace(/[\x00-\x1f\x7f]+/g, " ").replace(/[;]+/g, ",").replace(/\s+/g, " ").trim();
}

function notifyOSC777(title: string, body: string): void {
	process.stdout.write(`\x1b]777;notify;${cleanText(title)};${cleanText(body)}\x07`);
}

function notifyOSC99(title: string, body: string): void {
	process.stdout.write(`\x1b]99;i=1:d=0;${cleanText(title)}\x1b\\`);
	process.stdout.write(`\x1b]99;i=1:p=body;${cleanText(body)}\x1b\\`);
}

function escapePowerShell(text: string): string {
	return text.replace(/'/g, "''");
}

function windowsToastScript(title: string, body: string): string {
	const type = "Windows.UI.Notifications";
	const mgr = `[${type}.ToastNotificationManager, ${type}, ContentType = WindowsRuntime]`;
	const template = `[${type}.ToastTemplateType]::ToastText02`;
	const toast = `[${type}.ToastNotification]::new($xml)`;
	const safeTitle = escapePowerShell(title);
	const safeBody = escapePowerShell(body);
	return [
		`${mgr} > $null`,
		`$xml = [${type}.ToastNotificationManager]::GetTemplateContent(${template})`,
		`$xml.GetElementsByTagName('text')[0].AppendChild($xml.CreateTextNode('${safeTitle}')) > $null`,
		`$xml.GetElementsByTagName('text')[1].AppendChild($xml.CreateTextNode('${safeBody}')) > $null`,
		`[${type}.ToastNotificationManager]::CreateToastNotifier('Pi').Show(${toast})`,
	].join("; ");
}

function notifyWindows(title: string, body: string): void {
	execFile("powershell.exe", ["-NoProfile", "-Command", windowsToastScript(title, body)], () => {});
}

function notifyLinux(title: string, body: string): void {
	execFile("notify-send", [title, body], () => {});
}

function sendNotification(title: string, body: string): void {
	if (process.env.WT_SESSION) {
		notifyWindows(title, body);
		return;
	}

	if (process.platform === "linux" && (process.env.DISPLAY || process.env.WAYLAND_DISPLAY)) {
		notifyLinux(title, body);
		return;
	}

	if (process.env.KITTY_WINDOW_ID) {
		notifyOSC99(title, body);
		return;
	}

	notifyOSC777(title, body);
}

export default function projectFinishNotify(pi: ExtensionAPI) {
	pi.on("agent_end", async (_event, ctx) => {
		const projectName = basename(ctx.cwd) || ctx.cwd;
		const modelText = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "no model";
		const title = `Pi finished · ${projectName}`;
		const body = `Project: ${ctx.cwd} | Model: ${modelText}`;
		sendNotification(title, body);
	});
}
