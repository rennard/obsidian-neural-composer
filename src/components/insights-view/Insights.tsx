import { App, MarkdownView, Menu, Notice, TFile } from 'obsidian'
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react'

import { useApp } from '../../contexts/app-context'
import { usePlugin } from '../../contexts/plugin-context'
import { useSettings } from '../../contexts/settings-context'
import {
  Insight,
  SectionContext,
  buildNoteQuery,
  buildSectionContext,
  hashString,
} from '../../core/insights/insightsQuery'
import {
  InsightRetrievalMode,
  InsightsService,
} from '../../core/insights/insightsService'
import { RefreshCw } from '../../utils/icons'
import { openMarkdownFile } from '../../utils/obsidian'
import DotLoader from '../common/DotLoader'

import InsightCard from './InsightCard'

type Target = {
  view: MarkdownView
  file: TFile
}

type NoteContext = {
  notePath: string
  noteQuery: string | null
  section: SectionContext | null
}

type LoadedResults = {
  requestKey: string
  scope: string
  items: Insight[]
  error: string | null
}

type InsertKind = 'link' | 'quote' | 'embed'

/**
 * The markdown view the sidebar should follow. Falls back to the most
 * recently active file so the sidebar keeps its context when it takes focus.
 */
function findMarkdownView(app: App): Target | null {
  const active = app.workspace.getActiveViewOfType(MarkdownView)
  if (active?.file) return { view: active, file: active.file }

  const file = app.workspace.getActiveFile()
  if (!file) return null
  for (const leaf of app.workspace.getLeavesOfType('markdown')) {
    if (leaf.view instanceof MarkdownView && leaf.view.file === file) {
      return { view: leaf.view, file }
    }
  }
  return null
}

/** Cursor line when editing; first visible line when reading. */
function getFocusLine(view: MarkdownView): number {
  if (view.getMode() === 'source') return view.editor.getCursor().line
  return Math.max(Math.floor(view.currentMode.getScroll()), 0)
}

function computeContext(
  target: Target,
  previous: NoteContext | null,
  refreshNote: boolean,
): NoteContext | null {
  // The view may have navigated elsewhere since the target was captured.
  if (target.view.file !== target.file) return previous
  const notePath = target.file.path
  const title = target.file.basename
  const content = target.view.getViewData()

  const keepNoteQuery =
    !refreshNote && previous !== null && previous.notePath === notePath
  const noteQuery = keepNoteQuery
    ? previous.noteQuery
    : buildNoteQuery({ title, content })
  const section = buildSectionContext({
    title,
    content,
    cursorLine: getFocusLine(target.view),
  })

  if (
    previous !== null &&
    previous.notePath === notePath &&
    previous.noteQuery === noteQuery &&
    previous.section?.key === section?.key
  ) {
    return previous
  }
  return { notePath, noteQuery, section }
}

/**
 * Runs a retrieval and keeps the previous results for the same note on
 * screen while a new request is in flight, so the list does not flicker.
 */
function useInsightResults({
  service,
  query,
  mode,
  limit,
  scope,
  nonce,
}: {
  service: InsightsService
  query: string | null
  mode: InsightRetrievalMode
  limit: number
  scope: string | null
  nonce: number
}): { items: Insight[]; loading: boolean; error: string | null } {
  const requestKey =
    query === null || scope === null
      ? null
      : `${scope}:${mode}:${limit}:${nonce}:${hashString(query)}`
  const [loaded, setLoaded] = useState<LoadedResults | null>(null)

  useEffect(() => {
    if (query === null || scope === null || requestKey === null) return
    let cancelled = false
    service
      .retrieve({ query, mode, limit })
      .then((items) => {
        if (cancelled) return
        setLoaded({ requestKey, scope, items, error: null })
      })
      .catch((error: unknown) => {
        if (cancelled) return
        console.error('Insights retrieval failed:', error)
        setLoaded({
          requestKey,
          scope,
          items: [],
          error: error instanceof Error ? error.message : String(error),
        })
      })
    return () => {
      cancelled = true
    }
  }, [service, query, mode, limit, scope, requestKey])

  if (requestKey === null) return { items: [], loading: false, error: null }
  if (loaded === null || loaded.scope !== scope) {
    return { items: [], loading: true, error: null }
  }
  const isCurrent = loaded.requestKey === requestKey
  return {
    items: loaded.items,
    loading: !isCurrent,
    error: isCurrent ? loaded.error : null,
  }
}

