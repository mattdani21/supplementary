import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  webpack(config) {
    // The workspace packages import each other with Node-ESM style `.js` specifiers that point
    // at TypeScript sources. Next's default resolver does not map them; without this every
    // @gapos/* import fails to resolve at build time.
    config.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js'],
      '.mjs': ['.mts', '.mjs'],
    };
    return config;
  },
};

export default nextConfig;
