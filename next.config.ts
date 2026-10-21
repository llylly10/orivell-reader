import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Next.js's own indicator is replaced by components/ui/DevPanel.tsx, which
  // follows the reader's language. The bundled one is a prebuilt shadow-root
  // build with hardcoded English, so it cannot be translated from here.
  devIndicators: false,
  // The dev server is reached at 127.0.0.1:3200; without this Next blocks the
  // cross-origin HMR socket, so the client bundle never hot-reloads (and the
  // sign-in page, which mounts Clerk in the browser, stays blank).
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  serverExternalPackages: ["linkedom"],
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
