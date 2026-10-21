import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  // typedRoutes off: we build URLs dynamically (search params, category IDs)
  // so casting every router.replace and <Link> is more friction than typing
  // is worth in an app this small.
  experimental: { typedRoutes: false },
};

export default config;
