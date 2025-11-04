import {withSentryConfig} from '@sentry/nextjs';
/** @type {import('next').NextConfig} */
const nextConfig = {
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
export default withSentryConfig(nextConfig, {
  // For all available options, see:
  // https://www.npmjs.com/package/@sentry/webpack-plugin#options

  org: process.env.SENTRY_ORG,

  project: process.env.SENTRY_PROJECT,

  // Only print logs for uploading source maps in CI
  silent: !process.env.CI,

  // For all available options, see:
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/

  // Upload a larger set of source maps for prettier stack traces (increases build time)
  widenClientFileUpload: true,

  // Uncomment to route browser requests to Sentry through a Next.js rewrite to circumvent ad-blockers.
  // This can increase your server load as well as your hosting bill.
  // Note: Check that the configured route will not match with your Next.js middleware, otherwise reporting of client-
  // side errors will fail.
  // tunnelRoute: "/monitoring",

  // Automatically tree-shake Sentry logger statements to reduce bundle size
  disableLogger: true,

  // Enables automatic instrumentation of Vercel Cron Monitors. (Does not yet work with App Router route handlers.)
  // See the following for more information:
  // https://docs.sentry.io/product/crons/
  // https://vercel.com/docs/cron-jobs
  automaticVercelMonitors: true
});