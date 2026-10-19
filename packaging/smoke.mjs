import fs from "node:fs";
import path from "node:path";
import dgram from "node:dgram";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { once } from "node:events";

const here = path.dirname(fileURLToPath(import.meta.url));
export async function smoke({ app, node, mpv, env, home }) {
  const control = dgram.createSocket("udp4"), camera = dgram.createSocket("udp4");
  const packets = [], samples = [], marks = {}; let streaming = false, frameId = 0, address;
  control.on("message", (p) => { packets.push(Buffer.from(p)); samples.push({ at: Date.now(), packet: Buffer.from(p) }); });
  camera.on("message", (p, r) => { streaming = p[2] === 0x20; address = r.address; });
  await Promise.all([new Promise((r) => control.bind(23458, "127.0.0.1", r)), new Promise((r) => camera.bind(23459, "127.0.0.1", r))]);
  const feed = fs.readFileSync(path.join(here, "camera.h265"));
  const boundaries = [];
  for (let i = 0; i + 5 < feed.length; i++) {
    if (feed[i] || feed[i + 1]) continue;
    const prefix = feed[i + 2] === 1 ? 3 : feed[i + 2] === 0 && feed[i + 3] === 1 ? 4 : 0;
    if (prefix && ((feed[i + prefix] >> 1) & 63) === 35) boundaries.push(i);
    if (prefix) i += prefix - 1;
  }
  const frames = boundaries.map((start, i) => feed.subarray(start, boundaries[i + 1] || feed.length));
  if (!frames.length) throw Error("Synthetic HEVC fixture has no access units");
  const fixture = path.join(home, "mpv-fixture.lua");
  // Run inside the actual bundled player: exercise Lua, video decode and the same keyboard message boundary.
  fs.writeFileSync(fixture, `
mp.register_event('file-loaded', function()
  mp.add_timeout(3.5, function() mp.commandv('quit', '0') end)
end)
`);
  const helper = path.join(home, process.platform === "win32" ? "input-fixture.exe" : "input-fixture");
  const compiled = spawnSync(process.platform === "win32" ? "gcc" : "cc", [path.join(here, "fixture.c"), "-O2", "-o", helper], { encoding: "utf8" });
  if (compiled.error || compiled.status !== 0) throw Error(compiled.error?.message || compiled.stderr);
  console.log("Starting synthetic car and extracted driver");
  const child = spawn(node, [path.join(app, "drive.mjs")], {
    cwd: home, env: { ...env, CAR_IP: "127.0.0.1", NO_AUTOCONNECT: "1", FULLSCREEN: "0", KEYBOARD_BIN: helper, GAMEPAD_BIN: path.join(home, "absent-gamepad"), MPV_BIN: helper, FIXTURE_MPV: mpv, FIXTURE_LUA: fixture },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (b) => output += b);
  child.stderr.on("data", (b) => {
    output += b;
    if (process.env.CI) process.stdout.write(b);
    for (const match of String(b).matchAll(/fixture:(turn|release|forward|stale)/g)) marks[match[1]] = Date.now();
  });
  const sender = setInterval(() => {
    if (!streaming || !address) return;
    const frame = frames[frameId % frames.length];
    for (let offset = 0; offset < frame.length; offset += 1200) {
      const bytes = frame.subarray(offset, offset + 1200), packet = Buffer.alloc(32 + bytes.length);
      packet.writeUInt32LE(frame.length, 4); packet.writeUInt32LE(frameId, 8);
      packet.writeUInt32LE(offset, 24); packet.writeUInt32LE(bytes.length, 28);
      bytes.copy(packet, 32); camera.send(packet, 1234, address);
    }
    frameId++;
  }, 40);
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; child.kill(); setTimeout(() => child.kill("SIGKILL"), 2000).unref(); }, 12000);
  try {
    const [code] = await once(child, "exit");
    if (timedOut) throw Error(`Video never completed: ${output}`);
    if (code !== 0) throw Error(`App/video smoke failed (${code}): ${output}`);
    if (frameId < 20 || !/VO: \[null\]/.test(output)) throw Error(`Video was not decoded: ${output}`);
    if (/Lua error|Error loading|Failed to open|Error opening/i.test(output)) throw Error(output);
    if (packets.length < 30 || !packets.every((p) => p.length === 16 && p[14] === (p[9] ^ p[10] ^ p[11]))) throw Error("Invalid UDP control packets");
    if (!packets.some((p) => p[9] > 128 && p[10] === 255)) throw Error(`No simultaneous keyboard forward/steer: ${output}`);
    for (const [name, wait, duration, check] of [
      ["release", 80, 200, (p) => p[9] === 128 && p[10] === 128],
      ["forward", 80, 200, (p) => p[10] === 255],
      ["stale", 350, 500, (p) => p[9] === 128 && p[10] === 128],
    ]) {
      const phase = samples.filter((s) => s.at >= marks[name] + wait && s.at <= marks[name] + duration);
      if (!phase.length || !phase.every((s) => check(s.packet))) throw Error(`Input ${name} failsafe check failed: ${JSON.stringify({marks, packets: phase.map((s) => [s.at - marks[name], s.packet[9], s.packet[10]])})}\n${output}`);
    }
    if (!packets.slice(-6).every((p) => p[9] === 128 && p[10] === 128)) throw Error("Shutdown failed to neutralize");
    console.log(`UDP/video smoke: ${packets.length} valid packets, ${frameId} HEVC frames; neutral shutdown`);
  } finally {
    clearInterval(sender); clearTimeout(timeout); child.kill(); control.close(); camera.close();
  }
}
