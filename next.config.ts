/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: { allowedOrigins: ['*'] },
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**' }
    ],
    // Disable image optimization for local API routes to avoid conflicts
    unoptimized: true
  }
};
export default nextConfig;
