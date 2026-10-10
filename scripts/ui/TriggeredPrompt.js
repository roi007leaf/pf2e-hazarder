export async function showTriggered(tokenDoc, plan) {
  const name = tokenDoc.name;
  const item = plan.reactionItemId ? tokenDoc.actor?.items.get(plan.reactionItemId) : null;
  const fire = await foundry.applications.api.DialogV2.confirm({
    window: { title: game.i18n.format('PF2E_HAZARDER.Triggered.Title', { name }) },
    content: `<p>${game.i18n.localize('PF2E_HAZARDER.Triggered.Body')}</p>`,
    yes: { label: game.i18n.localize('PF2E_HAZARDER.Triggered.Fire') },
  });
  if (fire && item) await item.toMessage();
}
