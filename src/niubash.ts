import { existsSync, statSync } from "node:fs";
import { delimiter, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import {
  createLocalBashOperations,
  type BashOperations,
} from "@earendil-works/pi-coding-agent";

export const NIU_ENV_PATH = "PI_NIUBASH_PATH";

export function findNiubashPath(
  env: NodeJS.ProcessEnv = process.env,
  cliPath?: string,
): string {
  const configured = cliPath?.trim() || env[NIU_ENV_PATH]?.trim();
  if (configured) {
    const candidate = resolve(configured);
    if (!isExecutableFile(candidate)) {
      throw new Error(
        `${NIU_ENV_PATH} must point to an existing Niubash executable: ${candidate}`,
      );
    }
    return candidate;
  }

  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === "path");
  const pathValue = pathKey ? env[pathKey] ?? "" : "";
  for (const entry of pathValue.split(delimiter).filter(Boolean)) {
    const directory = entry.replace(/^"(.*)"$/, "$1");
    const candidate = join(directory, process.platform === "win32" ? "niu.exe" : "niu");
    if (isExecutableFile(candidate)) return resolve(candidate);
  }

  throw new Error(
    `Niubash was not found on PATH. Install Niubash and ensure niu.exe is available, or set ${NIU_ENV_PATH} to its full path. No shell fallback is used.`,
  );
}

function isExecutableFile(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isFile();
  } catch {
    return false;
  }
}

export function verifyNiubash(path: string): void {
  const result = spawnSync(path, ["--version"], {
    encoding: "utf8",
    timeout: 5000,
    windowsHide: true,
  });
  if (result.error) {
    throw new Error(`Could not start Niubash at ${path}: ${result.error.message}`);
  }
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  if (result.status !== 0 || !/^Niubash\b/m.test(output)) {
    throw new Error(
      `${path} did not identify itself as Niubash. Set ${NIU_ENV_PATH} to the Niubash executable. No shell fallback is used.`,
    );
  }
}

export function createNiubashOperations(path: string): BashOperations {
  return createLocalBashOperations({ shellPath: path });
}
