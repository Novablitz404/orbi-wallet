import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      {
        source: '/',
        has: [{ type: 'host', value: 'keys.orbiwallet.xyz' }],
        destination: 'https://account.orbiwallet.xyz',
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
