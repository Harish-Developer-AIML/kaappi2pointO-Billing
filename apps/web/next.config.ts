import type { NextConfig } from "next";

// Browser only ever talks to ONE origin (this Next.js server) — API calls
// are proxied server-side to the backend. Same reasoning as nodedr-pos:
// this keeps the session cookie first-party, avoiding the cross-origin
// cookie fragility that broke that app's very first version. NOTE: Next
// bakes the rewrite destination at build time, so in Docker this must come
// from a build ARG, not a runtime env var (see nodedr-pos memory).
const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:4001";

// BUILD_TARGET=android: a static export (plain HTML/JS/CSS in out/) that the
// Android app's embedded backend serves itself, on the same origin as /api and
// /socket.io — so no Next.js server and no rewrites are needed on the phone.
// See apps/android/scripts/stage-web.sh.
const ANDROID = process.env.BUILD_TARGET === "android";

const nextConfig: NextConfig = {
  output: ANDROID ? "export" : "standalone",
  // Exported pages are served as /path/index.html by the embedded backend.
  ...(ANDROID ? { trailingSlash: true, images: { unoptimized: true } } : {}),
  experimental: {
    // Policy for `next upgrade --agent` and the dev/build upgrade reminders:
    // recommend an upgrade only when a security advisory affects this version.
    agentUpgrade: "security",
  },
  // Development only: let phones and tablets on the same Wi-Fi open the dev
  // server by the Mac's local IP (e.g. http://192.168.1.20:3000). Next.js
  // otherwise blocks its dev resources for any host but localhost. These are
  // private (RFC 1918) address ranges plus .local hostnames; production
  // builds ignore this setting.
  allowedDevOrigins: ["10.*.*.*", "192.168.*.*", "172.*.*.*", "*.local"],
  // socket.io's endpoint is literally "/socket.io/" — the backend 404s on the
  // slash-less form, so Next must not redirect it.
  skipTrailingSlashRedirect: !ANDROID,
  ...(ANDROID
    ? {}
    : {
        async rewrites() {
          return [
            { source: "/api/:path*", destination: `${BACKEND_URL}/api/:path*` },
            // Realtime push (socket.io) goes through the same origin too: in
            // production only this web server is reachable, never the backend's
            // own port. socket.io starts with long-polling, which proxies fine.
            // Literal first: an empty :path* would drop the trailing slash.
            { source: "/socket.io/", destination: `${BACKEND_URL}/socket.io/` },
            { source: "/socket.io/:path+", destination: `${BACKEND_URL}/socket.io/:path+` },
          ];
        },
      }),
};

export default nextConfig;
