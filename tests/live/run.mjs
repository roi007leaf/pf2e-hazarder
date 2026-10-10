import { chromium } from 'playwright';
import { input, password, confirm } from '@inquirer/prompts';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, open, unlink } from 'node:fs/promises';
import path from 'node:path';
import { scenarios } from './cases.mjs';
import { loadLocalDefaults, promptAccount } from './local-defaults.mjs';
import { assertQaWorld, DEFAULT_QA_WORLD } from './world-guard.mjs';

const MODULE_ID = 'pf2e-hazarder';
const directory = path.resolve('artifacts/live');
const journalPath = path.join(directory, 'recovery.json');
const lockPath = path.join(directory, 'runner.lock');
const abort = new AbortController();
const expectedWorld = process.env.VISIONER_DISPOSABLE_WORLD ?? DEFAULT_QA_WORLD;
const report = { started: new Date().toISOString(), scenarios: [], cleanup: 'not-needed' };
const credentials = [];
let browser;
let gm;
let player;
let journal;
let locked = false;
let localDefaults = {};
process.once('SIGINT', () => abort.abort());
process.once('SIGTERM', () => abort.abort());

async function atomicJson(file, value) {
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporary, file);
}

function safeError(error) {
  let text = String(error?.stack ?? error?.message ?? error);
  for (const secret of credentials.filter(Boolean)) text = text.split(secret).join('[redacted]');
  return text;
}

async function rpc(page, method, data) {
  return page.evaluate(
    async ({ method, data }) => {
      const api = await import('/modules/pf2e-hazarder/tests/live/world.js');
      if (typeof api[method] !== 'function') throw Error(`Unknown live RPC: ${method}`);
      return api[method](data);
    },
    { method, data },
  );
}

async function account(role) {
  const result = await promptAccount(role, localDefaults, process.env, { input, password, confirm }, { signal: abort.signal });
  credentials.push(result.password);
  if (role === 'gm' && !result.password) throw Error('GM account requires password');
  return result;
}

async function login(context, url, accountValue, isGM) {
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  await page.goto(`${url}/join`);
  await page.locator('select[name="userid"], input[name="username"]').first().waitFor();
  assertQaWorld(await page.evaluate(() => globalThis.game?.world?.id), expectedWorld);
  const select = page.locator('select[name="userid"]');
  if (await select.count()) {
    const options = await select.locator('option').evaluateAll((nodes) => nodes.map((node) => ({ label: node.textContent.trim(), value: node.value })));
    const match = options.find((option) => option.label.toLowerCase() === accountValue.username.trim().toLowerCase());
    if (!match) throw Error(`${isGM ? 'GM' : 'player'} account not found`);
    await select.selectOption(match.value);
  } else {
    await page.locator('input[name="username"]').fill(accountValue.username);
  }
  await page.locator('input[name="password"]').fill(accountValue.password);
  await page.locator('button[name="join"]').click();
  await page.waitForFunction(() => globalThis.game?.ready && globalThis.canvas?.ready, null, { timeout: 90000 });
  const state = await rpc(page, 'preflight');
  assertQaWorld(state.world, expectedWorld);
  if (state.isGM !== isGM) throw Error(`Wrong account role for ${isGM ? 'GM' : 'player'} session`);
  if (!state.moduleActive) throw Error('PF2e Hazarder is not active');
  return { page, state };
}

async function restore(record) {
  const failures = [];
  try { await rpc(gm.page, 'restoreSettings', record.settings); } catch (error) { failures.push(error); }
  for (const [session, saved] of [[gm, record.gm], [player, record.player]]) {
    if (!session || !saved?.scene) continue;
    try {
      await session.page.evaluate(async (sceneId) => {
        const scene = game.scenes.get(sceneId);
        if (scene) await scene.view();
      }, saved.scene);
    } catch (error) { failures.push(error); }
  }
  if (failures.length) throw new AggregateError(failures, 'Could not restore QA state');
}

async function cleanup(record) {
  report.cleanup = 'running';
  const failures = [];
  try { await restore(record); } catch (error) { failures.push(error); }
  try { await rpc(gm.page, 'cleanup', record.runId); } catch (error) { failures.push(error); }
  try {
    const remaining = await rpc(gm.page, 'leftovers', record.runId);
    if (Object.values(remaining).some((ids) => ids.length)) throw Error(`Live documents remain: ${JSON.stringify(remaining)}`);
  } catch (error) { failures.push(error); }
  if (failures.length) throw new AggregateError(failures, 'Live cleanup incomplete');
  await unlink(journalPath).catch((error) => { if (error.code !== 'ENOENT') throw error; });
  report.cleanup = 'complete';
}

async function saveReport() {
  if (locked) await atomicJson(path.join(directory, 'report.json'), report);
}

async function acquireLock() {
  await mkdir(directory, { recursive: true });
  let handle;
  try { handle = await open(lockPath, 'wx'); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const pid = Number(await readFile(lockPath, 'utf8'));
    if (!Number.isInteger(pid) || pid <= 0) throw Error('Invalid live runner lock; inspect it manually');
    try { process.kill(pid, 0); throw Error(`Live suite already running (PID ${pid})`); }
    catch (probe) { if (probe.code !== 'ESRCH') throw probe; }
    await unlink(lockPath);
    handle = await open(lockPath, 'wx');
  }
  await handle.writeFile(String(process.pid));
  await handle.close();
  locked = true;
}

