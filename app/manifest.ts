import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Break Par — daily golf challenge",
    short_name: "Break Par",
    description: "One real course a day. 18 holes, one decision each. Can you break par?",
    start_url: "/",
    display: "standalone",
    background_color: "#143728",
    theme_color: "#143728",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
  };
}
