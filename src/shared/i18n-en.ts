import { EN_CATALOGUE } from './catalogue'
import { useCatalogue } from './i18n'

// Importing this module registers the whole English catalogue as the fallback of t().
useCatalogue(EN_CATALOGUE)
