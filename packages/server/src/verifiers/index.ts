import type { Verifier } from "./types.js";
import { nftOwnershipVerifier, tokenBalanceVerifier, walletSignatureVerifier } from "./onchain.js";
import { discordVerifier, socialTaskVerifier, telegramVerifier, xVerifier, youtubeVerifier } from "./social.js";
import { captchaVerifier, quizVerifier, referralVerifier } from "./input.js";

export const builtinVerifiers: Verifier[] = [
  walletSignatureVerifier,
  tokenBalanceVerifier,
  nftOwnershipVerifier,
  xVerifier as Verifier,
  discordVerifier as Verifier,
  telegramVerifier as Verifier,
  youtubeVerifier as Verifier,
  socialTaskVerifier as Verifier,
  quizVerifier as Verifier,
  referralVerifier as Verifier,
  captchaVerifier as Verifier,
];

export * from "./types.js";
export * from "./onchain.js";
export * from "./social.js";
export * from "./input.js";