async function run() {
  if (process.argv.includes('--list')) {
    console.table(scenarios);
    return;
  }
  await acquireLock();
  localDefaults = await loadLocalDefaults();
  const url = (process.env.VISIONER_FOUNDRY_URL || await input({ message: 'Foundry URL:', default: localDefaults.url || 'https://localhost:30000' }, { signal: abort.signal })).replace(/\/$/, '');
  const gmAccount = await account('gm');
  const playerAccount = await account('player');
  browser = await chromium.launch({ headless: process.argv.includes('--headless'), channel: process.env.VISIONER_BROWSER_CHANNEL || undefined });
  gm = await login(await browser.newContext({ ignoreHTTPSErrors: true }), url, gmAccount, true);
  player = await login(await browser.newContext({ ignoreHTTPSErrors: true }), url, playerAccount, false);
  if (gm.state.world !== player.state.world) throw Error('GM and player joined different worlds');
  if (gm.state.foundry !== 14 || gm.state.system !== 'pf2e') throw Error(`Requires Foundry 14/PF2e; got ${gm.state.foundry}/${gm.state.system}`);

  const pending = await readFile(journalPath, 'utf8').then(JSON.parse).catch((error) => (error.code === 'ENOENT' ? null : Promise.reject(error)));
  if (pending) {
    if (pending.url !== url || pending.world !== gm.state.world || pending.gm.user !== gm.state.user || pending.player.user !== player.state.user) {
      throw Error('Recovery journal requires original URL, world, GM, and player');
    }
    journal = pending;
    await cleanup(journal);
    if (process.argv.includes('--cleanup-only')) return;
  } else if (process.argv.includes('--cleanup-only')) {
    report.cleanup = 'complete';
    return;
  }

  const manifest = JSON.parse(await readFile('module.json', 'utf8'));
  if (gm.state.moduleVersion !== manifest.version) {
    throw Error(`Foundry loaded ${MODULE_ID} ${gm.state.moduleVersion}; checkout manifest is ${manifest.version}. Restart QA world.`);
  }
  report.runId = randomUUID();
  report.world = gm.state.world;
  journal = {
    runId: report.runId, url, world: gm.state.world,
    gm: { user: gm.state.user, scene: gm.state.scene },
    player: { user: player.state.user, scene: player.state.scene },
    settings: await rpc(gm.page, 'settingsSnapshot'),
  };
  await atomicJson(journalPath, journal);

  let fixture = await rpc(gm.page, 'prepare', { runId: report.runId, playerUserId: player.state.user, expectedWorld });
  await rpc(player.page, 'view', fixture);

  const errors = [];
  const onPageError = (error) => errors.push(safeError(error));
  const onConsole = (message) => { if (message.type() === 'error') errors.push(safeError(message.text())); };
  for (const session of [gm, player]) {
    session.page.on('pageerror', onPageError);
    session.page.on('console', onConsole);
  }

  for (const [index, scenario] of scenarios.entries()) {
    if (abort.signal.aborted) throw Error('Live suite cancelled');
    const label = `${index + 1}. ${scenario.name}`;
    const result = { name: scenario.name, role: scenario.role, status: 'running' };
    report.scenarios.push(result);
    try {
      const session = scenario.role === 'player' ? player : gm;
      const outcome = await rpc(session.page, 'step', { name: scenario.name, fixture });
      const { assertions } = outcome;
      fixture = outcome.fixture;
      if (!assertions?.length || assertions.some((item) => item.status !== 'passed')) throw Error(`Assertion failed: ${JSON.stringify(assertions)}`);
      result.assertions = assertions;
      result.status = 'passed';
      console.log(`PASS ${label}`);
    } catch (error) {
      result.status = 'failed';
      result.error = safeError(error);
      console.log(`FAIL ${label}\n${result.error}`);
    }
    await saveReport();
    if (result.status === 'failed') break; // later scenarios depend on this one
  }
  if (errors.length) report.browserErrors = errors;

  await cleanup(journal);
}

try {
  await run();
} catch (error) {
  report.error = safeError(error);
  process.exitCode = 1;
} finally {
  if (journal && gm && report.cleanup !== 'complete') {
    try { await cleanup(journal); }
    catch (error) { report.cleanup = 'failed'; report.cleanupError = safeError(error); process.exitCode = 1; }
  }
  report.finished = new Date().toISOString();
  try { await saveReport(); } catch (error) { console.error(safeError(error)); process.exitCode = 1; }
  await browser?.close().catch(() => {});
  if (locked) await unlink(lockPath).catch(() => {});
}

const incomplete = report.scenarios.filter((result) => result.status !== 'passed');
if (report.error || (report.runId && (incomplete.length || report.scenarios.length < scenarios.length || report.cleanup !== 'complete'))) process.exitCode = 1;
if (report.runId) console.log(JSON.stringify({ runId: report.runId, passed: report.scenarios.length - incomplete.length, failed: incomplete.length, cleanup: report.cleanup, report: path.join(directory, 'report.json') }, null, 2));
if (report.error) console.error(report.error);
