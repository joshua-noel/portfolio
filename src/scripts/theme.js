// The theme switch of every page of the site (the main site, the blog and
// Learn): one button, two themes, dark by default. The choice is kept on this
// host in localStorage (the key theme-init.js reads before first paint) and, so
// that it carries to the site's other hostnames, in a `theme` cookie whose
// Domain the server computed from the configured hostnames and put on <html>
// as data-theme-domain (absent: no shared parent, so no cookie). Not HttpOnly:
// theme-init.js reads it. The server never reads it.
document.querySelector("[data-theme-toggle]")?.addEventListener("click", () => {
  const root = document.documentElement;
  const next = root.dataset.theme === "light" ? "dark" : "light";
  root.dataset.theme = next;
  try {
    localStorage.setItem("learn-theme", next);
  } catch {
    // Private mode or storage disabled: the choice lasts until the page closes.
  }
  const domain = root.dataset.themeDomain;
  if (domain) {
    const secure = location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `theme=${next}; Domain=${domain}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
  }
});
