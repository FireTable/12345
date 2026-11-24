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

export default function robots(): MetadataRoute.Robots {
  const isEcommerce = getAppDomainMode() === "ECOMMERCE_CS";
  const baseUrl = resolveSiteBaseUrl(isEcommerce);

  const publicAllow = [
    "/",
    "/login",
    "/submit",
    "/themes",
    "/multifreq",
    "/tickets",
    "/agent",
    "/dict",
    "/sandbox",
    "/screen",
    "/llms.txt",
    "/.well-known/oauth-protected-resource",
    "/.well-known/oauth-authorization-server",
    "/api/public/",
    "/api/mcp/oauth-protected-resource",
    "/api/mcp/oauth-authorization-server",
  ];

  const privateDisallow = [
    "/admin",
    "/api/",
    "/mcp/authorize",
  ];

  return {
    rules: [
      {
        userAgent: "*",
        allow: publicAllow,
        disallow: privateDisallow,
      },
      {
        userAgent: [
          "GPTBot",
          "OAI-SearchBot",
          "ChatGPT-User",
          "ClaudeBot",
          "Claude-SearchBot",
          "PerplexityBot",
          "Google-Extended",
          "Applebot-Extended",
        ],
        allow: publicAllow,
        disallow: privateDisallow,
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
    host: baseUrl,
  };
}
