import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@itckar/db", "@itckar/scheduling", "@itckar/shared"],
  serverExternalPackages: ["pg", "kysely"],
  experimental: { serverActions: { bodySizeLimit: "1mb" } },
};

export default config;
