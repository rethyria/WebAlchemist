/**
 * Whether leaving the editor page should ask the user to confirm.
 *
 * `dirty` in create mode means that a name and code are present, and it does
 * not compare them with anything saved, so it stays true after a successful
 * Create. The page then reloads itself to become an edit session, and that
 * reload fired the guard, which asked the user whether to leave a page whose
 * work had just been saved. The reload is the page's own, made after the save,
 * so it is the one case where nothing can be lost and the guard stands down.
 * The alternative, comparing the code with the saved value in create mode too,
 * was rejected because there is nothing to compare with before the first save.
 */
export function shouldConfirmLeaving(dirty: boolean, reloadingAfterCreate: boolean): boolean {
  return dirty && !reloadingAfterCreate
}
