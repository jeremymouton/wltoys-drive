export const compiler = process.env.CC || (process.platform === "win32" ? (process.arch === "arm64" ? "clang" : "gcc") : "cc");
