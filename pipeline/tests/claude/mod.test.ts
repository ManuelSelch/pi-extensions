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
