import assert from 'node:assert/strict'
import test from 'node:test'
import { PassThrough } from 'node:stream'
import React, { isValidElement } from 'react'
import { Box, render, Text } from '../../src/ink/index.js'
import type { ScrollBoxHandle } from '../../src/ink/components/ScrollBox.js'
import { TranscriptScrollHandler } from '../../src/tui/components/TranscriptScrollHandler.js'
import {
  applyTranscriptScrollAction,
  getTranscriptScrollDelta,
} from '../../src/tui/hooks/useTranscriptScroll.js'
import {
  isTuiFullscreenEnabled,
  resetTuiFullscreenProbeForTest,
} from '../../src/tui/runtime/fullscreen.js'
import { TuiFullscreenLayout } from '../../src/tui/views/TuiFullscreenLayout.js'
import {
  computeTranscriptSliceStart,
  type TranscriptSliceAnchor,
} from '../../src/tui/views/TranscriptPane.js'
import type { TranscriptItem } from '../../src/tui/state/index.js'

function setTty(stream: NodeJS.ReadStream | NodeJS.WriteStream, value: boolean) {
  const descriptor = Object.getOwnPropertyDescriptor(stream, 'isTTY')
  Object.defineProperty(stream, 'isTTY', {
    configurable: true,
    value,
  })

  return () => {
    if (descriptor) {
      Object.defineProperty(stream, 'isTTY', descriptor)
      return
    }

    delete (stream as { isTTY?: boolean }).isTTY
  }
}

function withEnv(
  values: Record<string, string | undefined>,
  fn: () => void,
): void {
  const previous = Object.fromEntries(
    Object.keys(values).map(key => [key, process.env[key]]),
  )

  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }

  try {
    resetTuiFullscreenProbeForTest()
    fn()
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
    resetTuiFullscreenProbeForTest()
  }
}

function createFakeScrollHandle() {
  let sticky = true
  const calls: string[] = []

  const handle = {
    getViewportHeight: () => 10,
    scrollBy: (delta: number) => {
      sticky = false
      calls.push(`scrollBy:${delta}`)
    },
    scrollTo: (offset: number) => {
      sticky = false
      calls.push(`scrollTo:${offset}`)
    },
    scrollToBottom: () => {
      sticky = true
      calls.push('scrollToBottom')
    },
    isSticky: () => sticky,
  } as unknown as ScrollBoxHandle

  return { calls, handle }
}

function createTranscriptEntries(
  count: number,
  kind: TranscriptItem['kind'] = 'system',
): Array<Pick<TranscriptItem, 'id' | 'kind'>> {
  return Array.from({ length: count }, (_, index) => ({
    id: `item-${index}`,
    kind,
  }))
}

test('fullscreen is opt-in and still gated by tty and tmux auto mode', () => {
  const restoreStdin = setTty(process.stdin, true)
  const restoreStdout = setTty(process.stdout, true)

  try {
    withEnv(
      {
        DCLAW_TUI_FULLSCREEN: undefined,
        TERM: undefined,
        TERM_PROGRAM: undefined,
        TMUX: undefined,
      },
      () => {
        assert.equal(isTuiFullscreenEnabled(), false)
      },
    )

    withEnv({ DCLAW_TUI_FULLSCREEN: '1' }, () => {
      assert.equal(isTuiFullscreenEnabled(), true)
    })

    withEnv({ DCLAW_TUI_FULLSCREEN: '0' }, () => {
      assert.equal(isTuiFullscreenEnabled(), false)
    })

    const restoreNonTty = setTty(process.stdout, false)
    try {
      withEnv({ DCLAW_TUI_FULLSCREEN: '1' }, () => {
        assert.equal(isTuiFullscreenEnabled(), false)
      })
    } finally {
      restoreNonTty()
    }

    withEnv(
      {
        DCLAW_TUI_FULLSCREEN: 'auto',
        TERM: 'xterm-256color',
        TERM_PROGRAM: 'iTerm.app',
        TMUX: '/tmp/tmux-501/default,123,0',
      },
      () => {
        assert.equal(isTuiFullscreenEnabled(), false)
      },
    )

    withEnv(
      {
        DCLAW_TUI_FULLSCREEN: '1',
        TERM: 'xterm-256color',
        TERM_PROGRAM: 'iTerm.app',
        TMUX: '/tmp/tmux-501/default,123,0',
      },
      () => {
        assert.equal(isTuiFullscreenEnabled(), true)
      },
    )
  } finally {
    restoreStdout()
    restoreStdin()
  }
})

test('main screen transcript slice caps growth with a stable anchor', () => {
  const anchorRef = { current: null as TranscriptSliceAnchor }

  assert.equal(
    computeTranscriptSliceStart(
      createTranscriptEntries(200),
      anchorRef,
      200,
      50,
    ),
    0,
  )
  assert.deepEqual(anchorRef.current, { id: 'item-0', index: 0 })

  assert.equal(
    computeTranscriptSliceStart(
      createTranscriptEntries(250),
      anchorRef,
      200,
      50,
    ),
    0,
  )
  assert.deepEqual(anchorRef.current, { id: 'item-0', index: 0 })

  assert.equal(
    computeTranscriptSliceStart(
      createTranscriptEntries(251),
      anchorRef,
      200,
      50,
    ),
    51,
  )
  assert.deepEqual(anchorRef.current, { id: 'item-51', index: 51 })

  assert.equal(
    computeTranscriptSliceStart(
      createTranscriptEntries(252),
      anchorRef,
      200,
      50,
    ),
    51,
  )
  assert.deepEqual(anchorRef.current, { id: 'item-51', index: 51 })
})

