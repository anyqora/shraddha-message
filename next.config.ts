import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["mysql2"],
  experimental: {
    serverActions: { bodySizeLimit: "20mb" },
    // Shared hosting limits processes/threads: build with a single worker.
    cpus: 1,
    workerThreads: false,
    staticGenerationMaxConcurrency: 1,
  },
};

export default nextConfig;
