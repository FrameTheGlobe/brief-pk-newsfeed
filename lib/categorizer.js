/**
 * lib/categorizer.js
 * Keyword-based category detection for Pakistan news articles.
 * Returns the most specific category match, defaulting to 'Society'.
 */

const CATEGORY_MAP = [
  {
    name: 'Politics',
    keywords: [
      'parliament','pm ','prime minister','government','election','pti','pmln',
      'pml-n','ppp','minister','senator','assembly','cabinet','imran khan',
      'shehbaz sharif','nawaz sharif','asif zardari','bilawal','chief justice',
      'judiciary','constitution','political party','vote','speaker','coalition',
      'senate','national assembly','provincial','chief minister','cm ',
      'governor','president of pakistan','presidency',
    ],
  },
  {
    name: 'Economy',
    keywords: [
      'economy','gdp','imf','finance','dollar','rupee','inflation','sbp',
      'state bank','stock exchange','kse','budget','trade deficit','fiscal',
      'national debt','economic','revenue','tax','investment','market crash',
      'growth rate','recession','loan','bailout','forex','reserves',
      'petroleum price','fuel price','petrol','electricity price','power tariff',
      'cpec investment','privatisation','privatization','sme','exports','imports',
    ],
  },
  {
    name: 'Geopolitics',
    keywords: [
      'china','cpec','united states','us-pakistan','russia','afghanistan',
      'iran','saudi arabia','gulf','turkey','nato','strategic partnership',
      'regional stability','middle east','sco','brics','kashmir conflict',
      'india-pakistan','line of control','loc ','working boundary',
      'haqqani network','taliban ','doha agreement',
    ],
  },
  {
    name: 'Foreign Policy',
    keywords: [
      'ambassador','embassy','diplomacy','foreign minister','bilateral talks',
      'treaty','memorandum','agreement','united nations','un security',
      'foreign policy','envoy','consulate','diplomatic relations',
      'foreign office','state department','pakistan foreign','visited pakistan',
      'pakistan delegation','foreign visit','official visit',
    ],
  },
  {
    name: 'Security',
    keywords: [
      'terrorist','terrorism','bomb blast','blast','attack on','suicide bombing',
      'ied ','killed in','injured in','explosion','ttp','ctd','counter terrorism',
      'ranger','militant','extremist','encounter','insurgent','kidnap',
      'abducted','target killing','sectarian','mass shooting','attack kills',
    ],
  },
  {
    name: 'Military',
    keywords: [
      'army','ispr','dg ispr','coas','chief of army staff','military','general ',
      'air force','pakistan navy','isc','isi ','border patrol','soldier',
      'exercise','defence','corps commander','jcsc','admiral',
      'pakistan armed forces','pak army','pak navy','paf ',
    ],
  },
  {
    name: 'Sports',
    keywords: [
      'cricket','psl','pakistan super league','pcb','pakistan cricket',
      'football','hockey','batting','bowling','test match','odi match',
      't20 match','world cup','pak squad','athlete','olympic','squash',
      'wicket','century','runs scored','match preview','match report',
      'sports ministry','national team','pakistan team',
    ],
  },
  {
    name: 'Technology',
    keywords: [
      'technology','digital pakistan','cyber','internet shutdown','broadband',
      'software house','startup','artificial intelligence',' ai ','blockchain',
      'mobile app','ict sector','e-commerce','5g pakistan','semiconductor',
      'social media ban','twitter ban','vpn','freelancer','it sector',
    ],
  },
  {
    name: 'Society',
    keywords: [
      'education','health','hospital','school','university','culture',
      'religion','poverty','flood','earthquake','disaster','weather',
      'climate change','environment','pollution','women','children',
      'minority','human rights','social welfare','court verdict','civil society',
    ],
  },
];

/**
 * Detect category from article title and description.
 * @param {string} title
 * @param {string} description
 * @returns {string} category name
 */
function detectCategory(title = '', description = '') {
  const text = (title + ' ' + description).toLowerCase();

  for (const { name, keywords } of CATEGORY_MAP) {
    if (keywords.some(kw => text.includes(kw))) {
      return name;
    }
  }

  return 'Society';
}

module.exports = { detectCategory, CATEGORY_MAP };
