import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { RpcClient } from "@earendil-works/pi-coding-agent";
import { findNiubashPath } from "../src/niubash.ts";

const extensionPath = resolve(process.env.PI_NIUBASH_TEST_EXTENSION ?? "src/index.ts");
const cliPath = resolve("node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js");
const args = [
  "--no-session", "--offline", "--no-extensions", "--no-skills",
  "--no-prompt-templates", "--no-themes", "--no-context-files", "-e", extensionPath,
];

test("real Pi RPC uses Niubash despite an invalid default shell", async () => {
  const workspace = mkdtempSync(join(tmpdir(), "pi-niubash-rpc-"));
  writeFileSync(join(workspace, "settings.json"), JSON.stringify({
    shellPath: "Z:/must-not-run/bash.exe", shellCommandPrefix: "printf prefix-ok",
  }));
  const client = new RpcClient({
    cliPath, cwd: workspace, args: [...args, "--niubash-path", findNiubashPath()],
    env: {
      PI_CODING_AGENT_DIR: workspace, PI_TELEMETRY: "0", PI_OFFLINE: "1",
      PI_NIUBASH_PATH: "Z:/cli-override-must-win/niu.exe",
    },
  });
  const errors: unknown[] = [];
  client.onEvent((event: any) => {
    if (event.type === "extension_error") errors.push(event);
  });
  try {
    await client.start();
    const result = await client.bash("niu --version");
    assert.equal(result.exitCode, 0, result.output);
    assert.match(result.output, /Niubash/);
    assert.match(result.output, /prefix-ok/);
    assert.deepEqual(errors, []);
  } finally {
    await client.stop();
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("missing Niubash blocks RPC instead of falling through to default shell", async () => {
  const workspace = mkdtempSync(join(tmpdir(), "pi-niubash-missing-"));
  const client = new RpcClient({
    cliPath, cwd: workspace, args,
    env: {
      PI_CODING_AGENT_DIR: workspace, PI_TELEMETRY: "0", PI_OFFLINE: "1",
      PI_NIUBASH_PATH: "Z:/missing/niu.exe",
    },
  });
  try {
    await client.start();
    await assert.rejects(client.bash("printf should-not-run"), /existing Niubash executable/);
  } finally {
    await client.stop();
    rmSync(workspace, { recursive: true, force: true });
  }
});
