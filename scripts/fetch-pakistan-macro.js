#!/usr/bin/env node
/**
 * Fetches Pakistan macro series from World Bank API and writes JSON used by the
 * Pakistan Trajectory widget. Run manually or in CI when you want fresh numbers:
 *   node scripts/fetch-pakistan-macro.js
 *
 * Outputs:
 *   public/data/pakistan-macro.json  (Vercel static — zero server cost for reads)
 *   backend/data/pakistan-macro.json (Railway API fallback / AI prompt context)
 */

const fs = require('fs');
const path = require('path');

const FROM_YEAR = 1989;
const TO_YEAR = new Date().getFullYear();

const INDICATORS = [
  {
    id: 'gdpGrowth',
    wbId: 'NY.GDP.MKTP.KD.ZG',
    label: 'GDP growth (annual %)',
    shortLabel: 'GDP growth',
    unit: '%'
  },
  {
    id: 'inflation',
    wbId: 'FP.CPI.TOTL.ZG',
    label: 'Inflation, consumer prices (annual %)',
    shortLabel: 'CPI inflation',
    unit: '%'
  },
  {
    id: 'extDebtGni',
    wbId: 'DT.DOD.DECT.GN.ZS',
    label: 'External debt stocks (% of GNI)',
    shortLabel: 'External debt / GNI',
    unit: '%'
  },
  {
    id: 'poverty',
    wbId: 'SI.POV.DDAY',
    label: null, // filled from API (PPP line varies by vintage)
    shortLabel: 'Poverty headcount',
    unit: '%',
    sparse: true
  }
];

async function fetchIndicator(wbId) {
  const u = new URL('https://api.worldbank.org/v2/country/PAK/indicator/' + wbId);
  u.searchParams.set('format', 'json');
  u.searchParams.set('per_page', '500');
  u.searchParams.set('date', `${FROM_YEAR}:${TO_YEAR}`);
  const res = await fetch(u);
  if (!res.ok) throw new Error(`WB ${wbId}: HTTP ${res.status}`);
  const data = await res.json();
  const rows = data[1];
  if (!Array.isArray(rows)) throw new Error(`WB ${wbId}: bad payload`);
  const wbName = rows[0]?.indicator?.value || wbId;
  const points = [];
  for (const row of rows) {
    if (row.value == null || row.value === '') continue;
    const y = parseInt(row.date, 10);
    if (y < FROM_YEAR || y > TO_YEAR) continue;
    points.push({ y, v: Number(row.value) });
  }
  points.sort((a, b) => a.y - b.y);
  return { wbName, points };
}

function buildStaticInsight(seriesById, bundleDateIso) {
  const gdp = seriesById.gdpGrowth?.points || [];
  const pov = seriesById.poverty?.points || [];
  const inf = seriesById.inflation?.points || [];
  const debt = seriesById.extDebtGni?.points || [];
  const last = (arr) => arr[arr.length - 1];
  const first = (arr) => arr[0];

  const g0 = first(gdp);
  const g1 = last(gdp);
  const p0 = first(pov);
  const p1 = last(pov);
  const i1 = last(inf);
  const d1 = last(debt);

  const gdpVs = gdp.map((x) => x.v).filter((v) => Number.isFinite(v));
  const gMin = gdpVs.length ? Math.min(...gdpVs) : NaN;
  const gMax = gdpVs.length ? Math.max(...gdpVs) : NaN;

  const bundleDay = bundleDateIso ? bundleDateIso.slice(0, 10) : '—';

  return [
    `This block uses World Development Indicators. This JSON was built on ${bundleDay} (not the same as “data through” — the Bank publishes each indicator on its own schedule). Poverty appears only in survey years. External debt is external debt stocks as % of GNI — not the same as total government debt-to-GDP.`,
    '',
    `Newest calendar year in this file — GDP ${g1?.y || '—'}, CPI ${i1?.y || '—'}, external debt ${d1?.y || '—'}, poverty ${p1?.y || '—'} (poverty is sparse).`,
    '',
    `GDP growth from ${g0?.y || '—'} to ${g1?.y || '—'} ranged about ${Number.isFinite(gMin) ? gMin.toFixed(1) : '—'}% to ${Number.isFinite(gMax) ? gMax.toFixed(1) : '—'}%; latest near ${g1 ? g1.v.toFixed(1) : '—'}%.`,
    `Poverty headcount: about ${p0 ? p0.v.toFixed(1) : '—'}% (${p0?.y || '—'}) vs ${p1 ? p1.v.toFixed(1) : '—'}% (${p1?.y || '—'}) — see methodology in Sources.`,
    `Latest CPI inflation about ${i1 ? i1.v.toFixed(1) : '—'}% (${i1?.y || '—'}); external debt about ${d1 ? d1.v.toFixed(1) : '—'}% of GNI (${d1?.y || '—'}).`,
    '',
    'Optional AI summary (below) is cached on the server when Groq is configured.'
  ].join('\n');
}

function latestObsFromSeries(seriesList) {
  return seriesList.map((s) => {
    const pts = s.points || [];
    const p = pts.length ? pts[pts.length - 1] : null;
    return {
      id: s.id,
      shortLabel: s.shortLabel,
      unit: s.unit,
      year: p ? p.y : null,
      value: p ? p.v : null
    };
  });
}

async function main() {
  const series = [];
  const byId = {};

  for (const def of INDICATORS) {
    const { wbName, points } = await fetchIndicator(def.wbId);
    const label = def.id === 'poverty' ? wbName : def.label;
    const entry = {
      id: def.id,
      wbId: def.wbId,
      label,
      shortLabel: def.shortLabel,
      unit: def.unit,
      sparse: !!def.sparse,
      points
    };
    series.push(entry);
    byId[def.id] = entry;
  }

  const updatedAt = new Date().toISOString();
  const payload = {
    meta: {
      country: 'Pakistan',
      iso3: 'PAK',
      range: { from: FROM_YEAR, to: TO_YEAR },
      updatedAt,
      latestObs: latestObsFromSeries(series),
      sources: [
        {
          name: 'World Bank — World Development Indicators',
          url: 'https://data.worldbank.org/country/pakistan',
          license: 'CC BY 4.0'
        }
      ],
      disclaimer:
        'Estimates vary by methodology and year. Poverty series are not annual; debt shown is external debt relative to GNI, not total public debt/GDP. WDI releases lag: the newest calendar year differs by indicator and is whatever the Bank has published to date.',
      schemaVersion: 1
    },
    staticInsight: buildStaticInsight(byId, updatedAt),
    series
  };

  const outPublic = path.join(__dirname, '../public/data/pakistan-macro.json');
  const outBackend = path.join(__dirname, '../backend/data/pakistan-macro.json');
  fs.mkdirSync(path.dirname(outPublic), { recursive: true });
  fs.mkdirSync(path.dirname(outBackend), { recursive: true });
  const json = JSON.stringify(payload, null, 2);
  fs.writeFileSync(outPublic, json, 'utf8');
  fs.writeFileSync(outBackend, json, 'utf8');
  console.log('Wrote', outPublic);
  console.log('Wrote', outBackend);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
