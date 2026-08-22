import type { MetadataRoute } from "next";

/** Installable on a home screen: the trip is what people open ten times a day. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Chiang Pai",
    short_name: "Chiang Pai",
    description: "The app for the trip that actually happens.",
    start_url: "/trips",
    display: "standalone",
    background_color: "#143024",
    theme_color: "#143024",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
