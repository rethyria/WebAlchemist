import { defineMessages } from './define'

/** Messages of the overlay surface. */
export const overlayMessages = defineMessages({
  overlayHintTouch: {
    message: 'Tap an element, or touch and hold to draw an area',
    description: 'Hint shown in the overlay on the page while picking by touch.',
  },
  overlayHintRegion: {
    message: 'Drag over the area to capture',
    description: 'Hint shown in the overlay on the page while an area is drawn for a screenshot.',
  },
  overlayHintCrop: {
    message: 'Confirm or redraw',
    description: 'Hint shown in the overlay on the page after an area was drawn.',
  },
  overlayHintHover: {
    message: 'Point at an element, or drag to draw an area',
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
    description: 'Reason shown for an elixir whose element is gone. $SELECTOR$ is a CSS selector.',
    placeholders: ['SELECTOR'],
  },
  scriptErrorReason: {
    message: 'The script stopped with an error when it ran.',
    description: 'Sent to the model as the reason a repair is requested, and shown to the user.',
  },
  addressRemovalNote: {
    message: 'This is the page address sent to your AI provider. These parts are removed: the part after #, any user name and password, query values, query keys with no value, anything after a semicolon in the path, and query keys and path parts that are longer than $LIMIT$ characters or look like codes (a long run of digits, or of letters and digits). Removed path parts are shown as $PLACEHOLDER$. For addresses that are not http or https, such as file, blob and data addresses, only the type of address (for example "file:") is sent.',
    description: 'Shown next to the page address. $LIMIT$ is a number of characters; $PLACEHOLDER$ is the text that replaces a removed path segment.',
    placeholders: ['LIMIT', 'PLACEHOLDER'],
  },
  anchorKeepsRole: {
    message: 'the element still has role="$ROLE$"',
    description: 'Names an assumption of an elixir that no longer holds. It follows the words \'This elixir assumed\'. $ROLE$ is an attribute value.',
    placeholders: ['ROLE'],
  },
  anchorKeepsId: {
    message: 'the element still has id="$ID$"',
    description: 'Names an assumption of an elixir that no longer holds. It follows the words \'This elixir assumed\'. $ID$ is an attribute value.',
    placeholders: ['ID'],
  },
  anchorKeepsClass: {
    message: 'the element still has the class $CLASSES$',
    description: 'Names an assumption of an elixir that no longer holds. It follows the words \'This elixir assumed\'. $CLASSES$ is a list of class names.',
    placeholders: ['CLASSES'],
  },
  anchorTextStarts: {
    message: 'the element\'s text still starts with "$TEXT$…"',
    description: 'Names an assumption of an elixir that no longer holds. It follows the words \'This elixir assumed\'. $TEXT$ is the start of the element text.',
    placeholders: ['TEXT'],
  },
  anchorInside: {
    message: 'the element is still inside $LANDMARK$',
    description: 'Names an assumption of an elixir that no longer holds. It follows the words \'This elixir assumed\'. $LANDMARK$ is the name of a page region.',
    placeholders: ['LANDMARK'],
  },
})
