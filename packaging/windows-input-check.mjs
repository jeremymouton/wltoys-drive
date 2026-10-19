import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";

export async function checkWindowsInput(app, home, env) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const dir = path.join(home, "native focus check"); fs.mkdirSync(dir);
  const fixture = path.join(dir, "mpv.exe");
  const build = spawnSync("gcc", [path.join(here, "windows-input-fixture.c"), "-O2", "-o", fixture, "-luser32"], { encoding: "utf8" });
  if (build.error || build.status) throw Error(build.error?.message || build.stderr);
  const helper = spawn(path.join(app, "bin/input-helper.exe"), ["--keyboard"], { env });
  let keys = "", errors = "";
  helper.stdout.on("data", (b) => keys += b); helper.stderr.on("data", (b) => errors += b);
  const player = spawn(fixture, [], { env });
  let message = ""; player.stdout.on("data", (b) => message += b);
  const timeout = setTimeout(() => { player.kill(); helper.kill(); }, 10000);
  try {
    const [code] = await once(player, "exit");
    if (code !== 0) throw Error(`Native keyboard window check failed: ${message} ${errors}`);
    const lines = keys.trim().split(/\r?\n/);
    const combined = lines.findIndex((s) => s === "KEYS w d");
    const released = lines.findIndex((s, i) => i > combined && s === "KEYS -");
    const forward = lines.findIndex((s, i) => i > released && s === "KEYS w");
    if (combined < 0 || released <= combined || forward <= released || !lines.slice(-5).every((s) => s === "KEYS -")) throw Error(`Native keyboard combine/release/focus check failed: ${keys} ${errors}`);
    console.log("PASS Windows native keyboard: combined keys, release and focus-loss neutral");
  } finally { clearTimeout(timeout); helper.kill(); player.kill(); }
}
