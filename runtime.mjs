import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const APP_DIR = path.dirname(fileURLToPath(import.meta.url));
export const BIN_DIR = path.join(APP_DIR, "bin");
export const SESSION_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "wltoys-"));
process.once("exit", () => {
  try { fs.rmSync(SESSION_DIR, { recursive: true, force: true }); } catch {}
});

export function findTool(name) {
  if (name === "mpv" && process.env.MPV_BIN) return process.env.MPV_BIN;
  const filename = process.platform === "win32" ? `${name}.exe` : name;
  for (const dir of [BIN_DIR, ...(name === "input-helper" ? [path.join(APP_DIR, "gamepad")] : []), ...(process.env.PATH || "").split(path.delimiter)]) {
    if (!dir) continue;
    const candidate = path.join(dir, filename);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {}
  }
  return null;
}

export function luaString(value) {
  return '"' + String(value).replace(/[\\"\x00-\x1f\x7f]/g, (c) => {
    if (c === "\\" || c === '"') return "\\" + c;
    return "\\" + String(c.charCodeAt(0)).padStart(3, "0");
  }) + '"';
}
