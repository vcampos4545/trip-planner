import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Lets Playwright build into its own directory so it never clobbers `next dev` output.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // `next dev` would otherwise write an AGENTS.md into the repository.
  agentRules: false,
  poweredByHeader: false,
  typedRoutes: true,
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
    ],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
