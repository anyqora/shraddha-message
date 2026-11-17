import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["mysql2"],
  experimental: { serverActions: { bodySizeLimit: "20mb" } },
};

export default nextConfig;
