/**
 * lib/feed-utils.js
 * Utility functions for RSS feed processing.
 */

function clean(str = '') {
  return str
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g,  '&')
    .replace(/&lt;/g,   '<')
    .replace(/&gt;/g,   '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g,  "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g,    ' ')
    .trim();
}

function extractImage(html = '') {
  const m = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  return m ? m[1] : null;
}

function getImage(item) {
  if (item.enclosure?.url && /\.(jpg|jpeg|png|webp|gif)/i.test(item.enclosure.url)) {
    return item.enclosure.url;
  }
  if (item.mediaThumbnail?.['$']?.url) return item.mediaThumbnail['$'].url;
  if (item.mediaContent?.['$']?.url)   return item.mediaContent['$'].url;

  const html = item['content:encoded'] || item.content || item.summary || '';
  return extractImage(html);
}

function truncate(str = '', n = 160) {
  const s = clean(str);
  if (s.length <= n) return s;
  return s.slice(0, n).replace(/\s\S*$/, '') + '…';
}

function isRtl(str = '') {
  return /[\u0600-\u06FF\u0750-\u077F]/.test(str);
}

const PK_KEYWORDS = [
  'pakistan', 'pakistani', 'pak ',
  'islamabad', 'karachi', 'lahore', 'peshawar', 'quetta', 'rawalpindi',
  'multan', 'faisalabad', 'hyderabad', 'gujranwala', 'sialkot', 'abbottabad',
  'swat', 'mardan', 'larkana', 'sukkur', 'gilgit', 'muzaffarabad',
  'balochistan', 'khyber pakhtunkhwa', 'sindh', 'punjab', 'kpk', 'fata',
  'azad kashmir', 'ajk ', 'gilgit-baltistan', 'gb ',
  'imran khan', 'shehbaz', 'nawaz sharif', 'maryam nawaz', 'bilawal',
  'asif zardari', 'fazlur rehman', 'siraj ul haq',
  'pti', 'pml-n', 'pmln', 'ppp', 'mqm', 'jui-f', 'tehreek-e-insaf',
  'national assembly', 'senate of pakistan', 'supreme court of pakistan',
  'lahore high court', 'sindh high court', 'balochistan high court',
  'election commission of pakistan', 'ecp ', 'govt of pakistan',
  'state bank of pakistan', 'sbp', 'kse', 'psx', 'karachi stock',
  'pak rupee', 'pakistani rupee', 'pkr', 'imf pakistan', 'cpec',
  'fbr ', 'secp', 'ogra', 'nepra', 'wapda', 'pso ',
  'pakistan army', 'ispr', 'coas', 'isi ', 'dg ispr', 'dg isi',
  'inter-services', 'pak air force', 'pak navy', 'paf ',
  'fc balochistan', 'frontier corps', 'rangers', 'ctd ',
  'ttp ', 'tehrik-i-taliban', 'baloch liberation',
  'kashmir', 'line of control', 'loc ', 'torkham', 'chaman',
  'durand line', 'pak-afghan', 'pak-iran', 'pak-india', 'pak-china',
  'پاکستان', 'کراچی', 'لاہور', 'اسلام آباد', 'پشاور', 'کوئٹہ',
  'وزیراعظم', 'فوج', 'حکومت', 'عمران خان', 'شہباز',
];

function isPakistanRelevant(title = '', desc = '') {
  const text = (title + ' ' + desc).toLowerCase();
  return PK_KEYWORDS.some(kw => text.includes(kw));
}

function applyFilters(articles, query = {}) {
  let result = articles;
  if (query.source) result = result.filter(a => a.source.id === query.source);
  if (query.category) result = result.filter(a => a.category.toLowerCase() === query.category.toLowerCase());
  const limit = parseInt(query.limit, 10) || 200;
  return result.slice(0, limit);
}

module.exports = {
  clean,
  extractImage,
  getImage,
  truncate,
  isRtl,
  isPakistanRelevant,
  applyFilters
};
