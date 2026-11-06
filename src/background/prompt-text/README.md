# Prompt texts

These Markdown files hold the fixed instructions that the extension sends to
the model. Each file is bundled into the extension as a string and sent as
written, apart from the placeholders named below.

- `generate.md` is the system prompt for writing a transform.
- `ask.md` is the system prompt for a side question about a draft.
- `review.md` is the system prompt for the code check.
- `repair.md` is the instruction for repairing a transform that stopped matching.
- `page-content-is-data.md` is the section about page content that `generate.md` and `ask.md` include.

A placeholder such as `{{PAGE_CONTENT_IS_DATA}}` or `{{NONCE}}` is replaced by
`fill.ts`, which throws when a placeholder has no value or a value is unused.
The final newline of each file is not sent. The code that builds each request
message is in `../prompts.ts`. A test pins a hash of every text, so a change to
a file shows up in review.
