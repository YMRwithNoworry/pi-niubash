import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createBashToolDefinition } from "@earendil-works/pi-coding-agent";
import {
  createNiubashOperations,
  findNiubashPath,
  verifyNiubash,
} from "./niubash.ts";

const DISABLED_SHELL_TOOLS = new Set(["powershell", "pwsh", "cmd"]);
const NIUBASH_GUIDELINES = [
  "This shell runs Niubash, not GNU Bash, PowerShell, or cmd. Write commands directly; do not prefix them with `niu -c`.",
  "Use Niubash-compatible syntax and native Windows paths. Non-interactive commands do not load the interactive Niubash rc file.",
];

export default function (pi: ExtensionAPI) {
  let operationsPromise: Promise<ReturnType<typeof resolveOperations>> | undefined;

  pi.registerFlag("niubash-path", {
    description: "Path to the Niubash executable",
    type: "string",
  });

  function resolveOperations() {
    const flagPath = pi.getFlag("niubash-path");
    const path = findNiubashPath(
      process.env,
      typeof flagPath === "string" ? flagPath : undefined,
    );
    verifyNiubash(path);
    return createNiubashOperations(path);
  }

  function getOperations() {
    operationsPromise ??= Promise.resolve().then(resolveOperations);
    return operationsPromise;
  }

  function removeOtherShellTools() {
    const activeTools = pi.getActiveTools();
    const filtered = activeTools.filter((name) => !DISABLED_SHELL_TOOLS.has(name));
    if (filtered.length !== activeTools.length) pi.setActiveTools(filtered);
  }

  const bash = createBashToolDefinition(process.cwd());
  pi.registerTool({
    ...bash,
    label: "niubash",
    description: `${bash.description.replace("Execute a bash command", "Execute a Niubash command")} This tool runs Niubash, not GNU Bash, PowerShell, or cmd.`,
    promptSnippet: "Execute Niubash commands (native Windows command environment)",
    promptGuidelines: [...(bash.promptGuidelines ?? []), ...NIUBASH_GUIDELINES],
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const operations = await getOperations();
      return createBashToolDefinition(ctx.cwd, { operations }).execute(
        toolCallId,
        params,
        signal,
        onUpdate,
        ctx,
      );
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    removeOtherShellTools();
    try {
      await getOperations();
      ctx.ui.notify("Pi shell commands are routed through Niubash.", "info");
    } catch (error) {
      ctx.ui.notify(
        error instanceof Error ? error.message : String(error),
        "error",
      );
    }
  });

  pi.on("before_agent_start", () => {
    removeOtherShellTools();
  });

  pi.on("tool_call", (event) => {
    if (!DISABLED_SHELL_TOOLS.has(event.toolName)) return;
    return {
      block: true,
      reason: `The ${event.toolName} shell tool is disabled. Use the Niubash-backed bash tool instead.`,
    };
  });

  pi.on("user_bash", async () => ({ operations: await getOperations() }));
}
