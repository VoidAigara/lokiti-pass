import type { MetadataRoute } from "next";

const siteUrl = process.env.NEXT_PUBLIC_WEB_URL ?? "http://localhost:3000";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return [
    { url: `${siteUrl}/`, lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: `${siteUrl}/buy`, lastModified: now, changeFrequency: "weekly", priority: 0.9 },
    { url: `${siteUrl}/rules`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    { url: `${siteUrl}/refund`, lastModified: now, changeFrequency: "monthly", priority: 0.5 },
    { url: `${siteUrl}/profile`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
  ];
}
