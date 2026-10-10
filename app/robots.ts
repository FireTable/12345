import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const baseUrl = process.env.BETTER_AUTH_URL || "http://localhost:3000";

  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/themes", "/multifreq", "/tickets", "/dict", "/screen", "/api/mcp/.well-known/*"],
        disallow: ["/api/admin/*", "/admin/*", "/mcp/authorize"],
      },
      {
        userAgent: ["GPTBot", "ClaudeBot", "PerplexityBot", "Applebot-Extended"],
        allow: ["/", "/llms.txt", "/llms-full.txt"],
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}
