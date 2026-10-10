/**
 * Optional PF2e Toolbelt integration.
 * Toolbelt's Target Helper upgrades a chat message whose content is a single inline save
 * into a per-target save card, and its damage messages then apply results per target.
 */

const TOOLBELT_ID = 'pf2e-toolbelt';

/** The Target Helper api when Toolbelt is active and the tool is enabled, else null. */
export function toolbeltTargetHelper() {
  if (!game.modules.get(TOOLBELT_ID)?.active) return null;
  const tb = game.toolbelt;
  if (!tb?.getToolSetting?.('targetHelper', 'enabled')) return null;
  return tb.api?.targetHelper ?? null;
}

/**
 * Chat message data for a save request. The content stays a bare inline check so Toolbelt
 * recognises it; without Toolbelt it is still a clickable PF2e save link.
 */
export function buildSaveRequest({ raw, speaker, targetUuids, targetHelper }) {
  const data = { content: raw, speaker };
  if (targetHelper && targetUuids.length) {
    return targetHelper.setMessageFlagTargets(data, targetUuids);
  }
  return data;
}
