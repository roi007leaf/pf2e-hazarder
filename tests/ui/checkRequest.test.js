import { buildCheckRequest } from '../../scripts/ui/checkRequest.js';

test('builds an inline check with dc, name and traits', () => {
  expect(
    buildCheckRequest({
      skill: 'nature',
      dc: 24,
      label: 'Calm the spirits',
      traits: ['action:disable-a-device', 'haunt'],
    }),
  ).toBe('@Check[nature|dc:24|name:Calm the spirits|traits:action:disable-a-device,haunt]');
});

test('omits empty parts and a label equal to the skill', () => {
  expect(buildCheckRequest({ skill: 'religion', dc: null, label: 'religion', traits: [] })).toBe(
    '@Check[religion]',
  );
});

test('strips characters that would break the inline syntax from the label', () => {
  expect(buildCheckRequest({ skill: 'thievery', dc: 30, label: 'Jam [it] | now' })).toBe(
    '@Check[thievery|dc:30|name:Jam it now]',
  );
});
