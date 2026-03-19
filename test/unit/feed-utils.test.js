const { 
  clean, 
  extractImage, 
  truncate, 
  isRtl, 
  isPakistanRelevant,
  applyFilters
} = require('../../lib/feed-utils');

describe('Feed Utils Unit Tests', () => {
  describe('clean()', () => {
    test('should strip HTML tags', () => {
      expect(clean('<p>Hello <b>World</b></p>')).toBe('Hello World');
    });

    test('should decode entities', () => {
      expect(clean('Fish &amp; Chips')).toBe('Fish & Chips');
      expect(clean('Let&#39;s go')).toBe("Let's go");
    });

    test('should collapse whitespace', () => {
      expect(clean('  many    spaces  ')).toBe('many spaces');
    });
  });

  describe('extractImage()', () => {
    test('should find img src', () => {
      const html = '<div><img src="https://example.com/a.jpg"></div>';
      expect(extractImage(html)).toBe('https://example.com/a.jpg');
    });

    test('should return null if no img', () => {
      expect(extractImage('no image here')).toBeNull();
    });
  });

  describe('truncate()', () => {
    test('should truncate at word boundary', () => {
      const longText = 'This is a very long sentence that should be truncated';
      expect(truncate(longText, 20)).toBe('This is a very long…');
    });

    test('should not truncate if short enough', () => {
      expect(truncate('Short', 20)).toBe('Short');
    });
  });

  describe('isRtl()', () => {
    test('should detect Urdu/Arabic characters', () => {
      expect(isRtl('پاکستان')).toBe(true);
      expect(isRtl('English')).toBe(false);
    });
  });

  describe('isPakistanRelevant()', () => {
    test('should return true for Pakistan related keywords', () => {
      expect(isPakistanRelevant('Breaking news in Islamabad', '')).toBe(true);
      expect(isPakistanRelevant('Cricket match in Karachi', '')).toBe(true);
    });

    test('should return false for unrelated text', () => {
      expect(isPakistanRelevant('Global warming in New York', '')).toBe(false);
    });
  });

  describe('applyFilters()', () => {
    const articles = [
      { id: 1, category: 'Politics', source: { id: 'dawn' } },
      { id: 2, category: 'Sports', source: { id: 'dawn' } },
      { id: 3, category: 'Politics', source: { id: 'tribune' } },
    ];

    test('should filter by source', () => {
      expect(applyFilters(articles, { source: 'dawn' })).toHaveLength(2);
    });

    test('should filter by category', () => {
      expect(applyFilters(articles, { category: 'Politics' })).toHaveLength(2);
    });

    test('should apply limit', () => {
      expect(applyFilters(articles, { limit: 1 })).toHaveLength(1);
    });
  });
});
