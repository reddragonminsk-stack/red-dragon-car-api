const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = process.cwd();
const RUNTIME_JSON = path.join(ROOT, 'runtime-home.json');
const RUNTIME_IMAGES = path.join(ROOT, 'runtime-images');
const CACHE = path.join(ROOT, 'cache');
const CACHE_IMAGES = path.join(CACHE, 'images');
const PUBLIC_BASE = 'https://red-dragon-car-api.red-dragon-minsk.workers.dev';
const PORT = process.env.PORT || '10000';

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function waitForCache(timeoutMs = 15 * 60 * 1000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/health`, { cache: 'no-store' });
      if (r.ok) {
        const health = await r.json();
        if (health.ok && health.live && health.count >= 12 && fs.existsSync(RUNTIME_JSON)) return health;
      }
    } catch {}
    await sleep(3000);
  }
  throw new Error('CACHE_REFRESH_TIMEOUT');
}

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dst, entry.name);
    if (entry.isDirectory()) copyDir(from, to);
    else fs.copyFileSync(from, to);
  }
}

async function main() {
  fs.rmSync(CACHE, { recursive: true, force: true });
  fs.mkdirSync(CACHE_IMAGES, { recursive: true });

  const child = spawn(process.execPath, ['source-fetch-bootstrap.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT },
    stdio: ['ignore', 'inherit', 'inherit']
  });

  const stop = () => new Promise(resolve => {
    if (child.exitCode !== null) return resolve();
    child.once('exit', () => resolve());
    child.kill('SIGTERM');
    setTimeout(() => child.kill('SIGKILL'), 5000);
  });

  try {
    const health = await waitForCache();
    console.log('[publish-cache] refresh complete:', JSON.stringify(health));

    const data = JSON.parse(fs.readFileSync(RUNTIME_JSON, 'utf8'));
    if (!Array.isArray(data.cars) || data.cars.length < 12) throw new Error(`CACHE_CARDS_${data.cars?.length || 0}`);

    copyDir(RUNTIME_IMAGES, CACHE_IMAGES);

    for (const car of data.cars) {
      const filename = `${car.id}.webp`;
      const local = path.join(CACHE_IMAGES, filename);
      if (!fs.existsSync(local)) throw new Error(`MISSING_IMAGE_${car.id}`);
      const url = `${PUBLIC_BASE}/images/${encodeURIComponent(filename)}`;
      car.image = url;
      car.preview = url;
    }

    data.publishedAt = new Date().toISOString();
    data.imageBase = `${PUBLIC_BASE}/images/`;
    fs.writeFileSync(path.join(CACHE, 'home.json'), JSON.stringify(data));

    const files = fs.readdirSync(CACHE_IMAGES).filter(name => name.endsWith('.webp'));
    console.log(`[publish-cache] published ${data.cars.length} cars and ${files.length} images`);
  } finally {
    await stop();
  }
}

main().catch(error => {
  console.error('[publish-cache] failed:', error.stack || error.message || error);
  process.exitCode = 1;
});
