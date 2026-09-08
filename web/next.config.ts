import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The dev badge sits over the bottom-right corner, which in the Studio is
  // the chat's Send button — its overlay swallows the click. Moved rather than
  // switched off, so the build indicator is still there when something is
  // recompiling.
  devIndicators: { position: "bottom-left" },

  async redirects() {
    return [
      {
        source: "/rooms/greenlight",
        destination: "/data?view=titles",
        permanent: true,
      },
      {
        source: "/rooms/rollout",
        destination: "/data?view=titles",
        permanent: true,
      },
      {
        source: "/rooms/promo",
        destination: "/data?view=promo",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
