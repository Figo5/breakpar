import type { MetadataRoute } from "next";

// ponytail: static public routes — /admin and /profile excluded (gated/user-specific)
export default function sitemap(): MetadataRoute.Sitemap {
  const base = "https://breakpar.xyz";
  return ["", "/courses", "/play"].map((path) => ({
    url: `${base}${path}`,
    lastModified: new Date(),
    changeFrequency: path === "" ? "daily" : "weekly",
  }));
}
