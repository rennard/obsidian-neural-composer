import { minimatch } from 'minimatch'
import { App, TFile, stripHeadingForLink } from 'obsidian'

import { NeuralComposerSettings } from '../../settings/schema/setting.types'
import { getChatModelClient } from '../llm/manager'
import { RAGEngine } from '../rag/ragEngine'

import {
  Insight,
  filterInsights,
  findPassageLine,
  generateBlockId,
  hashString,
  parseQueryDataChunks,
  withBlockId,
} from './insightsQuery'

export type InsightRetrievalMode = 'live' | 'deep'

const CACHE_LIMIT = 60
/** Fetch more than we show so filtering still leaves a full list. */
const OVERFETCH_FACTOR = 4
const MAX_CHUNK_TOP_K = 60

const WHY_SYSTEM_PROMPT = `You help a writer see how a passage from their own notes relates to what they are working on right now.

You will receive the text they are currently reading or writing, and one passage retrieved from another of their notes. In one or two short sentences, say specifically why the passage matters for the current text: what it adds, supports, complicates, or contradicts. Refer to concrete ideas from both. Do not summarise the passage, do not start with "This passage", and do not use markdown.`

/** The LightRAG server could not be reached at all (as opposed to erroring). */
export class InsightsServerUnreachableError extends Error {
  constructor(
    public serverUrl: string,
    /** The underlying network error, for diagnosis. */
    public detail: string,
  ) {
    super(`No response from the LightRAG server at ${serverUrl}: ${detail}`)
    this.name = 'InsightsServerUnreachableError'
  }
}

/**
 * Retrieval and explanation for the insights sidebar. All communication with
 * the LightRAG server goes through the plugin's shared RAGEngine, so the
 * sidebar uses the same server address and headers as chat and ingestion.
 */
export class InsightsService {
  private cache = new Map<string, Insight[]>()

  constructor(
    private app: App,
    private getSettings: () => NeuralComposerSettings,
    private getRAGEngine: () => Promise<RAGEngine>,
  ) {}

  /**
   * Retrieves passages for `query`, best match first.
   *
   * - `live` uses plain vector search with reranking off: no LLM call is made,
   *   so it is cheap enough to run as the user moves through a note.
   * - `deep` uses the configured graph mode, which has LightRAG extract
   *   keywords with an LLM and traverse the knowledge graph.
   */
  async retrieve({
    query,
    mode,
    limit,
    force = false,
  }: {
    query: string
    mode: InsightRetrievalMode
    limit: number
    force?: boolean
  }): Promise<Insight[]> {
    const cacheKey = `${mode}:${hashString(query)}`
    if (!force) {
      const cached = this.cache.get(cacheKey)
      if (cached) return cached
    }

    const settings = this.getSettings()
    const engine = await this.getRAGEngine()

    const chunkTopK = Math.min(
      Math.max(limit, 1) * OVERFETCH_FACTOR,
      MAX_CHUNK_TOP_K,
    )
    const configuredMode = settings.lightRagQueryMode
    const deepMode =
      configuredMode === 'naive' || configuredMode === 'bypass'
        ? 'mix'
        : configuredMode
    const response = await engine
      .queryData(
        mode === 'live'
          ? {
              query,
              mode: 'naive',
              chunk_top_k: chunkTopK,
              enable_rerank: false,
            }
          : { query, mode: deepMode, chunk_top_k: chunkTopK },
      )
      .catch((error: unknown) => {
        throw new InsightsServerUnreachableError(
          settings.lightRagServerUrl,
          error instanceof Error ? error.message : String(error),
        )
      })
    if (response.status === 404) {
      throw new Error(
        'This LightRAG server has no /query/data endpoint. Update it with: pip install -U "lightrag-hku[api]"',
      )
    }
    if (response.status >= 400) {
      throw new Error(`LightRAG returned ${response.status}: ${response.text}`)
    }

    const insights = parseQueryDataChunks(response.json, query)
    this.cache.set(cacheKey, insights)
    if (this.cache.size > CACHE_LIMIT) {
      const oldest = this.cache.keys().next()
      if (!oldest.done) this.cache.delete(oldest.value)
    }
    return insights
  }

  /** Whether the LightRAG server currently answers its health check. */
  async isServerOnline(): Promise<boolean> {
    const engine = await this.getRAGEngine()
    return engine.isServerOnline()
  }

  clearCache(): void {
    this.cache.clear()
  }

