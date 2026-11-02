import { defineMessages } from './define'

/** Messages of the editor surface. */
export const editorMessages = defineMessages({
  edMainRestoreTitle: {
    message: 'This version runs in the page\'s own world (MAIN)',
    description: 'Heading of the risks shown before a version that runs in the page\'s own world is restored.',
  },
  edMainRestoreConfirm: {
    message: 'I have read the risks and want this version to run in the page\'s own world',
    description: 'Label of a checkbox that confirms the risks were read.',
  },
  edCodeLabel: {
    message: 'Elixir code',
    description: 'Accessible name of the box that holds the code.',
  },
  edDraftGone: {
    message: 'That draft is no longer available. Drafts are kept only until the browser closes. Pick the element again to start over.',
    description: 'Error shown when a draft elixir was lost.',
  },
  edWrittenByHandIntent: {
    message: 'Written by hand.',
    description: 'Saved as the description of an elixir that the user wrote by hand.',
  },
  edWrittenByHandApproach: {
    message: 'Written by hand, so there is no generated description of it.',
    description: 'Saved as the approach of an elixir that the user wrote by hand.',
  },
  edTitleNew: {
    message: 'New elixir · Web Alchemist',
    description: 'Title of the editor tab for a new elixir.',
  },
  edTitleNamed: {
    message: '$NAME$ · Web Alchemist',
    description: 'Title of the editor tab. $NAME$ is the name of the elixir.',
    placeholders: ['NAME'],
  },
  edTransformGone: {
    message: 'That elixir no longer exists. It may have been deleted.',
    description: 'Error shown when the elixir to edit was deleted.',
  },
  edNeedsPermissionRestore: {
    message: 'Web Alchemist needs permission for the site this version applies to before it can restore it.',
    description: 'Error shown when permission for the site was refused.',
  },
  edNeedsPermissionJs: {
    message: 'Web Alchemist needs the permission to run JavaScript elixirs, and permission for the site it applies to, before it can save this.',
    description: 'Error shown when a permission was refused.',
  },
  edNeedsPermissionCookies: {
    message: 'To apply this on $ORIGIN$, Web Alchemist needs access to that site and the cookies permission, which it uses to read the container.',
    description: 'Error shown when a permission was refused. $ORIGIN$ is a site address pattern.',
    placeholders: ['ORIGIN'],
  },
  edNeedsPermission: {
    message: 'Web Alchemist needs permission for $ORIGIN$ before it can apply this there.',
    description: 'Error shown when a permission was refused. $ORIGIN$ is a site address pattern.',
    placeholders: ['ORIGIN'],
  },
  edFindingLine: {
    message: 'Line $LINE$: $EXPLANATION$',
    description: 'A problem that stops the code from being saved. $LINE$ is a line number and $EXPLANATION$ says what is wrong.',
    placeholders: ['LINE', 'EXPLANATION'],
  },
  edCssNeedsApproval: {
    message: 'This CSS loads addresses outside the site. Tick the box below to approve them, then save again.',
    description: 'Error shown when the CSS loads addresses that are not approved.',
  },
  edNothingTitle: {
    message: 'Nothing to edit',
    description: 'Heading shown when no elixir can be opened.',
  },
  edNamePlaceholder: {
    message: 'Name this elixir',
    description: 'Hint shown in the empty name box.',
  },
  edHandNote: {
    message: 'Written by hand. Nothing is sent to a model, and no page content leaves the browser.',
    description: 'Explains that writing by hand sends nothing.',
  },
  edKindLabel: {
    message: 'Elixir kind',
    description: 'Accessible name of the choice between CSS and JavaScript.',
  },
  edCheckedBadge: {
    message: 'checked before it is saved',
    description: 'Badge that says JavaScript is checked before saving.',
  },
  edDisabledBadge: {
    message: 'disabled',
    description: 'Badge that marks an elixir that is turned off.',
  },
  edSavedAnnounce: {
    message: 'Saved.',
    description: 'Read out by a screen reader after a save.',
  },
  edSaved: {
    message: 'Saved',
    description: 'Shown beside the buttons after a save.',
  },
  edUnsaved: {
    message: 'Unsaved changes',
    description: 'Shown beside the buttons when the code was changed.',
  },
  edRevert: {
    message: 'Revert',
    description: 'Button that undoes unsaved changes.',
  },
  edSaving: {
    message: 'Saving…',
    description: 'Button text while an elixir is saved.',
  },
  edCreate: {
    message: 'Create',
    description: 'Button that creates a new elixir.',
  },
  edSave: {
    message: 'Save',
    description: 'Button that saves an elixir.',
  },
  edAppliesTo: {
    message: 'Applies to',
    description: 'Label of the box that holds the address pattern.',
  },
  edNoLongerCovers: {
    message: 'This no longer covers $HOST$, where it was written.',
    description: 'Warning shown when the address pattern misses the site. $HOST$ is a site name.',
    placeholders: ['HOST'],
  },
  edSavingAsks: {
    message: 'Saving asks for permission to read $ORIGIN$.',
    description: 'Hint shown when the address pattern changed. $ORIGIN$ is a site address pattern.',
    placeholders: ['ORIGIN'],
  },
  edNow: {
    message: 'Runs in: $WORLD$',
    description: 'Names the execution world that is set. $WORLD$ is the name of the world.',
    placeholders: ['WORLD'],
  },
  edKeepsMain: {
    message: 'This elixir was saved to run in the page\'s own world and keeps doing so.',
    description: 'Explains that a saved elixir keeps running in the page\'s own world.',
  },
  edRunInMain: {
    message: 'Run in the page\'s own world (MAIN)',
    description: 'Label of a checkbox.',
  },
  edContainer: {
    message: 'Container',
    description: 'Label of the choice of Firefox container.',
  },
  edAdvanced: {
    message: 'Advanced: addresses CSS may load',
    description: 'Heading of a section of settings that is closed by default.',
  },
  edForSite: {
    message: 'For $SITE$',
    description: 'Label of the choice of which addresses the CSS may load. $SITE$ is a site name.',
    placeholders: ['SITE'],
  },
  edForThisSite: {
    message: 'For this site',
    description: 'Label of the choice of which addresses the CSS may load.',
  },
  edCssBlock: {
    message: 'Only data: addresses (default)',
    description: 'Choice of which addresses the CSS may load.',
  },
  edCssSame: {
    message: 'The page\'s own addresses (same domain, protocol and port) and data: addresses',
    description: 'Choice of which addresses the CSS may load.',
  },
  edCssList: {
    message: 'The page\'s own addresses, data: addresses, and other addresses that you approve one by one',
    description: 'Choice of which addresses the CSS may load.',
  },
  edCssHint: {
    message: 'CSS that loads an address makes the browser send a request on every visit, and a request can carry information about the page. @import is never allowed.',
    description: 'Explains the choice of which addresses the CSS may load.',
  },
  edCssNoKey: {
    message: 'The Applies to value does not name one site (for example, it covers every .com site), so the default applies.',
    description: 'Added when the address pattern has no fixed host name.',
  },
  edNeedsApproval: {
    message: 'Needs approval',
    description: 'Heading of the list of addresses that the CSS loads and the user has not approved.',
  },
  edApproveLoadingOne: {
    message: 'Approve loading this address',
    description: 'Label of a checkbox.',
  },
  edApproveLoadingMany: {
    message: 'Approve loading these addresses',
    description: 'Label of a checkbox.',
  },
  edNotSaved: {
    message: 'Not saved',
    description: 'Heading of the reasons why a save failed.',
  },
  edEarlierVersions: {
    message: 'Earlier versions ($COUNT$)',
    description: 'Heading of the list of earlier versions. $COUNT$ is a number.',
    placeholders: ['COUNT'],
  },
  edReviewVersion: {
    message: 'Review this version',
    description: 'Button that opens a comparison with an earlier version.',
  },
  edVersionFrom: {
    message: 'Version from $DATE$',
    description: 'Heading of the comparison with an earlier version. $DATE$ is a date and time.',
    placeholders: ['DATE'],
  },
  edRestoreExplain: {
    message: 'Restoring replaces the code, the pages it applies to, the access it asks for and the world of this elixir with those of this version. The current state is kept as a version, so a restore can be undone.',
    description: 'Explains what restoring a version does.',
  },
  edTableCaption: {
    message: 'Current values and the values of this version',
    description: 'Caption of the table that compares two versions.',
  },
  edColItem: {
    message: 'Item',
    description: 'Column heading of the table that compares two versions.',
  },
  edColCurrent: {
    message: 'Current',
    description: 'Column heading of the table that compares two versions.',
  },
  edColVersion: {
    message: 'This version',
    description: 'Column heading of the table that compares two versions.',
  },
  edColDifference: {
    message: 'Difference',
    description: 'Column heading of the table that compares two versions.',
  },
  edRowCode: {
    message: 'Code',
    description: 'Row heading of the table that compares two versions.',
  },
  edShownBelow: {
    message: 'Shown below',
    description: 'Cell of the table that compares two versions.',
  },
  edCodeInVersion: {
    message: 'Code in this version',
    description: 'Heading above the code of an earlier version.',
  },
  edRestore: {
    message: 'Restore this version',
    description: 'Button that restores an earlier version.',
  },
  edSaveFirst: {
    message: 'Save or revert the changes in the editor before restoring a version.',
    description: 'Hint shown when there are unsaved changes.',
  },
  edFootJs: {
    message: 'Checked before it is saved',
    description: 'Footer text that says what happens to JavaScript.',
  },
  edFootCss: {
    message: 'Applied as written',
    description: 'Footer text that says what happens to CSS.',
  },
  edShortcuts: {
    message: 'Ctrl+S saves · Tab indents · Esc then Tab leaves the field',
    description: 'Footer text that lists keyboard shortcuts.',
  },
  edLoading: {
    message: 'Loading…',
    description: 'Shown while the elixir loads.',
  },
})
