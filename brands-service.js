const express = require('express');
const cors = require('cors');
const { refresh, readCache } = require('./brands-parser');

const app = express();
const PORT = process.env.PORT || 10001;
const REFRESH_MS = Number(process.env.BRANDS_REFRESH_MS || 3600000);

let cache = readCache();
let refreshing = false;
let lastError = null;

app.use(cors());

async function refreshInBackground() {
  if (refreshing) return;
  refreshing = true;
  try {
    const next = await refresh();
    cache = next;
    lastError = null;
    console.log(`[brands-service] cache updated: ${next.brandCount} brands / ${next.modelCount} models`);
  } catch (error) {
    lastError = error.message;
    console.error(`[brands-service] refresh failed: ${error.message}`);
  } finally {
    refreshing = false;
  }
}

function requireCache() {
  if (!cache) {
    cache = readCache();
  }
  if (!cache) {
    const error = new Error('BRANDS_CACHE_UNAVAILABLE');
    error.statusCode = 503;
    throw error;
  }
  return cache;
}

app.get('/api/brands', (req, res) => {
  try {
    const data = requireCache();
    res.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=3600');
    res.json({
      ok: true,
      cached: true,
      source: data.source,
      updatedAt: data.updatedAt,
      brandCount: data.brandCount,
      modelCount: data.modelCount,
      brands: data.brands
    });
  } catch (error) {
    res.status(error.statusCode || 503).json({
      ok: false,
      cached: false,
      error: error.message
    });
  }
});

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    cached: !!cache,
    brandCount: cache?.brandCount || 0,
    modelCount: cache?.modelCount || 0,
    updatedAt: cache?.updatedAt || null,
    refreshing,
    lastError
  });
});

async function start() {
  console.log(`[brands-service] port: ${PORT}`);
  console.log('[brands-service] data endpoint: /api/brands');

  if (!cache) {
    await refreshInBackground();
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[brands-service] listening on ${PORT}`);
  });

  setInterval(() => {
    refreshInBackground().catch(error => {
      lastError = error.message;
      console.error(`[brands-service] scheduled refresh failed: ${error.message}`);
    });
  }, REFRESH_MS);
}

start().catch(error => {
  console.error(`[brands-service] startup failed: ${error.message}`);
  process.exitCode = 1;
});
