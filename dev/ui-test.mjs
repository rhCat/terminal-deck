// terminal-deck headless UI verification (Playwright) — the full deck harness:
//   * layout zones + live cards
//   * main-terminal STREAMING (regression: token-match fix so main isn't blank)
//   * theme switching (incl. Eye Guard / Ocean / Forest / Violet / Sepia)
//   * rename via modal
//   * color demo into the focused pane
//   * foldable properties panel (pwd / ip / history)
// Screenshots -> dev/screenshots. Run against the server on localhost:8787.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import assert from 'node:assert';
import { fileURLToPath } from 'node:url';

const BASE = 'http://127.0.0.1:8787';
const OUT = new URL('./screenshots', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

await page.goto(BASE, { waitUntil: 'networkidle', timeout: 25000 });
await page.waitForTimeout(1800);

// --- 1) layout + cards ---
assert.equal(await page.locator('#toolbar').count(), 1, 'toolbar');
assert.equal(await page.locator('#sorter').count(), 1, 'sorter');
assert.equal(await page.locator('#stage').count(), 1, 'stage');
assert.equal(await page.locator('#notes').count(), 1, 'notes');
assert.ok(await page.locator('.card').count() >= 1, 'cards');
assert.ok(await page.locator('.card').first().locator('.card-collapse').count() === 1, 'collapse button on cards');
console.log('[1] layout + cards OK');

// --- 1b) card collapse toggles preview ---
const fc = page.locator('.card').first();
assert.ok(await fc.locator('.card-preview').isVisible(), 'preview visible before');
await fc.locator('.card-collapse').click();
await page.waitForTimeout(200);
assert.ok(!(await fc.locator('.card-preview').isVisible()), 'preview hidden after collapse');
assert.ok(await fc.evaluate((el) => el.classList.contains('collapsed')), 'card.collapsed class set');
await page.screenshot({ path: OUT + '/09-collapsed.png' }); // show collapse-to-name-only
await fc.locator('.card-collapse').click(); // expand back
await page.waitForTimeout(200);
assert.ok(await fc.locator('.card-preview').isVisible(), 'preview visible after expand');
console.log('[1b] card collapse/expand OK');

// --- 1c) shared clipboard capture + popover ---
await page.evaluate(() => { try { window.setSharedClipboard('shared clip from deck'); } catch {} });
await page.locator('#btn-clip').click();
await page.waitForTimeout(300);
const clipVal = (await page.locator('#cb-value').textContent()) || '';
assert.ok(clipVal.includes('shared clip from deck'), 'clipboard popover shows shared value');
const clipLen = (await page.locator('#cb-len').textContent()) || '';
assert.ok(/chars/.test(clipLen), 'clipboard length label shown');
await page.screenshot({ path: OUT + '/10-clipboard.png' });
await page.locator('#btn-clip').click(); // close popover
await page.waitForTimeout(200);
console.log('[1c] shared clipboard popover OK');

// --- 2) focus logs -> MAIN TERMINAL must actually stream (token-match fix) ---
const logsCard = page.locator('.card', { hasText: 'logs' }).first();
if (await logsCard.count()) {
  await logsCard.click();
  await page.waitForTimeout(2500);
  const mainText = (await page.locator('#term').innerText()) || '';
  assert.ok(/line \d+|tick/i.test(mainText), 'main terminal renders live output (not blank)');
  console.log('[2] main terminal streams live output (fix verified)');
  await page.screenshot({ path: OUT + '/08-main-live.png' });
} else {
  console.log('[2] (no logs session; skipped main-stream check)');
}

// --- 3) properties panel ---
await page.locator('#btn-props').click();
await page.waitForTimeout(700);
assert.ok(await page.locator('#props').isVisible(), 'props visible');
assert.ok(await page.locator('body.show-props').count() === 1, 'show-props class');
await page.waitForTimeout(900);
const pwd = (await page.locator('#p-pwd').textContent()) || '';
const ip = (await page.locator('#p-ip').textContent()) || '';
assert.ok(pwd.length > 0, 'pwd populated');
assert.ok(ip.length > 0, 'ip populated');
await page.screenshot({ path: OUT + '/05-props-panel.png' });
console.log('[3] props panel populated (pwd=' + pwd + ' ip=' + ip + ')');

// --- 4) theme switching: new themes apply ---
const themes = { dracula: 'rgb(40, 42, 54)', eyeGuard: 'rgb(0, 43, 54)', ocean: 'rgb(11, 43, 64)', forest: 'rgb(15, 31, 15)', violet: 'rgb(28, 22, 42)', sepia: 'rgb(245, 240, 230)' };
for (const [tname, want] of Object.entries(themes)) {
  await page.locator('#theme-select').selectOption(tname);
  await page.waitForTimeout(250);
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  assert.equal(bg, want, tname + ' bg');
}
await page.locator('#theme-select').selectOption('ocean');
await page.waitForTimeout(300);
console.log('[4] 6 themes apply correctly (dracula→sepia)');

// --- 5) rename via modal (rename focused work, then rename it back) ---
if (await logsCard.count()) {
  await logsCard.click(); // ensure a card is focused for rename
  await page.locator('#btn-rename').click();
  await page.waitForTimeout(300);
  await page.locator('#rename-input').fill('renamed-demo');
  await page.locator('#rename-ok').click();
  await page.waitForTimeout(1500);
  const stageTitle = (await page.locator('#stage-title').textContent()) || '';
  console.log('[5] renamed -> stage title: ' + stageTitle);
  await page.screenshot({ path: OUT + '/06-after-rename.png' });
  // rename back so the harness is idempotent on re-runs
  await page.locator('#btn-rename').click();
  await page.waitForTimeout(300);
  await page.locator('#rename-input').fill('logs');
  await page.locator('#rename-ok').click();
  await page.waitForTimeout(1200);
  console.log('[5b] renamed back to logs');
}

// --- 6) color demo into focused pane ---
await page.locator('#btn-demo').click();
await page.waitForTimeout(2500);
await page.screenshot({ path: OUT + '/07-demo.png' });
console.log('[6] demo command sent');

console.log('UI errors:', errors.length ? errors : 'none');
if (errors.length) { await browser.close(); process.exit(1); }
await browser.close();
console.log('UI TEST PASS — screenshots in ' + OUT);
