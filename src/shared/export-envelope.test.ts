import { describe, expect, it } from 'vitest'
import {
  MAX_IMPORT_BYTES,
  MAX_IMPORT_RECORDS,
  importCountProblem,
  importSizeProblem,
} from './export-envelope'

describe('the size of a file to import (#31)', () => {
  it('is 5 MB', () => {
    expect(MAX_IMPORT_BYTES).toBe(5 * 1024 * 1024)
  })

  it('refuses a file one byte over the limit, with a message that says so', () => {
    expect(importSizeProblem(MAX_IMPORT_BYTES + 1)).toContain('larger than 5 MB')
  })

  it('accepts a file of exactly the limit and an empty file (control)', () => {
    expect(importSizeProblem(MAX_IMPORT_BYTES)).toBeNull()
    expect(importSizeProblem(0)).toBeNull()
  })
})

describe('the number of records in a file to import (#31)', () => {
  it('refuses one record over the limit and names the count', () => {
    expect(importCountProblem(MAX_IMPORT_RECORDS + 1)).toContain('1001 records')
  })

  it('accepts exactly the limit (control)', () => {
    expect(importCountProblem(MAX_IMPORT_RECORDS)).toBeNull()
  })
})
