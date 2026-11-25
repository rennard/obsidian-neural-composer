import {
  MAX_QUERY_CHARS,
  buildNoteQuery,
  buildSectionContext,
  cleanChunkContent,
  extractHeadings,
  filterInsights,
  findPassageLine,
  frontmatterLineCount,
  getHeadingPath,
  parseQueryDataChunks,
  pickFocusParagraph,
  stripFrontmatter,
  stripInlineMarkdown,
  withBlockId,
} from './insightsQuery'

const NOTE = [
  '---',
  'tags: [career]',
  '---',
  'Opening thoughts about where my career is heading this year.',
  '',
  '# Strategy',
  'The overall strategy is to specialise before going broad.',
  '',
  '## Risks',
  'Specialising too early could narrow the roles available to me later.',
  '',
  '```md',
  '# not a heading',
  '```',
  '',
  '## Next steps',
  'Talk to three people who made the same move and write up what I learn.',
].join('\n')

describe('frontmatter', () => {
  it('strips a leading frontmatter block', () => {
    expect(stripFrontmatter(NOTE).startsWith('Opening thoughts')).toBe(true)
    expect(frontmatterLineCount(NOTE)).toBe(3)
  })

  it('leaves notes without frontmatter untouched', () => {
    expect(stripFrontmatter('# Title\nbody')).toBe('# Title\nbody')
    expect(frontmatterLineCount('# Title\nbody')).toBe(0)
  })
})

describe('extractHeadings', () => {
  it('finds headings and ignores fenced code', () => {
    const headings = extractHeadings(NOTE.split('\n'))
    expect(headings.map((h) => h.heading)).toEqual([
      'Strategy',
      'Risks',
      'Next steps',
    ])
    expect(headings.map((h) => h.level)).toEqual([1, 2, 2])
  })
})

describe('stripInlineMarkdown', () => {
  it('removes emphasis, code and link syntax', () => {
    expect(stripInlineMarkdown('**general thoughts**')).toBe('general thoughts')
    expect(stripInlineMarkdown('An *italic* and _other_ word')).toBe(
      'An italic and other word',
    )
    expect(stripInlineMarkdown('Use `code` and ==marks==')).toBe(
      'Use code and marks',
    )
    expect(stripInlineMarkdown('See [[Target|alias]] and [[Plain]]')).toBe(
      'See alias and Plain',
    )
    expect(stripInlineMarkdown('A [link](https://example.com) here')).toBe(
      'A link here',
    )
  })

  it('leaves ordinary punctuation alone', () => {
    expect(stripInlineMarkdown('snake_case_name and 2 * 3')).toBe(
      'snake_case_name and 2 * 3',
    )
  })

  it('is applied to extracted headings', () => {
    expect(extractHeadings(['## **Bold** heading'])[0].heading).toBe(
      'Bold heading',
    )
  })
})

describe('getHeadingPath', () => {
  it('returns the trail of ancestors for a line', () => {
    const headings = extractHeadings(NOTE.split('\n'))
    expect(getHeadingPath(headings, 9).map((h) => h.heading)).toEqual([
      'Strategy',
      'Risks',
    ])
    expect(getHeadingPath(headings, 3)).toEqual([])
  })
})

describe('buildSectionContext', () => {
  it('scopes the query to the section under the cursor', () => {
    const context = buildSectionContext({
      title: 'Career',
      content: NOTE,
      cursorLine: 9,
    })
    expect(context).not.toBeNull()
    expect(context?.label).toBe('Strategy > Risks')
    expect(context?.query).toContain('Career > Strategy > Risks')
    expect(context?.query).toContain('Specialising too early')
    expect(context?.query).not.toContain('overall strategy')
    expect(context?.query).not.toContain('Talk to three people')
  })

  it('uses the text before the first heading, without frontmatter', () => {
    const context = buildSectionContext({
      title: 'Career',
      content: NOTE,
      cursorLine: 3,
    })
    expect(context?.label).toBe('Top of note')
    expect(context?.query).toContain('Opening thoughts')
    expect(context?.query).not.toContain('tags:')
  })

  it('returns null when the section has too little text', () => {
    expect(
      buildSectionContext({
        title: 'Empty',
        content: '# Heading\n\nshort',
        cursorLine: 2,
      }),
    ).toBeNull()
  })

  it('keeps the same key until the query changes', () => {
    const a = buildSectionContext({
      title: 'Career',
      content: NOTE,
      cursorLine: 9,
    })
    const b = buildSectionContext({
      title: 'Career',
      content: NOTE,
      cursorLine: 10,
    })
    const c = buildSectionContext({
      title: 'Career',
      content: NOTE,
      cursorLine: 16,
    })
    expect(a?.key).toBe(b?.key)
    expect(a?.key).not.toBe(c?.key)
  })

  it('windows long sections around the cursor within the budget', () => {
    const lines = ['# Long']
    for (let i = 0; i < 200; i++) {
      lines.push(`Paragraph number ${i} with enough words to take up room.`)
    }
    const context = buildSectionContext({
      title: 'Big',
      content: lines.join('\n'),
      cursorLine: 150,
    })
    expect(context).not.toBeNull()
    expect(context!.query.length <= MAX_QUERY_CHARS).toBe(true)
    expect(context?.query).toContain('Paragraph number 149 ')
    expect(context?.query).not.toContain('Paragraph number 5 ')
  })
})

