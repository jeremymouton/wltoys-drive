import net from "node:net";
import { matchCarSsid } from "./wifi/core.mjs";

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const clean = (value) => String(value).replace(/[{}\\\r\n]/g, " ").slice(0, 150);

export class StartupScreen {
  constructor({ player, ipc, draw, text, gamepad }) {
    this.player = player;
    this.ipc = ipc;
    this.draw = draw;
    this.text = text;
    this.gamepad = gamepad;
    this.pending = new Map();
    this.sequence = 0;
    this.cars = [];
    this.index = 0;
    this.first = 0;
    this.closed = false;
    player.once("exit", () => this.dispose());
    this.timer = setInterval(() => {
      const { y, a } = gamepad();
      if (y < -0.5 && !(this.previousY < -0.5)) this.input("UP");
      if (y > 0.5 && !(this.previousY > 0.5)) this.input("DOWN");
      if (a && !this.previousA) this.input("SELECT");
      this.previousY = y;
      this.previousA = a;
    }, 30);
    this.status("Searching for cars", "Turn on your car. It will connect automatically.");
  }

  async ready() {
    const deadline = Date.now() + 10000;
    while (!this.closed && Date.now() < deadline) {
      try {
        this.socket = await new Promise((resolve, reject) => {
          const socket = net.createConnection(this.ipc);
          socket.once("connect", () => resolve(socket));
          socket.once("error", reject);
        });
        break;
      } catch { await pause(50); }
    }
    if (!this.socket || this.closed) throw Error("The video window could not open");
    let buffer = "";
    this.socket.on("data", (bytes) => {
      buffer += bytes;
      let end;
      while ((end = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
        let response;
        try { response = JSON.parse(line); } catch { continue; }
        const pending = this.pending.get(response.request_id);
        if (!pending) continue;
        this.pending.delete(response.request_id);
        clearTimeout(pending.timer);
        if (response.error === "success") pending.resolve(response.data);
        else pending.reject(Error(response.error));
      }
    });
    this.socket.on("error", () => this.dispose());
    this.socket.on("close", () => this.dispose());
    while (!this.closed && Date.now() < deadline) {
      try {
        if (typeof await this.command(["get_property", "time-pos"]) === "number") return;
      } catch {}
      await pause(50);
    }
    throw Error("The video window did not become ready");
  }

  command(command) {
    if (this.closed || !this.socket) return Promise.reject(Error("Window closed"));
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(Error("Player response timed out")); }, 5000);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.write(JSON.stringify({ command, request_id: id }) + "\n");
    });
  }

  status(title, detail = "", error = false, action = null) {
    this.title = title;
    this.detail = detail;
    this.error = error;
    this.action = action;
    this.cars = [];
    this.render();
  }

  render() {
    const t = this.text;
    const rows = [t(96, 72, 4, 25, "WLtoys Drive"), t(640, 175, 5, 38, clean(this.title))];
    if (this.detail) {
      const words = clean(this.detail).split(" ");
      let line = "", y = 225;
      for (const word of words) {
        if ((line + word).length > 70) { rows.push(t(640, y, 5, 21, line, this.error ? "4040E0" : "FFFFFF")); line = ""; y += 28; }
        line += (line ? " " : "") + word;
      }
      if (line) rows.push(t(640, y, 5, 21, line, this.error ? "4040E0" : "FFFFFF"));
    }
    this.first = Math.max(0, Math.min(this.index - 5, this.cars.length - 7));
    this.cars.slice(this.first, this.first + 7).forEach((ssid, row) => {
      const index = this.first + row, y = 292 + row * 46;
      if (index === this.index) rows.push(`{\\an7\\pos(330,${y - 22})\\bord2\\shad0\\1a&HFF&\\3c&HFFFFFF&\\p1}m 0 0 l 620 0 620 44 0 44`);
      rows.push(t(360, y, 4, 26, ssid));
    });
    if (this.action) {
      rows.push(`{\\an7\\pos(430,350)\\bord2\\shad0\\1a&HFF&\\3c&HFFFFFF&\\p1}m 0 0 l 420 0 420 64 0 64`);
      rows.push(t(640, 382, 5, 24, this.action.label));
    }
    if (this.cars.length) rows.push(t(640, 650, 5, 20, "Click a car, or use Up / Down and Enter. Gamepad: D-pad and A."));
    else rows.push(t(640, 650, 5, 20, "Close the window to exit."));
    this.draw(rows.join("\n"));
  }

  choose(cars, preferred) {
    if (this.closed) return Promise.resolve(null);
    this.title = "Choose your car";
    this.detail = "Several cars are nearby. Select the one you want to drive.";
    this.error = false;
    this.action = null;
    this.cars = cars;
    this.index = Math.max(0, cars.indexOf(preferred));
    this.render();
    return new Promise((resolve) => { this.selection = resolve; });
  }

  input(value) {
    const [action, x, y] = value.split(" ");
    if (this.action && (action === "SELECT" || (action === "CLICK" && Number(x) >= 430 && Number(x) <= 850 && Number(y) >= 350 && Number(y) <= 414))) {
      Promise.resolve(this.action.run()).catch(() => {}); return;
    }
    if (!this.selection || !this.cars.length) return;
    if (action === "UP") this.index = (this.index - 1 + this.cars.length) % this.cars.length;
    if (action === "DOWN") this.index = (this.index + 1) % this.cars.length;
    if (action === "CLICK") {
      const row = Math.floor((Number(y) - 270) / 46);
      if (!Number.isFinite(Number(x)) || !Number.isFinite(Number(y)) || Number(x) < 330 || Number(x) > 950 || row < 0 || row >= 7 || this.first + row >= this.cars.length) return;
      this.index = this.first + row;
    }
    if (action === "SELECT" || action === "CLICK") {
      const resolve = this.selection; this.selection = null;
      resolve(this.cars[this.index]);
    } else this.render();
  }

  async play({ mode, rtsp, transport, fps = 25, lowLatency = true }) {
    const options = { "untimed": "yes" };
    if (mode === "udp") {
      Object.assign(options, { "demuxer": "lavf", "demuxer-lavf-format": "hevc", "correct-pts": "no" });
      if (lowLatency) Object.assign(options, { "vd-lavc-o": "flags=+low_delay", "demuxer-lavf-probesize": "32" });
      try { await this.command(["set_property", "options/container-fps-override", String(fps)]); }
      catch { await this.command(["set_property", "options/fps", String(fps)]); }
    } else options["rtsp-transport"] = transport;
    for (const [name, value] of Object.entries(options)) await this.command(["set_property", `options/${name}`, value]);
    await this.command(["loadfile", mode === "udp" ? "-" : rtsp, "replace"]);
  }

  dispose() {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.timer);
    this.selection?.(null); this.selection = null;
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(Error("Window closed")); }
    this.pending.clear();
    this.socket?.destroy();
  }
}

