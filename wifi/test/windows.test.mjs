import test from "node:test";
import assert from "node:assert/strict";
import { windowsBackend } from "../windows.mjs";

test("Windows SSID boundaries reject profile injection and accept only car names", async () => {
  process.env.WIFI_BIN = "fixture-helper";
  const calls = [];
  const backend = windowsBackend(async (_cmd, args) => {
    calls.push(args);
    return { code: 0, stdout: args[0] === "--wifi-current" ? "WL FPV CAR 75899112\n" : "" };
  });
  try {
    for (const ssid of ["Home", "WL FPV CAR 1234567", "WL FPV CAR 12345678</name>", "WL FPV CAR " + "1".repeat(22)]) {
      assert.deepEqual(await backend.joinCar(ssid), { ok: false, reason: "notcar" });
    }
    assert.equal(calls.length, 0);
    assert.deepEqual(await backend.joinCar("  WL FPV CAR 75899112  "), { ok: true });
    assert.deepEqual(calls[0], ["--wifi-join", "WL FPV CAR 75899112"]);
  } finally { delete process.env.WIFI_BIN; }
});

test("Windows network list filters non-car names and deduplicates adapters", async () => {
  process.env.WIFI_BIN = "fixture-helper";
  try {
    const backend = windowsBackend(async () => ({ code: 0, stdout: "Home\r\nWL FPV CAR 75899112\r\nWL FPV CAR 75899112\r\n" }));
    assert.deepEqual(await backend.scanCars(), ["WL FPV CAR 75899112"]);
  } finally { delete process.env.WIFI_BIN; }
});
