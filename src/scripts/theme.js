// The theme switch of every page of the site (the main site, the blog and
// Learn): one button, two themes, dark by default, the choice kept on this
// host in localStorage under the key theme-init.js reads before first paint.
document.querySelector("[data-theme-toggle]")?.addEventListener("click", () => {
  const root = document.documentElement;
  const next = root.dataset.theme === "light" ? "dark" : "light";
  root.dataset.theme = next;
  try {
    localStorage.setItem("learn-theme", next);
  } catch {
    // Private mode or storage disabled: the choice lasts until the page closes.
  }
});
