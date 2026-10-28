#!/usr/bin/env node
// Pulls Julian's works from OpenAlex + ORCID and merges new ones into
// src/data/publications.json. Existing entries are never overwritten, except
// that a preprint is upgraded once its published version shows up.
// Usage: node scripts/sync-publications.mjs [--dry-run]

import { readFile, writeFile } from 'node:fs/promises';

const ORCID = '0000-0001-8949-6134';
const OPENALEX_AUTHOR = 'A5014575365';
const SELF = 'Julian Nubert';
const MAILTO = 'site-bot@juliannubert.com';

const DATA = new URL('../src/data/publications.json', import.meta.url);
const IGNORE = new URL('../src/data/publications.ignore.json', import.meta.url);
const dryRun = process.argv.includes('--dry-run');

const SKIP_TYPES = new Set(['dataset', 'paratext', 'peer-review', 'erratum', 'retraction', 'other']);

const VENUES = [
  [/transactions on robotics/i, 'IEEE Transactions on Robotics (T-RO)'],
  [/transactions on field robotics/i, 'IEEE Transactions on Field Robotics (T-FR)'],
  [/robotics and automation letters/i, 'IEEE Robotics and Automation Letters (RA-L)'],
  [/intelligent robots and systems|\bIROS\b/i, 'IEEE/RSJ Intl. Conf. on Intelligent Robots and Systems (IROS)'],
  [/conference on robotics and automation|\bICRA\b/i, 'IEEE Intl. Conf. on Robotics and Automation (ICRA)'],
  [/robotics: science and systems/i, 'Robotics: Science and Systems (RSS)'],
  [/field and service robotics/i, 'Field and Service Robotics (FSR)'],
  [/arxiv/i, 'arXiv preprint'],
];

export const titleKey = (t) => t.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '');

const cleanVenue = (v) => {
  if (!v) return '';
  if (/workshop/i.test(v)) return v.trim();
  for (const [re, name] of VENUES) if (re.test(v)) return name;
  return v.replace(/\.$/, '').trim();
};

const cleanAuthor = (name) => {
  const m = name.match(/^([^,]+),\s*(.+)$/); // "Last, First" -> "First Last"
  return m ? `${m[2]} ${m[1]}` : name;
};

