// ============================================================
// Text search shared by find-in-document and the search panel
// ============================================================

export interface SearchOptions {
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
}

export const DEFAULT_SEARCH_OPTIONS: SearchOptions = {
  caseSensitive: false,
  wholeWord: false,
  regex: false,
};

/** One match inside a source text. `line` and `column` are 0-based. */
export interface LineMatch {
  line: number;
  column: number;
  length: number;
  /** The whole source line, for the result preview. */
  lineText: string;
}

export type SearchRegexResult =
  | { regex: RegExp; error?: undefined }
  | { regex: null; error?: string };

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Build the global RegExp for a query. Empty queries give `null`; an invalid
 * regular expression gives `null` plus the error message.
 */
export function buildSearchRegex(query: string, options: SearchOptions): SearchRegexResult {
  if (!query) return { regex: null };

  let source = options.regex ? query : escapeRegExp(query);
  if (options.wholeWord) {
    source = `(?<![\\p{L}\\p{N}_])(?:${source})(?![\\p{L}\\p{N}_])`;
  }

  try {
    // 'u' only when needed for \p{...}: it also rejects escapes like \- that
    // people commonly type in plain regexes
    const flags = (options.caseSensitive ? 'g' : 'gi') + (options.wholeWord ? 'u' : '');
    return { regex: new RegExp(source, flags) };
  } catch (error) {
    return { regex: null, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Iterate the matches of a global regex, skipping empty matches (a regex like
 * `a*` would otherwise loop forever or flood the results).
 */
export function* iterateMatches(text: string, regex: RegExp): Generator<RegExpExecArray> {
  regex.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    if (match[0].length === 0) {
      regex.lastIndex += 1;
      continue;
    }
    yield match;
  }
}

/** Find matches line by line, at most `limit` of them. */
export function findLineMatches(text: string, regex: RegExp, limit = Infinity): LineMatch[] {
  const results: LineMatch[] = [];
  const lines = text.split(/\r?\n/);

  for (let line = 0; line < lines.length && results.length < limit; line++) {
    const lineText = lines[line];
    for (const match of iterateMatches(lineText, regex)) {
      results.push({ line, column: match.index, length: match[0].length, lineText });
      if (results.length >= limit) break;
    }
  }

  return results;
}
