import { execFile } from 'node:child_process';
import fs, { readFileSync } from 'node:fs';

import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

/**
 * Resolve a value for `name`.
 *
 *   1. If the variable is already exported in the shell, that wins.
 *   2. Otherwise we scan, in order:
 *        - ~/.pi/agent/.env
 *        - ~/.pi/agent/extensions/.env
 *
 * We deliberately do NOT use `import.meta.url` to locate the .env file:
 * Pi loads extensions through its own runtime, so `import.meta.url` does
 * not necessarily point at this file's on-disk location — that's why the
 * previous `dirname(fileURLToPath(import.meta.url))` approach silently
 * failed to find the .env. `homedir()` is stable regardless of how Pi
 * compiles/evaluates the extension.
 */
function readEnvValue(name: string): string | undefined {
  if (process.env[name]) return process.env[name];

  const candidates = [
    join(homedir(), '.pi', 'agent', '.env'),
    join(homedir(), '.pi', 'agent', 'extensions', '.env'),
  ];

  for (const path of candidates) {
    let text: string;
    try {
      text = readFileSync(path, 'utf8');
    } catch {
      continue;
    }

    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      const match = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (!match || match[1] !== name) continue;

      const raw = match[2].trim();
      if (
        (raw.startsWith('"') && raw.endsWith('"')) ||
        (raw.startsWith("'") && raw.endsWith("'"))
      ) {
        return raw.slice(1, -1);
      }
      // Strip an inline `# comment` tail on unquoted values.
      return raw.replace(/\s+#.*$/, '');
    }
  }

  return undefined;
}

const BROWSER_RELAY_URL =
  readEnvValue('PI_BROWSER_NOTIFICATION_RELAY_URL') ?? 'http://127.0.0.1:48291/notify';
const BROWSER_RELAY_API_KEY = readEnvValue('PI_NOTIFICATION_RELAY_API_KEY');

if (!BROWSER_RELAY_API_KEY) {
  // Surface a single, easy-to-grep warning at load time so misconfigured
  // installs are obvious instead of silently 401-ing against the relay.
  console.warn(
    '[project-finish-notify] PI_NOTIFICATION_RELAY_API_KEY not found in env or ~/.pi/agent[/extensions]/.env — browser notifications will be unauthorized.',
  );
}

interface BrowserNotificationPayload {
  id: string;
  title: string;
  projectName: string;
  projectPath: string;
  model?: string;
  timestamp: number;
}

function cleanText(text: string): string {
  return text
    .replace(/[\x00-\x1f\x7f]+/g, ' ')
    .replace(/[;]+/g, ',')
    .replace(/\s+/g, ' ')
    .trim();
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
  const type = 'Windows.UI.Notifications';
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
  ].join('; ');
}

function notifyWindows(title: string, body: string): void {
  execFile('powershell.exe', ['-NoProfile', '-Command', windowsToastScript(title, body)], () => {});
}

function notifyLinux(title: string, body: string): void {
  execFile('notify-send', [title, body], () => {});
}

function sendNativeNotification(title: string, body: string): void {
  if (process.env.WT_SESSION) {
    notifyWindows(title, body);
    return;
  }

  if (process.platform === 'linux' && (process.env.DISPLAY || process.env.WAYLAND_DISPLAY)) {
    notifyLinux(title, body);
    return;
  }

  if (process.env.KITTY_WINDOW_ID) {
    notifyOSC99(title, body);
    return;
  }

  notifyOSC777(title, body);
}

function generateId(): string {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function sendBrowserNotification(payload: BrowserNotificationPayload): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1500);

  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };
  if (BROWSER_RELAY_API_KEY) {
    headers['x-api-key'] = BROWSER_RELAY_API_KEY;
  }

  try {
    await fetch(BROWSER_RELAY_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

  } catch {
    // Ignore relay failures so native notifications still work.
  } finally {
    clearTimeout(timeout);
  }
}

export default function projectFinishNotify(pi: ExtensionAPI) {
  pi.on('agent_end', async (_event, ctx) => {
    const projectName = basename(ctx.cwd) || ctx.cwd;
    const modelText = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined;
    const nativeTitle = `Pi finished · ${projectName}`;
    const nativeBody = modelText
      ? `Project: ${ctx.cwd} | Model: ${modelText}`
      : `Project: ${ctx.cwd}`;

    sendNativeNotification(nativeTitle, nativeBody);

    const payload: BrowserNotificationPayload = {
      id: generateId(),
      title: 'Task complete',
      projectName,
      projectPath: ctx.cwd,
      model: modelText,
      timestamp: Date.now(),
    };

    void sendBrowserNotification(payload);
  });
}
