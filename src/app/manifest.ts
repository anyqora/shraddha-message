import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  const name = process.env.APP_NAME || "Shraddha Message";
  return {
    name,
    short_name: name.length > 12 ? "Shraddha Msg" : name,
    description: "WhatsApp inbox, campaigns and CRM",
    id: "/inbox",
    start_url: "/inbox",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#f1f1f1",
    theme_color: "#1961ed",
    categories: ["business", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
    shortcuts: [
      { name: "Inbox", url: "/inbox", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Contacts", url: "/contacts", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
