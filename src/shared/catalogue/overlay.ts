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
  scriptErrorReason: {
    message: 'The script threw an error when it ran.',
    description: 'Sent to the model as the reason a repair is requested, and shown to the user.',
  },
  addressRemovalNote: {
    message: 'Page address sent to your AI provider. Removed from it: the fragment, the user name and password, query values, query keys with no value, query keys and path segments longer than $LIMIT$ characters or that look like tokens (a long run of digits, or a long run of letters and digits), and path parameters (everything after a semicolon in a path segment). Removed path segments are shown as $PLACEHOLDER$. For file, blob, data and other addresses that are not http or https, only the scheme is sent.',
    description: 'Shown next to the page address. $LIMIT$ is a number of characters; $PLACEHOLDER$ is the text that replaces a removed path segment.',
    placeholders: ['LIMIT', 'PLACEHOLDER'],
  },
  anchorKeepsRole: {
    message: 'it keeps role="$ROLE$"',
    description: 'Names an assumption of a transform that no longer holds. It follows the words \'This transform assumed\'. $ROLE$ is an attribute value.',
    placeholders: ['ROLE'],
  },
  anchorKeepsId: {
    message: 'it keeps id="$ID$"',
    description: 'Names an assumption of a transform that no longer holds. It follows the words \'This transform assumed\'. $ID$ is an attribute value.',
    placeholders: ['ID'],
  },
  anchorKeepsClass: {
    message: 'it keeps the class $CLASSES$',
    description: 'Names an assumption of a transform that no longer holds. It follows the words \'This transform assumed\'. $CLASSES$ is a list of class names.',
    placeholders: ['CLASSES'],
  },
  anchorTextStarts: {
    message: 'its text still starts "$TEXT$…"',
    description: 'Names an assumption of a transform that no longer holds. It follows the words \'This transform assumed\'. $TEXT$ is the start of the element text.',
    placeholders: ['TEXT'],
  },
  anchorInside: {
    message: 'it still sits inside $LANDMARK$',
    description: 'Names an assumption of a transform that no longer holds. It follows the words \'This transform assumed\'. $LANDMARK$ is the name of a page region.',
    placeholders: ['LANDMARK'],
  },
})
