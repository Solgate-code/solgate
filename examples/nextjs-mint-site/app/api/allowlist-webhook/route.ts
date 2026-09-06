/** Receives signed events from the allowlist server (e.g. to sync to your CRM / Discord bot). */
import { verifyWebhookSignature } from "@solgate/server";

export async function POST(req: Request) {
  const body = await req.text();
  const sig = req.headers.get("x-allowlist-signature") ?? "";
  if (!verifyWebhookSignature(process.env.ALLOWLIST_WEBHOOK_SECRET!, sig, body)) return new Response("bad signature", { status: 401 });
  const event = JSON.parse(body);
  if (event.type === "entry.eligible") {
    console.log(`${event.wallet} is now eligible for ${event.campaignId} with allocation ${event.data.allocation}`);
  }
  return new Response("ok");
}