function InsightList({
  title,
  subtitle,
  items,
  loading,
  error,
  emptyText,
  initialCount,
  isDeep,
  onDigDeeper,
  renderCard,
}: {
  title: string
  subtitle?: string
  items: Insight[]
  loading: boolean
  error: string | null
  emptyText: string
  initialCount: number
  isDeep: boolean
  onDigDeeper?: () => void
  renderCard: (insight: Insight) => React.ReactNode
}) {
  const [showAll, setShowAll] = useState(false)
  const visible = showAll ? items : items.slice(0, initialCount)
  const hiddenCount = items.length - visible.length

  return (
    <div className="nrlcmp-insights-section">
      <div className="nrlcmp-insights-section__header">
        <div className="nrlcmp-insights-section__title">
          <span>{title}</span>
          {subtitle && (
            <span className="nrlcmp-insights-section__subtitle">
              {subtitle}
            </span>
          )}
        </div>
        {loading && <DotLoader />}
        {onDigDeeper &&
          (isDeep ? (
            <span className="nrlcmp-insights-section__badge">Graph</span>
          ) : (
            <button
              className="nrlcmp-insights-section__action"
              onClick={onDigDeeper}
              aria-label="Search the knowledge graph for connected passages"
            >
              Dig deeper
            </button>
          ))}
      </div>

      {error && (
        <div className="nrlcmp-insights-message nrlcmp-insights-message--error">
          Could not retrieve passages. Check that the LightRAG server is
          running.
          <div className="nrlcmp-insights-message__detail">{error}</div>
        </div>
      )}

      {!error && items.length === 0 && !loading && (
        <div className="nrlcmp-insights-message">{emptyText}</div>
      )}

      <div
        className={`nrlcmp-insights-list${loading ? ' nrlcmp-insights-list--loading' : ''}`}
      >
        {visible.map((insight) => renderCard(insight))}
      </div>

      {hiddenCount > 0 && (
        <button
          className="nrlcmp-insights-section__more"
          onClick={() => setShowAll(true)}
        >
          Show {hiddenCount} more
        </button>
      )}
    </div>
  )
}

