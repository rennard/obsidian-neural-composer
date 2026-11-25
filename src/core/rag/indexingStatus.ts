/**
 * Pure helpers that turn LightRAG's `/documents/status_counts` and
 * `/documents/pipeline_status` responses into the one-line indexing status
 * shown in settings. Nothing here touches the Obsidian API.
 */

export type IndexingStatus = {
  /** Every document the server knows about. */
  total: number
  processed: number
  failed: number
  /** Documents that are neither processed nor failed yet. */
  remaining: number
  /** Whether the server's pipeline is working through documents right now. */
  busy: boolean
}

function toCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0
}

/**
 * Returns null when the counts response is not in the expected shape, which
 * is how LightRAG versions without the endpoint show up.
 */
export function parseIndexingStatus(
  countsJson: unknown,
  pipelineJson: unknown,
): IndexingStatus | null {
  if (typeof countsJson !== 'object' || countsJson === null) return null
  const raw = (countsJson as { status_counts?: unknown }).status_counts
  if (typeof raw !== 'object' || raw === null) return null
  const counts = raw as Record<string, unknown>

  const processed = toCount(counts.processed)
  const failed = toCount(counts.failed)
  // Older servers omit "all"; fall back to the sum of the individual states.
  const total =
    'all' in counts
      ? toCount(counts.all)
      : Object.values(counts).reduce<number>((sum, n) => sum + toCount(n), 0)

  const busy =
    typeof pipelineJson === 'object' &&
    pipelineJson !== null &&
    (pipelineJson as { busy?: unknown }).busy === true

  return {
    total,
    processed,
    failed,
    remaining: Math.max(total - processed - failed, 0),
    busy,
  }
}

export function describeIndexingStatus(status: IndexingStatus): string {
  const { total, processed, failed, remaining, busy } = status
  if (total === 0) return 'No notes have been sent to the server yet.'

  const failedNote = failed > 0 ? ` ${failed} failed.` : ''
  if (remaining === 0) {
    return `Indexing complete: ${processed} of ${total} notes indexed.${failedNote}`
  }
  if (busy) {
    return `Indexing in progress: ${processed} of ${total} notes indexed, ${remaining} to go.${failedNote}`
  }
  return `Indexing is not running: ${processed} of ${total} notes indexed, ${remaining} waiting.${failedNote}`
}
