import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { buildDefaultTerminalOptions } from '@/lib/pane-manager/pane-terminal-options'
import type { SandboxTarget } from '../../../../shared/sandbox-policy-types'
import '@xterm/xterm/css/xterm.css'

export function useSandboxCredentialTerminal(target: SandboxTarget, sessionId: string) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<'opening' | 'active' | 'completed' | 'cancelled' | 'failed'>(
    'opening'
  )
  useEffect(() => {
    const container = containerRef.current
    if (!container) {
      return
    }
    let disposed = false
    let started = false
    let ended = false
    let terminalClosed = false
    const colors = getComputedStyle(container)
    const terminal = new Terminal({
      ...buildDefaultTerminalOptions(),
      scrollback: 0,
      disableStdin: true,
      logLevel: 'off',
      theme: { background: colors.backgroundColor, foreground: colors.color, cursor: colors.color }
    })
    const fit = new FitAddon()
    terminal.loadAddon(fit)
    terminal.open(container)
    const clearTerminal = () => {
      if (!terminalClosed) {
        terminalClosed = true
        terminal.dispose()
        container.replaceChildren()
      }
    }
    const fail = () => {
      if (disposed || ended) {
        return
      }
      ended = true
      if (!disposed) {
        clearTerminal()
        setStatus('failed')
      }
      void window.api.sandboxes.closeCredentials(sessionId).catch(() => {
        /* Owner teardown is a second cleanup path. */
      })
    }
    const dimensions = () => ({
      cols: Math.max(20, Math.min(300, terminal.cols)),
      rows: Math.max(5, Math.min(100, terminal.rows))
    })
    const resize = () => {
      if (terminalClosed) {
        return
      }
      fit.fit()
      if (started && !ended) {
        void window.api.sandboxes.resizeCredentials({ sessionId, ...dimensions() }).catch(fail)
      }
    }
    const observer = new ResizeObserver(resize)
    observer.observe(container)
    fit.fit()
    const unsubscribe = window.api.sandboxes.onCredentialEvent((event) => {
      if (disposed || ended || event.sessionId !== sessionId) {
        return
      }
      if (event.type === 'data') {
        terminal.write(event.data)
      } else {
        ended = true
        clearTerminal()
        setStatus(event.result)
      }
    })
    const input = terminal.onData((data) => {
      if (started && !ended) {
        void window.api.sandboxes.writeCredentials({ sessionId, data }).catch(fail)
      }
    })
    void Promise.resolve()
      .then(async () => {
        if (disposed) {
          return
        }
        await window.api.sandboxes.startCredentials({
          sessionId,
          target: { name: target.name, id: target.id },
          ...dimensions()
        })
        started = true
        if (!disposed && !ended) {
          terminal.options.disableStdin = false
          setStatus('active')
          resize()
        }
      })
      .catch(fail)
    return () => {
      disposed = true
      observer.disconnect()
      input.dispose()
      unsubscribe()
      clearTerminal()
      void window.api.sandboxes.closeCredentials(sessionId).catch(() => {
        /* Owner teardown also closes the PTY. */
      })
    }
  }, [sessionId, target.name, target.id])
  return { containerRef, status }
}
