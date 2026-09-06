document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll("[data-toggle]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.getAttribute("data-toggle");
      const panel = document.getElementById(id);

      if (!panel) return;

      const isOpen = panel.classList.toggle("open");

      button.textContent = isOpen ? "Hide" : "Info";
    });
  });

  document.querySelectorAll("[data-copy-target]").forEach((button) => {
    button.addEventListener("click", async () => {
      const id = button.getAttribute("data-copy-target");
      const codeBlock = document.getElementById(id);

      if (!codeBlock) return;

      const text = codeBlock.textContent || "";

      try {
        await navigator.clipboard.writeText(text);

        button.textContent = "Copied";
        button.classList.add("copied");

        setTimeout(() => {
          button.textContent = "Copy";
          button.classList.remove("copied");
        }, 1600);
      } catch {
        button.textContent = "Copy failed";

        setTimeout(() => {
          button.textContent = "Copy";
        }, 1600);
      }
    });
  });
});
