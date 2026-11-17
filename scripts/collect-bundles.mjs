import { cp, mkdir, readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const { productName, version } = JSON.parse(
  await readFile(path.join(root, 'src-tauri/tauri.conf.json'), 'utf8'),
);
const { name: packageName } = JSON.parse(
  await readFile(path.join(root, 'package.json'), 'utf8'),
);
const bundleDir = path.join(root, 'src-tauri/target/release/bundle');
const outputDir = path.join(root, 'release');
const formats = ['macos', 'dmg', 'nsis', 'msi', 'deb', 'rpm', 'appimage'];
const copied = [];

for (const format of formats) {
  const sourceDir = path.join(bundleDir, format);
  const entries = await readdir(sourceDir, { withFileTypes: true }).catch(
    (error) => {
      if (error.code === 'ENOENT') return [];
      throw error;
    },
  );
  for (const entry of entries) {
    const isApp = entry.isDirectory() && entry.name === `${productName}.app`;
    const isInstaller =
      entry.isFile() &&
      entry.name.startsWith(`${productName}_${version}_`) &&
      /\.(dmg|exe|msi|deb|rpm|AppImage)$/i.test(entry.name);
    if (!isApp && !isInstaller) continue;
    await mkdir(outputDir, { recursive: true });
    const outputName = isInstaller
      ? `${packageName}${entry.name.slice(productName.length)}`
      : entry.name;
    const destination = path.join(outputDir, outputName);
    await cp(path.join(sourceDir, entry.name), destination, {
      recursive: true,
    });
    copied.push(destination);
  }
}

if (copied.length === 0) {
  throw new Error(
    `No bundles found for ${productName} ${version} in ${bundleDir}`,
  );
}
console.log(`Build outputs:\n${copied.join('\n')}`);
