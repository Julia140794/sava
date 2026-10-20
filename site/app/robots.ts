import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/studio";
export default function robots(): MetadataRoute.Robots {
  const origin = siteUrl();
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/api/", "/privacy"] },
    ...(origin ? { sitemap: `${origin}/sitemap.xml` } : {}),
  };
}
