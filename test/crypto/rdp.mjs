/**
 * Shared RDP harness for Web Alchemist verification runs.
 *
 * Every /tmp probe in this project rebuilt the same connection code. This is
 * that code, once. Import it and ask for the contexts you need.
 */
import { connect } from 'node:net'

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export function open(port = 41365, host = '127.0.0.1') {
  const socket = connect(port, host)
  let buf = Buffer.alloc(0)
  let greeted = null
  const pending = new Map()
  const events = []

  socket.on('data', (c) => {
    buf = Buffer.concat([buf, c])
    for (;;) {
      const i = buf.indexOf(0x3a)
      if (i === -1) return
      const n = Number(buf.subarray(0, i).toString())
      if (!Number.isFinite(n)) return
      if (buf.length < i + 1 + n) return
      const p = JSON.parse(buf.subarray(i + 1, i + 1 + n).toString())
      buf = buf.subarray(i + 1 + n)
      if (!greeted) {
        greeted = p
        continue
      }
      const q = pending.get(p.from)
      const isEv = p.type === 'evaluationResult' || p.type === 'target-available-form'
      if (q && q.length && !isEv) q.shift()(p)
      else events.push(p)
    }
  })

  const send = (m) =>
    new Promise((r) => {
      if (!pending.has(m.to)) pending.set(m.to, [])
      pending.get(m.to).push(r)
      const j = JSON.stringify(m)
      socket.write(`${Buffer.byteLength(j)}:${j}`)
    })

  /*
   * Two layers. `raw` is one evaluation and returns whatever the console gives
   * back — which for anything long is a grip, not a string. `run` wraps the
   * expression so the result is stringified in-page and polled for, which is
   * how a value larger than the grip threshold gets out intact.
   */
  const mkEval = (C) => {
    const raw = async (text) => {
      const reply = await send({ to: C, type: 'evaluateJSAsync', text, disableBreak: true })
      for (let i = 0; i < 250; i++) {
        const f = events.find((e) => e.type === 'evaluationResult' && e.resultID === reply.resultID)
        if (f) {
          events.splice(events.indexOf(f), 1)
          if (f.exception != null) return `EXC ${String(f.exceptionMessage ?? '').slice(0, 300)}`
          const r = f.result
          return r && typeof r === 'object' ? (r.type ?? 'obj') : String(r)
        }
        await sleep(80)
      }
      return 'TIMEOUT'
    }
    const run = async (expr) => {
      await raw(
        `globalThis.__x="__p__";(async()=>{try{globalThis.__x=String(await (${expr}))}catch(e){globalThis.__x="EXC "+e.message}})();1`,
      )
      for (let i = 0; i < 200; i++) {
        const v = await raw('globalThis.__x')
        if (v !== '__p__') return v
        await sleep(200)
      }
      return 'TIMEOUT'
    }
    /* A long value, fetched in slices so grips never truncate it. */
    const long = async (expr) => {
      const n = await run(`(async()=>{globalThis.__L=String(await (${expr}));return __L.length})()`)
      const len = Number(n)
      if (!Number.isFinite(len)) return String(n)
      let out = ''
      for (let at = 0; at < len; at += 4000) {
        out += await raw(`globalThis.__L.slice(${at}, ${at + 4000})`)
      }
      return out
    }
    return { raw, run, long }
  }

  const ready = new Promise((resolve) => socket.on('connect', resolve))

  return {
    socket,
    send,
    events,
    mkEval,
    close: () => socket.end(),
    async contexts({ needBackground = true, waitMs = 3000 } = {}) {
      await ready
      await sleep(400)
      const proc = await send({ to: 'root', type: 'getProcess', id: 0 })
      const ptgt = await send({ to: proc.processDescriptor.actor, type: 'getTarget' })
      const parent = mkEval(ptgt.process.consoleActor)

      const addons = await send({ to: 'root', type: 'listAddons' })
      const ours = addons.addons.find((x) => (x.id ?? '').includes('webalchemist'))
      if (!ours) return { parent, addon: null }

      if (needBackground) {
        await parent.run(
          `(async()=>{const {ExtensionParent}=ChromeUtils.importESModule("resource://gre/modules/ExtensionParent.sys.mjs");
           const ext=ExtensionParent.GlobalManager.extensionMap.get(${JSON.stringify(ours.id)});
           await ext.wakeupBackground(); return ext.backgroundState;})()`,
        )
      }

      const w = await send({ to: ours.actor, type: 'getWatcher' })
      await send({ to: w.actor, type: 'watchTargets', targetType: 'frame' })
      await sleep(waitMs)

      const frames = () => events.filter((e) => e.type === 'target-available-form').map((e) => e.target)
      const find = (needle) => {
        const t = [...frames()].reverse().find((f) => (f.url ?? '').includes(needle))
        return t ? mkEval(t.consoleActor) : null
      }

      return {
        parent,
        addon: ours,
        watcher: w.actor,
        frames,
        find,
        refresh: () => send({ to: w.actor, type: 'watchTargets', targetType: 'frame' }).catch(() => {}),
        background: find('_generated_background_page'),
        sidebar: find('src/sidebar'),
        async tab(needle) {
          const list = await send({ to: 'root', type: 'listTabs' })
          const d = (list.tabs || []).find((t) => (t.url || '').includes(needle))
          if (!d) return null
          const target = await send({ to: d.actor, type: 'getTarget' })
          return mkEval(target.frame.consoleActor)
        },
        baseUrl() {
          const t = frames().find((f) => (f.url ?? '').includes('src/sidebar'))
          return (t?.url ?? '').replace(/src\/sidebar.*$/, '')
        },
      }
    },
  }
}

/** Prints a control-then-test verdict block and returns whether all passed. */
export function verdict(rows) {
  console.log('\n=== VERDICT ===')
  for (const [name, ok] of rows) console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}`)
  const all = rows.every(([, ok]) => ok)
  console.log(all ? 'PASS' : 'FAIL')
  return all
}
