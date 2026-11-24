import type { MetadataRoute } from "next";
import { getAppDomainMode } from "@/lib/app-domain";

export const dynamic = "force-dynamic";

function resolveSiteBaseUrl(isEcommerce: boolean): string {
  const raw = (process.env.BETTER_AUTH_URL || "").trim();
  if (raw) {
    return raw.replace(/\/+$/, "");
  }
  return isEcommerce ? "https://ecom.firetable.tech" : "https://12345.firetable.tech";
}

export default function sitemap(): MetadataRoute.Sitemap {
  const isEcommerce = getAppDomainMode() === "ECOMMERCE_CS";
  const baseUrl = resolveSiteBaseUrl(isEcommerce);
  const now = new Date();

  return [
    {
      url: `${baseUrl}/`,
      lastModified: now,
      changeFrequency: "hourly",
      priority: 1.0,
    },
    {
      url: `${baseUrl}/submit`,
      lastModified: now,
      changeFrequency: "daily",
      priority: 0.95,
    },
    {
      url: `${baseUrl}/themes`,
      lastModified: now,
      changeFrequency: "hourly",
      priority: 0.9,
    },
    {
      url: `${baseUrl}/multifreq`,
      lastModified: now,
      changeFrequency: "hourly",
      priority: 0.9,
    },
    {
      url: `${baseUrl}/tickets`,
      lastModified: now,
      changeFrequency: "hourly",
      priority: 0.85,
    },
    {
      url: `${baseUrl}/agent`,
      lastModified: now,
      changeFrequency: "hourly",
      priority: 0.85,
    },
    {
      url: `${baseUrl}/screen`,
      lastModified: now,
      changeFrequency: "hourly",
      priority: 0.8,
    },
    {
      url: `${baseUrl}/dict`,
      lastModified: now,
      changeFrequency: "daily",
      priority: 0.75,
    },
    {
      url: `${baseUrl}/sandbox`,
      lastModified: now,
      changeFrequency: "daily",
      priority: 0.75,
    },
    {
      url: `${baseUrl}/login`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.6,
    },
  ];
}
