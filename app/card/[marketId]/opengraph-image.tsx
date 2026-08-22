import { ImageResponse } from "next/og";
import { marketCard } from "@/lib/data";
import { piesText } from "@/lib/pies";

export const alt = "A prediction from a friend trip on Chiang Pai";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * What WhatsApp unfurls: the question, the verdict, the names. Drawn with
 * system fonts only — the card has to render in the time a chat gives it.
 */
export default async function Image({ params }: { params: Promise<{ marketId: string }> }) {
  const { marketId } = await params;
  const card = await marketCard(marketId);
  const question = card?.question ?? "Chiang Pai";
  const settled = card && (card.status === "yes" || card.status === "no");
  const verdict = !card
    ? ""
    : card.status === "open"
      ? "STILL OPEN"
      : card.status === "refunded"
        ? "VOIDED"
        : card.status.toUpperCase();
  const names = (list: { name: string; profitC: number }[]) =>
    list
      .slice(0, 4)
      .map((x) => `${x.name} ${piesText(x.profitC, { sign: true })}`)
      .join("   ");

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        background: "#143024",
        color: "#f1eee4",
        padding: 64,
        fontFamily: "sans-serif",
      }}
    >
      <div style={{ display: "flex", fontSize: 28, color: "#e8c46a", letterSpacing: 2 }}>
        {card ? card.trip.name.toUpperCase() : "CHIANG PAI"}
      </div>
      <div
        style={{
          display: "flex",
          fontSize: question.length > 80 ? 52 : 64,
          fontWeight: 800,
          lineHeight: 1.1,
        }}
      >
        {question}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {verdict && (
          <div
            style={{
              display: "flex",
              fontSize: 40,
              fontWeight: 800,
              color:
                card?.status === "yes" ? "#9db9e8" : card?.status === "no" ? "#eda06d" : "#e8c46a",
            }}
          >
            {settled ? `RESOLVED ${verdict}` : verdict}
          </div>
        )}
        {card && settled && card.winners.length > 0 && (
          <div style={{ display: "flex", fontSize: 26, color: "#f1eee4" }}>
            Called it: {names(card.winners)}
          </div>
        )}
        {card && settled && card.losers.length > 0 && (
          <div style={{ display: "flex", fontSize: 26, color: "rgba(241,238,228,0.7)" }}>
            Paid for it: {names(card.losers)}
          </div>
        )}
        <div style={{ display: "flex", fontSize: 22, color: "rgba(241,238,228,0.55)" }}>
          π Chiang Pai · the app for the trip that actually happens · pies are never money
        </div>
      </div>
    </div>,
    { ...size },
  );
}
