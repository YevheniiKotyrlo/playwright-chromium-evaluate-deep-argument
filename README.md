# `page.evaluate` in Chromium never settles when its argument nests 60 objects deep

`repro.mjs` clones microsoft/playwright's `main`, builds it, installs the Chromium it pins, and evaluates `(value) => JSON.stringify(value).length` with `{ children: [ … ] }` nested 59 objects deep, then 60 deep, each raced against 10 seconds. It writes `DEBUG=pw:protocol` to a file and prints each answer Chromium sends with an error and no `id`. It exits 1 while the first call resolves and the second neither resolves nor rejects, 0 once both settle, and 2 when a step fails.

## Run

With Node 18 or later and git:

```sh
node repro.mjs
```

`PLAYWRIGHT_DIR=<checkout> node repro.mjs` uses a checkout already built with `npm ci && npm run build`.
