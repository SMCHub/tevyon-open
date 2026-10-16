/** One entry of the command palette: a page, a model, a preset or an action. */
export type Command = { id: string; group: string; label: string; hint?: string; keywords?: string[] };

/** Lower case without accents, so «über» finds «Über» and «uber» alike. */
function fold(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

const WORDS = /[\s→\-–—/·,()]+/;

/** How well one query word fits a command; 0: not at all. */
function scoreWord(word: string, label: string, labelWords: string[], keywords: string[], hint: string): number {
  if (label.startsWith(word)) return 100;
  if (labelWords.some((w) => w.startsWith(word))) return 60;
  if (label.includes(word)) return 30;
  if (keywords.some((k) => k.startsWith(word))) return 25;
  if (keywords.some((k) => k.includes(word))) return 15;
  if (hint.includes(word)) return 5;
  return 0;
}

/**
 * The commands that fit the query, best first: every word of the query must match the label, a keyword or the hint;
 * a label that starts with it beats one with a word that starts with it, which beats one that merely contains it.
 * Ties keep the given order; an empty query keeps all of them in order.
 */
export function searchCommands<C extends Command>(commands: C[], query: string, limit = 50): C[] {
  const words = fold(query).split(WORDS).filter(Boolean);
  if (!words.length) return commands.slice(0, limit);
  const scored: { c: C; score: number; i: number }[] = [];
  commands.forEach((c, i) => {
    const label = fold(c.label);
    const labelWords = label.split(WORDS).filter(Boolean);
    const keywords = (c.keywords ?? []).map(fold);
    const hint = fold(c.hint ?? "");
    let score = 0;
    for (const w of words) {
      const s = scoreWord(w, label, labelWords, keywords, hint);
      if (!s) return;
      score += s;
    }
    scored.push({ c, score, i });
  });
  return scored.sort((a, b) => b.score - a.score || a.i - b.i).slice(0, limit).map((x) => x.c);
}
