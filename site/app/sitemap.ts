import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/studio";
export default function sitemap(): MetadataRoute.Sitemap {
  const origin = siteUrl();
  return origin
    ? [{ url: origin, changeFrequency: "monthly", priority: 1 }]
    : [];
}
