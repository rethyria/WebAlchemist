import { overlayMessages } from '@shared/catalogue/overlay'
import { useCatalogue } from '@shared/i18n'

// The content script runs on every page where access is granted, so its fallback
// catalogue is only the overlay surface and not the whole catalogue.
useCatalogue(overlayMessages)
