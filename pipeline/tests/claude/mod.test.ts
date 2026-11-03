import { expect, mock, test } from 'claude-code/testing'

const BAND = {
  plugin: 'pipeline',
  component: 'AbovePrompt',
  surface: 'terminal',
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 80, scroll: { offset: 0, bodyRows: 10 }, view: {} },
} as const

test('the mod draws pipeline status after its first refresh', async ($, on) => {
  const clock = mock.clock(on)
  on('session.start', () => ({ cwd: '/work' }))
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['other mod'] }))
  on('mcp.call', (_$, e) => {
    expect(e.server).toBe('plugin:pipeline:pipeline')
    expect(e.tool).toBe('pipeline_status')
    return { value: { content: [{ type: 'text', text: JSON.stringify({ configured: true, suites: { unit: { outcome: 'never', stale: false } }, github: { workflows: [] } }) }] } }
  })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await clock.settle()

  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Text', text: /Local 0\/1/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /unit never/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'other mod' })).toBeDefined()
  await ui.unmount()
})

test('a Desktop surface attaching after headless startup begins status polling', async ($, on) => {
  const clock = mock.clock(on)
  let calls = 0
  on('session.start', () => ({ cwd: '/work' }))
  on('session.attach', (_$, e) => ({ clientId: e.clientId }))
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['other mod'] }))
  on('mcp.call', () => {
    calls += 1
    return { value: { content: [{ type: 'text', text: JSON.stringify({ configured: true, suites: { unit: { outcome: 'never', stale: false } } }) }] } }
  })
  await $.session.start({ surface: null, isInteractive: false, cwd: '/work' })
  await clock.advance(5000)
  expect(calls).toBe(0)

  await $.session.attach({ surface: 'desktop', clientId: 'desktop-1' })
  await clock.settle()

  expect(calls).toBe(1)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /Local 0\/1/ })).toBeDefined()
  await ui.unmount()
})

test('Desktop refresh continues while any client is attached and stops after the last detaches', async ($, on) => {
  const clock = mock.clock(on)
  let calls = 0
  on('session.start', () => ({ cwd: '/work' }))
  on('session.attach', (_$, e) => ({ clientId: e.clientId }))
  on('session.detach', (_$, e) => ({ clientId: e.clientId }))
  on('mcp.call', () => {
    calls += 1
    return { value: { content: [{ type: 'text', text: JSON.stringify({ configured: false, suites: {} }) }] } }
  })
  await $.session.start({ surface: null, isInteractive: false, cwd: '/work' })
  await $.session.attach({ surface: 'desktop', clientId: 'desktop-1' })
  await $.session.attach({ surface: 'desktop', clientId: 'desktop-2' })
  await clock.settle()
  expect(calls).toBe(1)

  await $.session.detach({ surface: 'desktop', clientId: 'desktop-1', reason: 'detach' })
  await clock.advance(5000)
  expect(calls).toBe(2)

  await $.session.detach({ surface: 'desktop', clientId: 'desktop-2', reason: 'detach' })
  await clock.advance(5000)
  expect(calls).toBe(2)
})

test('detaching Desktop leaves an interactive terminal polling', async ($, on) => {
  const clock = mock.clock(on)
  let calls = 0
  on('session.start', () => ({ cwd: '/work' }))
  on('session.attach', (_$, e) => ({ clientId: e.clientId }))
  on('session.detach', (_$, e) => ({ clientId: e.clientId }))
  on('mcp.call', () => {
    calls += 1
    return { value: { content: [{ type: 'text', text: JSON.stringify({ configured: false, suites: {} }) }] } }
  })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.session.attach({ surface: 'desktop', clientId: 'desktop-1' })
  await clock.settle()

  await $.session.detach({ surface: 'desktop', clientId: 'desktop-1', reason: 'detach' })
  await clock.advance(5000)

  expect(calls).toBe(2)
})
