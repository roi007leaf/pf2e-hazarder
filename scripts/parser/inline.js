const CHECK_RE = /@Check\[([^\]]+)\](?:\{([^}]*)\})?/g;
const COUNTERACT_RE = /@UUID\[(Compendium\.[^\]]*spells[^\]]*)\]\{([^}]*)\}\s*\(([^)]*)\)/g;

export function stripHtml(html) {
  if (html == null) return '';
  return String(html)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseInlineChecks(html) {
  const out = [];
  if (!html) return out;
  for (const m of String(html).matchAll(CHECK_RE)) {
    const parts = m[1].split('|');
    const params = {};
    parts.forEach((part, i) => {
      const colon = part.indexOf(':');
      if (i === 0 && colon === -1) {
        params.type = part.trim();
        return;
      }
      if (colon === -1) return;
      params[part.slice(0, colon).trim()] = part.slice(colon + 1).trim();
    });
    if (!params.type) continue;
    const dc = Number.parseInt(params.dc, 10);
    out.push({
      skill: params.type,
      dc: Number.isFinite(dc) ? dc : null,
      label: params.name || (m[2] ? m[2].trim() : '') || params.type,
      traits: params.traits ? params.traits.split(',').map((t) => t.trim()).filter(Boolean) : [],
      index: m.index,
      end: m.index + m[0].length,
    });
  }
  return out;
}

export function parseCounteracts(html) {
  const out = [];
  if (!html) return out;
  for (const m of String(html).matchAll(COUNTERACT_RE)) {
    const rank = /(\d+)(?:st|nd|rd|th)\s+rank/i.exec(m[3]);
    const dc = /counteract\s+DC\s+(\d+)/i.exec(m[3]);
    out.push({
      spellUuid: m[1],
      name: m[2].trim(),
      rank: rank ? Number(rank[1]) : null,
      dc: dc ? Number(dc[1]) : null,
    });
  }
  return out;
}
