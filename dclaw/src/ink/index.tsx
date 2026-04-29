import React, { type ReactNode } from 'react'
import inkRender, {
  createRoot as inkCreateRoot,
  type Instance,
  type RenderOptions,
  type Root,
} from './root.js'
import BaseBox, { type Props as BaseBoxProps } from './components/Box.js'
import BaseText, { type Props as BaseTextProps } from './components/Text.js'
import type { Color } from './styles.js'

export type { Instance, RenderOptions, Root }

type InkColorName =
  | 'black'
  | 'red'
  | 'green'
  | 'yellow'
  | 'blue'
  | 'magenta'
  | 'cyan'
  | 'white'
  | 'gray'
  | 'grey'

type CompatColor = Color | InkColorName | string

export type BoxProps = Omit<
  BaseBoxProps,
  'backgroundColor' | 'borderColor' | 'children'
> & {
  backgroundColor?: CompatColor
  borderColor?: CompatColor
  children?: ReactNode
}

export type TextProps = Omit<BaseTextProps, 'backgroundColor' | 'color' | 'dim'> & {
  backgroundColor?: CompatColor
  color?: CompatColor
  dim?: boolean
  dimColor?: boolean
}

function normalizeColor(color: CompatColor | undefined): Color | undefined {
  if (!color) {
    return undefined
  }

  if (color === 'gray' || color === 'grey') {
    return 'ansi:blackBright'
  }

  if (
    color === 'black' ||
    color === 'red' ||
    color === 'green' ||
    color === 'yellow' ||
    color === 'blue' ||
    color === 'magenta' ||
    color === 'cyan' ||
    color === 'white'
  ) {
    return `ansi:${color}` as Color
  }

  return color as Color
}

export function Box({
  backgroundColor,
  borderColor,
  ...props
}: BoxProps): React.ReactNode {
  return (
    <BaseBox
      {...props}
      backgroundColor={normalizeColor(backgroundColor)}
      borderColor={normalizeColor(borderColor)}
    />
  )
}

export function Text({
  backgroundColor,
  color,
  dim,
  dimColor,
  ...props
}: TextProps): React.ReactNode {
  return (
    <BaseText
      {...props}
      backgroundColor={normalizeColor(backgroundColor)}
      color={normalizeColor(color)}
      dim={dim ?? dimColor}
    />
  )
}

export async function render(
  node: ReactNode,
  options?: NodeJS.WriteStream | RenderOptions,
): Promise<Instance> {
  return inkRender(node, options)
}

export async function createRoot(options?: RenderOptions): Promise<Root> {
  return inkCreateRoot(options)
}

export { Ansi } from './Ansi.js'
export type { Props as AppProps } from './components/AppContext.js'
export type { Props as BaseBoxProps } from './components/Box.js'
export { default as BaseBox } from './components/Box.js'
export type { Props as BaseTextProps } from './components/Text.js'
export { default as BaseText } from './components/Text.js'
export type { DOMElement } from './dom.js'
export type { Key } from './events/input-event.js'
export { default as useApp } from './hooks/use-app.js'
export { default as useInput } from './hooks/use-input.js'
export { default as useStdin } from './hooks/use-stdin.js'
export { useTerminalViewport } from './hooks/use-terminal-viewport.js'
export { default as measureElement } from './measure-element.js'
export { default as wrapText } from './wrap-text.js'
