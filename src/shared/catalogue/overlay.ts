import { defineMessages } from './define'

/** Messages of the overlay surface. */
export const overlayMessages = defineMessages({
  overlayHintTouch: {
    message: 'Tap an element, or touch and hold to draw an area',
    description: 'Hint shown in the overlay on the page while picking by touch.',
  },
  overlayHintRegion: {
    message: 'Drag the area to capture',
    description: 'Hint shown in the overlay on the page while an area is drawn for a screenshot.',
  },
  overlayHintCrop: {
    message: 'Confirm or redraw',
    description: 'Hint shown in the overlay on the page after an area was drawn.',
  },
  overlayHintHover: {
    message: 'Hover or drag',
    description: 'Hint shown in the overlay on the page while picking an element.',
  },
  overlayRedraw: {
    message: 'redraw',
    description: 'Label in the overlay on the page that tells the user to draw the area again.',
  },
  overlayConfirm: {
    message: 'confirm',
    description: 'Label after the Enter key in the overlay on the page.',
  },
  overlayCancel: {
    message: 'cancel',
    description: 'Label after the Escape key in the overlay on the page.',
  },
  overlayMore: {
    message: '+$COUNT$ more',
    description: 'Row in the list of elements that stands for elements that are not listed. $COUNT$ is a number.',
    placeholders: ['COUNT'],
  },
  overlayNoMatch: {
    message: 'Nothing on this page matches $SELECTOR$',
    description: 'Reason shown for a transform whose element is gone. $SELECTOR$ is a CSS selector.',
    placeholders: ['SELECTOR'],
  },
})
