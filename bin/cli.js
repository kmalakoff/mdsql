#!/usr/bin/env node

// exitCode (not exit()) lets Node flush queued stdout writes from the streaming sql path before
// exiting; the unref'd timer only force-exits if a stray handle would otherwise hang the process.
// biome-ignore lint/security/noGlobalEval: dual esm and cjs
if (typeof require === 'undefined') eval("import('../dist/esm/cli.js').then((cli) => cli.default(process.argv.slice(2), 'sense')).catch((err) => { console.error(err); process.exitCode = 1; setTimeout(() => process.exit(1), 2000).unref(); });");
else
  require('../dist/cjs/cli.js')(process.argv.slice(2), 'sense').catch((err) => {
    console.error(err);
    process.exitCode = 1;
    setTimeout(() => process.exit(1), 2000).unref();
  });
