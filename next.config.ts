import path from 'path';
/** @type {import('next').NextConfig} */
const nextConfig = {
  // Ensure Next.js traces from this project root (prevents parent lockfile confusion on Windows/OneDrive)
  outputFileTracingRoot: path.join(process.cwd()),
  // Enable production optimizations
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