import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const ANTHROPIC_SYSTEM_PROMPT = "You are Claude Code, Anthropic's official CLI for Claude.";

export default function anthropicSystemPrompt(pi: ExtensionAPI) {
	pi.on("before_agent_start", async (_event, ctx) => {
		if (ctx.model?.provider !== "anthropic") {
			return undefined;
		}

		return {
			systemPrompt: ANTHROPIC_SYSTEM_PROMPT,
		};
	});
}
