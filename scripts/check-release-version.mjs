import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const tag = process.argv[2];
const config = JSON.parse(
  await readFile(path.join(root, 'src-tauri/tauri.conf.json'), 'utf8'),
);
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const packageLock = JSON.parse(
  await readFile(path.join(root, 'package-lock.json'), 'utf8'),
);
const cargo = await readFile(path.join(root, 'src-tauri/Cargo.toml'), 'utf8');
const cargoLock = await readFile(
  path.join(root, 'src-tauri/Cargo.lock'),
  'utf8',
);

function tomlString(section, key) {
  return section?.match(
    new RegExp(`^\\s*${key}\\s*=\\s*["']([^"']*)["']\\s*(?:#.*)?$`, 'm'),
  )?.[1];
}

const cargoPackage = cargo.split(/^\[package\]\s*$/m)[1]?.split(/^\[/m)[0];
const cargoName = tomlString(cargoPackage, 'name');
const cargoLockPackages = cargoLock
  .split(/^\[\[package\]\]\s*$/m)
  .slice(1)
  .map((section) => section.split(/^\[/m)[0])
  .filter((section) => cargoName && tomlString(section, 'name') === cargoName);
const versions = {
  'src-tauri/tauri.conf.json': config.version,
  'package.json': pkg.version,
  'src-tauri/Cargo.toml': tomlString(cargoPackage, 'version'),
  'package-lock.json (version)': packageLock.version,
  'package-lock.json (packages[""].version)':
    packageLock.packages?.['']?.version,
  'src-tauri/Cargo.lock (root package)':
    cargoLockPackages.length === 1
      ? tomlString(cargoLockPackages[0], 'version')
      : undefined,
};

if (
  typeof config.version !== 'string' ||
  !config.version ||
  tag !== `v${config.version}` ||
  Object.values(versions).some((version) => version !== config.version)
) {
  throw new Error(
    `Release version mismatch: tag=${tag}, ${Object.entries(versions)
      .map(([file, version]) => `${file}=${version ?? 'missing or ambiguous'}`)
      .join(', ')}. Keep all versions aligned before publishing.`,
  );
}
console.log(`Release version verified: ${tag}`);
