import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/admin", "/profile"] },
    sitemap: "https://breakpar.xyz/sitemap.xml",
  };
}
