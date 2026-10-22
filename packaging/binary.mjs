function peHeader(bytes) {
  if (bytes.length < 64 || bytes.toString("ascii", 0, 2) !== "MZ") throw Error("Invalid PE image");
  const offset = bytes.readUInt32LE(0x3c);
  if (offset + 24 > bytes.length || bytes.readUInt32LE(offset) !== 0x4550) throw Error("Invalid PE header");
  return offset;
}

export function binaryArchitecture(bytes) {
  let machine, architectures;
  if (bytes.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) {
    if (bytes.length < 20 || bytes[4] !== 2 || bytes[5] !== 1) throw Error("Expected 64-bit little-endian ELF");
    machine = bytes.readUInt16LE(18);
    architectures = { 62: "x64", 183: "arm64" };
  } else {
    machine = bytes.readUInt16LE(peHeader(bytes) + 4);
    architectures = { 0x8664: "x64", 0xaa64: "arm64" };
  }
  if (!architectures[machine]) throw Error(`Unsupported native machine: 0x${machine.toString(16)}`);
  return architectures[machine];
}

export function peResourceTypes(bytes) {
  const header = peHeader(bytes), optional = header + 24;
  if (bytes.readUInt16LE(optional) !== 0x20b) throw Error("Expected PE32+ image");
  const rva = bytes.readUInt32LE(optional + 128);
  if (!rva) return new Set();
  const sections = optional + bytes.readUInt16LE(header + 20);
  for (let i = 0; i < bytes.readUInt16LE(header + 6); i++) {
    const section = sections + i * 40;
    const address = bytes.readUInt32LE(section + 12), size = bytes.readUInt32LE(section + 16);
    if (rva < address || rva >= address + size) continue;
    const root = bytes.readUInt32LE(section + 20) + rva - address;
    const count = bytes.readUInt16LE(root + 12) + bytes.readUInt16LE(root + 14);
    const types = new Set();
    for (let entry = 0; entry < count; entry++) {
      const id = bytes.readUInt32LE(root + 16 + entry * 8);
      if (!(id & 0x80000000)) types.add(id);
    }
    return types;
  }
  throw Error("PE resource directory is outside its sections");
}
