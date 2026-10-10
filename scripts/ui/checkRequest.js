/** Inline check text for posting a disable option to chat, e.g. @Check[nature|dc:24|name:…]. */
export function buildCheckRequest({ skill, dc, label, traits = [] }) {
  const parts = [skill];
  if (dc != null) parts.push(`dc:${dc}`);
  const name = String(label ?? '')
    .replace(/[[\]|{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (name && name.toLowerCase() !== String(skill).toLowerCase()) parts.push(`name:${name}`);
  if (traits.length) parts.push(`traits:${traits.join(',')}`);
  return `@Check[${parts.join('|')}]`;
}
