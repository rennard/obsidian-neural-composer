/**
 * Pure helpers for the insights sidebar: building retrieval queries from the
 * note being read or written, normalising LightRAG `/query/data` chunks, and
 * locating a retrieved passage inside its source note.
 *
 * Nothing in this file touches the Obsidian API, so it can be unit tested in
 * a plain node environment.
 */

export type Insight = {
  /** Stable identifier of the chunk (LightRAG chunk id when available). */
  key: string
  /** Source path as reported by LightRAG (vault path, or bare file name). */
  path: string
  /** Full chunk text. */
  content: string
  /** The paragraph of the chunk that best matches the query. */
  focus: string
}

export type NoteHeading = {
  heading: string
  level: number
  line: number
}

export type SectionContext = {
  /** Human readable location, e.g. "Strategy > Risks". */
  label: string
  /** Text sent to the retriever. */
  query: string
  /** Changes whenever the query changes; used to skip redundant requests. */
  key: string
}

/** LightRAG rejects very long queries, and long queries embed poorly. */
export const MAX_QUERY_CHARS = 1500

/** Below this much text there is nothing meaningful to search with. */
export const MIN_QUERY_BODY_CHARS = 20

const STOP_WORDS = new Set([
  'about',
  'after',
  'also',
  'because',
  'been',
  'before',
  'being',
  'between',
  'both',
  'could',
  'does',
  'each',
  'from',
  'have',
  'into',
  'just',
  'more',
  'most',
  'much',
  'only',
  'other',
  'over',
  'same',
  'should',
  'some',
  'such',
  'than',
  'that',
  'their',
  'them',
  'then',
  'there',
  'these',
  'they',
  'this',
  'those',
  'through',
  'very',
  'what',
  'when',
  'where',
  'which',
  'while',
  'will',
  'with',
  'would',
  'your',
])

// Built with the RegExp constructor so unicode property escapes do not depend
// on the TypeScript compile target.
const WORD_PATTERN = '[\\p{L}\\p{N}]{4,}'

export function hashString(value: string): string {
  let hash = 5381
  for (let i = 0; i < value.length; i++) {
    hash = ((hash << 5) + hash + value.charCodeAt(i)) | 0
  }
  return (hash >>> 0).toString(36)
}

export function extractTerms(text: string): Set<string> {
  const terms = new Set<string>()
  const matches = text.toLowerCase().match(new RegExp(WORD_PATTERN, 'gu'))
  if (!matches) return terms
  for (const word of matches) {
    if (!STOP_WORDS.has(word)) terms.add(word)
  }
  return terms
}

/** Removes a leading YAML frontmatter block, returning the remaining body. */
export function stripFrontmatter(content: string): string {
  if (!content.startsWith('---')) return content
  const match = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(\r?\n|$)/.exec(content)
  return match ? content.slice(match[0].length) : content
}

/** Number of lines occupied by a leading frontmatter block (0 if none). */
export function frontmatterLineCount(content: string): number {
  const body = stripFrontmatter(content)
  if (body.length === content.length) return 0
  return content.slice(0, content.length - body.length).split('\n').length - 1
}