  /** Maps a LightRAG source path to a file in the vault. */
  resolveFile(path: string): TFile | null {
    if (!path) return null
    const direct = this.app.vault.getFileByPath(path)
    if (direct) return direct
    // Documents ingested before v1.2 were stored under their bare file name.
    const name = path.replace(/\\/g, '/').split('/').pop()
    return name ? this.app.metadataCache.getFirstLinkpathDest(name, '') : null
  }

  /**
   * Applies the visibility rules for the note at `currentPath`: drops the
   * note itself, excluded folders, notes it already links to or is linked
   * from, and any explicitly excluded keys (pins and dismissals).
   */
  filter(
    insights: Insight[],
    currentPath: string,
    excludedKeys: Set<string>,
    {
      hideLinkedNotes,
      excludePatterns,
    }: { hideLinkedNotes: boolean; excludePatterns: string[] },
  ): Insight[] {
    const linked = hideLinkedNotes
      ? this.getLinkedPaths(currentPath)
      : new Set<string>()

    return filterInsights(insights, {
      excludedKeys,
      resolvePath: (path) => this.resolveFile(path)?.path ?? null,
      isHidden: (vaultPath) =>
        vaultPath === currentPath ||
        linked.has(vaultPath) ||
        excludePatterns.some((pattern) => minimatch(vaultPath, pattern)),
    })
  }

  private getLinkedPaths(currentPath: string): Set<string> {
    const linked = new Set<string>()
    const resolved = this.app.metadataCache.resolvedLinks
    const outgoing = resolved[currentPath]
    if (outgoing) {
      for (const target of Object.keys(outgoing)) linked.add(target)
    }
    for (const source of Object.keys(resolved)) {
      if (resolved[source][currentPath]) linked.add(source)
    }
    return linked
  }

  /** Asks the chat model why `insight` is relevant to `context`. */
  async explain(insight: Insight, context: string): Promise<string> {
    const settings = this.getSettings()
    const { providerClient, model } = getChatModelClient({
      settings,
      modelId: settings.chatModelId,
    })
    const response = await providerClient.generateResponse(model, {
      model: model.model,
      stream: false,
      messages: [
        { role: 'system', content: WHY_SYSTEM_PROMPT },
        {
          role: 'user',
          content: `# What I am working on\n\n${context}\n\n# Passage from "${insight.path}"\n\n${insight.content}`,
        },
      ],
    })
    return response.choices[0]?.message.content?.trim() ?? ''
  }

  /** 0-based line of the insight's focus paragraph in its source note. */
  async locate(insight: Insight): Promise<number | null> {
    const file = this.resolveFile(insight.path)
    if (!file) return null
    const content = await this.app.vault.cachedRead(file)
    return (
      findPassageLine(content, insight.focus) ??
      findPassageLine(content, insight.content)
    )
  }

  /**
   * Resolves the most precise link target for an insight: a block reference
   * to its paragraph when one exists (or may be created), otherwise the
   * heading it sits under, otherwise the note itself.
   *
   * Returns a subpath such as `#^abc123`, `#Heading`, or an empty string.
   */
  async resolveSubpath(insight: Insight): Promise<string> {
    const file = this.resolveFile(insight.path)
    if (!file) return ''
    const line = await this.locate(insight)
    if (line === null) return ''

    const cache = this.app.metadataCache.getFileCache(file)
    const section = cache?.sections?.find(
      (s) => s.position.start.line <= line && line <= s.position.end.line,
    )
    if (section?.id) return `#^${section.id}`

    if (
      section?.type === 'paragraph' &&
      this.getSettings().insightsOptions.createBlockIds
    ) {
      const endLine = section.position.end.line
      const created: { id: string | null } = { id: null }
      await this.app.vault.process(file, (data) => {
        const lines = data.split('\n')
        // Bail out if the note changed since the metadata cache was built.
        if (endLine >= lines.length || lines[endLine].trim() === '') {
          return data
        }
        const result = withBlockId(lines[endLine], generateBlockId())
        created.id = result.id
        lines[endLine] = result.line
        return lines.join('\n')
      })
      if (created.id) return `#^${created.id}`
    }

    const headings = cache?.headings ?? []
    for (let i = headings.length - 1; i >= 0; i--) {
      if (headings[i].position.start.line <= line) {
        return `#${stripHeadingForLink(headings[i].heading)}`
      }
    }
    return ''
  }
}
