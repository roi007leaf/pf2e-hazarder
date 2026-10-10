let systemId = null;

export function detectSystem() {
  systemId = game.system.id;
}

export function getSystemId() {
  return systemId || game.system?.id || 'pf2e';
}

export function getSystemFlags(doc) {
  return doc?.flags?.[getSystemId()];
}
