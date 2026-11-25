import path from 'path-browserify'
import { useState } from 'react'

import { Insight, hashString } from '../../core/insights/insightsQuery'
import { InsightsService } from '../../core/insights/insightsService'
import {
  ChevronDown,
  ChevronRight,
  Pin,
  PinOff,
  Plus,
  X,
} from '../../utils/icons'
import DotLoader from '../common/DotLoader'

import InsightMarkdown from './InsightMarkdown'

type WhyState =
  | { status: 'idle' }
  | { status: 'loading'; contextKey: string }
  | { status: 'done'; contextKey: string; text: string }
  | { status: 'error'; contextKey: string; message: string }

/**
 * One retrieved passage: the paragraph that best matches what the user is
 * working on, with the full chunk and a generated explanation behind the
 * expander. The explanation is only requested when the card is opened, so
 * browsing the sidebar never costs an LLM call.
 */
export default function InsightCard({
  insight,
  isPinned,
  explainContext,
  service,
  onJump,
  onInsert,
  onTogglePin,
  onDismiss,
}: {
  insight: Insight
  isPinned: boolean
  /** The text the passage should be explained against, if any. */
  explainContext: string | null
  service: InsightsService
  onJump: () => void
  onInsert: (event: React.MouseEvent) => void
  onTogglePin: () => void
  onDismiss: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [why, setWhy] = useState<WhyState>({ status: 'idle' })

  const contextKey = explainContext === null ? null : hashString(explainContext)
  // An explanation written for another section is stale once the user moves.
  const whyIsCurrent = why.status !== 'idle' && why.contextKey === contextKey

  const explain = () => {
    if (explainContext === null || contextKey === null) return
    setWhy({ status: 'loading', contextKey })
    service
      .explain(insight, explainContext)
      .then((text) => {
        setWhy(
          text
            ? { status: 'done', contextKey, text }
            : {
                status: 'error',
                contextKey,
                message: 'The model returned an empty response.',
              },
        )
      })
      .catch((error: unknown) => {
        console.error('Insight explanation failed:', error)
        setWhy({
          status: 'error',
          contextKey,
          message: error instanceof Error ? error.message : String(error),
        })
      })
  }

  const toggleExpanded = () => {
    const next = !expanded
    setExpanded(next)
    if (next && !whyIsCurrent) explain()
  }

  const hasMore = insight.content.trim() !== insight.focus.trim()

  return (
    <div
      className={`nrlcmp-insight-card${isPinned ? ' nrlcmp-insight-card--pinned' : ''}`}
    >
      <div className="nrlcmp-insight-card__header">
        <button
          className="nrlcmp-insight-card__toggle"
          onClick={toggleExpanded}
          aria-label={expanded ? 'Collapse passage' : 'Expand passage'}
        >
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
        <div
          className="nrlcmp-insight-card__source"
          onClick={onJump}
          title={insight.path}
        >
          {path.basename(insight.path).replace(/\.md$/i, '')}
        </div>
        <div className="nrlcmp-insight-card__actions">
          <button
            className="clickable-icon"
            onClick={onInsert}
            aria-label="Insert at cursor"
          >
            <Plus size={14} />
          </button>
          <button
            className="clickable-icon"
            onClick={onTogglePin}
            aria-label={isPinned ? 'Unpin' : 'Pin to this note'}
          >
            {isPinned ? <PinOff size={14} /> : <Pin size={14} />}
          </button>
          <button
            className="clickable-icon"
            onClick={onDismiss}
            aria-label="Not relevant to this note"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      <InsightMarkdown
        className={`nrlcmp-insight-card__passage${expanded ? '' : ' nrlcmp-insight-card__passage--clamped'}`}
        content={expanded && hasMore ? insight.content : insight.focus}
        sourcePath={insight.path}
        onClick={onJump}
      />

      {expanded && (
        <div className="nrlcmp-insight-card__why">
          <div className="nrlcmp-insight-card__why-label">
            Why it is relevant
          </div>
          {explainContext === null && (
            <div className="nrlcmp-insight-card__why-text">
              Nothing to compare this passage against yet.
            </div>
          )}
          {explainContext !== null && !whyIsCurrent && (
            <button
              className="nrlcmp-insights-section__action"
              onClick={explain}
            >
              Explain for where I am now
            </button>
          )}
          {whyIsCurrent && why.status === 'loading' && <DotLoader />}
          {whyIsCurrent && why.status === 'done' && (
            <div className="nrlcmp-insight-card__why-text">{why.text}</div>
          )}
          {whyIsCurrent && why.status === 'error' && (
            <div className="nrlcmp-insight-card__why-text nrlcmp-insight-card__why-text--error">
              Could not generate an explanation: {why.message}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
