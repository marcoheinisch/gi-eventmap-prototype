#!/usr/bin/env node
'use strict';

// Builds events.json from the public gi.de event list (next six months).
// Only title, link, dates, tags and city are taken. No descriptions, no images.

const fs = require('node:fs/promises');
const path = require('node:path');

const BASE_URL = 'https://gi.de/aktuelles/veranstaltungen';
const FILTER_VALUE = 'next:nexthalfyear';
const OUT_FILE = path.join(__dirname, 'events.json');
const CACHE_FILE = path.join(__dirname, '.geocode-cache.json');
const MAX_PAGES = Number(process.env.GI_EVENT_MAX_PAGES || 30);
const MIN_EVENTS = Number(process.env.GI_EVENT_MIN_EVENTS || 5);
const USER_AGENT = process.env.GI_EVENT_USER_AGENT
  || 'gi-eventmap-prototype/0.1 (+https://github.com/marcoheinisch/gi-eventmap-prototype)';
const REQUEST_DELAY_MS = 500;
const NOMINATIM_DELAY_MS = 1100;

// Tags that are not a category. "Online" marks the event as remote, "NotVisible" is a CMS flag.
const NON_CATEGORY_TAGS = new Set(['Online', 'NotVisible']);
// Online events carry the GI office as location; that is not a venue.
const PLACEHOLDER_CITIES = new Set(['Bonn']);

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main() {
  const cache = await readJson(CACHE_FILE, {});
  const events = (await fetchAllPages()).map(normalizeEvent).sort(compareEvents);

  if (events.length < MIN_EVENTS) {
    throw new Error(`Only ${events.length} events parsed (minimum ${MIN_EVENTS}). Not writing events.json; the gi.de markup may have changed.`);
  }

  for (const event of events) {
    if (event.online || !event.city) continue;
    const resolved = await geocodeCity(event.city, cache);
    if (resolved) {
      event.lat = resolved.lat;
      event.lng = resolved.lng;
    }
  }

  await fs.writeFile(CACHE_FILE, `${JSON.stringify(cache, null, 2)}\n`, 'utf8');
  await fs.writeFile(OUT_FILE, `${JSON.stringify(events, null, 2)}\n`, 'utf8');
  const geocoded = events.filter((e) => e.lat !== null).length;
  const online = events.filter((e) => e.online).length;
  console.error(`Wrote ${events.length} events (${geocoded} geocoded, ${online} online) to ${path.basename(OUT_FILE)}`);
}

// ---------- fetching ----------

async function fetchAllPages() {
  const seen = new Set();
  const items = [];

  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = buildPageUrl(page);
    console.error(`Fetching page ${page}`);
    const pageItems = parseEventList(await fetchText(url), url).filter((item) => !seen.has(item.url));
    if (pageItems.length === 0) break;
    for (const item of pageItems) seen.add(item.url);
    items.push(...pageItems);
    await sleep(REQUEST_DELAY_MS);
  }

  return items;
}

function buildPageUrl(page) {
  const url = new URL(BASE_URL);
  url.searchParams.set('tx_solr[filter][0]', FILTER_VALUE);
  if (page > 1) url.searchParams.set('tx_solr[page]', String(page));
  return url.toString();
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: { accept: 'text/html', 'user-agent': USER_AGENT },
    signal: AbortSignal.timeout(30000)
  });
  if (!response.ok) throw new Error(`Failed to fetch ${url}: HTTP ${response.status}`);
  return response.text();
}

// ---------- parsing ----------
// Each list entry is a <div class="wiro-eventListItem"> containing four class-marked fields.
// We split on the wrapper and pick each field by its class instead of guessing from text.

function parseEventList(html, baseUrl) {
  const events = [];

  for (const part of String(html).split('<div class="wiro-eventListItem">').slice(1)) {
    const titleBlock = between(part, 'wiro-eventListItem-title">', '</h3>');
    const link = titleBlock.match(/<a\s+[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!link) continue;

    const range = parseDateRange(text(between(part, 'wiro-eventListItem-date">', '</div>')));
    if (!range) continue;

    const tags = [...between(part, 'wiro-divider', '</div>').matchAll(/<span>([^<]*)<\/span>/g)]
      .map((m) => text(m[1]))
      .filter(Boolean);

    events.push({
      title: text(link[2]),
      url: absolutize(decodeEntities(link[1]), baseUrl),
      dateStart: range.start,
      dateEnd: range.end,
      tags,
      city: text(between(part, 'wiro-eventListItem-location">', '</div>')) || null
    });
  }

  return events;
}

// "09.09.2026" or "21.09.2026 - 25.09.2026"
function parseDateRange(input) {
  const m = String(input || '').match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:\s*[-–—]\s*(\d{1,2})\.(\d{1,2})\.(\d{4}))?$/);
  if (!m) return null;
  const start = toIsoDate(+m[3], +m[2], +m[1]);
  if (!start) return null;
  const end = m[4] ? toIsoDate(+m[6], +m[5], +m[4]) : start;
  return end ? { start, end } : null;
}

function normalizeEvent(raw) {
  const online = raw.tags.includes('Online') || raw.city === 'Online';
  let city = raw.city === 'Online' ? null : raw.city;
  if (online && city && PLACEHOLDER_CITIES.has(city)) city = null;

  return {
    title: raw.title,
    url: raw.url,
    dateStart: raw.dateStart,
    dateEnd: raw.dateEnd,
    category: raw.tags.find((tag) => !NON_CATEGORY_TAGS.has(tag)) || null,
    city,
    lat: null,
    lng: null,
    online
  };
}

function between(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  if (start < 0) return '';
  const from = start + startMarker.length;
  const end = source.indexOf(endMarker, from);
  return end < 0 ? source.slice(from) : source.slice(from, end);
}

function text(input) {
  return decodeEntities(String(input || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function decodeEntities(value) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—' };
  return String(value || '').replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (entity, body) => {
    if (body[0] === '#') {
      const hex = body[1]?.toLowerCase() === 'x';
      const code = Number.parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : entity;
    }
    return Object.prototype.hasOwnProperty.call(named, body) ? named[body] : entity;
  });
}

function absolutize(href, baseUrl) {
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return href;
  }
}

function toIsoDate(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// ---------- geocoding ----------

async function geocodeCity(city, cache) {
  if (Object.prototype.hasOwnProperty.call(cache, city)) return cache[city];

  await sleep(NOMINATIM_DELAY_MS);
  // Free-form query, then accept only hits inside Germany. A structured query with country=Germany
  // would happily return the Bavarian village "Prag" for the Czech capital.
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('q', city);
  url.searchParams.set('format', 'json');
  url.searchParams.set('addressdetails', '1');
  url.searchParams.set('limit', '1');

  console.error(`Geocoding ${city}`);
  const response = await fetch(url, {
    headers: { accept: 'application/json', 'user-agent': USER_AGENT },
    signal: AbortSignal.timeout(30000)
  });
  if (!response.ok) throw new Error(`Nominatim failed for ${city}: HTTP ${response.status}`);

  const results = await response.json();
  const first = Array.isArray(results) ? results[0] : null;
  const inGermany = first && first.address && first.address.country_code === 'de';
  cache[city] = inGermany
    ? { lat: Number(Number(first.lat).toFixed(6)), lng: Number(Number(first.lon).toFixed(6)) }
    : null;
  return cache[city];
}

// ---------- helpers ----------

function compareEvents(a, b) {
  if (a.dateStart !== b.dateStart) return a.dateStart.localeCompare(b.dateStart);
  return a.title.localeCompare(b.title, 'de');
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
