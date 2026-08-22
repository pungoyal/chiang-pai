import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { googleConfigured, noteSignInIntent, startGoogleSignIn } from "@/lib/auth";
import { env } from "@/lib/env";

/** Kick off Google sign-in: sets the handshake cookie, bounces to Google. */
export async function GET(request: NextRequest) {
  if (!googleConfigured) {
    return NextResponse.redirect(`${env.AUTH_URL}/signin?error=NotConfigured`);
  }
  const params = request.nextUrl.searchParams;
  await noteSignInIntent({ agreed: params.get("agree") === "1", next: params.get("next") ?? "/" });
  return NextResponse.redirect(await startGoogleSignIn());
}
