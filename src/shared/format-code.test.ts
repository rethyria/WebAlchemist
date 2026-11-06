import { parse } from 'acorn'
import { describe, expect, it } from 'vitest'
import { formatCode, formatGeneration } from './format-code'

/** The syntax tree without positions, so that two layouts of one program compare equal. */
function tree(code: string): unknown {
  const ast = parse(code, { ecmaVersion: 'latest', sourceType: 'script', allowReturnOutsideFunction: true })
  return JSON.parse(
    JSON.stringify(ast, (key, value) =>
      key === 'start' || key === 'end' || key === 'loc' || key === 'range' || key === 'raw' ? undefined : value,
    ),
  )
}

const SNIPPETS: Record<string, string> = {
  'a statement without a semicolon before a bracket':
    "let x = 1\n;[1, 2].forEach(n => { x += n })\nconst y = x\n;(function () { return y })()",
  'a return and a line break': 'function f(a){\nreturn a\n}\nconst g=()=>{return{a:1}}',
  'a regular expression literal': "const r=/a\\/[/]b+/gi;const t=r.test('a/b');const d=4/2/1",
  'a template literal with an expression':
    'const n=3;const s=`a ${n} b ${`inner ${n+1}`}`;const t=tag`x${n}y`',
  'a closing script tag in a string': "const s='</script>';const t=\"<\\/script>\";const u=`</script>`",
  'comments': "// one\nconst a=1;/* two */const b=2;/** three\n * four */function f(){// five\nreturn a+b}",
  'optional chaining and nullish operators': 'const a=o?.b?.[c]?.(d)??e;a??=1;a||=2;a&&=3',
  'class fields': 'class A{x=1;static y=2;#z=3;static{A.y=4}get z(){return this.#z}m(){return this.x+this.#z}}',
  'arrow functions and spread': 'const f=(...a)=>({...a,b:1});const g=async x=>await x;for(const [k,v] of Object.entries({a:1})){f(k,v)}',
  'labelled statements and a do loop': 'a:for(;;){do{break a}while(0)}',
  'an increment next to a plus': 'let a=1,b=2;a=a+ +b;a=a- -b;a++ +b;a+++b',
  'object literal methods': "const o={a(){return 1},get b(){return 2},['c'+1]:3,'d-e':4}",
  'an exponent and a division after a bracket': 'const a=(1+2)/3;const b=[1][0]/2;const c=2**3**2',
}

describe('formatting JavaScript', () => {
  it('puts one-line code on several lines with 2-space indentation', () => {
    const out = formatCode("const a=document.querySelector('h1');if(a){a.textContent='x'}", 'js')
    expect(out).toBe("const a = document.querySelector('h1');\nif (a) {\n  a.textContent = 'x'\n}")
  })

  for (const [name, code] of Object.entries(SNIPPETS)) {
    it(`gives code with ${name} that acorn accepts and that has the same syntax tree`, () => {
      const out = formatCode(code, 'js')
      expect(() => tree(out)).not.toThrow()
      expect(tree(out)).toEqual(tree(code))
    })
  }

  it('keeps comments', () => {
    const out = formatCode(SNIPPETS['comments']!, 'js')
    for (const comment of ['// one', '/* two */', '// five']) expect(out).toContain(comment)
    expect(out).toContain('four */')
  })

  it('keeps a closing script tag inside a string as it was written', () => {
    const out = formatCode(SNIPPETS['a closing script tag in a string']!, 'js')
    expect(out).toContain("'</script>'")
    expect(out).toContain('"<\\/script>"')
    expect(out).toContain('`</script>`')
  })

  it('does not change what a template literal holds', () => {
    const out = formatCode('const s=`a  ${ n+1 }\n   b`', 'js')
    expect(out).toContain('`a  ${ n+1 }\n   b`')
  })

  it('does not change code that is formatted already', () => {
    const once = formatCode(SNIPPETS['class fields']!, 'js')
    expect(formatCode(once, 'js')).toBe(once)
  })
})

describe('formatting CSS', () => {
  it('puts each declaration on its own line', () => {
    expect(formatCode('h1{color:red;margin:0}', 'css')).toBe('h1 {\n  color: red;\n  margin: 0\n}')
  })

  it('keeps comments, important flags, at-rules and strings', () => {
    const out = formatCode('/* c */a>b{content:"x;y";margin:0 !important}@media (min-width:1px){d{e:f}}', 'css')
    expect(out).toContain('/* c */')
    expect(out).toContain('content: "x;y"')
    expect(out).toContain('!important')
    expect(out).toContain('@media (min-width:1px) {\n  d {\n    e: f\n  }\n}')
  })
})

describe('code that is empty', () => {
  it('is returned as it was', () => {
    expect(formatCode('', 'js')).toBe('')
    expect(formatCode('  \n', 'css')).toBe('  \n')
  })
})

describe('formatting a generation result', () => {
  it('formats the code by the kind of the result and leaves the other fields', () => {
    const result = { kind: 'css' as const, code: 'a{b:c}', name: 'n' }
    expect(formatGeneration(result)).toEqual({ kind: 'css', code: 'a {\n  b: c\n}', name: 'n' })
  })

  it('returns the same object when the layout does not change', () => {
    const result = { kind: 'css' as const, code: 'a {\n  b: c\n}' }
    expect(formatGeneration(result)).toBe(result)
  })
})

describe('formatting a result without code', () => {
  it('returns it as it was', () => {
    const result = { kind: 'css' } as unknown as { kind: 'css'; code: string }
    expect(formatGeneration(result)).toBe(result)
  })
})
