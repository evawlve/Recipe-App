/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**' }
    ],
    // Enable image optimization for /api/image/... proxy routes
    domains: ['localhost'],
    unoptimized: false
  },
  // Prevent API routes from being executed during build
  serverExternalPackages: ['@prisma/client'],
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
