import assert from "node:assert/strict";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import extension from "../src/index.ts";
import {
  createNiubashOperations,
  findNiubashPath,
  verifyNiubash,
} from "../src/niubash.ts";

const niuPath = findNiubashPath(process.env);

test("finds Niubash from PATH and accepts an explicit path with spaces", () => {
  assert.equal(findNiubashPath({ PATH: dirname(niuPath) }), niuPath);
  assert.equal(findNiubashPath({}, niuPath), niuPath);
});

test("rejects a missing configured executable without fallback", () => {
  assert.throws(
    () => findNiubashPath({ PI_NIUBASH_PATH: "Z:/missing/niu.exe" }),
    /must point to an existing Niubash executable/,
  );
});

test("path overrides take precedence and handle quoted mixed-case PATH entries", () => {
  assert.equal(findNiubashPath({ PI_NIUBASH_PATH: "Z:/missing/niu.exe" }, niuPath), niuPath);
  assert.equal(findNiubashPath({ pAtH: `"${dirname(niuPath)}"` }), niuPath);
  assert.throws(() => findNiubashPath({ PATH: "" }), /No shell fallback/);
  const fixture = mkdtempSync(join(tmpdir(), "niubash 中文 path-"));
  try {
    const executable = join(fixture, "niu.exe");
    copyFileSync(niuPath, executable);
    assert.equal(findNiubashPath({}, executable), executable);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("rejects a different executable and an unstartable path", () => {
  assert.throws(() => verifyNiubash(process.execPath), /did not identify itself as Niubash/);
  assert.throws(() => verifyNiubash("Z:/missing/niu.exe"), /Could not start Niubash/);
});

test("verifies the real Niubash executable", () => {
  assert.doesNotThrow(() => verifyNiubash(niuPath));
});

test("executes raw commands through Niubash operations", async () => {
  const operations = createNiubashOperations(niuPath);
  let output = "";
  const result = await operations.exec(
    "printf 'niubash-ok\\n'; printf 'stderr-ok\\n' >&2",
    process.cwd(),
    {
      onData: (data) => {
        output += data.toString();
      },
      env: { ...process.env, PI_NIUBASH_TEST: "yes" },
    },
  );
  assert.equal(result.exitCode, 0);
  assert.match(output, /niubash-ok/);
  assert.match(output, /stderr-ok/);
});

test("preserves non-zero Niubash exit codes", async () => {
  const operations = createNiubashOperations(niuPath);
  const result = await operations.exec("exit 23", process.cwd(), {
    onData: () => {},
  });
  assert.equal(result.exitCode, 23);
});

test("routes user bash and blocks alternate shell tools", async () => {
  const handlers = new Map<string, (...args: any[]) => any>();
  const registered: any[] = [];
  let activeTools = ["bash", "powershell", "read"];
  const pi = {
    registerFlag() {},
    getFlag() {},
    getActiveTools: () => activeTools,
    setActiveTools: (tools: string[]) => {
      activeTools = tools;
    },
    registerTool: (tool: unknown) => registered.push(tool),
    on: (name: string, handler: (...args: any[]) => any) => {
      handlers.set(name, handler);
      return () => {};
    },
  };

  extension(pi as any);
  await handlers.get("session_start")?.({}, { ui: { notify() {} } });

  assert.deepEqual(activeTools, ["bash", "read"]);
  assert.equal(registered.length, 1);
  assert.equal(registered[0].name, "bash");
  assert.equal(registered[0].label, "niubash");

  const userBash = await handlers.get("user_bash")?.();
  assert.ok(userBash?.operations);
  let output = "";
  const result = await userBash.operations.exec("printf route-ok", process.cwd(), {
    onData: (data: Buffer) => {
      output += data.toString();
    },
  });
  assert.equal(result.exitCode, 0);
  assert.equal(output, "route-ok");

  for (const toolName of ["powershell", "pwsh", "cmd"]) {
    const blocked = handlers.get("tool_call")?.({ toolName, parentToolCallId: "parent" });
    assert.equal(blocked.block, true);
    assert.match(blocked.reason, /Niubash-backed bash/);
  }
  assert.equal(handlers.get("tool_call")?.({ toolName: "read" }), undefined);
  activeTools = ["read", "edit", "write", "bash", "cmd", "pwsh"];
  await handlers.get("before_agent_start")?.();
  assert.deepEqual(activeTools, ["read", "edit", "write", "bash"]);
});
