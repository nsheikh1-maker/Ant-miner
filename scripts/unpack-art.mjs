import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const pack = "art-pack";
let names = [];
try {
  names = readdirSync(pack).filter((name) => name.endsWith(".b64"));
} catch {
  process.exit(0);
}

for (const name of names) {
  const target = name.slice(0, -4).replaceAll("__", "/");
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, Buffer.from(readFileSync(join(pack, name), "utf8"), "base64"));
}
