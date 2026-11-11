// Clones microsoft/playwright's main, builds it, installs the Chromium it pins, and in that Chromium evaluates a function
// with an argument nested 59 objects deep and then with one nested 60 deep, each raced against 10 seconds, logging the
// protocol to read Chromium's answers. Exits 1 while the first resolves and the second neither resolves nor rejects, 0
// once both settle, and 2 on anything else.
//   node repro.mjs                                    clones and builds main
//   PLAYWRIGHT_DIR=<checkout> node repro.mjs          uses a checkout built with `npm ci && npm run build`
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const work = mkdtempSync(join(tmpdir(), 'playwright-deep-argument-'));
const protocolLog = join(work, 'protocol.log');

function finish(code, summary) {
  console.log(`summary: ${summary}`);
  rmSync(work, { recursive: true, force: true });
  process.exit(code);
}

function run(step, command, args, cwd) {
  const windowsScript = process.platform === 'win32' && command === 'npm';
  try {
    return execFileSync(windowsScript ? 'npm.cmd' : command, args, { cwd, encoding: 'utf8', shell: windowsScript, stdio: 'pipe' });
  } catch (error) {
    const output = `${error.stdout ?? ''}${error.stderr ?? ''}`.trim().split('\n').slice(-20).join('\n');
    console.log(output);
    return finish(2, `${step} failed`);
  }
}

let checkout = process.env.PLAYWRIGHT_DIR;
if (!checkout) {
  checkout = join(work, 'playwright');
  run('git clone of microsoft/playwright', 'git', ['clone', '--quiet', '--depth', '1', 'https://github.com/microsoft/playwright.git', checkout]);
  run('npm ci', 'npm', ['ci', '--no-audit', '--no-fund'], checkout);
  run('npm run build', 'npm', ['run', 'build'], checkout);
}
const commit = run(`git rev-parse in ${checkout}`, 'git', ['rev-parse', '--short', 'HEAD'], checkout).trim();
const core = join(checkout, 'packages', 'playwright-core');
run('installing Chromium', process.execPath, [join(core, 'cli.js'), 'install', 'chromium'], checkout);

process.env.DEBUG = 'pw:protocol';
process.env.DEBUG_FILE = protocolLog;
let chromium;
try {
  ({ chromium } = await import(pathToFileURL(join(core, 'index.mjs')).href));
} catch (error) {
  console.log(String(error));
  finish(2, `${core} does not load`);
}
const browser = await chromium.launch();
console.log(`microsoft/playwright ${commit}, Chromium ${browser.version()}, Node ${process.version}, ${process.platform} ${process.arch}`);
const page = await browser.newPage();

const outcomes = new Map();
for (const objects of [59, 60]) {
  let argument = 0;
  for (let level = 0; level < objects; level += 1) {
    argument = { children: [argument] };
  }
  const started = performance.now();
  let timer;
  const outcome = await Promise.race([
    page.evaluate((value) => JSON.stringify(value).length, argument).then(
      (length) => ({ kind: 'resolved', text: `resolved with ${length}` }),
      (error) => ({ kind: 'rejected', text: `rejected: ${String(error).split('\n')[0]}` }),
    ),
    new Promise((resolve) => {
      timer = setTimeout(() => resolve({ kind: 'unsettled', text: 'neither resolved nor rejected within 10 s' }), 10_000);
    }),
  ]);
  clearTimeout(timer);
  outcomes.set(objects, outcome.kind);
  console.log(`page.evaluate with an argument ${objects} objects deep: ${outcome.text} after ${Math.round(performance.now() - started)} ms`);
}
await browser.close();

const answersWithoutId = readFileSync(protocolLog, 'utf8')
  .split('\n')
  .map((line) => line.match(/RECV (\{"error".*)$/)?.[1])
  .filter((message) => message !== undefined && !message.includes('"id"'));
for (const message of answersWithoutId) {
  console.log(`Chromium's answer with no id: ${message}`);
}

if (outcomes.get(59) !== 'resolved') {
  finish(2, 'the argument 59 objects deep did not resolve, so the check itself is off');
}
if (outcomes.get(60) === 'unsettled') {
  finish(1, `microsoft/playwright ${commit} with Chromium ${browser.version()} resolves page.evaluate with an argument 59 objects deep and neither resolves nor rejects it with one 60 deep`);
}
finish(0, `microsoft/playwright ${commit} with Chromium ${browser.version()} settles page.evaluate with an argument 59 objects deep and with one 60 deep`);
