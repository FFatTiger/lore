/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: (process.env.ALLOWED_DEV_ORIGINS || '').split(',').filter(Boolean),
  experimental: {
    instrumentationHook: true,
  },
};

module.exports = nextConfig;
