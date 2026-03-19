const { detectCategory } = require('../../lib/categorizer');

describe('Categorizer Unit Tests', () => {
  test('should detect Politics category', () => {
    expect(detectCategory('Imran Khan addresses PTI rally in Lahore')).toBe('Politics');
    expect(detectCategory('PM Shehbaz Sharif chairs cabinet meeting')).toBe('Politics');
  });

  test('should detect Economy category', () => {
    expect(detectCategory('IMF approves next tranche for Pakistan')).toBe('Economy');
    expect(detectCategory('Pakistan Stock Exchange (PSX) hits record high')).toBe('Economy');
  });

  test('should detect Security category', () => {
    expect(detectCategory('Blast in Quetta kills three, injures many')).toBe('Security');
    expect(detectCategory('CTD operation in Karachi results in arrests')).toBe('Security');
  });

  test('should detect Military category', () => {
    expect(detectCategory('Pakistan Army holds exercises in Punjab')).toBe('Military');
    expect(detectCategory('COAS General Asim Munir visits forward posts')).toBe('Military');
  });

  test('should detect Sports category', () => {
    expect(detectCategory('Babar Azam leads Pakistan to victory in PSL')).toBe('Sports');
    expect(detectCategory('Cricket series against South Africa announced')).toBe('Sports');
  });

  test('should detect Entertainment category', () => {
    expect(detectCategory('New drama serial featuring popular actress triggers debate')).toBe('Entertainment');
    expect(detectCategory('Lollywood film star wins international award')).toBe('Entertainment');
  });

  test('should fallback to Society for unknown topics', () => {
    expect(detectCategory('Random news about daily life in Abbottabad')).toBe('Society');
  });
});
