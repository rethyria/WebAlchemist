import '@shared/i18n-en'
import { mount } from 'svelte'
import App from './App.svelte'
import { applyPageLanguage, t } from '@shared/i18n'

applyPageLanguage()
document.title = t('optPageTitle')

const target = document.getElementById('app')
if (!target) throw new Error('Options root element is missing.')

export default mount(App, { target })