export async function connectToCar({ wifi, ui, noAutoconnect = false, carSsid = "", preferred = null,
  remember = () => {}, chosen = () => {}, log = () => {}, retry = true, sleep = pause }) {
  if (noAutoconnect) { log("[wifi] NO_AUTOCONNECT set — using whatever network is already joined"); return { action: "skip", ssid: null }; }
  while (!ui.closed) {
    ui.status("Searching for cars", "Turn on your car. It will connect automatically.");
    let cars;
    try {
      cars = carSsid ? [carSsid] : [...new Set((await wifi.scanCars()).filter((ssid) => matchCarSsid(ssid) && ssid.length <= 32))];
    } catch (error) {
      const permission = error.code === "permission";
      ui.status(permission ? "Allow nearby-car discovery" : "Wi-Fi discovery unavailable", error.message, true,
        permission && wifi.openDiscoverySettings ? { label: "Open settings", run: () => wifi.openDiscoverySettings() } : null);
      log(`[wifi] ${error.message}`);
      if (!retry) return { action: "nojoin", ssid: null, reason: error.code || "scan" };
      await sleep(3000); continue;
    }
    if (ui.closed) return { action: "cancel", ssid: null };
    if (!cars.length) {
      ui.status("No cars found yet", "Turn on your car and keep it nearby. Searching again automatically.");
      if (!retry) return { action: "nojoin", ssid: null };
      await sleep(3000); continue;
    }
    const ssid = cars.length === 1 ? cars[0] : await ui.choose(cars, preferred);
    if (!ssid || ui.closed) return { action: "cancel", ssid: null };
    if (!cars.includes(ssid) || !matchCarSsid(ssid)) return { action: "cancel", ssid: null };
    chosen(ssid);
    ui.status("Connecting to your car", ssid);
    log(`[wifi] joining ${ssid}…`);
    let result;
    try {
      const current = await wifi.currentCar();
      if (current === ssid || (cars.length === 1 && current === "<car>")) result = { ok: true, already: true };
      else result = await wifi.joinCar(ssid);
    } catch (error) { result = { ok: false, reason: error.message }; }
    if (ui.closed) return { action: "cancel", ssid: null };
    if (result?.ok) {
      remember(ssid);
      ui.status("Connected", "Starting your car's camera…");
      return { action: result.already ? "already" : "join", ssid, ok: true };
    }
    const reason = result?.reason || "The car did not answer";
    ui.status("Could not connect", `${ssid}. ${reason}. Retrying automatically.`, true);
    log(`[wifi] couldn't join ${ssid}: ${reason}`);
    if (!retry) return { action: "join", ssid, ok: false, reason };
    await sleep(3000);
  }
  return { action: "cancel", ssid: null };
}
