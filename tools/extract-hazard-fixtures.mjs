import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const FOUNDRY_APP =
  process.env.FOUNDRY_APP ?? 'C:/Program Files/Foundry Virtual Tabletop/resources/app';
const PACKS = process.env.PF2E_PACKS ?? path.resolve('../../systems/pf2e/packs');
const require = createRequire(import.meta.url);
const { ClassicLevel } = require(path.join(FOUNDRY_APP, 'node_modules/classic-level'));

const pick = (actor, items) => ({
  _id: actor._id,
  name: actor.name,
  system: {
    details: {
      isComplex: !!actor.system?.details?.isComplex,
      routine: actor.system?.details?.routine ?? '',
      disable: actor.system?.details?.disable ?? '',
      reset: actor.system?.details?.reset ?? '',
    },
  },
  items: items.map((i) => ({
    _id: i._id,
    type: i.type,
    name: i.name,
    system: { actionType: { value: i.system?.actionType?.value ?? null } },
  })),
});

const out = [];
for (const pack of fs.readdirSync(PACKS)) {
  const src = path.join(PACKS, pack);
  if (!fs.statSync(src).isDirectory()) continue;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hz-'));
  fs.cpSync(src, tmp, { recursive: true });
  const db = new ClassicLevel(tmp, { valueEncoding: 'json' });
  const actors = [];
  const items = new Map();
  try {
    for await (const [k, v] of db.iterator()) {
      if (k.startsWith('!actors!') && v.type === 'hazard') actors.push(v);
      else if (k.startsWith('!actors.items!')) items.set(k.slice('!actors.items!'.length), v);
    }
  } catch {
    // not a LevelDB pack
  } finally {
    await db.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  for (const a of actors) {
    const own = (a.items ?? []).map((id) => items.get(`${a._id}.${id}`)).filter(Boolean);
    out.push({ pack, ...pick(a, own) });
  }
}
fs.mkdirSync('tests/fixtures', { recursive: true });
fs.writeFileSync('tests/fixtures/hazards.json', JSON.stringify(out, null, 1));
console.log(
  `wrote ${out.length} hazards (${out.filter((h) => h.system.details.isComplex).length} complex)`,
);
