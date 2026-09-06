/**
 * Usage:
 *   <link rel="stylesheet" href="https://cdn.example.com/allowlist/styles.css">
 *   <div data-allowlist data-base-url="https://api.myproject.xyz" data-campaign="genesis" data-theme="dark"></div>
 *   <script src="https://cdn.example.com/allowlist/embed.js" defer></script>
 *
 * or programmatically: SolanaAllowlist.mount(el, { baseUrl, campaignId })
 */
import { createRoot } from "react-dom/client";
import { AllowlistWidget, type AllowlistWidgetProps } from "@solgate/react";

export function mount(el: HTMLElement, props: AllowlistWidgetProps) {
  const root = createRoot(el);
  root.render(<AllowlistWidget {...props} />);
  return () => root.unmount();
}

function auto() {
  document.querySelectorAll<HTMLElement>("[data-allowlist]").forEach((el) => {
    if (el.dataset.mounted) return;
    el.dataset.mounted = "1";
    mount(el, {
      baseUrl: el.dataset.baseUrl!,
      campaignId: el.dataset.campaign!,
      theme: (el.dataset.theme as "light" | "dark") ?? "light",
      telegramBot: el.dataset.telegramBot,
      onEligible: (entry) => el.dispatchEvent(new CustomEvent("allowlist:eligible", { detail: entry, bubbles: true })),
    });
  });
}
if (typeof document !== "undefined") {
  document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", auto) : auto();
}
