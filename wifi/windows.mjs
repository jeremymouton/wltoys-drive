import { findTool } from "../runtime.mjs";
import { matchCarSsid, parseSsidList } from "./core.mjs";

export function windowsBackend(run) {
  const invoke = async (...args) => {
    const helper = process.env.WIFI_BIN || findTool("input-helper");
    return helper ? run(helper, args) : { code: 127, stdout: "", stderr: "Windows helper missing" };
  };
  const currentCar = async () => {
    const r = await invoke("--wifi-current");
    return r.code === 0 ? parseSsidList(r.stdout)[0] || null : null;
  };
  const onCarAP = async (ip = process.env.CAR_IP || "172.16.11.1") =>
    !!(await currentCar()) || (await invoke("--wifi-on", ip)).code === 0;
  return {
    SCAN_SUPPORTED: true,
    scanCars: async () => {
      const result = await invoke("--wifi-scan");
      if (result.code !== 0) {
        const error = Error(result.code === 5
          ? "Allow Location access for desktop apps to scan nearby Wi-Fi networks and find your car."
          : "Wi-Fi discovery failed. Check that Wi-Fi is on; retrying automatically.");
        error.code = result.code === 5 ? "permission" : "scan";
        throw error;
      }
      return parseSsidList(result.stdout);
    },
    savedCars: async () => parseSsidList((await invoke("--wifi-saved")).stdout),
    openWifiPicker: async () => (await run("explorer.exe", ["ms-settings:network-wifi"])).code === 0,
    openDiscoverySettings: async () => (await run("explorer.exe", ["ms-settings:privacy-location"])).code === 0,
    currentCar, onCarAP,
    joinCar: async (ssid, ip) => {
      const s = String(ssid ?? "").trim();
      if (!matchCarSsid(s) || s.length > 32) return { ok: false, reason: "notcar" };
      const r = await invoke("--wifi-join", s);
      if (r.code !== 0) return { ok: false, reason: r.code === 5 ? "Wi-Fi permission denied; join in Windows Settings" : "retry" };
      for (let i = 0; i < 15; i++) {
        if (await onCarAP(ip)) return { ok: true };
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      return { ok: false, reason: "retry" };
    },
  };
}
