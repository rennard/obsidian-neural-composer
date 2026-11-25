import { useState } from 'react'

import { useSettings } from '../../../contexts/settings-context'
import { NeuralComposerSettings } from '../../../settings/schema/setting.types'
import { ObsidianSetting } from '../../common/ObsidianSetting'
import { ObsidianTextArea } from '../../common/ObsidianTextArea'
import { ObsidianTextInput } from '../../common/ObsidianTextInput'
import { ObsidianToggle } from '../../common/ObsidianToggle'

type InsightsOptions = NeuralComposerSettings['insightsOptions']

const MIN_DEBOUNCE_MS = 300
const MAX_RESULTS_LIMIT = 15

export function InsightsSection() {
  const { settings, setSettings } = useSettings()
  const options = settings.insightsOptions

  // Inputs keep their own draft text: the stored value is clamped and
  // normalised, and echoing that back mid-edit would fight the user's typing.
  const [debounceDraft, setDebounceDraft] = useState(String(options.debounceMs))
  const [maxResultsDraft, setMaxResultsDraft] = useState(
    String(options.maxResults),
  )
  const [excludeDraft, setExcludeDraft] = useState(
    options.excludePatterns.join('\n'),
  )

  const update = (patch: Partial<InsightsOptions>) => {
    void setSettings({
      ...settings,
      insightsOptions: { ...options, ...patch },
    })
  }

  return (
    <div className="nrlcmp-settings-section">
      <div className="nrlcmp-settings-header">Insights sidebar</div>

      <ObsidianSetting
        name="Update as you work"
        desc="Refresh the passages for the current section when you pause typing, move the cursor, or scroll. When off, use the refresh button in the sidebar."
      >
        <ObsidianToggle
          value={options.liveUpdate}
          onChange={(value) => update({ liveUpdate: value })}
        />
      </ObsidianSetting>

      <ObsidianSetting
        name="Pause before updating"
        desc="How long to wait, in milliseconds, after you stop before looking for related passages."
      >
        <ObsidianTextInput
          type="number"
          value={debounceDraft}
          onChange={(value) => {
            setDebounceDraft(value)
            const parsed = Number.parseInt(value, 10)
            if (Number.isNaN(parsed)) return
            update({ debounceMs: Math.max(parsed, MIN_DEBOUNCE_MS) })
          }}
        />
      </ObsidianSetting>

      <ObsidianSetting
        name="Passages per section"
        desc="How many passages to show before the 'show more' link."
      >
        <ObsidianTextInput
          type="number"
          value={maxResultsDraft}
          onChange={(value) => {
            setMaxResultsDraft(value)
            const parsed = Number.parseInt(value, 10)
            if (Number.isNaN(parsed)) return
            update({
              maxResults: Math.min(Math.max(parsed, 1), MAX_RESULTS_LIMIT),
            })
          }}
        />
      </ObsidianSetting>

      <ObsidianSetting
        name="Hide notes that are already linked"
        desc="Skip passages from notes the current note links to, or that link to it."
      >
        <ObsidianToggle
          value={options.hideLinkedNotes}
          onChange={(value) => update({ hideLinkedNotes: value })}
        />
      </ObsidianSetting>

      <ObsidianSetting
        name="Add block IDs when inserting"
        desc="Allow a block ID to be appended to a paragraph in the source note so inserted links and embeds point at the exact passage. When off, links point at the nearest heading instead and source notes are never modified."
      >
        <ObsidianToggle
          value={options.createBlockIds}
          onChange={(value) => update({ createBlockIds: value })}
        />
      </ObsidianSetting>

      <ObsidianSetting
        name="Excluded folders"
        desc="Glob patterns, one per line, for notes that should never appear in the sidebar."
        className="nrlcmp-settings-textarea-header"
      />

      <ObsidianSetting className="nrlcmp-settings-textarea">
        <ObsidianTextArea
          value={excludeDraft}
          placeholder={'Templates/**\nDaily/**'}
          onChange={(value) => {
            setExcludeDraft(value)
            update({
              excludePatterns: value
                .split('\n')
                .map((pattern) => pattern.trim())
                .filter((pattern) => pattern.length > 0),
            })
          }}
        />
      </ObsidianSetting>
    </div>
  )
}
