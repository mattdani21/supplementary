/**
 * Normalise lesson text for text-to-speech (E26, Kokoro math-reading fix).
 *
 * Kokoro (like most TTS engines) reads symbols literally: "a^2" comes out as "a two",
 * "1/2" as "one slash two", "√x" as nothing or "root x". The lesson scripts are written
 * for the eye (LaTeX-ish notation), so before synthesis we rewrite the common notation
 * into words the engine can actually pronounce. The notebook/transcript is untouched —
 * this only feeds the audio.
 *
 * Rules (applied in order, each idempotent):
 *  - superscripts: a^2 → "a squared", a^3 → "a cubed", x^n → "x to the power of n"
 *  - unicode superscripts ² ³
 *  - fractions/division: 1/2 → "one over two", a/b → "a over b"; "and/or" is preserved
 *  - symbols: × → "times", − → "minus", √ → "the square root of"
 *  - comparisons: ≤ ≥ ≠ ≈ → "at most" / "at least" / "does not equal" / "approximately"
 *  - set notation: ∈ → "in", ⊆ → "is a subset of", ∪ → "union", ∩ → "intersection"
 *  - Greek letters → their names (θ → "theta", Σ → "sum")
 */

const GREEK: Record<string, string> = {
  α: 'alpha',
  β: 'beta',
  γ: 'gamma',
  δ: 'delta',
  ε: 'epsilon',
  θ: 'theta',
  λ: 'lambda',
  μ: 'mu',
  π: 'pi',
  ρ: 'rho',
  σ: 'sigma',
  φ: 'phi',
  ω: 'omega',
  Δ: 'delta',
  Λ: 'lambda',
  Σ: 'sum',
  Ω: 'omega',
};

/** Ordered [pattern, replacement] pairs; replacements may use $1/$2 capture groups. */
const RULES: ReadonlyArray<readonly [RegExp, string]> = [
  // sums with limits: Σ_{i=1}^{n} → the sum from i equals 1 to n (requires explicit
  // braces or a _..^.. pair — plain "Σ x_i" must not be caught)
  [/Σ_\{(.+?)\}\^\{([^}]+)\}/g, 'the sum from $1 to $2'],
  [/Σ/g, 'the sum'],
  [/×/g, ' times '],
  [/·/g, ' times '],
  [/−/g, ' minus '],
  [/≥/g, ' at least '],
  [/≤/g, ' at most '],
  [/≠/g, ' does not equal '],
  [/≈/g, ' approximately '],
  [/∈/g, ' in '],
  [/∉/g, ' not in '],
  [/⊆/g, ' is a subset of '],
  [/⊂/g, ' is a subset of '],
  [/∪/g, ' union '],
  [/∩/g, ' intersection '],
  [/∅/g, ' the empty set '],
  [/√\s*([a-zA-Z0-9]+)/g, 'the square root of $1'],
  [/√/g, 'the square root'],
  [/∞/g, ' infinity '],
  [/²/g, ' squared'],
  [/³/g, ' cubed'],
  // superscripts: a^2, a^(n+1), x^10 — braced/parenthesized powers first so ^2 is not
  // stolen from ^(2)
  [/([a-zA-Z0-9])\^\{([^}]+)\}/g, '$1 to the power of $2'],
  [/([a-zA-Z0-9])\^\(([^)]+)\)/g, '$1 to the power of $2'],
  [/([a-zA-Z0-9])\^2\b/g, '$1 squared'],
  [/([a-zA-Z0-9])\^3\b/g, '$1 cubed'],
  [/([a-zA-Z0-9])\^([a-zA-Z0-9]+)/g, '$1 to the power of $2'],
  // fractions/division: token over token; "and/or" protected beforehand
  [/([a-zA-Z0-9]+)\s*\/\s*([a-zA-Z0-9]+)/g, '$1 over $2'],
];

const AND_OR = /(and\s*\/\s*or|a\/k\/a|and or)/gi;

/** Marker that cannot appear in lesson prose (chosen deliberately). */
const MARKER = '\u0001GAPOS_PROTECTED\u0001';

export const normaliseForSpeech = (text: string): string => {
  let out = text;

  // protect "and/or" so the slash rule never touches it
  const protectedPhrases: string[] = [];
  out = out.replace(AND_OR, (match) => {
    protectedPhrases.push(match.replace(/\//g, ' '));
    return `${MARKER}${protectedPhrases.length - 1}${MARKER}`;
  });
  for (const [pattern, replacement] of RULES) {
    out = out.replace(pattern, replacement);
  }
  for (const [letter, name] of Object.entries(GREEK)) {
    out = out.split(letter).join(` ${name} `);
  }

  // restore protected phrases (the marker regex is constructed from a constant, not
  // user input — the control character is deliberate and safe)
  const restore = new RegExp(`${MARKER}(\\d+)${MARKER}`, 'g');
  out = out.replace(restore, (_m, index: string) => {
    const value = protectedPhrases[Number(index)];
    return value ?? '';
  });

  // collapse stray double spaces introduced by symbol replacements
  return out.replace(/[ \t]{2,}/g, ' ').trim();
};
