import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const pack = "art-pack";
let names = [];
try {
  names = readdirSync(pack);
} catch {
  process.exit(0);
}

function writePacked(b64Name, b64) {
  const target = b64Name.slice(0, -4).replaceAll("__", "/");
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, Buffer.from(b64, "base64"));
}

for (const name of names.filter((name) => name.endsWith(".b64"))) {
  writePacked(name, readFileSync(join(pack, name), "utf8"));
}

const grouped = new Map();
for (const name of names) {
  const match = name.match(/^(.*\.b64)\.p(\d+)$/);
  if (!match) continue;
  const list = grouped.get(match[1]) ?? [];
  list.push(name);
  grouped.set(match[1], list);
}
for (const [b64Name, parts] of grouped) {
  parts.sort();
  writePacked(
    b64Name,
    parts.map((part) => readFileSync(join(pack, part), "utf8")).join(""),
  );
}
