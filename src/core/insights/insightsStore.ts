import { App } from 'obsidian'

import { Insight } from './insightsQuery'

export type NoteInsightState = {
  /** Passages kept visible for this note, most recently pinned first. */
  pins: Insight[]
  /** Keys of passages hidden for this note. */
  dismissed: string[]
}

type PersistedState = {
  version: 1
  notes: Record<string, NoteInsightState>
}

const EMPTY_STATE: NoteInsightState = Object.freeze({
  pins: [],
  dismissed: [],
}) as NoteInsightState

const SAVE_DEBOUNCE_MS = 1000

/**
 * Per-note pins and dismissals for the insights sidebar.
 *
 * Kept in its own file inside the plugin folder rather than in the plugin
 * settings: it changes far more often than settings do, and settings go
 * through schema validation that would discard unknown keys.
 */
export class InsightsStore {
  private notes = new Map<string, NoteInsightState>()
  private listeners = new Set<() => void>()
  private saveTimer: number | null = null
  private loaded = false

  constructor(
    private app: App,
    private filePath: string,
  ) {}

  async load(): Promise<void> {
    try {
      if (await this.app.vault.adapter.exists(this.filePath)) {
        const raw = await this.app.vault.adapter.read(this.filePath)
        const parsed = JSON.parse(raw) as Partial<PersistedState>
        const notes = parsed.notes ?? {}
        for (const path of Object.keys(notes)) {
          const state = notes[path]
          this.notes.set(path, {
            pins: Array.isArray(state?.pins) ? state.pins : [],
            dismissed: Array.isArray(state?.dismissed) ? state.dismissed : [],
          })
        }
      }
    } catch (error) {
      console.error('Failed to load insights state:', error)
    }
    this.loaded = true
    this.emit()
  }

  // Arrow property so it can be passed directly to useSyncExternalStore.
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** Returns a stable reference until the note's state changes. */
  get(notePath: string): NoteInsightState {
    return this.notes.get(notePath) ?? EMPTY_STATE
  }

  togglePin(notePath: string, insight: Insight): void {
    const state = this.get(notePath)
    const isPinned = state.pins.some((p) => p.key === insight.key)
    this.set(notePath, {
      ...state,
      pins: isPinned
        ? state.pins.filter((p) => p.key !== insight.key)
        : [insight, ...state.pins],
    })
  }

  dismiss(notePath: string, key: string): void {
    const state = this.get(notePath)
    if (state.dismissed.includes(key)) return
    this.set(notePath, {
      pins: state.pins.filter((p) => p.key !== key),
      dismissed: [...state.dismissed, key],
    })
  }

  restoreDismissed(notePath: string): void {
    const state = this.get(notePath)
    if (state.dismissed.length === 0) return
    this.set(notePath, { ...state, dismissed: [] })
  }

  /** Keeps state attached to a note, and pins pointing at it, across renames. */
  handleRename(oldPath: string, newPath: string): void {
    let changed = false
    const moved = this.notes.get(oldPath)
    if (moved) {
      this.notes.delete(oldPath)
      this.notes.set(newPath, moved)
      changed = true
    }
    this.notes.forEach((state, notePath) => {
      if (!state.pins.some((p) => p.path === oldPath)) return
      this.notes.set(notePath, {
        ...state,
        pins: state.pins.map((p) =>
          p.path === oldPath ? { ...p, path: newPath } : p,
        ),
      })
      changed = true
    })
    if (changed) this.commit()
  }

  handleDelete(path: string): void {
    if (this.notes.delete(path)) this.commit()
  }

  /** Writes any pending change immediately (used when the plugin unloads). */
  async flush(): Promise<void> {
    if (this.saveTimer === null) return
    window.clearTimeout(this.saveTimer)
    this.saveTimer = null
    await this.save()
  }

  private set(notePath: string, state: NoteInsightState): void {
    if (state.pins.length === 0 && state.dismissed.length === 0) {
      this.notes.delete(notePath)
    } else {
      this.notes.set(notePath, state)
    }
    this.commit()
  }

  private commit(): void {
    this.emit()
    // Never overwrite the file before the initial read has finished.
    if (!this.loaded) return
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer)
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null
      void this.save()
    }, SAVE_DEBOUNCE_MS)
  }

  private emit(): void {
    this.listeners.forEach((listener) => listener())
  }

  private async save(): Promise<void> {
    const notes: Record<string, NoteInsightState> = {}
    this.notes.forEach((state, path) => {
      notes[path] = state
    })
    const payload: PersistedState = { version: 1, notes }
    try {
      await this.app.vault.adapter.write(
        this.filePath,
        JSON.stringify(payload, null, 2),
      )
    } catch (error) {
      console.error('Failed to save insights state:', error)
    }
  }
}
