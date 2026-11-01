import { mount } from 'svelte'
import App from './App.svelte'
import { resolveBinding, setBoundTab } from '@shared/panel-binding'

const target = document.getElementById('app')
if (!target) throw new Error('Sidebar root element is missing.')
const root = target

/**
 * Opened in a tab (Firefox for Android), the panel names its page tab in the
 * address. The tab is checked before anything is shown, and a panel whose page
 * is gone says so instead of working on whichever tab is in front.
 */
async function start(): Promise<void> {
  const binding = await resolveBinding(
    location.search,
    browser.runtime.getURL(''),
    (id) => browser.tabs.get(id),
  )
  if (binding.kind === 'refused') {
    const message = document.createElement('p')
    message.textContent = binding.message
    message.style.padding = '16px'
    root.append(message)
    return
  }
  setBoundTab(binding.kind === 'bound' ? binding.tabId : null)
  mount(App, { target: root })
}

void start()
