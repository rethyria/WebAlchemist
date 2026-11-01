import '@shared/i18n-en'
import { mount } from 'svelte'
import App from './App.svelte'
import { applyPageLanguage } from '@shared/i18n'

applyPageLanguage()

const target = document.getElementById('app')
if (!target) throw new Error('Editor root element is missing.')

export default mount(App, { target })
