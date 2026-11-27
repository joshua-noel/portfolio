/**
 * The interactive diagrams: which script module each one loads, and which
 * diagram of which course declares it. A diagram says `data-interactive="<name>"`
 * on its <svg>, and the site then loads `src/scripts/learn-diagrams/<name>.js`.
 * Writers who regenerate a diagram have dropped the attribute before, and the
 * interactive then silently never loaded, so `bin/check-learn.mjs` holds the
 * content to this table: the table lists what each course must declare.
 */
export interface InteractiveModule {
  /** The module's name, as in `data-interactive` and `src/scripts/learn-diagrams/<name>.js`. */
  name: string;
  /** The course whose content must declare it. */
  course: string;
  /** The diagram file, without `.svg`, that must declare it. */
  diagram: string;
}

export const INTERACTIVE_MODULES: readonly InteractiveModule[] = [
  { name: "token-budget", course: "agent-systems", diagram: "04-budget-pack" },
  { name: "eviction-policy", course: "agent-systems", diagram: "05-eviction-timeline" },
  { name: "pass-curves", course: "agent-systems", diagram: "06-pass-curves" },
  { name: "trifecta", course: "agent-systems", diagram: "07-trifecta" },
  { name: "temperature", course: "how-language-models-work", diagram: "02-temperature" },
  { name: "rope-rotation", course: "how-language-models-work", diagram: "04-rope-rotation" },
  { name: "prefill-budget", course: "inference-and-serving", diagram: "03-token-budget" },
  { name: "speculative-speedup", course: "inference-and-serving", diagram: "06-speedup-vs-batch" },
  { name: "partition-sides", course: "system-design", diagram: "05-partition-sides" },
  { name: "retry-policies", course: "system-design", diagram: "06-retry-policies" },
  { name: "pipeline-bubble", course: "training-and-fine-tuning", diagram: "03-pipeline-bubble" },
  { name: "kl-leash", course: "training-and-fine-tuning", diagram: "05-kl-leash" },
];

/**
 * The three modules of the sample lectures in this repository, which stand in
 * for a real course of the same name and are held to the same rule there.
 */
export const SAMPLE_MODULES: readonly InteractiveModule[] = [
  { name: "attention-weights", course: "how-language-models-work", diagram: "01-attention-weights" },
  { name: "mask-cost", course: "how-language-models-work", diagram: "05-causal-mask" },
  { name: "scaling", course: "how-language-models-work", diagram: "06-scaling" },
];

const DECLARED = /^<svg\b[^>]*\sdata-interactive="([^"]*)"/;

/**
 * What is wrong with one course's interactive declarations. `diagrams` maps a
 * file stem to its SVG source. The modules that the table expects of this
 * course (the sample table for the sample lectures, the real one otherwise)
 * must each be declared by exactly one diagram, the one the table names; and
 * a name that is no module of the site is an error wherever it appears.
 */
export function interactiveProblems(
  course: string,
  diagrams: ReadonlyMap<string, string>,
  sample: boolean,
): string[] {
  const known = new Set([...INTERACTIVE_MODULES, ...SAMPLE_MODULES].map((m) => m.name));
  const declared = new Map<string, string[]>();
  const problems: string[] = [];
  for (const [stem, svg] of diagrams) {
    const name = DECLARED.exec(svg.trimStart())?.[1];
    if (name === undefined) continue;
    if (!known.has(name)) {
      problems.push(
        `diagrams/${stem}.svg: data-interactive="${name}" is not an interactive module of this site (known: ${[...known].join(", ")})`,
      );
      continue;
    }
    declared.set(name, [...(declared.get(name) ?? []), stem]);
  }
  for (const module of sample ? SAMPLE_MODULES : INTERACTIVE_MODULES) {
    if (module.course !== course) continue;
    const where = declared.get(module.name) ?? [];
    if (where.length === 0) {
      problems.push(
        `interactive module "${module.name}" is declared by no diagram: diagrams/${module.diagram}.svg should have data-interactive="${module.name}" on its <svg>`,
      );
    } else if (where.length > 1) {
      problems.push(
        `interactive module "${module.name}" is declared by ${where.length} diagrams (${where.map((s) => `${s}.svg`).join(", ")}); only diagrams/${module.diagram}.svg should declare it`,
      );
    } else if (where[0] !== module.diagram) {
      problems.push(
        `interactive module "${module.name}" is declared by diagrams/${where[0]}.svg; it should be diagrams/${module.diagram}.svg`,
      );
    }
  }
  return problems;
}
