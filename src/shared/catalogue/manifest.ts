import { defineMessages } from './define'

/** The messages that src/manifest.json refers to with __MSG_ keys. */
export const manifestMessages = defineMessages({
  extensionName: {
    message: 'Web Alchemist',
    description: 'The name of the extension, shown in the add-ons manager and on the add-on listing.',
  },
  extensionDescription: {
    message:
      'Describe a change to any webpage and have it written, saved, and repaired when the site changes.',
    description: 'The summary of the extension, shown in the add-ons manager and on the add-on listing.',
  },
  sidebarTitle: {
    message: 'Web Alchemist',
    description: 'The title of the sidebar, shown in the sidebar switcher and in the sidebar header.',
  },
  toolbarButtonTitle: {
    message: 'Web Alchemist',
    description: 'The tooltip of the toolbar button.',
  },
})
