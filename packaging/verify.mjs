import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { smoke } from "./smoke.mjs";
import { checkWindowsInput } from "./windows-input-check.mjs";
import { checkStartup } from "./startup-check.mjs";
import { binaryArchitecture, peResourceTypes } from "./binary.mjs";

const archive = path.resolve(process.argv[2] || "");
if (!fs.statSync(archive).isFile()) throw Error("Pass a built platform archive");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "wltoys package 'check' "));
const run = (cmd, args, options = {}) => {
  const r = spawnSync(cmd, args, { encoding: "utf8", timeout: 60000, maxBuffer: 8 * 1024 * 1024, ...options });
  if (r.error || r.status !== 0) throw Error(`${cmd} (exit ${r.status}, signal ${r.signal}): ${r.error?.message || r.stderr || r.stdout}`);
  return r.stdout;
};
let failure;
try {
  run(process.platform === "darwin" ? "ditto" : process.platform === "win32" ? path.join(process.env.SystemRoot, "System32/tar.exe") : "tar", process.platform === "darwin" ? ["-x", "-k", archive, temp] : ["-xf", archive, "-C", temp]);
  console.log("Extracted package");
  const top = path.join(temp, fs.readdirSync(temp).find((s) => s !== "__MACOSX"));
  const app = process.platform === "darwin" ? path.join(top, "Contents/Resources") : top;
  const manifest = JSON.parse(fs.readFileSync(path.join(app, "build.json")));
  const target = `${{ darwin: "macos", linux: "linux", win32: "windows" }[process.platform]}-${process.arch}`;
  if (manifest.target !== target) throw Error(`Archive target ${manifest.target} does not match native runner ${target}`);
  if (process.platform !== "darwin") {
    const native = process.platform === "win32"
      ? [path.join(top, "WLtoys Drive.exe"), ...fs.readdirSync(path.join(app, "bin")).filter((file) => /\.(exe|dll)$/i.test(file)).map((file) => path.join(app, "bin", file))]
      : [path.join(app, "bin/node"), path.join(app, "bin/mpv.bin"), ...fs.readdirSync(path.join(app, "lib")).map((file) => path.join(app, "lib", file))];
    for (const file of native) {
      const arch = binaryArchitecture(fs.readFileSync(file));
      if (arch !== process.arch) throw Error(`Wrong binary architecture: ${file} is ${arch}, expected ${process.arch}`);
    }
    console.log(`PASS ${target}: ${native.length} native binaries match ${process.arch}`);
  }
  if (!manifest.dependencies.length) throw Error("No bundled dependency provenance");
  for (const entry of ["drive.mjs", "runtime.mjs", "wifi/connect.mjs", "wifi/windows.mjs", "wltoys-drive.png", "licenses/Node-LICENSE", "licenses/mpv-GPL", "licenses/SOURCES.txt"]) {
    if (!fs.statSync(path.join(app, entry)).isFile()) throw Error(`Package missing ${entry}`);
  }
  const node = path.join(app, "bin", process.platform === "win32" ? "node.exe" : "node");
  const mpv = path.join(app, "bin", process.platform === "win32" ? "mpv.exe" : "mpv");
  const home = path.join(temp, "test home"); fs.mkdirSync(home);
  const env = { ...process.env, HOME: home, USERPROFILE: home, TMPDIR: home, TMP: home, TEMP: home, NO_AUTOCONNECT: "1", PATH: process.platform === "win32" ? `${process.env.SystemRoot}\\System32;${process.env.SystemRoot}` : "/usr/bin:/bin:/usr/sbin:/sbin" };
  if (process.platform === "darwin") {
    run("codesign", ["--verify", "--deep", "--strict", top]);
    for (const bundle of [top, path.join(app, "Player.app")]) {
      const icon = run("/usr/libexec/PlistBuddy", ["-c", "Print :CFBundleIconFile", path.join(bundle, "Contents/Info.plist")]).trim();
      if (!fs.statSync(path.join(bundle, "Contents/Resources", icon)).isFile()) throw Error("Mac app icon missing");
    }
    if (fs.existsSync(path.join(app, "keyboard-helper")) || manifest.macKeyboardInput !== "window-local") throw Error("Mac global keyboard helper must not ship");
    if (!fs.existsSync(path.join(app, "Player.app/Contents/MacOS/wltoys-player"))) throw Error("Native Mac player missing");
    const keyboard = run(path.join(app, "Player.app/Contents/MacOS/wltoys-player"), ["--input-selftest"], { env });
    if (!keyboard.includes("PASS window-local") || !keyboard.includes("UI UP") || !keyboard.includes("UI SELECT") || (keyboard.match(/^HUD$/gm) || []).length !== 1 || (keyboard.match(/^REC$/gm) || []).length !== 1) throw Error("Mac local input regression check failed");
    for (const file of [mpv, ...fs.readdirSync(path.join(app, "lib")).map((s) => path.join(app, "lib", s))]) {
      if (/\/(opt\/homebrew|usr\/local)\//.test(run("otool", ["-L", file]))) throw Error(`Host library leak: ${file}`);
    }
  }
  if (!run(node, ["--version"], { env }).includes(manifest.node)) throw Error("Wrong Node runtime version");
  if (run(node, ["-p", "process.platform + '-' + process.arch"], { env }).trim() !== `${process.platform}-${process.arch}`) throw Error("Bundled Node architecture does not match native runner");
  const launch = process.platform === "darwin" ? path.join(top, "Contents/MacOS/wltoys-drive") : process.platform === "linux" ? path.join(top, "wltoys-drive") : path.join(top, "WLtoys Drive.exe");
  const args = ["--selftest"];
  console.log("Checking launcher self-test");
  let checks = run(launch, args, { env, cwd: home });
  if (process.platform === "win32") checks = fs.readFileSync(path.join(home, "wltoys-drive.log"), "utf8");
  if (checks.includes("FAIL") || !checks.includes("checksum")) throw Error("Packaged self-test failed");
  if (process.platform === "linux") {
    run(node, [path.join(app, "desktop-shortcut.mjs")], { env, cwd: home });
    const desktop = fs.readFileSync(path.join(home, ".local/share/applications/wltoys-drive.desktop"), "utf8");
    if (!desktop.includes("Name=WLtoys Drive") || !desktop.includes(`Icon=${path.join(app, "wltoys-drive.png")}`)) throw Error("Desktop shortcut or its icon missing");
  }
  if (process.platform === "win32") {
    const resources = peResourceTypes(fs.readFileSync(launch));
    if (!resources.has(3) || !resources.has(14)) throw Error("Windows executable icon resources missing");
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
  console.log("Checking visible discovery, automatic connection and car picker");
  await checkStartup({ app, node, mpv, env, home });
  if (process.platform === "win32") await checkWindowsInput(app, home, env);
  console.log(`PASS ${manifest.target}: extracted launch, runtime, player, HUD, UDP video/control, failsafes and notices`);
  if (process.env.KEEP_PACKAGE_CHECK) console.log(`Extracted package: ${top}`);
} catch (error) {
  failure = error;
  throw error;
} finally {
  if (!process.env.KEEP_PACKAGE_CHECK) {
    try { await fs.promises.rm(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); }
    catch (error) {
      if (!failure) throw error;
      console.error(`Could not remove test directory ${temp}: ${error.message}`);
    }
  }
}
