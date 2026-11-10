import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["pg"],
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
