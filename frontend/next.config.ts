import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  allowedDevOrigins: ["10.100.101.19", "192.168.71.71", "localhost", "127.0.0.1"],
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${process.env.BACKEND_URL || "http://localhost:4000"}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;