describe('buildNoteQuery', () => {
  it('combines the title, headings and opening text', () => {
    const query = buildNoteQuery({ title: 'Career', content: NOTE })
    expect(query).toContain('Career')
    expect(query).toContain('Strategy; Risks; Next steps')
    expect(query).toContain('Opening thoughts')
    expect(query).not.toContain('tags:')
  })

  it('returns null for a nearly empty note', () => {
    expect(buildNoteQuery({ title: 'New', content: '---\na: b\n---\n' })).toBe(
      null,
    )
  })

  it('never exceeds the query budget', () => {
    const query = buildNoteQuery({
      title: 'Big',
      content: 'word '.repeat(2000),
    })
    expect(query!.length <= MAX_QUERY_CHARS).toBe(true)
  })
})

describe('chunk handling', () => {
  it('drops the synthetic title prefix added at ingestion', () => {
    expect(cleanChunkContent('Title: My note\n\nActual text')).toBe(
      'Actual text',
    )
    expect(cleanChunkContent('No prefix here')).toBe('No prefix here')
  })

  it('picks the paragraph that best matches the query', () => {
    const content = [
      '# Reflections',
      'Some unrelated remarks about the weather last weekend in the hills.',
      'Specialising early narrowed my options but deepened my expertise.',
    ].join('\n\n')
    expect(
      pickFocusParagraph(content, 'risks of specialising and expertise'),
    ).toBe('Specialising early narrowed my options but deepened my expertise.')
  })

  it('normalises a query/data response, de-duplicating by chunk id', () => {
    const insights = parseQueryDataChunks(
      {
        status: 'success',
        data: {
          chunks: [
            {
              content: 'Title: A\n\nFirst passage about strategy.',
              file_path: 'Notes/A.md',
              chunk_id: 'chunk-1',
            },
            {
              content: 'Duplicate',
              file_path: 'Notes/A.md',
              chunk_id: 'chunk-1',
            },
            { content: 'No id passage', file_path: 'B.md' },
            { content: 42 },
            null,
          ],
        },
      },
      'strategy',
    )
    expect(insights.length).toBe(2)
    expect(insights[0]).toEqual({
      key: 'chunk-1',
      path: 'Notes/A.md',
      content: 'First passage about strategy.',
      focus: 'First passage about strategy.',
    })
    expect(insights[1].key.startsWith('local-')).toBe(true)
  })

  it('returns nothing for malformed responses', () => {
    expect(parseQueryDataChunks(null, 'q')).toEqual([])
    expect(parseQueryDataChunks({ data: { chunks: 'nope' } }, 'q')).toEqual([])
  })
})

describe('filterInsights', () => {
  const insights = [
    { key: 'a', path: 'A.md', content: 'a', focus: 'a' },
    { key: 'b', path: 'B.md', content: 'b', focus: 'b' },
    { key: 'c', path: 'Old name.md', content: 'c', focus: 'c' },
    { key: 'd', path: 'Gone.md', content: 'd', focus: 'd' },
    { key: 'e', path: 'Templates/E.md', content: 'e', focus: 'e' },
  ]

  it('drops excluded keys, hidden paths and unresolvable sources', () => {
    const result = filterInsights(insights, {
      excludedKeys: new Set(['a']),
      resolvePath: (path) => {
        if (path === 'Gone.md') return null
        if (path === 'Old name.md') return 'Folder/Old name.md'
        return path
      },
      isHidden: (vaultPath) => vaultPath.startsWith('Templates/'),
    })
    expect(result.map((i) => i.key)).toEqual(['b', 'c'])
    expect(result[1].path).toBe('Folder/Old name.md')
  })
})

describe('findPassageLine', () => {
  it('locates a passage by its first substantial line', () => {
    expect(
      findPassageLine(NOTE, 'Specialising too early could narrow the roles'),
    ).toBe(9)
  })

  it('returns null when the passage is no longer in the note', () => {
    expect(findPassageLine(NOTE, 'This sentence was deleted long ago.')).toBe(
      null,
    )
  })
})

describe('withBlockId', () => {
  it('appends a block id to a line', () => {
    expect(withBlockId('Some paragraph.  ', 'abc123')).toEqual({
      id: 'abc123',
      line: 'Some paragraph. ^abc123',
    })
  })

  it('reuses an existing block id', () => {
    expect(withBlockId('Some paragraph. ^keep-me', 'abc123')).toEqual({
      id: 'keep-me',
      line: 'Some paragraph. ^keep-me',
    })
  })
})
