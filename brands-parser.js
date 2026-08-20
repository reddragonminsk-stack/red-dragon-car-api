const fs = require('fs');
const path = require('path');

const SOURCE = process.env.BRANDS_SOURCE_URL || 'https://im4car.by/brands';
const JINA = 'https://r.jina.ai/';
const AO = 'https://api.allorigins.win/raw?url=';
const CACHE = path.join(__dirname, process.env.BRANDS_CACHE_FILE || 'runtime-brands.json');
const REFRESH_MS = Number(process.env.BRANDS_REFRESH_MS || 3600000);
const EXPECTED_BRANDS = Number(process.env.BRANDS_EXPECTED_COUNT || 130);
const EXPECTED_MODELS = Number(process.env.BRANDS_EXPECTED_MODELS || 1624);

const H = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/151 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/json,text/plain,text/html,*/*',
  'Accept-Language': 'ru-RU,ru;q=0.9,en;q=0.8',
  Referer: 'https://im4car.by/'
};

function decodeHtml(value) {
  return String(value || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/\\\//g, '/')
    .replace(/\\u002F/gi, '/')
    .replace(/\\u0026/gi, '&')
    .replace(/\\"/g, '"');
}

function cleanText(value) {
  return decodeHtml(String(value || '').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function absoluteUrl(value) {
  try {
    return new URL(value, 'https://im4car.by').href;
  } catch {
    return null;
  }
}

async function get(url) {
  const response = await fetch(url, {
    headers: H,
    redirect: 'follow',
    cache: 'no-store'
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP_${response.status}`);
  if (!text || text.length < 5000) throw new Error(`SHORT_RESPONSE_${text.length}`);
  if (/Проверка безопасности|Just a moment|Access denied/i.test(text)) {
    throw new Error('SOURCE_BLOCKED');
  }
  return { text, url: response.url };
}

async function loadLiveHtml() {
  let lastError = null;
  const attempts = [
    () => get(SOURCE),
    () => get(AO + encodeURIComponent(SOURCE)),
    () => get(JINA + SOURCE)
  ];

  for (const attempt of attempts) {
    try {
      return await attempt();
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error('BRANDS_SOURCE_UNAVAILABLE');
}

function extractJsonLdBrands(html) {
  const brands = new Map();
  const scriptRe = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;

  while ((match = scriptRe.exec(html))) {
    const raw = match[1].trim();
    let json;
    try {
      json = JSON.parse(raw);
    } catch {
      continue;
    }

    const candidates = [];
    if (json && json.mainEntity && Array.isArray(json.mainEntity.itemListElement)) {
      candidates.push(...json.mainEntity.itemListElement);
    }
    if (Array.isArray(json)) {
      for (const item of json) {
        if (item && item.mainEntity && Array.isArray(item.mainEntity.itemListElement)) {
          candidates.push(...item.mainEntity.itemListElement);
        }
      }
    }

    for (const item of candidates) {
      const name = cleanText(item?.name);
      const url = absoluteUrl(item?.url);
      const brandMatch = url && url.match(/\/catalog\/brand\/([^/]+)\/?$/i);
      if (!name || !brandMatch) continue;
      brands.set(brandMatch[1], {
        name,
        slug: brandMatch[1],
        url
      });
    }
  }

  return brands;
}

function extractModels(html) {
  const models = [];
  const seen = new Set();
  const anchorRe = /<a[^>]+href=["'](\/catalog\/brand\/([^/]+)\/([^"'#?]+))["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;

  while ((match = anchorRe.exec(html))) {
    const relativeUrl = match[1];
    const brandSlug = decodeURIComponent(match[2]);
    const modelSlug = decodeURIComponent(match[3]);
    const body = match[4];
    const nameMatch = body.match(/<span[^>]*>([^<]+)<\/span>/i);
    const name = cleanText(nameMatch?.[1]);
    const plain = cleanText(body);
    if (!name || !brandSlug || !modelSlug) continue;

    const countMatch = plain.match(/([\d\s\u00A0]+)\s*авто\b/i);
    const priceMatch = plain.match(/от\s*\$\s*([\d\s\u00A0,\.]+)/i);
    const count = countMatch ? Number(countMatch[1].replace(/[\s\u00A0]/g, '')) : null;
    const priceFrom = priceMatch ? Number(priceMatch[1].replace(/[\s\u00A0,]/g, '')) : null;

    const key = `${brandSlug}/${modelSlug}`;
    if (seen.has(key)) continue;
    seen.add(key);

    models.push({
      name,
      slug: modelSlug,
      url: absoluteUrl(relativeUrl),
      cars: Number.isFinite(count) ? count : null,
      priceFrom: Number.isFinite(priceFrom) ? priceFrom : null
    });
  }

  return models;
}

function buildDataset(html, sourceUrl) {
  const brands = extractJsonLdBrands(html);
  const models = extractModels(html);

  if (!brands.size) throw new Error('BRANDS_NOT_FOUND');
  if (!models.length) throw new Error('MODELS_NOT_FOUND');

  const grouped = new Map();
  for (const brand of brands.values()) grouped.set(brand.slug, { ...brand, models: [] });

  for (const model of models) {
    if (!grouped.has(model.slug.split('/')[0])) continue;
    grouped.get(model.slug.split('/')[0]).models.push(model);
  }

  const resultBrands = [...grouped.values()].filter(brand => brand.models.length);
  const modelCount = resultBrands.reduce((sum, brand) => sum + brand.models.length, 0);

  if (EXPECTED_BRANDS && resultBrands.length !== EXPECTED_BRANDS) {
    throw new Error(`BRANDS_COUNT_${resultBrands.length}_EXPECTED_${EXPECTED_BRANDS}`);
  }
  if (EXPECTED_MODELS && modelCount !== EXPECTED_MODELS) {
    throw new Error(`MODELS_COUNT_${modelCount}_EXPECTED_${EXPECTED_MODELS}`);
  }

  return {
    source: sourceUrl,
    updatedAt: new Date().toISOString(),
    brandCount: resultBrands.length,
    modelCount,
    brands: resultBrands
  };
}

function readCache() {
  try {
    if (!fs.existsSync(CACHE)) return null;
    const value = JSON.parse(fs.readFileSync(CACHE, 'utf8'));
    if (value && Array.isArray(value.brands) && value.brands.length) return value;
  } catch {}
  return null;
}

function writeCache(value) {
  const temp = `${CACHE}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value));
  fs.renameSync(temp, CACHE);
}

async function refresh() {
  const live = await loadLiveHtml();
  const dataset = buildDataset(live.text, live.url || SOURCE);
  writeCache(dataset);
  console.log(`[brands] updated: ${dataset.brandCount} brands / ${dataset.modelCount} models`);
  return dataset;
}

async function main() {
  console.log(`[brands] source: ${SOURCE}`);
  console.log(`[brands] cache: ${CACHE}`);
  try {
    await refresh();
  } catch (error) {
    const cached = readCache();
    console.error(`[brands] refresh failed: ${error.message}`);
    if (cached) console.log(`[brands] keeping cache: ${cached.brandCount} brands / ${cached.modelCount} models`);
  }

  setInterval(() => {
    refresh().catch(error => console.error(`[brands] scheduled refresh failed: ${error.message}`));
  }, REFRESH_MS);
}

if (require.main === module) {
  main().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = {
  cleanText,
  extractJsonLdBrands,
  extractModels,
  buildDataset,
  readCache,
  refresh
};
