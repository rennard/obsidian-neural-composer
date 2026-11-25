import { describeIndexingStatus, parseIndexingStatus } from './indexingStatus'

const counts = (statusCounts: Record<string, number>) => ({
  status_counts: statusCounts,
})

describe('parseIndexingStatus', () => {
  it('counts everything that is neither processed nor failed as remaining', () => {
    const status = parseIndexingStatus(
      counts({
        pending: 551,
        parsing: 105,
        analyzing: 9,
        processing: 1,
        preprocessed: 0,
        processed: 11,
        failed: 1,
        deleting: 0,
        all: 678,
      }),
      { busy: false },
    )
    expect(status).toEqual({
      total: 678,
      processed: 11,
      failed: 1,
      remaining: 666,
      busy: false,
    })
  })

  it('sums the individual states when the server omits the total', () => {
    const status = parseIndexingStatus(
      counts({ pending: 3, processed: 5, failed: 2 }),
      { busy: true },
    )
    expect(status).toEqual({
      total: 10,
      processed: 5,
      failed: 2,
      remaining: 3,
      busy: true,
    })
  })

  it('treats a missing or malformed pipeline status as not busy', () => {
    expect(
      parseIndexingStatus(counts({ processed: 1, all: 1 }), null)?.busy,
    ).toBe(false)
    expect(
      parseIndexingStatus(counts({ processed: 1, all: 1 }), { busy: 'yes' })
        ?.busy,
    ).toBe(false)
  })

  it('returns null when the counts are not in the expected shape', () => {
    expect(parseIndexingStatus(null, { busy: true })).toBeNull()
    expect(parseIndexingStatus({ detail: 'Not Found' }, null)).toBeNull()
    expect(parseIndexingStatus({ status_counts: 'n/a' }, null)).toBeNull()
  })
})

describe('describeIndexingStatus', () => {
  const base = { total: 678, processed: 11, failed: 0, remaining: 667 }

  it('reports progress while the pipeline is busy', () => {
    expect(describeIndexingStatus({ ...base, busy: true })).toBe(
      'Indexing in progress: 11 of 678 notes indexed, 667 to go.',
    )
  })

  it('says indexing is not running when notes are waiting', () => {
    expect(describeIndexingStatus({ ...base, busy: false })).toBe(
      'Indexing is not running: 11 of 678 notes indexed, 667 waiting.',
    )
  })

  it('reports completion and mentions failures', () => {
    expect(
      describeIndexingStatus({
        total: 678,
        processed: 677,
        failed: 1,
        remaining: 0,
        busy: false,
      }),
    ).toBe('Indexing complete: 677 of 678 notes indexed. 1 failed.')
  })

  it('handles an empty server', () => {
    expect(
      describeIndexingStatus({
        total: 0,
        processed: 0,
        failed: 0,
        remaining: 0,
        busy: false,
      }),
    ).toBe('No notes have been sent to the server yet.')
  })
})
