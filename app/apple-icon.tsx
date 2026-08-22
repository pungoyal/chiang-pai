import { ImageResponse } from "next/og";
import { Logo } from "@/components/logo";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/** The home-screen icon, drawn from the same mark as the favicon. */
export default function AppleIcon() {
  return new ImageResponse(
    <div style={{ display: "flex", width: "100%", height: "100%", background: "#143024" }}>
      <Logo size={180} />
    </div>,
    size,
  );
}
