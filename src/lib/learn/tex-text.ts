/**
 * A readable plain-text form of a TeX formula, for the places a formula cannot
 * be drawn: the "On this page" outline, a link's label. It is for reading, not
 * for parsing back: `d_{\text{model}}` is `d_model`, `\frac{a}{b}` is `a/b`,
 * `x^{2}` is `x^2`, `\sqrt{n}` is `√n`, `\alpha` is `α`.
 */

const SYMBOLS: Record<string, string> = {
  times: "×", cdot: "·", div: "÷", pm: "±", mp: "∓", leq: "≤", le: "≤", geq: "≥", ge: "≥", neq: "≠", ne: "≠",
  approx: "≈", sim: "~", equiv: "≡", propto: "∝", infty: "∞", partial: "∂", nabla: "∇", sum: "Σ", prod: "Π",
  int: "∫", in: "∈", notin: "∉", subset: "⊂", cup: "∪", cap: "∩", to: "→", rightarrow: "→", leftarrow: "←",
  Rightarrow: "⇒", mapsto: "↦", ldots: "…", dots: "…", cdots: "…", forall: "∀", exists: "∃", ell: "ℓ",
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε", varepsilon: "ε", zeta: "ζ", eta: "η",
  theta: "θ", iota: "ι", kappa: "κ", lambda: "λ", mu: "μ", nu: "ν", xi: "ξ", pi: "π", rho: "ρ",
  sigma: "σ", tau: "τ", upsilon: "υ", phi: "φ", varphi: "φ", chi: "χ", psi: "ψ", omega: "ω",
  Gamma: "Γ", Delta: "Δ", Theta: "Θ", Lambda: "Λ", Xi: "Ξ", Pi: "Π", Sigma: "Σ", Phi: "Φ", Psi: "Ψ", Omega: "Ω",
  log: "log", ln: "ln", exp: "exp", max: "max", min: "min", sin: "sin", cos: "cos", tan: "tan",
  softmax: "softmax", argmax: "argmax", argmin: "argmin", lim: "lim", Pr: "Pr",
};

/** A TeX command whose argument is words or a symbol name: keep the argument. */
const KEEP = /\\(?:text|textrm|textbf|textit|textsf|texttt|mbox|mathrm|mathit|mathbf|mathsf|mathtt|mathcal|mathbb|operatorname|boldsymbol|bm|hat|bar|tilde|vec)\s*\{([^{}]*)\}/g;

export function texToText(tex: string): string {
  let s = tex;
  // Innermost groups first, so nested commands resolve.
  for (let i = 0; i < 6; i++) {
    const before = s;
    s = s.replace(KEEP, "$1");
    s = s.replace(/\\sqrt\s*\{([^{}]*)\}/g, (_, x: string) => `√${x.length > 1 ? `(${x})` : x}`);
    s = s.replace(/\\[dt]?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, (_, a: string, b: string) => {
      const wrap = (x: string): string => (/^[\w.]+$/.test(x) ? x : `(${x})`);
      return `${wrap(a)}/${wrap(b)}`;
    });
    if (s === before) break;
  }
  return s
    .replace(/\\(?:left|right|big|Big|bigg|Bigg)\b\s*/g, "")
    .replace(/\\[,;:! ]/g, " ")
    .replace(/\\(?:quad|qquad)\b/g, " ")
    .replace(/\\([A-Za-z]+)/g, (_, name: string) => SYMBOLS[name] ?? name)
    .replace(/\^\s*\{([^{}]*)\}/g, (_, x: string) => `^${x.length > 1 ? `(${x})` : x}`)
    .replace(/_\s*\{([^{}]*)\}/g, "_$1")
    .replace(/[{}]/g, "")
    .replace(/\\/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