export default function Insights() {
  const app = useApp()
  const plugin = usePlugin()
  const { settings } = useSettings()
  const options = settings.insightsOptions
  const service = plugin.getInsightsService()
  const store = plugin.insightsStore

  const [target, setTarget] = useState<Target | null>(() =>
    findMarkdownView(app),
  )
  const [context, setContext] = useState<NoteContext | null>(null)
  const [refreshNonce, setRefreshNonce] = useState(0)
  // Query hashes for which the user asked for graph retrieval. Tied to the
  // query so moving to another section drops back to cheap vector search.
  const [deepSectionKey, setDeepSectionKey] = useState<string | null>(null)
  const [deepNoteKey, setDeepNoteKey] = useState<string | null>(null)

  // --- Follow the active note ---
  useEffect(() => {
    const sync = () => {
      const next = findMarkdownView(app)
      // Keep the last note when focus moves to a non-markdown view.
      if (!next) return
      setTarget((prev) =>
        prev && prev.view === next.view && prev.file === next.file
          ? prev
          : next,
      )
    }
    const leafRef = app.workspace.on('active-leaf-change', sync)
    const openRef = app.workspace.on('file-open', sync)
    // A renamed file keeps its TFile instance; re-render to pick up the path.
    const renameRef = app.vault.on('rename', (renamed) => {
      setTarget((prev) => (prev && prev.file === renamed ? { ...prev } : prev))
    })
    return () => {
      app.workspace.offref(leafRef)
      app.workspace.offref(openRef)
      app.vault.offref(renameRef)
    }
  }, [app])

  // --- Track the section being read or written ---
  useEffect(() => {
    if (!target) return
    let timer: number | null = null
    const schedule = (delay: number, refreshNote: boolean) => {
      if (timer !== null) window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        timer = null
        setContext((prev) => computeContext(target, prev, refreshNote))
      }, delay)
    }

    schedule(0, true)
    if (!options.liveUpdate) {
      return () => {
        if (timer !== null) window.clearTimeout(timer)
      }
    }

    const onActivity = () => schedule(options.debounceMs, false)
    const el = target.view.containerEl
    el.addEventListener('keyup', onActivity)
    el.addEventListener('mouseup', onActivity)
    // Scroll events do not bubble; capture them from the scroller inside.
    el.addEventListener('scroll', onActivity, true)
    const changeRef = app.workspace.on('editor-change', onActivity)

    return () => {
      if (timer !== null) window.clearTimeout(timer)
      el.removeEventListener('keyup', onActivity)
      el.removeEventListener('mouseup', onActivity)
      el.removeEventListener('scroll', onActivity, true)
      app.workspace.offref(changeRef)
    }
  }, [app, target, options.liveUpdate, options.debounceMs, refreshNonce])

  const notePath = target ? target.file.path : null
  const activeContext =
    context !== null && context.notePath === notePath ? context : null
  // True for the moment between switching notes and reading the new one.
  const contextPending = activeContext === null
  const section = activeContext?.section ?? null
  const noteQuery = activeContext?.noteQuery ?? null
  const noteQueryKey = noteQuery === null ? null : hashString(noteQuery)

  const sectionResults = useInsightResults({
    service,
    query: section?.query ?? null,
    mode: section !== null && deepSectionKey === section.key ? 'deep' : 'live',
    limit: options.maxResults,
    scope: notePath,
    nonce: refreshNonce,
  })
  const noteResults = useInsightResults({
    service,
    query: noteQuery,
    mode:
      noteQueryKey !== null && deepNoteKey === noteQueryKey ? 'deep' : 'live',
    limit: options.maxResults,
    scope: notePath,
    nonce: refreshNonce,
  })

  // --- Pins and dismissals for this note ---
  const noteState = useSyncExternalStore(store.subscribe, () =>
    store.get(notePath ?? ''),
  )

  const { sectionItems, noteItems } = useMemo((): {
    sectionItems: Insight[]
    noteItems: Insight[]
  } => {
    if (notePath === null) return { sectionItems: [], noteItems: [] }
    const excluded = new Set<string>(noteState.dismissed)
    noteState.pins.forEach((pin) => excluded.add(pin.key))
    const forSection = service.filter(sectionResults.items, notePath, excluded)
    // A passage shown for the section is not repeated under the note.
    forSection.forEach((insight) => excluded.add(insight.key))
    const forNote = service.filter(noteResults.items, notePath, excluded)
    return { sectionItems: forSection, noteItems: forNote }
    // The hide-linked and exclude settings are read inside service.filter,
    // so they are listed below to re-filter when they change.
  }, [
    service,
    notePath,
    noteState,
    sectionResults.items,
    noteResults.items,
    options.hideLinkedNotes,
    options.excludePatterns,
  ])

  // --- Actions ---
  const handleRefresh = useCallback(() => {
    service.clearCache()
    setDeepSectionKey(null)
    setDeepNoteKey(null)
    setRefreshNonce((n) => n + 1)
  }, [service])

  const handleJump = useCallback(
    async (insight: Insight) => {
      const file = service.resolveFile(insight.path)
      if (!file) {
        new Notice('The source note could not be found.')
        return
      }
      const line = await service.locate(insight)
      openMarkdownFile(app, file.path, line === null ? undefined : line + 1)
    },
    [app, service],
  )

  const handleInsert = useCallback(
    async (insight: Insight, kind: InsertKind) => {
      if (!target || target.view.file !== target.file) return
      if (target.view.getMode() !== 'source') {
        new Notice('Switch the note to editing view to insert.')
        return
      }
      const source = service.resolveFile(insight.path)
      if (!source) {
        new Notice('The source note could not be found.')
        return
      }
      const subpath = await service.resolveSubpath(insight)
      const link = app.fileManager.generateMarkdownLink(
        source,
        target.file.path,
        subpath,
      )
      let text = link
      if (kind === 'embed') {
        text = `!${link}`
      } else if (kind === 'quote') {
        const quoted = insight.focus
          .split('\n')
          .map((line) => `> ${line}`)
          .join('\n')
        text = `${quoted}\n> — ${link}\n`
      }
      const editor = target.view.editor
      editor.replaceSelection(text)
      editor.focus()
    },
    [app, service, target],
  )

  const openInsertMenu = useCallback(
    (insight: Insight, event: React.MouseEvent) => {
      const menu = new Menu()
      const add = (title: string, icon: string, kind: InsertKind) => {
        menu.addItem((item) =>
          item
            .setTitle(title)
            .setIcon(icon)
            .onClick(() => {
              void handleInsert(insight, kind)
            }),
        )
      }
      add('Link to passage', 'link', 'link')
      add('Quote with link', 'quote', 'quote')
      add('Embed passage', 'file-symlink', 'embed')
      menu.showAtMouseEvent(event.nativeEvent)
    },
    [handleInsert],
  )

  if (!target || notePath === null) {
    return (
      <div className="nrlcmp-insights">
        <div className="nrlcmp-insights-message">
          Open a note to see related passages from the rest of your vault.
        </div>
      </div>
    )
  }

  const renderCard = (insight: Insight, explainContext: string | null) => (
    <InsightCard
      key={insight.key}
      insight={insight}
      isPinned={noteState.pins.some((pin) => pin.key === insight.key)}
      explainContext={explainContext}
      service={service}
      onJump={() => void handleJump(insight)}
      onInsert={(event) => openInsertMenu(insight, event)}
      onTogglePin={() => store.togglePin(notePath, insight)}
      onDismiss={() => store.dismiss(notePath, insight.key)}
    />
  )
  const currentContext = section?.query ?? noteQuery

  return (
    <div className="nrlcmp-insights">
      <div className="nrlcmp-insights-header">
        <div className="nrlcmp-insights-header__title">
          {target.file.basename}
        </div>
        <button
          className="clickable-icon"
          aria-label="Refresh insights"
          onClick={handleRefresh}
        >
          <RefreshCw size={14} />
        </button>
      </div>

      {noteState.pins.length > 0 && (
        <div className="nrlcmp-insights-section">
          <div className="nrlcmp-insights-section__header">
            <div className="nrlcmp-insights-section__title">Pinned</div>
          </div>
          <div className="nrlcmp-insights-list">
            {noteState.pins.map((pin) => renderCard(pin, currentContext))}
          </div>
        </div>
      )}

      <InsightList
        key={`section:${notePath}:${section?.key ?? ''}`}
        title="This section"
        subtitle={section?.label}
        items={sectionItems}
        loading={sectionResults.loading || contextPending}
        error={sectionResults.error}
        emptyText={
          section === null
            ? 'Not enough text here yet.'
            : 'Nothing related to this section.'
        }
        initialCount={options.maxResults}
        isDeep={section !== null && deepSectionKey === section.key}
        onDigDeeper={
          section === null ? undefined : () => setDeepSectionKey(section.key)
        }
        renderCard={(insight) => renderCard(insight, section?.query ?? null)}
      />

      <InsightList
        key={`note:${notePath}`}
        title="This note"
        items={noteItems}
        loading={noteResults.loading || contextPending}
        error={noteResults.error}
        emptyText={
          noteQuery === null
            ? 'Not enough text in this note yet.'
            : 'Nothing related to this note.'
        }
        initialCount={options.maxResults}
        isDeep={noteQueryKey !== null && deepNoteKey === noteQueryKey}
        onDigDeeper={
          noteQueryKey === null ? undefined : () => setDeepNoteKey(noteQueryKey)
        }
        renderCard={(insight) => renderCard(insight, noteQuery)}
      />

      {noteState.dismissed.length > 0 && (
        <div className="nrlcmp-insights-footer">
          {noteState.dismissed.length} hidden for this note
          <button
            className="nrlcmp-insights-section__action"
            onClick={() => store.restoreDismissed(notePath)}
          >
            Restore
          </button>
        </div>
      )}
    </div>
  )
}
