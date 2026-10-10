import { showTriggered } from '../../scripts/ui/TriggeredPrompt.js';

const DialogV2 = { confirm: jest.fn(async () => true), prompt: jest.fn(async () => null) };
beforeEach(() => {
  global.foundry = { applications: { api: { DialogV2 } } };
  DialogV2.confirm.mockClear();
  DialogV2.prompt.mockClear();
});
afterEach(() => {
  delete global.foundry;
});

const tokenDoc = (item) => ({ name: 'Wheel', actor: { items: { get: () => item } } });

test('no reaction item: info-only prompt, no confirm', async () => {
  await showTriggered(tokenDoc(null), { reactionItemId: null });
  await showTriggered(tokenDoc(undefined), { reactionItemId: 'gone' });
  expect(DialogV2.prompt).toHaveBeenCalledTimes(2);
  expect(DialogV2.prompt.mock.calls[0][0].content).toContain('PF2E_HAZARDER.Triggered.NoReaction');
  expect(DialogV2.confirm).not.toHaveBeenCalled();
});

test('reaction item: confirm then post', async () => {
  const item = { toMessage: jest.fn() };
  await showTriggered(tokenDoc(item), { reactionItemId: 'r1' });
  expect(DialogV2.confirm).toHaveBeenCalled();
  expect(item.toMessage).toHaveBeenCalled();
});