test('main screen transcript slice falls back safely when the anchor disappears', () => {
  const anchorRef = {
    current: { id: 'deleted-anchor', index: 80 },
  }

  assert.equal(
    computeTranscriptSliceStart(
      createTranscriptEntries(220),
      anchorRef,
      200,
      50,
    ),
    20,
  )
  assert.deepEqual(anchorRef.current, { id: 'item-20', index: 20 })

  assert.equal(computeTranscriptSliceStart([], anchorRef, 200, 50), 0)
  assert.equal(anchorRef.current, null)
})

test('main screen transcript slice treats a streaming answer as one block', () => {
  const anchorRef = { current: null as TranscriptSliceAnchor }
  const entries: Array<Pick<TranscriptItem, 'id' | 'kind'>> = [
    { id: 'prompt', kind: 'user_prompt' },
    ...createTranscriptEntries(260, 'assistant_stream_chunk'),
  ]

  assert.equal(computeTranscriptSliceStart(entries, anchorRef, 200, 50), 0)
  assert.deepEqual(anchorRef.current, { id: 'prompt', index: 0 })
})

test('transcript scroll actions map to stable viewport-relative deltas', () => {
  assert.equal(getTranscriptScrollDelta('line-up', 20), -3)
  assert.equal(getTranscriptScrollDelta('line-down', 20), 3)
  assert.equal(getTranscriptScrollDelta('page-up', 20), -19)
  assert.equal(getTranscriptScrollDelta('page-down', 20), 19)
  assert.equal(getTranscriptScrollDelta('half-page-up', 20), -10)
  assert.equal(getTranscriptScrollDelta('half-page-down', 20), 10)
  assert.equal(getTranscriptScrollDelta('top', 20), undefined)
  assert.equal(getTranscriptScrollDelta('bottom', 20), undefined)
})

test('transcript scroll actions break follow and bottom repins sticky follow', () => {
  const { calls, handle } = createFakeScrollHandle()

  assert.equal(handle.isSticky(), true)
  assert.equal(applyTranscriptScrollAction(handle, 'line-up'), true)
  assert.equal(handle.isSticky(), false)
  assert.equal(applyTranscriptScrollAction(handle, 'bottom'), true)
  assert.equal(handle.isSticky(), true)
  assert.deepEqual(calls, ['scrollBy:-3', 'scrollToBottom'])
})

test('fullscreen layout keeps transcript scrolling outside the bottom dock', () => {
  const element = TuiFullscreenLayout({
    bottom: React.createElement(Text, null, 'bottom'),
    fullscreen: true,
    mouseTracking: false,
    scrollRef: { current: null },
    scrollable: React.createElement(Text, null, 'transcript'),
  })

  assert.equal(isValidElement(element), true)
  const layoutElement = element as React.ReactElement<{
    children: React.ReactNode
    mouseTracking: boolean
  }>
  assert.equal(layoutElement.props.mouseTracking, false)
  const children = React.Children.toArray(layoutElement.props.children)
  assert.equal(children.length, 2)
  assert.equal(isValidElement(children[0]), true)
  assert.equal((children[0] as React.ReactElement).type, TranscriptScrollHandler)
})

test('non-fullscreen layout does not constrain the root height', () => {
  const element = TuiFullscreenLayout({
    bottom: React.createElement(Text, null, 'bottom'),
    fullscreen: false,
    mouseTracking: false,
    scrollRef: { current: null },
    scrollable: React.createElement(Text, null, 'transcript'),
  })

  assert.equal(isValidElement(element), true)
  const layoutElement = element as React.ReactElement<{
    children: React.ReactNode
    height?: string
  }>
  assert.equal(layoutElement.props.height, undefined)
})

test('custom ink facade can mount and unmount a minimal tree', async () => {
  const stdout = new PassThrough() as unknown as NodeJS.WriteStream & {
    columns: number
    isTTY: boolean
    rows: number
  }
  const stdin = new PassThrough() as unknown as NodeJS.ReadStream & {
    isTTY: boolean
    setRawMode: (enabled: boolean) => void
  }
  const stderr = new PassThrough() as unknown as NodeJS.WriteStream
  const chunks: Buffer[] = []

  stdout.isTTY = false
  stdout.columns = 80
  stdout.rows = 24
  stdin.isTTY = false
  stdin.setRawMode = () => stdin
  stdout.on('data', chunk => chunks.push(Buffer.from(chunk)))

  const app = await render(
    React.createElement(
      Box,
      null,
      React.createElement(Text, null, 'hello from custom ink'),
    ),
    {
      exitOnCtrlC: false,
      patchConsole: false,
      stderr,
      stdin,
      stdout,
    },
  )

  await new Promise(resolve => {
    setTimeout(resolve, 25)
  })
  const exited = app.waitUntilExit()
  app.unmount()
  await exited
  app.cleanup()

  assert.match(Buffer.concat(chunks).toString('utf8'), /hello from custom ink/)
})
