import { test } from "node:test";
import assert from "node:assert/strict";
import { binaryArchitecture, peResourceTypes } from "../binary.mjs";

function pe(machine) {
  const bytes = Buffer.alloc(1024);
  bytes.write("MZ"); bytes.writeUInt32LE(0x80, 0x3c); bytes.writeUInt32LE(0x4550, 0x80);
  bytes.writeUInt16LE(machine, 0x84); bytes.writeUInt16LE(1, 0x86); bytes.writeUInt16LE(240, 0x94);
  bytes.writeUInt16LE(0x20b, 0x98); bytes.writeUInt32LE(0x7020, 0x118);
  bytes.writeUInt32LE(0x7000, 0x194); bytes.writeUInt32LE(512, 0x198); bytes.writeUInt32LE(512, 0x19c);
  bytes.writeUInt16LE(1, 0x22c); bytes.writeUInt16LE(2, 0x22e);
  bytes.writeUInt32LE(0x80000080, 0x230); bytes.writeUInt32LE(3, 0x238); bytes.writeUInt32LE(14, 0x240);
  return bytes;
}

test("distinguishes native ARM64 and x64 PE images and resolves resource RVAs", () => {
  for (const [machine, arch] of [[0x8664, "x64"], [0xaa64, "arm64"]]) {
    const bytes = pe(machine);
    assert.equal(binaryArchitecture(bytes), arch);
    assert.deepEqual([...peResourceTypes(bytes)], [3, 14]);
  }
});

test("distinguishes native ARM64 and x64 ELF images", () => {
  for (const [machine, arch] of [[62, "x64"], [183, "arm64"]]) {
    const bytes = Buffer.alloc(64);
    bytes.set([0x7f, 0x45, 0x4c, 0x46, 2, 1]); bytes.writeUInt16LE(machine, 18);
    assert.equal(binaryArchitecture(bytes), arch);
    bytes[4] = 1;
    assert.throws(() => binaryArchitecture(bytes), /64-bit/);
  }
});

test("rejects unknown machines, corrupt PE headers and unmapped resources", () => {
  assert.throws(() => binaryArchitecture(pe(0x14c)), /Unsupported native machine/);
  assert.throws(() => binaryArchitecture(Buffer.from("MZ")), /Invalid PE/);
  const bytes = pe(0xaa64); bytes.writeUInt32LE(0x9000, 0x118);
  assert.throws(() => peResourceTypes(bytes), /outside/);
  bytes.writeUInt32LE(0, 0x118);
  assert.deepEqual([...peResourceTypes(bytes)], []);
  bytes.writeUInt32LE(0, 0x80);
  assert.throws(() => binaryArchitecture(bytes), /Invalid PE/);
});
