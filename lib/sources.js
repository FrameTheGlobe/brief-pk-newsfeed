/**
 * lib/sources.js
 * All Pakistan-focused news sources.
 * Rules: No Indian media, no Israeli media.
 * International coverage of Pakistan (BBC Urdu, Al Jazeera Pakistan) is included.
 */

const SOURCES = [
  // ── English Print ──────────────────────────────────────────────────
  {
    id:    'dawn',
    name:  'Dawn',
    url:   'https://www.dawn.com/feeds/latest-news',
    color: '#006B3C',
    type:  'Print',
    lang:  'en',
  },
  {
    id:    'thenews',
    name:  'The News',
    url:   'https://www.thenews.com.pk/rss/1/16',
    color: '#1B4F72',
    type:  'Print',
    lang:  'en',
  },
  {
    id:    'tribune',
    name:  'Express Tribune',
    url:   'https://tribune.com.pk/feed',
    color: '#C0392B',
    type:  'Print',
    lang:  'en',
  },
  {
    id:    'paktoday',
    name:  'Pakistan Today',
    url:   'https://www.pakistantoday.com.pk/feed/',
    color: '#1A252F',
    type:  'Print',
    lang:  'en',
  },
  {
    id:    'nation',
    name:  'The Nation',
    url:   'https://nation.com.pk/feed/',
    color: '#1A237E',
    type:  'Print',
    lang:  'en',
  },
  {
    id:    'brecorder',
    name:  'Business Recorder',
    url:   'https://www.brecorder.com/feed/',
    color: '#1E8449',
    type:  'Business',
    lang:  'en',
  },
  // ── TV / Broadcast ─────────────────────────────────────────────────
  {
    id:    'geo',
    name:  'Geo News',
    url:   'https://www.geo.tv/rss/1',
    color: '#00843D',
    type:  'TV',
    lang:  'en',
  },
  {
    id:    'ary',
    name:  'ARY News',
    url:   'https://arynews.tv/feed',
    color: '#00529B',
    type:  'TV',
    lang:  'en',
  },
  {
    id:    'samaa',
    name:  'Samaa TV',
    url:   'https://www.samaa.tv/feed/',
    color: '#E07B1A',
    type:  'TV',
    lang:  'en',
  },
  {
    id:    'dunya',
    name:  'Dunya News',
    url:   'https://dunyanews.tv/index.php/en?format=feed&type=rss',
    color: '#A93226',
    type:  'TV',
    lang:  'en',
  },
  {
    id:    '24news',
    name:  '24 News HD',
    url:   'https://24newshd.tv/feed/',
    color: '#1A5276',
    type:  'TV',
    lang:  'en',
  },
  // ── Digital / Independent ──────────────────────────────────────────
  {
    id:    'nayadaur',
    name:  'Naya Daur',
    url:   'https://nayadaur.tv/feed/',
    color: '#6C3483',
    type:  'Digital',
    lang:  'en',
  },
  // ── International (Pakistan desk) ─────────────────────────────────
  {
    id:    'bbcurdu',
    name:  'BBC Urdu',
    url:   'https://feeds.bbci.co.uk/urdu/rss.xml',
    color: '#BB1919',
    type:  'Intl',
    lang:  'ur',
  },
];

module.exports = SOURCES;