/** Parses ATX headings, ignoring anything inside fenced code blocks. */
export function extractHeadings(lines: string[]): NoteHeading[] {
  const headings: NoteHeading[] = []
  let fence: string | null = null
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const fenceMatch = /^\s*(```+|~~~+)/.exec(line)
    if (fenceMatch) {
      const marker = fenceMatch[1][0]
      if (fence === null) fence = marker
      else if (fence === marker) fence = null
      continue
    }
    if (fence !== null) continue
    const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line)
    if (match) {
      headings.push({ heading: match[2], level: match[1].length, line: i })
    }
  }
  return headings
}

/**
 * Heading trail leading to `line`: the nearest heading above it plus each of
 * its ancestors, outermost first.
 */
export function getHeadingPath(
  headings: NoteHeading[],
  line: number,
): NoteHeading[] {
  const path: NoteHeading[] = []
  let level = Infinity
  for (let i = headings.length - 1; i >= 0; i--) {
    const heading = headings[i]
    if (heading.line > line) continue
    if (heading.level < level) {
      path.unshift(heading)
      level = heading.level
      if (level === 1) break
    }
  }
  return path
}

/**
 * Collects whole lines around `cursorLine` within [start, end), growing
 * outwards until the character budget is used up.
 */
function windowAroundLine(
  lines: string[],
  start: number,
  end: number,
  cursorLine: number,
  budget: number,
): string {
  if (end <= start) return ''
  const centre = Math.min(Math.max(cursorLine, start), end - 1)
  let lo = centre
  let hi = centre
  let used = lines[centre].length
  let grew = true
  while (grew && used < budget) {
    grew = false
    if (lo > start && used + lines[lo - 1].length + 1 <= budget) {
      lo--
      used += lines[lo].length + 1
      grew = true
    }
    if (hi < end - 1 && used + lines[hi + 1].length + 1 <= budget) {
      hi++
      used += lines[hi].length + 1
      grew = true
    }
  }
  return lines
    .slice(lo, hi + 1)
    .join('\n')
    .slice(0, budget)
}

/**
 * Builds the retrieval context for the section containing `cursorLine`.
 * Returns null when the section holds too little text to search with.
 */
export function buildSectionContext({
  title,
  content,
  cursorLine,
  maxChars = MAX_QUERY_CHARS,
}: {
  title: string
  content: string
  cursorLine: number
  maxChars?: number
}): SectionContext | null {
  const lines = content.split('\n')
  if (lines.length === 0) return null
  const line = Math.min(Math.max(cursorLine, 0), lines.length - 1)
  const headings = extractHeadings(lines)
  const path = getHeadingPath(headings, line)

  const current = path.length > 0 ? path[path.length - 1] : null
  const start = current ? current.line + 1 : frontmatterLineCount(content)
  const next = headings.find((h) => h.line > line)
  const end = next ? next.line : lines.length

  const label =
    path.length > 0 ? path.map((h) => h.heading).join(' > ') : 'Top of note'
  const header = [title, ...path.map((h) => h.heading)].join(' > ')
  const budget = Math.max(maxChars - header.length - 1, 0)
  const body = windowAroundLine(lines, start, end, line, budget).trim()
  if (body.length < MIN_QUERY_BODY_CHARS) return null

  const query = `${header}\n${body}`
  return { label, query, key: hashString(query) }
}

/** Builds the retrieval query that represents the note as a whole. */
export function buildNoteQuery({
  title,
  content,
  maxChars = MAX_QUERY_CHARS,
}: {
  title: string
  content: string
  maxChars?: number
}): string | null {
  const body = stripFrontmatter(content).trim()
  if (body.length < MIN_QUERY_BODY_CHARS) return null
  const headings = extractHeadings(body.split('\n'))
    .map((h) => h.heading)
    .join('; ')
  const header = headings ? `${title}\n${headings}` : title
  const budget = Math.max(maxChars - header.length - 1, 0)
  return `${header.slice(0, maxChars)}\n${body.slice(0, budget)}`.trim()
}

/**
 * Notes are ingested as `Title: <name>\n\n<content>`; drop that synthetic
 * prefix so the passage reads (and can be located) as written.
 */
export function cleanChunkContent(content: string): string {
  return content.replace(/^Title: [^\n]*\n+/, '').trim()
}

/** Picks the paragraph of `content` sharing the most terms with the query. */
export function pickFocusParagraph(content: string, query: string): string {
  const paragraphs = content
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
  if (paragraphs.length === 0) return content.trim()

  const queryTerms = extractTerms(query)
  let best = paragraphs[0]
  let bestScore = -1
  for (const paragraph of paragraphs) {
    // A bare heading is a poor preview unless nothing else matches.
    const isHeading = /^#{1,6}\s/.test(paragraph) && !paragraph.includes('\n')
    let score = 0
    extractTerms(paragraph).forEach((term) => {
      if (queryTerms.has(term)) score++
    })
    if (isHeading) score -= 0.5
    if (paragraph.length < 40) score -= 0.25
    if (score > bestScore) {
      best = paragraph
      bestScore = score
    }
  }
  return best
}

type RawChunk = {
  content?: unknown
  file_path?: unknown
  chunk_id?: unknown
}

/**
 * Normalises a LightRAG `/query/data` response into insights, in the order
 * the server ranked them. Tolerates missing fields and older response shapes.
 */
export function parseQueryDataChunks(json: unknown, query: string): Insight[] {
  if (typeof json !== 'object' || json === null) return []
  const root = json as { data?: unknown; chunks?: unknown }
  const data =
    typeof root.data === 'object' && root.data !== null
      ? (root.data as { chunks?: unknown })
      : root
  const chunks = Array.isArray(data.chunks) ? (data.chunks as RawChunk[]) : []

  const seen = new Set<string>()
  const insights: Insight[] = []
  for (const chunk of chunks) {
    if (typeof chunk !== 'object' || chunk === null) continue
    if (typeof chunk.content !== 'string') continue
    const content = cleanChunkContent(chunk.content)
    if (!content) continue
    const path = typeof chunk.file_path === 'string' ? chunk.file_path : ''
    const key =
      typeof chunk.chunk_id === 'string' && chunk.chunk_id
        ? chunk.chunk_id
        : `local-${hashString(`${path}\n${content}`)}`
    if (seen.has(key)) continue
    seen.add(key)
    insights.push({
      key,
      path,
      content,
      focus: pickFocusParagraph(content, query),
    })
  }
  return insights
}

/**
 * Applies the sidebar's visibility rules. `isHidden` receives the resolved
 * vault path of each insight's source note.
 */
export function filterInsights(
  insights: Insight[],
  {
    resolvePath,
    isHidden,
    excludedKeys,
  }: {
    resolvePath: (path: string) => string | null
    isHidden: (vaultPath: string) => boolean
    excludedKeys: Set<string>
  },
): Insight[] {
  const out: Insight[] = []
  for (const insight of insights) {
    if (excludedKeys.has(insight.key)) continue
    const vaultPath = resolvePath(insight.path)
    // Sources that no longer exist in the vault cannot be opened or linked.
    if (vaultPath === null) continue
    if (isHidden(vaultPath)) continue
    out.push(
      vaultPath === insight.path ? insight : { ...insight, path: vaultPath },
    )
  }
  return out
}

/**
 * Finds the 0-based line of `passage` inside `fileContent`, or null when it
 * cannot be located (the note changed since it was indexed).
 */
export function findPassageLine(
  fileContent: string,
  passage: string,
): number | null {
  const candidates = passage
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length >= 12)
    .slice(0, 3)
  for (const candidate of candidates) {
    const index = fileContent.indexOf(candidate.slice(0, 80))
    if (index >= 0) {
      let line = 0
      for (let i = 0; i < index; i++) {
        if (fileContent.charCodeAt(i) === 10) line++
      }
      return line
    }
  }
  return null
}

export function generateBlockId(): string {
  let id = ''
  while (id.length < 6) {
    id += Math.random().toString(36).slice(2)
  }
  return id.slice(0, 6)
}

/**
 * Appends a block id to the given line unless it already carries one.
 * Returns the id in use and the updated line.
 */
export function withBlockId(
  line: string,
  newId: string,
): { id: string; line: string } {
  const existing = /\s\^([A-Za-z0-9-]+)\s*$/.exec(line)
  if (existing) return { id: existing[1], line }
  return { id: newId, line: `${line.replace(/\s+$/, '')} ^${newId}` }
}
