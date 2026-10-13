import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  outputFileTracingIncludes: {
    "/*": ["./node_modules/pdfkit/js/standard-fonts/**/*"],
  },
};

export default nextConfig;
