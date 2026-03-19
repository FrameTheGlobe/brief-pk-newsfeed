/**
 * lib/categorizer.js
 * Category detection for Pakistan intelligence feed articles.
 *
 * Design decisions:
 *  - Categorise on TITLE ONLY. RSS descriptions contain sidebar content, ads,
 *    and related-article text that cause massive false-positive rates.
 *  - Entertainment is checked FIRST so celebrity/drama articles never bleed
 *    into Military, Security, or Foreign Policy.
 *  - All keyword lists use specific phrases to minimise partial-match noise.
 */

const CATEGORY_MAP = [

  // ── Entertainment (HIGHEST PRIORITY — catches before any other category) ──
  {
    name: 'Entertainment',
    keywords: [
      'showbiz', 'bollywood', 'lollywood', 'kollywood',
      'drama serial', 'drama finale', 'drama episode', 'drama cast',
      'telefilm', 'ost release', 'web series', 'reality show',
      'actress', 'film star', 'pop star', 'tiktoker', 'influencer',
      'music video', 'album launch', 'song release', 'concert tour',
      'box office', 'film review', 'movie review',
      'photoshoot', 'red carpet', 'award show', 'award ceremony', 'awards night',
      'mehndi night', 'baraat ceremony', 'wedding reception', 'nikah ceremony',
      'dupatta', 'iftar party photo', 'viral photo', 'viral video',
      'netizens react', 'fans react', 'internet reacts', 'social media reaction',
      'draws online criticism', 'sparks debate over', 'gains attention on social',
    ],
  },

  // ── Sports ────────────────────────────────────────────────────────────────
  {
    name: 'Sports',
    keywords: [
      'cricket', 'psl', 'pakistan super league', 'pcb', 'pakistan cricket',
      'test match', 'odi match', 't20 match', 't20i', 'world cup',
      'pakistan squad', 'batting', 'bowling', 'wicket', 'century',
      'football pakistan', 'hockey pakistan', 'olympic', 'squash',
      'pakistan team', 'national team', 'sports ministry', 'match report',
      'match preview', 'pakistan vs ', ' vs pakistan',
    ],
  },

  // ── Politics ──────────────────────────────────────────────────────────────
  {
    name: 'Politics',
    keywords: [
      'prime minister', 'national assembly', 'provincial assembly', 'senate of pakistan',
      'election commission', 'general election', 'by-election', 'local election',
      'pti', 'pml-n', 'pmln', 'ppp', 'mqm', 'jui-f', 'tehreek-e-insaf',
      'imran khan', 'shehbaz sharif', 'shehbaz ', 'nawaz sharif', 'nawaz ',
      'maryam nawaz', 'bilawal bhutto', 'asif zardari', 'fazlur rehman',
      'pm shehbaz', 'pm nawaz', 'cm shehbaz', 'cm nawaz',
      'chief justice', 'supreme court', 'high court',
      'chief minister', 'governor of', 'president arif',
      'no confidence', 'coalition government', 'cabinet meeting',
      'speaker of assembly', 'vote of confidence', 'parliament session',
      'political prisoner', 'party chairman',
    ],
  },

  // ── Economy ───────────────────────────────────────────────────────────────
  {
    name: 'Economy',
    keywords: [
      'economy', 'gdp', 'imf ', 'imf tranche', 'imf loan', 'imf package',
      'state bank of pakistan', 'sbp', 'sbp policy', 'sbp rate',
      'dollar rate', 'rupee', 'inflation rate', 'kse-100', 'kse 100', 'psx',
      'karachi stock', 'stock exchange', 'budget', 'trade deficit', 'fiscal',
      'national debt', 'economic growth', 'tax collection', 'fbr ',
      'foreign investment', 'market crash', 'recession', 'forex reserves',
      'current account', 'current account surplus', 'current account deficit',
      'petrol price', 'diesel price', 'electricity tariff', 'power tariff',
      'ogra', 'nepra', 'cpec investment', 'privatisation', 'privatization',
      'pakistan exports', 'pakistan imports', 'trade balance', 'it exports',
      'remittances', 'foreign direct investment', 'fdi ',
    ],
  },

  // ── Security ──────────────────────────────────────────────────────────────
  {
    name: 'Security',
    keywords: [
      'terrorist attack', 'terrorism', 'bomb blast', 'blast', 'suicide bombing',

      'ied attack', 'ied explosion', 'killed in attack', 'killed in blast',
      'injured in blast', 'injured in attack',
      'ttp ', 'tehrik-i-taliban', 'tehreek-e-taliban',
      'counter terrorism', 'ctd operation', 'anti-terrorism court',
      'militant attack', 'extremist', 'insurgent',
      'target killing', 'sectarian violence', 'mass shooting',
      'kidnapping in', 'abducted in', 'law enforcement operation',
      'security forces killed', 'soldiers killed', 'attack kills',
    ],
  },

  // ── Military ──────────────────────────────────────────────────────────────
  {
    name: 'Military',
    keywords: [
      'pakistan army', 'pak army', 'ispr', 'dg ispr', 'coas ',
      'chief of army staff', 'army chief', 'air chief', 'naval chief',
      'pak air force', 'pakistan air force', 'paf ', 'pakistan navy',
      'corps commander', 'jcsc', 'inter-services intelligence',
      'frontier corps', 'fc operation', 'military operation',
      'army operation', 'armed forces', 'border patrol',
    ],
  },

  // ── Foreign Policy (checked before Geopolitics — more specific) ──────────
  {
    name: 'Foreign Policy',
    keywords: [
      'foreign minister of pakistan', 'pak foreign minister', 'ishaq dar',
      'foreign office pakistan', 'foreign office spokesperson',
      'pakistan ambassador', 'pakistan embassy', 'pakistan envoy',
      'bilateral talks', 'state visit to pakistan', 'official visit to pakistan',
      'pakistan delegation', 'united nations', 'un security council',
      'diplomatic relations', 'pakistan foreign policy', 'pakistan foreign',
      'joint statement pakistan', 'mou signed pakistan', 'agreement signed pakistan',
      'pakistan meets', 'meets pakistan', 'pakistan holds talks',
    ],
  },

  // ── Geopolitics ───────────────────────────────────────────────────────────
  {
    name: 'Geopolitics',
    keywords: [
      'china-pakistan', 'pak-china', 'cpec', 'us-pakistan', 'pak-us',
      'iran-pakistan', 'pak-iran', 'pak-india', 'india-pakistan',
      'pak-saudi', 'saudi-pakistan', 'pak-afghan', 'afghanistan-pakistan',
      'chinese premier', 'chinese president', 'beijing visit', 'visited beijing',
      'us secretary of state pakistan', 'washington visit', 'visits washington',
      'iran strikes', 'iran war', 'india strikes', 'india attack',
      'nato', 'strategic partnership', 'regional stability',
      'sco summit', 'brics', 'kashmir conflict', 'line of control',
      'haqqani network', 'doha agreement', 'working boundary',
      'airstrikes on kabul', 'strikes on afghanistan', 'pakistan airstrikes',
    ],
  },

  // ── Technology ────────────────────────────────────────────────────────────
  {
    name: 'Technology',
    keywords: [
      'digital pakistan', 'cyber attack pakistan', 'internet shutdown',
      'broadband pakistan', 'software house pakistan', 'pakistan startup',
      'artificial intelligence pakistan', 'ai pakistan', 'blockchain pakistan',
      'mobile app pakistan', 'ict sector', 'e-commerce pakistan',
      '5g pakistan', 'social media ban', 'twitter ban', 'vpn pakistan',
      'freelancer pakistan', 'it exports', 'tech hub pakistan',
    ],
  },

  // ── Society (catch-all for legitimate domestic news) ──────────────────────
  {
    name: 'Society',
    keywords: [
      'education', 'health', 'hospital', 'school', 'university',
      'culture', 'religion', 'poverty', 'flood', 'earthquake',
      'disaster', 'weather', 'climate change', 'environment',
      'pollution', 'women rights', 'children', 'minority',
      'human rights', 'social welfare', 'court verdict', 'civil society',
    ],
  },
];

/**
 * Detect category from article title ONLY.
 * (Description is excluded — RSS body content causes too many false positives.)
 *
 * @param {string} title
 * @returns {string} category name
 */
function detectCategory(title = '') {
  const text = title.toLowerCase();

  for (const { name, keywords } of CATEGORY_MAP) {
    if (keywords.some(kw => text.includes(kw))) {
      return name;
    }
  }

  return 'Society';
}

module.exports = { detectCategory, CATEGORY_MAP };
