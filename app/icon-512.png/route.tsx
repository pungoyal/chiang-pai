import { ImageResponse } from "next/og";
import { Logo } from "@/components/logo";

/** A raster of the mark for the web manifest; SVG alone is not enough for every installer. */
export function GET() {
  return new ImageResponse(
    <div style={{ display: "flex", width: "100%", height: "100%", background: "#143024" }}>
      <Logo size={512} />
    </div>,
    { width: 512, height: 512 },
  );
}
