import path from 'path';
/** @type {import('next').NextConfig} */
const nextConfig = {
  // Ensure Next.js traces from this project root (prevents parent lockfile confusion on Windows/OneDrive)
  outputFileTracingRoot: path.join(process.cwd()),
  // Keep the ONNX/transformers stack (~390MB of per-platform native binaries +
  // WASM) OUT of the serverless function bundle. It's only reachable via the
  // optional query-time embedder (SEMANTIC_SEARCH_ENABLED, default off), which
  // is lazy-imported at runtime and cannot function on Vercel anyway (it needs
  // the self-hosted Typesense/pgvector). Without this, output-file-tracing
  // copies all of it into api/foods/search, pushing the function to 444MB and
  // over Vercel's 250MB uncompressed limit. Semantic search stays available on
  // the self-hosted deployment, where node_modules is present at runtime.
  outputFileTracingExcludes: {
    '**': [
      'node_modules/@huggingface/**',
      'node_modules/onnxruntime-node/**',
      'node_modules/onnxruntime-web/**',
    ],
  },
  // Enable production optimizations
  //
  // WHAT THIS SILENTLY DID (found 2026-08-01): SWC applies removeConsole at BUILD
  // time by deleting matching `console.<method>(...)` calls from the bundle. Since
  // `src/lib/logger.ts` routed through `console.info`, EVERY logger.info call site
  // was stripped from production — measured 0 lines carrying `"level":"info"` in
  // all 976,124 lines of the box's next-start.log, against 9,128 warn / 67 error.
  // That is why `logger.info('ai_nutrition.batch_cap_reached')` was unloggable.
  //
  // The strip is KEPT: it is still doing useful work against stray `console.log`
  // in route code, and adding 'info' to the exclude list would switch on all of
  // logger.info's call sites at once against an unrotated append-only log.
  // The sanctioned path around it is `logger` in `src/lib/logger.ts`, which writes
  // via process.stdout/stderr — not a `console` member call, so SWC cannot match
  // it — and gates volume with a runtime LOG_LEVEL threshold instead.
  //
  // If you add a new logging helper, route it through `logger`. Anything built on
  // `console.info`/`console.debug` will compile away in production without a
  // single error at build or run time.
  compiler: {
    removeConsole: process.env.NODE_ENV === 'production' ? {
      exclude: ['error', 'warn'],
    } : false,
  },
  images: {
    remotePatterns: [
      // CloudFront CDN for images
      { 
        protocol: 'https', 
        hostname: process.env.NEXT_PUBLIC_CLOUDFRONT_HOST || 'd3abc123xyz0.cloudfront.net'
      },
      // Fallback for other external images
      { protocol: 'https', hostname: '**' }
    ],
    // Enable image optimization for /api/image/... proxy routes
    domains: ['localhost'],
    unoptimized: false
  },
  // Prevent API routes from being executed during build.
  // @huggingface/transformers + onnxruntime-node ship native .node binaries
  // (query-time embedding model) that webpack must not try to bundle.
  serverExternalPackages: ['@prisma/client', '@huggingface/transformers', 'onnxruntime-node'],
  // NOTE: do NOT inline BUILD_TIME via `env` — Next freezes it into the bundle
  // as a constant at build time, so a self-hosted production build (NODE_ENV=
  // production, no VERCEL_ENV) would bake in 'true' and make every route's
  // `BUILD_TIME === 'true'` guard 503 at runtime. Left unset, route handlers
  // read it from the real runtime env (undefined → guard is false); build-time
  // execution is still prevented by the NEXT_PHASE === 'phase-production-build'
  // guard, which Next sets only during `next build`.
  webpack: (config: any, { isServer: _isServer }: { isServer: boolean }) => {
    // Exclude large data files from webpack bundling
    config.externals = config.externals || [];
    config.externals.push({
      './data/usda/fdc.json': 'commonjs ./data/usda/fdc.json',
      '../data/usda/fdc.json': 'commonjs ../data/usda/fdc.json',
      '../../data/usda/fdc.json': 'commonjs ../../data/usda/fdc.json',
      '../../../data/usda/fdc.json': 'commonjs ../../../data/usda/fdc.json',
    });

    // Add rule to ignore large JSON files during bundling
    config.module.rules.push({
      test: /data\/usda\/.*\.json$/,
      use: 'ignore-loader'
    });

    return config;
  }
};

export default nextConfig;