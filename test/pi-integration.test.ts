import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";

process.env.PI_OFFLINE = "1";
process.env.PI_TELEMETRY = "0";

test("Pi loads the extension, routes tools, blocks shells, and reloads", async () => {
  const workspace = mkdtempSync(join(tmpdir(), "pi niubash 中文-"));
  const agentDir = join(workspace, "agent");
  const settingsManager = SettingsManager.inMemory({
    defaultTools: ["read", "bash", "powershell", "edit", "write"],
    shellPath: "Z:/must-not-run/bash.exe",
  });
  const resourceLoader = new DefaultResourceLoader({
    cwd: workspace,
    agentDir,
    settingsManager,
    additionalExtensionPaths: [resolve("src/index.ts")],
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
  });
  await resourceLoader.reload();
  assert.deepEqual(resourceLoader.getExtensions().errors, []);
  const { session } = await createAgentSession({
    cwd: workspace,
    agentDir,
    settingsManager,
    resourceLoader,
    sessionManager: SessionManager.inMemory(workspace),
  });
  try {
    await session.bindExtensions({
      mode: "print",
      onError: (error) => { throw new Error(JSON.stringify(error)); },
    });
    assert.ok(session.getActiveToolNames().includes("bash"));
    assert.ok(session.getActiveToolNames().includes("read"));
    assert.ok(!session.getActiveToolNames().includes("powershell"));
    assert.match(session.systemPrompt, /Niubash/);

    // A persisted local assistant message supplies the Pi tool pipeline's issuer context.
    // No provider request is made by this test.
    const issuer: any = {
      role: "assistant", content: [], api: "openai-completions", provider: "test",
      model: "local-test", stopReason: "stop", timestamp: Date.now(),
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    };
    session.sessionManager.appendMessage(issuer);
    session.agent.state.messages.push(issuer);
    const execute = (command: string, timeout?: number, signal?: AbortSignal) =>
      session.extensionRunner.createToolContext("test-parent", signal)
        .executeTool("bash", { command, ...(timeout ? { timeout } : {}) });

    const quoted = await execute("TASK_VALUE='中文 with spaces'\nprintf '%s\\n' \"$TASK_VALUE\"\npwd\nprintf '%s' \"$PI_SESSION_ID\"");
    assert.equal(quoted.isError, false, JSON.stringify(quoted));
    const text = JSON.stringify(quoted);
    assert.match(text, /中文 with spaces/);
    assert.ok(text.includes(session.sessionId));
    assert.match(text, /pi niubash 中文/);
    assert.match(text, /exit_code/);

    const nonzero = await execute("printf error-output >&2\nexit 17");
    assert.equal(nonzero.isError, true);
    assert.match(JSON.stringify(nonzero), /error-output/);
    assert.match(JSON.stringify(nonzero), /\"exit_code\":17/);

    const updates: unknown[] = [];
    const large = await session.extensionRunner.createToolContext("large-parent", undefined)
      .executeTool("bash", { command: "node -e 'console.log(\"a\".repeat(70000))'" }, {
        onUpdate: (update) => updates.push(update),
      });
    assert.equal(large.isError, false);
    assert.ok(updates.length > 0);
    const serialized = JSON.stringify(large);
    assert.match(serialized, /fullOutputPath/);
    const result = (large as any).result ?? large;
    assert.ok(result.details.fullOutputPath);
    assert.ok(readFileSync(result.details.fullOutputPath, "utf8").length >= 70000);
    rmSync(result.details.fullOutputPath, { force: true });

    const timedOut = await execute("node -e 'setTimeout(() => {}, 10000)'", 0.15);
    assert.equal(timedOut.isError, true);
    assert.match(JSON.stringify(timedOut), /timed out/);

    const controller = new AbortController();
    const pending = execute("node -e 'setTimeout(() => {}, 10000)'", undefined, controller.signal);
    const abortTimer = setTimeout(() => controller.abort(), 150);
    const cancelled = await pending;
    clearTimeout(abortTimer);
    assert.equal(cancelled.isError, true);
    assert.match(JSON.stringify(cancelled), /aborted/);

    session.setActiveToolsByName([...session.getActiveToolNames(), "powershell"]);
    const blocked = await session.extensionRunner.createToolContext("blocked-parent", undefined)
      .executeTool("powershell", { command: "Write-Output should-not-run" });
    assert.equal(blocked.isError, true);
    assert.match(JSON.stringify(blocked), /disabled/);
    for (const toolName of ["cmd", "pwsh"]) {
      const gate = await session.extensionRunner.emitToolCall({
        type: "tool_call", toolCallId: "gate/1", parentToolCallId: "gate",
        toolName, input: { command: "should-not-run" },
      });
      assert.equal(gate?.block, true);
    }

    const user = await session.extensionRunner.emitUserBash({
      type: "user_bash", command: "niu --version", cwd: workspace, excludeFromContext: true,
    });
    assert.ok(user?.operations);
    const userResult = await session.executeBash("niu --version", undefined, { operations: user!.operations });
    assert.equal(userResult.exitCode, 0);
    assert.match(userResult.output, /Niubash/);

    await session.reload();
    assert.ok(!session.getActiveToolNames().includes("powershell"));
    const reloaded = await execute("printf reload-ok");
    assert.equal(reloaded.isError, false);
    assert.match(JSON.stringify(reloaded), /reload-ok/);
  } finally {
    session.dispose();
    rmSync(workspace, { recursive: true, force: true });
  }
});
