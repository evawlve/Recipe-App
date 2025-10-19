/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**' }
    ],
    // Enable image optimization for /api/image/... proxy routes
    domains: ['localhost'],
    unoptimized: false
  }
};
export default nextConfig;
