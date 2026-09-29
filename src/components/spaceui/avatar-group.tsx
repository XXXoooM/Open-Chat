'use client'

import React from 'react'
import { cn } from '@/lib/utils'

export interface AvatarGroupProps extends React.HTMLAttributes<HTMLDivElement> {
  stacking?: 'left' | 'right'
}

export function AvatarGroup({
  className,
  stacking = 'right',
  children,
  ...props
}: AvatarGroupProps): React.ReactElement {
  const count = React.Children.count(children)

  return (
    <div className={cn('flex items-center justify-center -space-x-2 *:ring-2 *:ring-background', className)} {...props}>
      {React.Children.map(children, (child, index) => {
        if (!React.isValidElement(child)) return child
        // 本地修补（非上游原文，见 SPACEUI_INTEGRATION.md 变更日志）：
        // 上游直接读 `child.props.style`，但 React.Children.map 的回调参数被推断为 unknown，
        // 在 TS 下报 TS2339（Property 'style' does not exist on type 'unknown'）。
        // 这里把 props 一次性断言后取出 style，语义不变。
        const childStyle = (child.props as { style?: React.CSSProperties }).style
        return React.cloneElement(child as React.ReactElement<any>, {
          style: {
            ...(childStyle || {}),
            zIndex: stacking === 'left' ? count - index : undefined,
          },
        })
      })}
    </div>
  )
}

export function AvatarGroupAction({ className, ...props }: React.HTMLAttributes<HTMLDivElement>): React.ReactElement {
  return (
    <div
      className={cn(
        'relative inline-flex size-8 shrink-0 select-none items-center justify-center rounded-full bg-muted font-medium text-xs ring-2 ring-background',
        className,
      )}
      data-slot="avatar-group-action"
      {...props}
    />
  )
}
