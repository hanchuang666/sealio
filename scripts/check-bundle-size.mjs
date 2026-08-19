import { readdir, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const distPath = fileURLToPath(new URL('../dist/', import.meta.url));
const maxTotalBytes = 2_500_000;
const maxAssetBytes = 1_200_000;

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory() ? collectFiles(path) : Promise.resolve([path]);
    }),
  );
  return nested.flat();
}

const files = await collectFiles(distPath);
const sizes = await Promise.all(files.map(async (path) => ({ path, bytes: (await stat(path)).size })));
const totalBytes = sizes.reduce((sum, item) => sum + item.bytes, 0);
const oversized = sizes.filter((item) => item.bytes > maxAssetBytes);

console.log(`Bundle size: ${(totalBytes / 1024 / 1024).toFixed(2)} MiB`);
sizes
  .sort((left, right) => right.bytes - left.bytes)
  .slice(0, 6)
  .forEach((item) => console.log(`  ${(item.bytes / 1024).toFixed(1)} KiB  ${relative(distPath, item.path)}`));

if (totalBytes > maxTotalBytes || oversized.length > 0) {
  const reasons = [];
  if (totalBytes > maxTotalBytes) reasons.push(`total exceeds ${(maxTotalBytes / 1024 / 1024).toFixed(2)} MiB`);
  oversized.forEach((item) => reasons.push(`${relative(distPath, item.path)} exceeds ${(maxAssetBytes / 1024).toFixed(0)} KiB`));
  throw new Error(`Bundle size budget exceeded: ${reasons.join(', ')}`);
}
