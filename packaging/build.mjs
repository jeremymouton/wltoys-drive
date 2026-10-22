import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { compiler } from "./compiler.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const platform = { darwin: "macos", linux: "linux", win32: "windows" }[process.platform];
if (!platform || !(process.platform === "darwin" ? ["arm64"] : ["x64", "arm64"]).includes(process.arch)) throw Error("Build on the matching supported OS and architecture");
const target = `${platform}-${process.arch}`;
if (process.env.RELEASE_TARGET && process.env.RELEASE_TARGET !== target) throw Error(`Requested ${process.env.RELEASE_TARGET}, but the native builder is ${target}`);
const deps = JSON.parse(fs.readFileSync(path.join(root, "packaging/dependencies.json")));
const windowsMpv = { ...deps.windowsMpv[process.arch], source: deps.windowsMpv.source };
const version = process.env.RELEASE_VERSION || "0.0.0-dev";
if (!/^[\w.-]+$/.test(version)) throw Error("Invalid release version");
const out = path.resolve(root, "dist");
const work = fs.mkdtempSync(path.join(os.tmpdir(), "wltoys-build-"));
const name = `wltoys-drive-${target}`;
const top = path.join(work, target.startsWith("macos") ? "WLtoys Drive.app" : name);
const app = target.startsWith("macos") ? path.join(top, "Contents/Resources") : top;
const bin = path.join(app, "bin"), licenses = path.join(app, "licenses");
fs.mkdirSync(bin, { recursive: true }); fs.mkdirSync(licenses);
fs.mkdirSync(out, { recursive: true });
const manifest = { version, target, node: deps.node, dependencies: [] };
function run(cmd, args, options = {}) {
  const r = spawnSync(cmd, args, { encoding: "utf8", windowsHide: true, maxBuffer: 32 * 1024 * 1024, ...options });
  if (r.error || r.status !== 0) throw Error(`${cmd} failed: ${r.error?.message || r.stderr || r.stdout}`);
  return r.stdout;
}
async function download(url, file, digest) {
  const response = await fetch(url);
  if (!response.ok) throw Error(`Download ${url}: ${response.status}`);
  const data = Buffer.from(await response.arrayBuffer());
  if (digest && createHash("sha256").update(data).digest("hex") !== digest) throw Error(`Checksum mismatch: ${url}`);
  fs.writeFileSync(file, data); return data;
}
const copy = (a, b) => { fs.mkdirSync(path.dirname(b), { recursive: true }); fs.copyFileSync(a, b); };
const executable = (file) => fs.chmodSync(file, 0o755);
copy(path.join(root, "assets/icons/wltoys-drive.png"), path.join(app, "wltoys-drive.png"));
for (const file of ["drive.mjs", "runtime.mjs", "startup.mjs", "README.md"]) copy(path.join(root, file), path.join(app, file));
fs.mkdirSync(path.join(app, "wifi"));
for (const file of fs.readdirSync(path.join(root, "wifi")).filter((f) => f.endsWith(".mjs"))) copy(path.join(root, "wifi", file), path.join(app, "wifi", file));
const slug = `${process.platform === "win32" ? "win" : process.platform}-${process.arch}`;
const archiveName = `node-v${deps.node}-${slug}.${process.platform === "win32" ? "zip" : "tar.gz"}`;
const base = `https://nodejs.org/dist/v${deps.node}/`;
const sums = await (await fetch(base + "SHASUMS256.txt")).text();
const digest = sums.split("\n").find((s) => s.endsWith("  " + archiveName))?.split(" ")[0];
if (!digest || !/^[a-f0-9]{64}$/.test(digest)) throw Error("Node checksum not found");
const nodeArchive = path.join(work, archiveName);
await download(base + archiveName, nodeArchive, digest);
if (process.platform === "win32") run(path.join(process.env.SystemRoot, "System32/tar.exe"), ["-xf", nodeArchive, "-C", work]);
else run("tar", ["-xzf", nodeArchive, "-C", work]);
const nodeDir = path.join(work, `node-v${deps.node}-${slug}`);
copy(path.join(nodeDir, process.platform === "win32" ? "node.exe" : "bin/node"), path.join(bin, process.platform === "win32" ? "node.exe" : "node"));
copy(path.join(nodeDir, "LICENSE"), path.join(licenses, "Node-LICENSE"));
if (process.platform !== "win32") executable(path.join(bin, "node"));
await download("https://raw.githubusercontent.com/mpv-player/mpv/v0.41.0/Copyright", path.join(licenses, "mpv-Copyright"));
await download("https://raw.githubusercontent.com/mpv-player/mpv/v0.41.0/LICENSE.GPL", path.join(licenses, "mpv-GPL"));

