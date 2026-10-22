import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { compiler } from "./compiler.mjs";

export async function checkWindowsInput(app, home, env) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const dir = path.join(home, "native focus check"); fs.mkdirSync(dir);
  const bin = path.join(dir, "bin"); fs.mkdirSync(bin);
  const fixture = path.join(bin, "mpv.exe");
  const build = spawnSync(compiler, [path.join(here, "windows-input-fixture.c"), "-O2", "-o", fixture, "-luser32"], { encoding: "utf8" });
  if (build.error || build.status) throw Error(build.error?.message || build.stderr);
  fs.copyFileSync(path.join(app, "bin/input-helper.exe"), path.join(bin, "input-helper.exe"));
  fs.copyFileSync(path.join(app, "wltoys-drive.ico"), path.join(dir, "wltoys-drive.ico"));
  const helper = spawn(path.join(bin, "input-helper.exe"), ["--keyboard"], { env });
  const helperClosed = once(helper, "close");
  let keys = "", errors = "";
  helper.stdout.on("data", (b) => keys += b); helper.stderr.on("data", (b) => errors += b);
  const player = spawn(fixture, [], { env });
  const playerClosed = once(player, "close");
  let message = ""; player.stdout.on("data", (b) => message += b);
  const timeout = setTimeout(() => { player.kill(); helper.kill(); }, 15000);
  try {
    const [code] = await playerClosed;
    if (code !== 0) throw Error(`Native keyboard window check failed: ${message} ${errors}`);
    const lines = keys.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const combined = lines.findIndex((s) => s === "KEYS w d");
    const released = lines.findIndex((s, i) => i > combined && s === "KEYS -");
    const forward = lines.findIndex((s, i) => i > released && s === "KEYS w");
    if (combined < 0 || released <= combined || forward <= released || !lines.slice(-5).every((s) => s === "KEYS -")) throw Error(`Native keyboard combine/release/focus check failed: ${JSON.stringify({ combined, released, forward, tail: lines.slice(-5) })}\nFixture: ${message}\n${keys} ${errors}`);
    if (!lines.includes("UI DOWN") || !lines.includes("UI SELECT") || !lines.some((s) => s.startsWith("UI CLICK "))) throw Error(`Native picker input failed: ${keys}`);
    if (!message.includes("PASS window icons")) throw Error(`Native window icon missing: ${message}`);
    console.log("PASS Windows native keyboard: combined keys, picker navigation/click, release, focus-loss neutral and window icons");
  } finally {
    clearTimeout(timeout); helper.kill(); player.kill();
    await Promise.allSettled([helperClosed, playerClosed]);
  }
}
