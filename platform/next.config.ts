import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Skills are read from disk at boot (src/server/skill-files.ts); every server route needs the folder in its trace.
  outputFileTracingIncludes: {
    "/**": ["./skills/**/*"],
  },
  // sharp (server/director-photo.ts) ships native binaries, loaded by Node at run time, not bundled.
  serverExternalPackages: ["sharp"],
};

export default nextConfig;
