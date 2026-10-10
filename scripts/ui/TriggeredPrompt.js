export async function showTriggered(tokenDoc, plan) {
  const name = tokenDoc.name;
  const item = plan.reactionItemId ? tokenDoc.actor?.items.get(plan.reactionItemId) : null;
  const { DialogV2 } = foundry.applications.api;
  const title = game.i18n.format('PF2E_HAZARDER.Triggered.Title', { name });
  if (!item) {
    // Nothing to post: inform the GM without offering a reaction.
    await DialogV2.prompt({
      window: { title },
      content: `<p>${game.i18n.localize('PF2E_HAZARDER.Triggered.NoReaction')}</p>`,
    });
    return;
  }
  const fire = await DialogV2.confirm({
    window: { title },
    content: `<p>${game.i18n.localize('PF2E_HAZARDER.Triggered.Body')}</p>`,
    yes: { label: game.i18n.localize('PF2E_HAZARDER.Triggered.Fire') },
  });
  if (fire) await item.toMessage();
}
