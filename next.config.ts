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
  // Prevent API routes from being executed during build
  serverExternalPackages: ['@prisma/client'],
  env: {
    BUILD_TIME: process.env.NODE_ENV === 'production' && !process.env.VERCEL_ENV ? 'true' : 'false',
  },
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