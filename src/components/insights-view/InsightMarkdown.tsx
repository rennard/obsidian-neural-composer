import { Component, Keymap, MarkdownRenderer } from 'obsidian'
import { useEffect, useRef } from 'react'

import { useApp } from '../../contexts/app-context'

/**
 * Renders a retrieved passage the way Obsidian's reading view would, with
 * links and embeds resolved relative to the note the passage came from.
 *
 * A click on an internal link opens that link; a click anywhere else is
 * reported through `onClick`.
 */
export default function InsightMarkdown({
  content,
  sourcePath,
  className,
  onClick,
}: {
  content: string
  /** Vault path of the note the passage was taken from. */
  sourcePath: string
  className?: string
  onClick?: () => void
}) {
  const app = useApp()
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let cancelled = false
    const component = new Component()
    component.load()

    // Render off-screen and swap the result in once it is complete, so the
    // previous passage stays visible meanwhile and overlapping renders (React
    // strict mode, quick expand/collapse) can never interleave their output.
    const staging = container.ownerDocument.createElement('div')
    MarkdownRenderer.render(app, content, staging, sourcePath, component)
      .then(() => {
        if (cancelled) return
        container.replaceChildren(...Array.from(staging.childNodes))
      })
      .catch((error: unknown) => {
        if (cancelled) return
        console.error('Insight passage could not be rendered:', error)
        container.textContent = content
      })

    return () => {
      cancelled = true
      component.unload()
    }
  }, [app, content, sourcePath])

  const handleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const link =
      event.target instanceof Element ? event.target.closest('a') : null

    if (link?.classList.contains('internal-link')) {
      event.preventDefault()
      const linktext =
        link.getAttribute('data-href') ?? link.getAttribute('href')
      if (linktext) {
        void app.workspace.openLinkText(
          linktext,
          sourcePath,
          Keymap.isModEvent(event.nativeEvent),
        )
      }
      return
    }
    // External links open in the browser through the default behaviour.
    if (link?.classList.contains('external-link')) return
    // Anything else that renders as an anchor (tags, footnote references)
    // would otherwise navigate the app window.
    if (link) event.preventDefault()

    onClick?.()
  }

  return (
    <div
      ref={containerRef}
      className={`markdown-rendered${className ? ` ${className}` : ''}`}
      onClick={handleClick}
    />
  )
}