function collectNotices(directory, prefix, depth = 0) {
  if (!fs.existsSync(directory) || depth > 4) return;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory() && !["include", "lib", "bin", "Frameworks"].includes(entry.name)) collectNotices(file, prefix, depth + 1);
    if (entry.isFile() && /^(copying|copyright|licen[sc]e|notice)/i.test(entry.name)) copy(file, path.join(licenses, prefix, path.relative(directory, file)));
  }
}

if (process.platform === "darwin") {
  run("/bin/bash", [path.join(root, "gamepad/build-mac.sh")]);
  copy(path.join(root, "gamepad/gamepad_mac"), path.join(app, "gamepad-helper"));
  executable(path.join(app, "gamepad-helper"));
  manifest.macKeyboardInput = "window-local";
  const libdir = path.join(app, "lib"); fs.mkdirSync(libdir);
  const queued = new Map(), names = new Map(), formulas = new Set();
  function stage(source, destination) {
    const real = fs.realpathSync(source);
    if (queued.has(real)) return queued.get(real);
    if (names.has(path.basename(destination)) && names.get(path.basename(destination)) !== real) throw Error(`Library basename collision: ${destination}`);
    names.set(path.basename(destination), real); queued.set(real, destination);
    copy(real, destination); executable(destination);
    const match = real.match(/\/Cellar\/([^/]+)\/([^/]+)\//);
    if (match) formulas.add(match[1]);
    const deps = run("otool", ["-L", real]).split("\n").slice(1).map((l) => l.trim().split(" (compatibility")[0]).filter(Boolean);
    const rpaths = [...run("otool", ["-l", real]).matchAll(/cmd LC_RPATH\n\s+cmdsize \d+\n\s+path (.*?) \(offset/g)].map((m) => m[1]);
    for (const dep of deps) {
      if (dep === source || dep === real || dep.startsWith("/usr/lib/") || dep.startsWith("/System/Library/")) continue;
      let resolved = dep;
      if (dep.startsWith("@loader_path/")) resolved = path.resolve(path.dirname(real), dep.slice(13));
      if (dep.startsWith("@rpath/")) {
        resolved = rpaths.map((r) => path.resolve(r.replace("@loader_path", path.dirname(real)), dep.slice(7))).find(fs.existsSync);
      }
      if (!resolved || !fs.existsSync(resolved)) throw Error(`Unresolved library: ${real} -> ${dep}`);
      if (fs.realpathSync(resolved) === real) continue;
      const local = stage(resolved, path.join(libdir, path.basename(resolved)));
      const relative = path.relative(path.dirname(destination), local);
      run("install_name_tool", ["-change", dep, `@loader_path/${relative}`, destination]);
    }
    if (destination.endsWith(".dylib")) run("install_name_tool", ["-id", `@loader_path/${path.basename(destination)}`, destination]);
    for (const rpath of rpaths.filter((r) => r.startsWith("/opt/") || r.startsWith("/usr/local/"))) run("install_name_tool", ["-delete_rpath", rpath, destination]);
    run("codesign", ["--force", "--sign", "-", destination]);
    return destination;
  }
  const mpv = run("/usr/bin/which", ["mpv"]).trim(); stage(mpv, path.join(bin, "mpv"));
  const playerBundle = path.join(app, "Player.app");
  fs.mkdirSync(path.join(playerBundle, "Contents/MacOS"), { recursive: true });
  for (const resources of [app, path.join(playerBundle, "Contents/Resources")]) {
    copy(path.join(root, "assets/icons/wltoys-drive.icns"), path.join(resources, "wltoys-drive.icns"));
  }
  stage(path.join(root, "gamepad/player_mac"), path.join(playerBundle, "Contents/MacOS/wltoys-player"));
  console.log(`Bundled mpv and ${queued.size - 1} libraries; collecting dependency metadata`);
  const formulaData = JSON.parse(run("brew", ["info", "--json=v2", ...formulas])).formulae;
  for (const formula of formulas) {
    const data = formulaData.find((f) => f.name === formula || f.full_name === formula);
    manifest.dependencies.push({ name: formula, version: data.installed.map((i) => i.version), license: data.license, source: data.urls, formula: data });
    const cellar = [...queued.keys()].find((f) => f.includes(`/Cellar/${formula}/`)).split(`/Cellar/${formula}/`)[0] + `/Cellar/${formula}`;
    collectNotices(cellar, formula);
  }
  fs.mkdirSync(path.join(top, "Contents/MacOS"), { recursive: true });
  run("clang", ["-O2", "-mmacosx-version-min=14.0", path.join(root, "packaging/macos-launcher.c"), "-o", path.join(top, "Contents/MacOS/wltoys-drive")]);
  const versions = [...queued.values(), path.join(bin, "node"), path.join(app, "gamepad-helper")].map((file) => {
    return run("vtool", ["-show-build", file]).match(/minos (\S+)/)?.[1] || "14.0";
  });
  manifest.minimumMacOS = versions.sort((a, b) => {
    const x = a.split(".").map(Number), y = b.split(".").map(Number);
    for (let i = 0; i < 3; i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d; }
    return 0;
  }).at(-1);
  fs.writeFileSync(path.join(top, "Contents/Info.plist"), fs.readFileSync(path.join(root, "packaging/Info.plist"), "utf8").replace("VERSION", version.replace(/^v/, "")).replace("MIN_OS", manifest.minimumMacOS));
  fs.writeFileSync(path.join(playerBundle, "Contents/Info.plist"), fs.readFileSync(path.join(root, "packaging/Player-Info.plist"), "utf8").replace("MIN_OS", manifest.minimumMacOS));
  run("codesign", ["--force", "--deep", "--sign", "-", playerBundle]);
  for (const file of ["bin/node", "gamepad-helper"]) run("codesign", ["--force", "--sign", "-", path.join(app, file)]);
} else if (process.platform === "linux") {
  const mpv = run("which", ["mpv"]).trim();
  const player = path.join(bin, "mpv.bin"), libdir = path.join(app, "lib");
  copy(mpv, player); executable(player); fs.mkdirSync(libdir);
  const entries = [...run("ldd", [mpv]).matchAll(/=> (\/\S+)/g)].map((m) => m[1]);
  const system = /^(ld-linux|libc\.|libm\.|libpthread\.|libdl\.|librt\.|libresolv\.|libnss_)/;
  const packages = new Set();
  for (const entry of entries.filter((f) => !system.test(path.basename(f)))) {
    copy(fs.realpathSync(entry), path.join(libdir, path.basename(entry)));
    const owner = run("dpkg-query", ["-S", `*/${path.basename(entry)}`]).split("\n")[0].split(": ")[0]; packages.add(owner);
  }
  packages.add("mpv");
  for (const pkg of packages) {
    const fields = run("dpkg-query", ["-W", "-f=${Package}\t${Version}\t${source:Package}\t${source:Version}", pkg]).trim().split("\t");
    manifest.dependencies.push({ name: fields[0], version: fields[1], source: fields.slice(2), sourceRepository: process.arch === "arm64" ? "https://ports.ubuntu.com/ubuntu-ports/pool/" : "https://archive.ubuntu.com/ubuntu/pool/" });
    collectNotices(`/usr/share/doc/${pkg.split(":")[0]}`, pkg.replace(":", "-"));
  }
  fs.writeFileSync(path.join(bin, "mpv"), '#!/bin/sh\nHERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\nexport LD_LIBRARY_PATH="$HERE/../lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"\nexec "$HERE/mpv.bin" "$@"\n');
  executable(path.join(bin, "mpv"));
  fs.writeFileSync(path.join(top, "wltoys-drive"), '#!/bin/sh\nHERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\nif [ "$#" -eq 0 ]; then exec >>"$HOME/wltoys-drive.log" 2>&1; fi\nexec "$HERE/bin/node" "$HERE/drive.mjs" "$@"\n');
  executable(path.join(top, "wltoys-drive"));
  // Desktop files cannot expand their own location; install the user shortcut after extraction.
  fs.writeFileSync(path.join(top, "Install desktop shortcut.sh"), '#!/bin/sh\nset -eu\nHERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\n"$HERE/bin/node" "$HERE/desktop-shortcut.mjs"\n');
  copy(path.join(root, "packaging/desktop-shortcut.mjs"), path.join(top, "desktop-shortcut.mjs"));
  executable(path.join(top, "Install desktop shortcut.sh"));
} else {
  const archive = path.join(work, "mpv.7z");
  await download(windowsMpv.url, archive, windowsMpv.sha256);
  const expanded = path.join(work, "mpv");
  run("7z", ["x", archive, `-o${expanded}`, "-y"]);
  for (const file of fs.readdirSync(expanded).filter((f) => /\.(exe|dll)$/i.test(f) && !/^updater/i.test(f))) copy(path.join(expanded, file), path.join(bin, file));
  const sources = {};
  for (const component of ["Vulkan-Headers", "Vulkan-Loader"]) {
    const source = path.join(work, component); fs.mkdirSync(source);
    const archive = path.join(work, component + ".tar.gz");
    await download(deps[component].url, archive, deps[component].sha256);
    run(path.join(process.env.SystemRoot, "System32/tar.exe"), ["-xzf", archive, "--strip-components=1", "-C", source]);
    sources[component] = source; collectNotices(source, component);
    manifest.dependencies.push({ name: component, ...deps[component] });
  }
  console.log("Building the portable Vulkan loader");
  const windowsArch = process.arch === "arm64" ? "ARM64" : "x64";
  const vswhere = path.join(process.env["ProgramFiles(x86)"], "Microsoft Visual Studio/Installer/vswhere.exe");
  const vsMajor = run(vswhere, ["-latest", "-products", "*", "-requires", `Microsoft.VisualStudio.Component.VC.Tools.${process.arch === "arm64" ? "ARM64" : "x86.x64"}`, "-property", "installationVersion"]).trim().split(".")[0];
  const generator = process.env.CMAKE_GENERATOR || { 17: "Visual Studio 17 2022", 18: "Visual Studio 18 2026" }[vsMajor];
  if (!generator) throw Error(`No supported Visual Studio C++ tools for ${windowsArch}`);
  const headersBuild = path.join(work, "headers-build"), headersInstall = path.join(work, "headers-install");
  run("cmake", ["-S", sources["Vulkan-Headers"], "-B", headersBuild, "-G", generator, "-A", windowsArch, `-DCMAKE_INSTALL_PREFIX=${headersInstall}`]);
  run("cmake", ["--build", headersBuild, "--config", "Release", "--target", "install"]);
  const loaderBuild = path.join(work, "loader-build"), loaderInstall = path.join(work, "loader-install");
  run("cmake", ["-S", sources["Vulkan-Loader"], "-B", loaderBuild, "-G", generator, "-A", windowsArch, `-DCMAKE_PREFIX_PATH=${headersInstall}`, `-DCMAKE_INSTALL_PREFIX=${loaderInstall}`, "-DBUILD_TESTS=OFF", "-DUPDATE_DEPS=OFF"]);
  run("cmake", ["--build", loaderBuild, "--config", "Release", "--target", "install", "--parallel", "2"]);
  copy(path.join(loaderInstall, "bin/vulkan-1.dll"), path.join(bin, "vulkan-1.dll"));
  const imports = await new Promise((resolve, reject) => {
    const names = new Set(); let pending = "";
    const child = spawn("objdump", ["-p", path.join(bin, "mpv.exe")], { windowsHide: true });
    child.stdout.on("data", (b) => {
      const lines = (pending + b).split("\n"); pending = lines.pop();
      for (const line of lines) { const m = line.match(/DLL Name:\s*(\S+)/); if (m) names.add(m[1]); }
    });
    child.stderr.on("data", (b) => process.stderr.write(b));
    child.on("error", reject);
    child.on("close", (code) => code ? reject(Error("Cannot inspect Windows player imports")) : resolve([...names]));
  });
  console.log("Windows player DLLs:", imports.join(", "));
  for (const dll of imports) {
    if (!/^api-ms-/i.test(dll) && !fs.existsSync(path.join(bin, dll)) && !fs.existsSync(path.join(process.env.SystemRoot, "System32", dll))) console.log(`DLL absent from package/System32: ${dll}`);
  }
  collectNotices(expanded, "mpv-windows");
  manifest.dependencies.push(windowsMpv);
  run("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(root, "gamepad/build-windows.ps1"), "-Output", path.join(bin, "input-helper.exe"), "-Compiler", compiler]);
  copy(path.join(root, "assets/icons/wltoys-drive.ico"), path.join(app, "wltoys-drive.ico"));
  const iconResource = path.join(work, "icon.o");
  run("windres", ["-I", path.join(root, "assets/icons"), path.join(root, "packaging/windows-icon.rc"), "-o", iconResource]);
  run(compiler, ["-O2", "-municode", "-mwindows", path.join(root, "packaging/windows-launcher.c"), iconResource, "-o", path.join(top, "WLtoys Drive.exe"), "-luser32"]);
}
fs.writeFileSync(path.join(app, "build.json"), JSON.stringify(manifest, null, 2) + "\n");
fs.writeFileSync(path.join(licenses, "SOURCES.txt"), `Node: https://nodejs.org/dist/v${deps.node}/node-v${deps.node}.tar.gz\nmpv: https://github.com/mpv-player/mpv\nWindows player build recipes: ${deps.windowsMpv.source}\nExact binary package versions, source URLs and build metadata are in ../build.json.\nFor Linux sources: enable matching Ubuntu 22.04 deb-src entries and run apt-get source PACKAGE=SOURCE_VERSION from that manifest.\nFor macOS sources: source archives, checksums and formula build metadata are recorded per dependency in that manifest.\n`);
if (process.platform === "darwin") {
  run("codesign", ["--force", "--deep", "--sign", "-", top]);
  run("codesign", ["--verify", "--deep", "--strict", top]);
}
const archive = path.join(out, name + (process.platform === "linux" ? ".tar.gz" : ".zip"));
if (process.platform === "darwin") run("ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", top, archive]);
else if (process.platform === "linux") run("tar", ["-czf", archive, "-C", work, name]);
else run("7z", ["a", "-tzip", archive, top]);
const hash = createHash("sha256").update(fs.readFileSync(archive)).digest("hex");
fs.writeFileSync(archive + ".sha256", `${hash}  ${path.basename(archive)}\n`);
if (process.platform === "darwin") {
  copy(path.join(app, "gamepad-helper"), path.join(out, "gamepad-helper-macos-arm64"));
  fs.rmSync(path.join(out, "keyboard-helper-macos-arm64"), { force: true });
}
console.log(archive);
fs.rmSync(work, { recursive: true, force: true });
