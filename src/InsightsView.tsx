import { ItemView, WorkspaceLeaf } from 'obsidian'
import React from 'react'
import { Root, createRoot } from 'react-dom/client'

import Insights from './components/insights-view/Insights'
import { INSIGHTS_VIEW_TYPE } from './constants'
import { AppProvider } from './contexts/app-context'
import { PluginProvider } from './contexts/plugin-context'
import { SettingsProvider } from './contexts/settings-context'
import NeuralComposerPlugin from './main'

/**
 * Sidebar that surfaces passages from the rest of the vault related to the
 * note, and the section of it, that the user is currently reading or writing.
 */
export class InsightsView extends ItemView {
  private root: Root | null = null

  constructor(
    leaf: WorkspaceLeaf,
    private plugin: NeuralComposerPlugin,
  ) {
    super(leaf)
  }

  getViewType() {
    return INSIGHTS_VIEW_TYPE
  }

  getIcon() {
    return 'lightbulb'
  }

  getDisplayText() {
    return 'Insights'
  }

  async onOpen() {
    this.render()
    await super.onOpen()
  }

  async onClose() {
    this.root?.unmount()
    this.root = null
    await super.onClose()
  }

  render() {
    if (!this.root) {
      this.root = createRoot(this.containerEl.children[1])
    }

    this.root.render(
      <PluginProvider plugin={this.plugin}>
        <AppProvider app={this.app}>
          <SettingsProvider
            settings={this.plugin.settings}
            setSettings={(newSettings) => {
              void this.plugin.setSettings(newSettings)
            }}
            addSettingsChangeListener={(listener) =>
              this.plugin.addSettingsChangeListener(listener)
            }
          >
            <React.StrictMode>
              <Insights />
            </React.StrictMode>
          </SettingsProvider>
        </AppProvider>
      </PluginProvider>,
    )
  }
}
