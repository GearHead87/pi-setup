import { execFile } from 'node:child_process';
import { basename } from 'node:path';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

function cleanText(text: string): string {
  return text
    .replace(/[\x00-\x1f\x7f]+/g, ' ')
    .replace(/[;]+/g, ',')
    .replace(/\s+/g, ' ')
    .trim();
}

function summarizeText(text: string, maxLength = 90): string {
  const summary = cleanText(text);
  if (summary.length <= maxLength) return summary;
  return `${summary.slice(0, maxLength - 1).trimEnd()}…`;
}

function formatDuration(durationMs: number): string {
  const totalSeconds = Math.max(1, Math.round(durationMs / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;

  const totalMinutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (totalMinutes < 60) return `${totalMinutes}m ${seconds}s`;

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${minutes}m`;
}

function formatTokens(tokens: number): string {
  if (tokens < 1_000) return String(tokens);
  if (tokens < 1_000_000) return `${(tokens / 1_000).toFixed(tokens < 10_000 ? 1 : 0)}k`;
  return `${(tokens / 1_000_000).toFixed(1)}m`;
}

function formatCost(cost: number): string {
  return cost < 0.01 ? `$${cost.toFixed(4)}` : `$${cost.toFixed(2)}`;
}

function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

function notifyOSC777(title: string, body: string): void {
  process.stdout.write(`\x1b]777;notify;${cleanText(title)};${cleanText(body)}\x07`);
}

function notifyOSC99(title: string, body: string): void {
  process.stdout.write(`\x1b]99;i=1:d=0;${cleanText(title)}\x1b\\`);
  process.stdout.write(`\x1b]99;i=1:p=body;${cleanText(body)}\x1b\\`);
}

function notifyLinux(title: string, body: string): void {
  execFile('notify-send', [title, body], () => {});
}

function sendNativeNotification(title: string, body: string): void {
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

type RunOutcome = 'completed' | 'failed' | 'cancelled' | 'truncated';

interface RunState {
  startedAt: number;
  task?: string;
  turns: number;
  toolCalls: number;
  toolErrors: number;
  totalTokens: number;
  totalCost: number;
  outcome: RunOutcome;
  errorMessage?: string;
}

function createRunState(task?: string): RunState {
  return {
    startedAt: Date.now(),
    task: task ? summarizeText(task) : undefined,
    turns: 0,
    toolCalls: 0,
    toolErrors: 0,
    totalTokens: 0,
    totalCost: 0,
    outcome: 'completed',
  };
}

function notificationHeading(outcome: RunOutcome, hasToolErrors: boolean): string {
  if (outcome === 'failed') return '❌ Pi failed';
  if (outcome === 'cancelled') return '⛔ Pi cancelled';
  if (outcome === 'truncated') return '⚠️ Pi stopped early';
  if (hasToolErrors) return '⚠️ Pi finished with warnings';
  return '✅ Pi finished';
}

export default function projectFinishNotify(pi: ExtensionAPI) {
  let run: RunState | undefined;

  pi.on('before_agent_start', (event) => {
    run ??= createRunState(event.prompt);
  });

  pi.on('agent_start', () => {
    run ??= createRunState();
  });

  pi.on('turn_end', (event) => {
    run ??= createRunState();
    run.turns += 1;

    if (event.message.role === 'assistant') {
      run.totalTokens += event.message.usage.totalTokens;
      run.totalCost += event.message.usage.cost.total;
    }
  });

  pi.on('tool_execution_end', (event) => {
    run ??= createRunState();
    run.toolCalls += 1;
    if (event.isError) run.toolErrors += 1;
  });

  pi.on('agent_end', (event) => {
    run ??= createRunState();

    const finalAssistant = [...event.messages]
      .reverse()
      .find((message) => message.role === 'assistant');

    if (!finalAssistant || finalAssistant.role !== 'assistant') return;

    run.errorMessage = finalAssistant.errorMessage
      ? summarizeText(finalAssistant.errorMessage, 120)
      : undefined;

    if (finalAssistant.stopReason === 'error') run.outcome = 'failed';
    else if (finalAssistant.stopReason === 'aborted') run.outcome = 'cancelled';
    else if (finalAssistant.stopReason === 'length') run.outcome = 'truncated';
    else run.outcome = 'completed';
  });

  pi.on('agent_settled', (_event, ctx) => {
    if (!run) return;

    const completedRun = run;
    run = undefined;

    const projectName = basename(ctx.cwd) || ctx.cwd;
    const modelText = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined;
    const sessionName = pi.getSessionName();
    const task = sessionName ? summarizeText(sessionName) : completedRun.task;
    const title = `${notificationHeading(completedRun.outcome, completedRun.toolErrors > 0)} · ${projectName}`;

    const activity = [
      formatDuration(Date.now() - completedRun.startedAt),
      plural(completedRun.turns, 'turn'),
      plural(completedRun.toolCalls, 'tool call'),
    ];
    if (completedRun.toolErrors > 0) {
      activity.push(plural(completedRun.toolErrors, 'tool error'));
    }

    const body = [
      task ? `Task: ${task}` : undefined,
      completedRun.errorMessage ? `Error: ${completedRun.errorMessage}` : undefined,
      activity.join(' · '),
      modelText ? `Model: ${modelText}` : undefined,
      completedRun.totalTokens > 0
        ? `Usage: ${formatTokens(completedRun.totalTokens)} tokens${
            completedRun.totalCost > 0 ? ` · ${formatCost(completedRun.totalCost)}` : ''
          }`
        : undefined,
      `Path: ${ctx.cwd}`,
    ]
      .filter((line): line is string => Boolean(line))
      .join('\n');

    sendNativeNotification(title, body);
  });
}
