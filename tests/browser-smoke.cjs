'use strict';
const assert = require('node:assert/strict');
const {spawn} = require('node:child_process');
const {once} = require('node:events');
const {readFile} = require('node:fs/promises');
const path = require('node:path');
const {chromium} = require('playwright');

const root = path.resolve(__dirname, '..');
const serverCode = [
  'from http.server import ThreadingHTTPServer',
  'from launch import AppHandler',
  'with ThreadingHTTPServer(("127.0.0.1", 0), AppHandler) as server:',
  '    print(server.server_port, flush=True)',
  '    server.serve_forever()'
].join('\n');

function tone() {
  const rate = 48000;
  const frames = rate / 4;
  const wav = Buffer.alloc(44 + 2 * frames);
  wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4);
  wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(frames * 2, 40);
  for (let frame = 0; frame < frames; frame++) {
    wav.writeInt16LE(Math.round(12000 * Math.sin(2 * Math.PI * 440 * frame / rate)), 44 + frame * 2);
  }
  return wav;
}

function workspaceStore(page, action, data) {
  return page.evaluate(({action, data}) => new Promise((resolve, reject) => {
    const open = indexedDB.open('soundweave-studio', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('workspace');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction('workspace', 'readwrite');
      const store = tx.objectStore('workspace');
      let result;
      const pointer = store.get('session');
      pointer.onsuccess = () => {
        const id = pointer.result?.id ?? 'legacy-fixture';
        const key = 'document:' + id;
        const latest = store.get(key);
        latest.onsuccess = () => {
          const row = latest.result;
          if (action === 'inspect') {
            const prior = store.get('session-backup:' + id);
            prior.onsuccess = () => {
              result = {version: pointer.result.recoveryVersion, current: row.snapshot.bpm,
                previous: prior.result?.snapshot.bpm, assets: row.data.size,
                commit: row.commit};
            };
          } else if (action === 'corrupt-audio') {
            const first = row.data.keys().next().value;
            row.data.set(first, Uint8Array.of(1, 2, 3).buffer);
            store.put(row, key);
          } else if (action === 'future-format') {
            store.put({...pointer.result, recoveryVersion: 999}, 'session');
          } else if (action === 'legacy') {
            const snapshot = SW.project();
            snapshot.name = 'Legacy browser Session';
            snapshot.bpm = data;
            const legacy = {snapshot, data: new Map()};
            store.put({...legacy, id}, 'session');
            store.put(legacy, key);
          }
        };
      };
      tx.oncomplete = () => { db.close(); resolve(result); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    };
  }), {action, data});
}

async function waitText(page, id, text) {
  await page.waitForFunction(({id, text}) => document.getElementById(id).textContent.includes(text), {id, text});
}

async function changeTempo(page, bpm) {
  await page.locator('#bpm').fill(String(bpm));
  await page.locator('#bpm').press('Tab');
}

async function portableSession(page) {
  const downloading = page.waitForEvent('download');
  await page.keyboard.press('Control+s');
  const file = await downloading;
  return JSON.parse(await readFile(await file.path(), 'utf8'));
}

async function checkWorkspaceControls(page) {
  await page.locator('#loop').click();
  await waitText(page, 'save-state', 'Saved locally');
  await page.locator('#play').click();
  await waitText(page, 'audio-state', 'Playing');
  const before = await portableSession(page);
  const selector = page.locator('#workspace-detail');
  const routing = page.locator('[data-tab="routing"]');
  const automation = page.locator('[data-tab="automation"]');
  const macros = page.locator('#macro-arrange-toggle');
  for (const [level, expected] of [
    ['beginner', [false, false, false]],
    ['intermediate', [false, true, false]],
    ['advanced', [true, true, false]],
    ['pro', [true, true, true]]
  ]) {
    await selector.selectOption(level);
    assert.deepEqual(await Promise.all([routing.isVisible(), automation.isVisible(), macros.isVisible()]), expected);
    assert.equal(await page.locator('#stop').isVisible(), true);
    assert.equal(await page.locator('#record').isVisible(), true);
    await waitText(page, 'audio-state', 'Playing');
  }
  await selector.selectOption('beginner');
  await page.locator('#find-command').click();
  await page.locator('#command-search').fill('signal flow');
  await page.locator('#commands [data-cmd="routing"]').click();
  assert.equal(await page.locator('#lower-workspace').isVisible(), true);
  assert.deepEqual(await portableSession(page), before);
  await page.locator('#stop').click();
  await page.reload();
  await waitText(page, 'save-state', 'Restored local Session');
  assert.equal(await selector.inputValue(), 'beginner');
}

async function main() {
  const server = spawn(process.env.PYTHON ?? 'python3', ['-u', '-c', serverCode], {cwd: root});
  server.stderr.pipe(process.stderr);
  let browser;
  try {
    const [port] = await Promise.race([
      once(server.stdout, 'data'),
      once(server, 'exit').then(([code]) => { throw Error('Local test server exited with ' + code); })
    ]);
    const url = 'http://127.0.0.1:' + port.toString().trim();
    browser = await chromium.launch({
      executablePath: process.env.CHROMIUM_PATH,
      args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream']
    });
    const context = await browser.newContext({permissions: ['microphone']});
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      if (!localStorage.getItem('sw-preferences')) {
        localStorage.setItem('sw-preferences', JSON.stringify({startup: 'blank', localServices: false}));
      }
    });
    await page.goto(url);
    await page.locator('#import-files').setInputFiles({name: 'fixture.wav', mimeType: 'audio/wav', buffer: tone()});
    await waitText(page, 'status', 'Imported 1 file');
    await waitText(page, 'save-state', 'Saved locally');
    await page.locator('#record').click();
    await page.waitForFunction(() => /Recording/i.test(document.getElementById('status').textContent));
    await page.waitForFunction(() => document.getElementById('time').textContent !== '0:00.000');
    await page.locator('#stop').click();
    await waitText(page, 'status', 'Recorded');
    await waitText(page, 'save-state', 'Saved locally');
    const first = await workspaceStore(page, 'inspect');
    assert.equal(first.assets, 2, 'imported WAV and captured take');
    await changeTempo(page, 124);
    await waitText(page, 'save-state', 'Saved locally');
    const changed = await workspaceStore(page, 'inspect');
    assert.equal(changed.version, 1);
    assert.equal(changed.current, 124);
    assert.equal(changed.previous, first.current);
    await page.evaluate(() => {
      const prefs = JSON.parse(localStorage.getItem('sw-preferences'));
      localStorage.setItem('sw-preferences', JSON.stringify({...prefs, startup: 'restore'}));
    });
    await page.reload();
    await waitText(page, 'save-state', 'Restored local Session');
    assert.equal(await page.locator('#bpm').inputValue(), '124');
    await workspaceStore(page, 'corrupt-audio');
    await page.reload();
    await waitText(page, 'save-state', 'Previous local revision recovered');
    assert.equal(await page.locator('#bpm').inputValue(), String(first.current));
    assert.equal((await workspaceStore(page, 'inspect')).commit, changed.commit);

    await page.keyboard.press('Control+e');
    await page.locator('#export-bits').selectOption('16');
    await page.locator('#export-tail').fill('0');
    const wavDownload = page.waitForEvent('download');
    await page.locator('#confirm-export').click();
    const download = await wavDownload;
    const wav = await readFile(await download.path());
    assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
    assert.equal(wav.toString('ascii', 8, 12), 'WAVE');
    const dataOffset = wav.indexOf('data', 12);
    assert.ok(dataOffset >= 36 && wav.readUInt32LE(dataOffset + 4) > 0);
    assert.ok(wav.subarray(dataOffset + 8).some(sample => sample !== 0), 'export has an audible signal');

    await changeTempo(page, 129);
    await waitText(page, 'save-state', 'Saved locally');
    const repaired = await workspaceStore(page, 'inspect');
    assert.equal(repaired.current, 129);
    assert.equal(repaired.previous, first.current, 'repair preserves the usable backup');

    await checkWorkspaceControls(page);

    const other = await context.newPage();
    await other.goto(url);
    await waitText(other, 'save-state', 'Restored local Session');
    await changeTempo(other, 131);
    await waitText(other, 'save-state', 'Saved locally');
    await changeTempo(page, 133);
    await waitText(page, 'status', 'changed in another window');
    assert.equal((await workspaceStore(page, 'inspect')).current, 131);
    await other.close();

    await workspaceStore(page, 'future-format');
    await page.reload();
    await waitText(page, 'status', 'unsupported recovery format');
    await workspaceStore(page, 'legacy', 97);
    await page.reload();
    await waitText(page, 'save-state', 'Restored local Session');
    assert.equal(await page.locator('#bpm').inputValue(), '97');
    await changeTempo(page, 99);
    await waitText(page, 'save-state', 'Saved locally');
    const migrated = await workspaceStore(page, 'inspect');
    assert.equal(migrated.version, 1);
    assert.equal(migrated.previous, 97);
    assert.equal(migrated.current, 99);

    const standalone = await browser.newPage();
    standalone.on('pageerror', error => errors.push(error.message));
    await standalone.goto(require('node:url').pathToFileURL(path.join(root, 'Sonoravell.html')).href);
    await standalone.locator('[data-workspace="session"]').click();
    assert.equal(await standalone.locator('#record').isVisible(), true);
    assert.deepEqual(errors, []);
    console.log('Chromium verified audio import, simulated microphone capture, recovery, WAV export, concurrent edits, legacy migration, workspace presets and standalone launch.');
  } finally {
    if (browser) await browser.close();
    server.kill();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
