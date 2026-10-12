import { access, copyFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = join(root, "node_modules/@electric-sql/pglite/dist");
const destDir = join(root, ".vercel/output/functions/__server.func/_libs");
const files = ["pglite.wasm", "pglite.data", "initdb.wasm"];

try {
  await access(destDir);
} catch {
  console.log("[pglite] no server bundle yet, skipping asset copy");
  process.exit(0);
}

await mkdir(destDir, { recursive: true });
for (const file of files) {
  await copyFile(join(srcDir, file), join(destDir, file));
}
console.log("[pglite] copied wasm assets next to the server bundle");
