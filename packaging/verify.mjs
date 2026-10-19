import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { smoke } from "./smoke.mjs";
import { checkWindowsInput } from "./windows-input-check.mjs";

const archive = path.resolve(process.argv[2] || "");
if (!fs.statSync(archive).isFile()) throw Error("Pass a built platform archive");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "wltoys package 'check' "));
const run = (cmd, args, options = {}) => {
  const r = spawnSync(cmd, args, { encoding: "utf8", timeout: 60000, maxBuffer: 8 * 1024 * 1024, ...options });
  if (r.error || r.status !== 0) throw Error(`${cmd} (exit ${r.status}, signal ${r.signal}): ${r.error?.message || r.stderr || r.stdout}`);
  return r.stdout;
};
try {
  run(process.platform === "darwin" ? "ditto" : process.platform === "win32" ? path.join(process.env.SystemRoot, "System32/tar.exe") : "tar", process.platform === "darwin" ? ["-x", "-k", archive, temp] : ["-xf", archive, "-C", temp]);
  console.log("Extracted package");
  const top = path.join(temp, fs.readdirSync(temp).find((s) => s !== "__MACOSX"));
  const app = process.platform === "darwin" ? path.join(top, "Contents/Resources") : top;
  const manifest = JSON.parse(fs.readFileSync(path.join(app, "build.json")));
  if (!manifest.dependencies.length) throw Error("No bundled dependency provenance");
  for (const entry of ["drive.mjs", "runtime.mjs", "wifi/connect.mjs", "wifi/windows.mjs", "licenses/Node-LICENSE", "licenses/mpv-GPL", "licenses/SOURCES.txt"]) {
    if (!fs.statSync(path.join(app, entry)).isFile()) throw Error(`Package missing ${entry}`);
  }
  const node = path.join(app, "bin", process.platform === "win32" ? "node.exe" : "node");
  const mpv = path.join(app, "bin", process.platform === "win32" ? "mpv.exe" : "mpv");
  const home = path.join(temp, "test home"); fs.mkdirSync(home);
  const env = { ...process.env, HOME: home, USERPROFILE: home, TMPDIR: home, TMP: home, TEMP: home, NO_AUTOCONNECT: "1", PATH: process.platform === "win32" ? `${process.env.SystemRoot}\\System32;${process.env.SystemRoot}` : "/usr/bin:/bin:/usr/sbin:/sbin" };
  if (process.platform === "darwin") {
    run("codesign", ["--verify", "--deep", "--strict", top]);
    for (const file of [mpv, ...fs.readdirSync(path.join(app, "lib")).map((s) => path.join(app, "lib", s))]) {
      if (/\/(opt\/homebrew|usr\/local)\//.test(run("otool", ["-L", file]))) throw Error(`Host library leak: ${file}`);
    }
  }
  if (!run(node, ["--version"], { env }).includes(manifest.node)) throw Error("Wrong Node runtime version");
  const launch = process.platform === "darwin" ? path.join(top, "Contents/MacOS/wltoys-drive") : process.platform === "linux" ? path.join(top, "wltoys-drive") : path.join(top, "WLtoys Drive.exe");
  const args = ["--selftest"];
  console.log("Checking launcher self-test");
  let checks = run(launch, args, { env, cwd: home });
  if (process.platform === "win32") checks = fs.readFileSync(path.join(home, "wltoys-drive.log"), "utf8");
  if (checks.includes("FAIL") || !checks.includes("checksum")) throw Error("Packaged self-test failed");
  if (process.platform === "linux") {
    run(node, [path.join(app, "desktop-shortcut.mjs")], { env, cwd: home });
    if (!fs.readFileSync(path.join(home, ".local/share/applications/wltoys-drive.desktop"), "utf8").includes("Name=WLtoys Drive")) throw Error("Desktop shortcut missing");
  }
  console.log("Checking bundled mpv decode");
  const playback = run(mpv, ["--terminal=yes", "--no-config", "--vo=null", "--ao=null", "--frames=4", "av://lavfi:testsrc2=size=128x72:rate=25"], { env, cwd: home });
  if (!playback.includes("VO:")) throw Error("Bundled mpv did not decode video");
  if (process.platform === "win32") {
    const helper = path.join(app, "bin/input-helper.exe");
    const probe = spawnSync(helper, ["--wifi-join", "invalid<profile>"], { env, timeout: 5000 });
    if (probe.error || probe.status === 0) throw Error("Windows helper failed invalid-profile check");
  }
  console.log("Checking app UDP/input/video integration");
  await smoke({ app, node, mpv, env, home });
  if (process.platform === "win32") await checkWindowsInput(app, home, env);
  console.log(`PASS ${manifest.target}: extracted launch, runtime, player, HUD, UDP video/control, failsafes and notices`);
  if (process.env.KEEP_PACKAGE_CHECK) console.log(`Extracted package: ${top}`);
} finally {
  if (!process.env.KEEP_PACKAGE_CHECK) fs.rmSync(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
