import fs from "node:fs";
import path from "node:path";
import dgram from "node:dgram";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { luaString } from "../runtime.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

export async function checkStartup({ app, node, mpv, env, home }) {
  const helper = path.join(home, process.platform === "win32" ? "startup-fixture.exe" : "startup-fixture");
  const build = spawnSync(process.platform === "win32" ? "gcc" : "cc", [path.join(here, "fixture.c"), "-O2", "-o", helper], { encoding: "utf8" });
  if (build.error || build.status !== 0) throw Error(build.error?.message || build.stderr);
  const feed = fs.readFileSync(path.join(here, "camera.h265"));
  const boundaries = [];
  for (let i = 0; i + 5 < feed.length; i++) {
    if (feed[i] || feed[i + 1]) continue;
    const prefix = feed[i + 2] === 1 ? 3 : feed[i + 2] === 0 && feed[i + 3] === 1 ? 4 : 0;
    if (prefix && ((feed[i + prefix] >> 1) & 63) === 35) boundaries.push(i);
    if (prefix) i += prefix - 1;
  }
  const frames = boundaries.map((start, i) => feed.subarray(start, boundaries[i + 1] || feed.length));
  for (const scenario of ["single", "multiple", "empty", "permission", "late"]) {
    const dir = path.join(home, `startup ${scenario}`); fs.mkdirSync(dir);
    const ready = path.join(dir, "player-ready"), state = path.join(dir, "joined-car");
    const lua = path.join(dir, "startup.lua");
    const duration = scenario === "late" ? 6 : scenario === "empty" || scenario === "permission" ? 2 : 4;
    fs.writeFileSync(lua, `
local scheduled = false
mp.register_event('file-loaded', function()
  local f = assert(io.open(${luaString(ready)}, 'w')); f:write('ready'); f:close()
  if not scheduled then
    scheduled = true
    mp.add_timeout(${duration}, function() mp.commandv('quit', '0') end)
  end
end)
`);
    fs.writeFileSync(path.join(dir, ".wltoys-car"), "WL FPV CAR 11111111\n");
    const control = dgram.createSocket("udp4"), camera = dgram.createSocket("udp4");
    const packets = [], messages = new Set();
    let streaming = false, address, frameId = 0, selectedAt = 0;
    control.on("message", (packet) => packets.push({ at: Date.now(), packet: Buffer.from(packet) }));
    camera.on("message", (packet, remote) => { streaming = packet[2] === 0x20; address = remote.address; });
    await Promise.all([
      new Promise((resolve) => control.bind(23458, "127.0.0.1", resolve)),
      new Promise((resolve) => camera.bind(23459, "127.0.0.1", resolve)),
    ]);
    const child = spawn(node, [path.join(app, "drive.mjs")], {
      cwd: dir, stdio: ["ignore", "pipe", "pipe"],
      env: { ...env, HOME: dir, USERPROFILE: dir, TMPDIR: dir, TMP: dir, TEMP: dir,
        CAR_IP: "127.0.0.1", NO_AUTOCONNECT: "0", CAR_SSID: "", FULLSCREEN: "0",
        WIFI_BIN: helper, KEYBOARD_BIN: helper, GAMEPAD_BIN: path.join(dir, "absent-gamepad"), JS_DEVICE: path.join(dir, "absent-gamepad"),
        MPV_BIN: helper, FIXTURE_MPV: mpv, FIXTURE_LUA: lua, FIXTURE_READY: ready,
        FIXTURE_STARTUP_CASE: scenario, FIXTURE_WIFI_STATE: state, FIXTURE_SCAN_COUNT: path.join(dir, "scan-count") },
    });
    let output = "";
    child.stdout.on("data", (bytes) => output += bytes);
    child.stderr.on("data", (bytes) => {
      output += bytes;
      if (!selectedAt && output.includes("fixture:selection\n")) selectedAt = Date.now();
    });
    const sender = setInterval(() => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isDirectory() || !entry.name.startsWith("wltoys-")) continue;
        try { messages.add(fs.readFileSync(path.join(dir, entry.name, "hud.txt"), "utf8")); } catch {}
      }
      if (!streaming || !address) return;
      const frame = frames[frameId % frames.length];
      for (let offset = 0; offset < frame.length; offset += 1200) {
        const data = frame.subarray(offset, offset + 1200), packet = Buffer.alloc(32 + data.length);
        packet.writeUInt32LE(frame.length, 4); packet.writeUInt32LE(frameId, 8);
        packet.writeUInt32LE(offset, 24); packet.writeUInt32LE(data.length, 28);
        data.copy(packet, 32); camera.send(packet, 1234, address);
      }
      frameId++;
    }, 40);
    const timeout = setTimeout(() => child.kill("SIGKILL"), 15000);
    try {
      const [code] = await once(child, "exit");
      if (code !== 0 || /Wi-Fi ran before|Lua error|Error loading|The video window|property.*unavailable/i.test(output)) throw Error(`Startup ${scenario} failed (${code}): ${output}`);
      const ui = [...messages].join("\n");
      if (scenario === "empty" || scenario === "permission") {
        if (packets.length || frameId || fs.existsSync(state)) throw Error(`Startup ${scenario} transmitted before connection`);
        const title = scenario === "empty" ? "No cars found yet" : "Allow nearby-car discovery";
        if (!ui.includes(title)) throw Error(`Missing visible ${scenario} state: ${ui}\n${output}`);
      } else {
        const expected = `WL FPV CAR ${scenario === "multiple" ? "22222222" : "11111111"}`;
        if (!fs.existsSync(state) || fs.readFileSync(state, "utf8").trim() !== expected) throw Error(`Startup ${scenario} joined the wrong car: ${output}`);
        if (frameId < 20 || packets.length < 20 || !packets.every(({packet: p}) => p.length === 16 && p[14] === (p[9] ^ p[10] ^ p[11]))) throw Error(`Startup ${scenario} missed video/control: ${output}`);
        if (!packets.slice(-6).every(({packet: p}) => p[9] === 128 && p[10] === 128) || streaming) throw Error(`Startup ${scenario} did not stop safely`);
        if (scenario === "multiple") {
          if (!selectedAt || packets.some(({at}) => at < selectedAt) || !ui.includes("Choose your car")) throw Error(`Multiple cars bypassed the picker: ${output}`);
          const held = packets.filter(({at}) => at < selectedAt + 400);
          if (!held.length || !held.every(({packet: p}) => p[9] === 128 && p[10] === 128)) throw Error("Picker input became driving input");
        }
        if (scenario === "late" && !ui.includes("No cars found yet")) throw Error("Late car was not discovered after an empty scan");
      }
      console.log(`PASS startup ${scenario}: visible window first, ${packets.length} packets, ${frameId} HEVC frames, safe close`);
    } finally {
      clearInterval(sender); clearTimeout(timeout); child.kill(); control.close(); camera.close();
    }
  }
}
