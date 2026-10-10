import { extractSaves, splitRoutine } from '../../scripts/ui/routineParts.js';

const faith =
  '<p>(3 actions; divine, enchantment, mental) Ghostly images of chanting dwarves float through the room. A targeted creature must attempt a @Check[will|dc:25|traits:divine,enchantment,mental] save.</p>' +
  '<hr /><p><strong>Critical Success</strong> The creature is unaffected.</p>' +
  '<p><strong>Success</strong> The creature takes @Damage[1d10[mental]] damage.</p>';

describe('splitRoutine', () => {
  test('strips the action prefix and returns its traits', () => {
    const { traits, intro } = splitRoutine(faith);
    expect(traits).toEqual(['divine', 'enchantment', 'mental']);
    expect(intro.startsWith('<p>Ghostly images')).toBe(true);
    expect(intro).not.toContain('3 actions');
  });

  test('splits outcomes at the rule before Critical Success', () => {
    const { intro, outcomes } = splitRoutine(faith);
    expect(intro).not.toContain('Critical Success');
    expect(intro).not.toContain('<hr');
    expect(outcomes.startsWith('<p><strong>Critical Success</strong>')).toBe(true);
    expect(outcomes).toContain('@Damage[1d10[mental]]');
  });

  test('splits outcomes without a rule', () => {
    const { outcomes } = splitRoutine(
      '<p>(1 action) It bites.</p><p><strong>Critical Success</strong> Nothing.</p>',
    );
    expect(outcomes).toBe('<p><strong>Critical Success</strong> Nothing.</p>');
  });

  test('prefix without traits, word counts and no outcomes', () => {
    expect(splitRoutine('<p>(two actions) It spins.</p>')).toEqual({
      traits: [],
      intro: '<p>It spins.</p>',
      outcomes: null,
    });
  });

  test('multi-word traits become slugs; prose without a prefix is untouched', () => {
    expect(splitRoutine('<p>(1 action; death, void energy) X</p>').traits).toEqual([
      'death',
      'void-energy',
    ]);
    expect(splitRoutine('<p>On its initiative it spins.</p>')).toEqual({
      traits: [],
      intro: '<p>On its initiative it spins.</p>',
      outcomes: null,
    });
  });

  test('empty input is safe', () => {
    expect(splitRoutine(undefined)).toEqual({ traits: [], intro: '', outcomes: null });
  });
});

describe('extractSaves', () => {
  test('returns saving throws only, with the raw check and basic flag, deduplicated', () => {
    const raw =
      'Attempt a @Check[will|dc:25|traits:mental] save. Again @Check[will|dc:25|traits:mental]. ' +
      'Then @Check[reflex|dc:20|basic]{basic Reflex} and @Check[athletics|dc:20] to escape.';
    expect(extractSaves(raw)).toEqual([
      { statistic: 'will', dc: 25, basic: false, raw: '@Check[will|dc:25|traits:mental]' },
      { statistic: 'reflex', dc: 20, basic: true, raw: '@Check[reflex|dc:20|basic]' },
    ]);
  });

  test('none when there is no save', () => {
    expect(extractSaves('<p>It bites.</p>')).toEqual([]);
  });
});
