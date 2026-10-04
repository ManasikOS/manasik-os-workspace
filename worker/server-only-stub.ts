// `import "server-only"` is resolved by Next.js's own bundler and is not an installed package, so a plain Node process cannot load
// it. The worker bundle points it here (see the `worker:build` script). The worker is server code by definition, so the guard the
// real module provides, keeping code out of the browser, has nothing to protect here.
export {};
