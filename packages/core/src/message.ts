/**
 * Sign-in message format shared by server and client so both sides
 * build byte-identical payloads. Loosely modelled on Sign-In-With-Solana.
 */
export interface SignInMessageFields {
  domain: string;
  wallet: string;
  campaignId: string;
  nonce: string;
  issuedAt: string; // ISO
  statement?: string;
}

export function buildSignInMessage(f: SignInMessageFields): string {
  const lines = [
    `${f.domain} wants you to sign in with your Solana account:`,
    f.wallet,
    "",
    f.statement ?? `Register for allowlist campaign "${f.campaignId}". This request will not trigger a blockchain transaction or cost any gas fees.`,
    "",
    `Campaign: ${f.campaignId}`,
    `Nonce: ${f.nonce}`,
    `Issued At: ${f.issuedAt}`,
  ];
  return lines.join("\n");
}
