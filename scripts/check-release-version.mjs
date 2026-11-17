import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const tag = process.argv[2];
const config = JSON.parse(
  await readFile(path.join(root, 'src-tauri/tauri.conf.json'), 'utf8'),
);
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const cargo = await readFile(path.join(root, 'src-tauri/Cargo.toml'), 'utf8');
const cargoPackage = cargo.split('[package]')[1];
const cargoLines = cargoPackage?.split(String.fromCharCode(10)) ?? [];
let cargoVersion;
for (const line of cargoLines) {
  if (line.trim().startsWith('[')) break;
  const [key, value] = line.split('=');
  if (key.trim() === 'version') cargoVersion = JSON.parse(value.trim());
}

if (
  !tag ||
  tag !== `v${config.version}` ||
  pkg.version !== config.version ||
  cargoVersion !== config.version
) {
  throw new Error(
    `Release version mismatch: tag=${tag}, tauri=${config.version}, package=${pkg.version}, cargo=${cargoVersion}. Keep all versions aligned before publishing.`,
  );
}
console.log(`Release version verified: ${tag}`);
