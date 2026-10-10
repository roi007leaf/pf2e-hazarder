import { parseCounteracts, parseInlineChecks, stripHtml } from '../../scripts/parser/inline.js';

describe('stripHtml', () => {
  test('removes tags and collapses whitespace', () => {
    expect(stripHtml('<p>Hello <strong>you</strong>\n there</p>')).toBe('Hello you there');
  });
  test('nullish gives empty string', () => {
    expect(stripHtml(undefined)).toBe('');
  });
});

describe('parseInlineChecks', () => {
  test('parses skill, dc, name and traits', () => {
    const html =
      '<p>@Check[thievery|dc:32|name:Disable Telekinetic Decoration|traits:action:disable-a-device] (master)</p>';
    const [c] = parseInlineChecks(html);
    expect(c).toMatchObject({
      skill: 'thievery',
      dc: 32,
      label: 'Disable Telekinetic Decoration',
      traits: ['action:disable-a-device'],
    });
  });
  test('supports type: key, brace label and comma traits', () => {
    const html = '@Check[type:religion|dc:35|traits:haunt,mechanical]{Religion (expert)}';
    const [c] = parseInlineChecks(html);
    expect(c).toMatchObject({
      skill: 'religion',
      dc: 35,
      label: 'Religion (expert)',
      traits: ['haunt', 'mechanical'],
    });
  });
  test('falls back to skill as label and null dc', () => {
    const [c] = parseInlineChecks('@Check[survival]');
    expect(c).toMatchObject({ skill: 'survival', dc: null, label: 'survival', traits: [] });
  });
  test('reports offsets in raw text', () => {
    const html = 'x @Check[athletics|dc:20] y';
    const [c] = parseInlineChecks(html);
    expect(html.slice(c.index, c.end)).toBe('@Check[athletics|dc:20]');
  });
  test('finds several checks', () => {
    expect(parseInlineChecks('@Check[a|dc:1] or @Check[b|dc:2]')).toHaveLength(2);
  });
});

describe('parseCounteracts', () => {
  test('parses spell uuid, rank and dc', () => {
    const html =
      '@UUID[Compendium.pf2e.spells-srd.Item.9HpwDN4MYQJnW0LG]{Dispel Magic} (6th rank; counteract DC 30) to counteract';
    expect(parseCounteracts(html)).toEqual([
      {
        spellUuid: 'Compendium.pf2e.spells-srd.Item.9HpwDN4MYQJnW0LG',
        name: 'Dispel Magic',
        rank: 6,
        dc: 30,
      },
    ]);
  });
  test('ignores non-spell uuids', () => {
    expect(
      parseCounteracts(
        '@UUID[Compendium.pf2e.equipment-srd.Item.x]{Rope} (1st rank; counteract DC 1)',
      ),
    ).toEqual([]);
  });
});