const doiOf = (url) => url?.replace(/^https?:\/\/(dx\.)?doi\.org\//i, '').toLowerCase() || '';
const arxivOf = (doi) => doi.match(/arxiv\.(\d{4}\.\d{4,5})/i)?.[1] || '';

function classify(type, venue, doi) {
  if (type === 'dissertation') return 'thesis';
  if (/workshop/i.test(venue)) return 'workshop';
  if (type === 'preprint' || arxivOf(doi) || /repository|arxiv/i.test(venue)) return 'preprint';
  if (type === 'book-chapter') return 'conference';
  if (/journal|article/.test(type)) return 'journal';
  return 'conference';
}

async function getJSON(url, headers = {}) {
  const res = await fetch(url, { headers: { 'User-Agent': `juliannubert.com (${MAILTO})`, ...headers } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

async function fromOpenAlex() {
  const out = [];
  let cursor = '*';
  while (cursor) {
    const url = `https://api.openalex.org/works?filter=author.id:${OPENALEX_AUTHOR}&per_page=100&cursor=${cursor}` +
      `&select=id,doi,title,publication_year,type,primary_location,authorships&mailto=${MAILTO}`;
    const page = await getJSON(url);
    for (const w of page.results) {
      if (SKIP_TYPES.has(w.type) || !w.title) continue;
      const doi = doiOf(w.doi);
      const venue = w.primary_location?.source?.display_name || '';
      out.push({
        title: w.title,
        authors: w.authorships.map((a) => cleanAuthor(a.author.display_name)),
        year: w.publication_year,
        venue: cleanVenue(venue),
        type: classify(w.type, venue, doi),
        doi,
        source: w.id,
      });
    }
    cursor = page.meta.next_cursor;
  }
  return out;
}

async function fromOrcid() {
  const data = await getJSON(`https://pub.orcid.org/v3.0/${ORCID}/works`, { Accept: 'application/json' });
  return data.group.map((g) => {
    const s = g['work-summary'][0];
    const ids = Object.fromEntries((s['external-ids']?.['external-id'] || []).map((e) => [e['external-id-type'], e['external-id-value']]));
    const venue = s['journal-title']?.value || '';
    const doi = (ids.doi || '').toLowerCase();
    const type = { 'journal-article': 'article', 'conference-paper': 'conference-paper', 'working-paper': 'preprint', 'book-chapter': 'book-chapter' }[s.type] || s.type;
    return {
      title: s.title.title.value,
      authors: [], // ORCID summaries carry no author list; OpenAlex fills it in
      year: Number(s['publication-date']?.year?.value) || null,
      venue: cleanVenue(venue),
      type: /conference-(abstract|poster)/.test(s.type) ? 'workshop' : classify(type, venue, doi),
      doi,
      source: `orcid:${s['put-code']}`,
    };
  });
}

// Merge records describing the same paper; prefer the peer-reviewed version.
function merge(records) {
  const rank = { journal: 0, conference: 1, workshop: 2, thesis: 2, preprint: 3 };
  const groups = new Map();
  for (const r of records) {
    const k = titleKey(r.title);
    groups.set(k, [...(groups.get(k) || []), r]);
  }
  return [...groups.entries()].map(([key, rs]) => {
    rs.sort((a, b) => rank[a.type] - rank[b.type] || (b.authors.length - a.authors.length));
    const best = { ...rs[0] };
    best.authors = rs.find((r) => r.authors.length)?.authors || [];
    best.year = Math.max(...rs.map((r) => r.year || 0)) || best.year;
    if (!best.venue) best.venue = rs.find((r) => r.venue)?.venue || '';
    const arxiv = rs.map((r) => arxivOf(r.doi)).find(Boolean) || '';
    return { key, best, arxiv };
  });
}

// ORCID-only records have no authors; ask the DOI registry (Crossref/DataCite) instead.
async function authorsFromDoi(doi) {
  try {
    const csl = await getJSON(`https://doi.org/${doi}`, { Accept: 'application/vnd.citationstyles.csl+json' });
    const names = (csl.author || []).map((a) => (a.given ? `${a.given} ${a.family}` : a.literal || a.family)).filter(Boolean);
    return names.length ? names.map(cleanAuthor) : null;
  } catch {
    return null;
  }
}

const toEntry =({ key, best, arxiv }) => ({
  id: key.slice(0, 48),
  title: best.title,
  authors: best.authors.length ? best.authors : [SELF],
  year: best.year,
  venue: best.venue,
  type: best.type,
  doi: arxivOf(best.doi) ? '' : best.doi,
  arxiv,
  links: {},
  featured: false,
});

async function main() {
  const existing = JSON.parse(await readFile(DATA, 'utf8').catch(() => '[]'));
  const ignore = new Set(JSON.parse(await readFile(IGNORE, 'utf8').catch(() => '[]')).map(titleKey));
  const byKey = new Map(existing.map((e) => [titleKey(e.title), e]));

  const [oa, orcid] = await Promise.all([fromOpenAlex(), fromOrcid().catch((e) => (console.warn('ORCID failed:', e.message), []))]);
  const merged = merge([...oa, ...orcid]);

  const added = [];
  const upgraded = [];
  for (const m of merged) {
    if (ignore.has(m.key)) continue;
    const cur = byKey.get(m.key) || existing.find((e) => e.id === m.key.slice(0, 48));
    if (!cur) {
      const entry = toEntry(m);
      if (!m.best.authors.length && entry.doi) entry.authors = (await authorsFromDoi(entry.doi)) || entry.authors;
      existing.push(entry);
      added.push(entry);
    } else if (cur.type === 'preprint' && m.best.type !== 'preprint' && !cur.locked) {
      Object.assign(cur, { type: m.best.type, venue: m.best.venue, doi: m.best.doi, year: m.best.year });
      if (!cur.arxiv && m.arxiv) cur.arxiv = m.arxiv;
      upgraded.push(cur);
    }
  }

  existing.sort((a, b) => (b.year || 0) - (a.year || 0) || a.title.localeCompare(b.title));

  const summary = [
    ...added.map((e) => `- **New:** ${e.title} (${e.venue || e.type}, ${e.year})`),
    ...upgraded.map((e) => `- **Published:** ${e.title} → ${e.venue}`),
  ].join('\n');
  console.log(summary || 'No changes.');

  if (!dryRun && (added.length || upgraded.length)) {
    await writeFile(DATA, JSON.stringify(existing, null, 2) + '\n');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
