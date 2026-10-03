import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // Google profile photos, shown in the header after signing in with Google.
    remotePatterns: [{ protocol: "https", hostname: "lh3.googleusercontent.com" }],
  },
};

export default nextConfig;
