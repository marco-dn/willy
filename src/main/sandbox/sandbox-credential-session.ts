import { z } from 'zod'
import type { IPty } from 'node-pty'
import type { SandboxCredentialEvent } from '../../shared/sandbox-policy-types'
import type { SandboxAccess } from './sandbox-command'
import { sandboxTargetSchema } from './sandbox-policy-response'

type CredentialPty = Pick<IPty, 'onData' | 'onExit' | 'write' | 'resize' | 'kill'>
export type CredentialOwner = {
  id: number
  send: (event: SandboxCredentialEvent) => void
  onDispose: (callback: () => void) => () => void
}
type Dependencies = {
  acquire: (target: unknown) => Promise<SandboxAccess>
  spawn: (
    name: string,
    cols: number,
    rows: number
  ) => Promise<{ process: CredentialPty; reportsChildExitStatus: boolean }>
}
const sizeSchema = z.object({
  cols: z.number().int().min(20).max(300),
  rows: z.number().int().min(5).max(100)
})
const startSchema = sizeSchema
  .extend({ sessionId: z.string().uuid(), target: sandboxTargetSchema })
  .strict()
const inputSchema = z.object({ sessionId: z.string().uuid(), data: z.string().max(8192) }).strict()
const resizeSchema = sizeSchema.extend({ sessionId: z.string().uuid() }).strict()
type Session = {
  owner: CredentialOwner
  cancelled: boolean
  process?: CredentialPty
  release?: () => void
  disposeOwner?: () => void
  listeners: { dispose: () => void }[]
  timer?: ReturnType<typeof setTimeout>
  forceTimer?: ReturnType<typeof setTimeout>
}

// Credential bytes only pass between the PTY and its owning renderer; no replay buffer or session store.
export class SandboxCredentialSessions {
  private sessions = new Map<string, Session>()
  constructor(private dependencies: Dependencies) {}
  async start(owner: CredentialOwner, input: unknown): Promise<void> {
    const request = startSchema.parse(input)
    if (
      this.sessions.has(request.sessionId) ||
      [...this.sessions.values()].some((session) => session.owner.id === owner.id)
    ) {
      throw new Error('Close the existing credential prompt first.')
    }
    const session: Session = { owner, cancelled: false, listeners: [] }
    this.sessions.set(request.sessionId, session)
    session.disposeOwner = owner.onDispose(() => this.close(owner.id, request.sessionId))
    try {
      const access = await this.dependencies.acquire(request.target)
      session.release = access.release
      if (session.cancelled) {
        this.finish(request.sessionId, 'cancelled')
        return
      }
      const spawned = await this.dependencies.spawn(request.target.name, request.cols, request.rows)
      session.process = spawned.process
      session.listeners.push(
        spawned.process.onData((data) => {
          if (!session.cancelled) {
            owner.send({ sessionId: request.sessionId, type: 'data', data: data.slice(0, 65536) })
          }
        })
      )
      session.listeners.push(
        spawned.process.onExit(({ exitCode, signal }) => {
          this.finish(
            request.sessionId,
            session.cancelled || exitCode === 130 || signal === 2
              ? 'cancelled'
              : spawned.reportsChildExitStatus && exitCode === 0
                ? 'completed'
                : 'failed'
          )
        })
      )
      session.timer = setTimeout(() => this.close(owner.id, request.sessionId), 15 * 60_000)
      if (session.cancelled) {
        this.close(owner.id, request.sessionId)
      }
    } catch {
      this.finish(request.sessionId, session.cancelled ? 'cancelled' : 'failed')
      throw new Error(
        'Could not open the private sbx prompt. Check sbx availability and finish other sandbox operations first.'
      )
    }
  }
  write(ownerId: number, input: unknown): void {
    const request = inputSchema.parse(input)
    const session = this.owned(ownerId, request.sessionId)
    if (!session.cancelled) {
      session.process?.write(request.data)
    }
  }
  resize(ownerId: number, input: unknown): void {
    const request = resizeSchema.parse(input)
    this.owned(ownerId, request.sessionId).process?.resize(request.cols, request.rows)
  }
  close(ownerId: number, sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (!session || session.owner.id !== ownerId) {
      return
    }
    session.cancelled = true
    if (session.process && !session.forceTimer) {
      session.forceTimer = setTimeout(() => {
        try {
          session.process?.kill('SIGKILL')
        } catch {
          /* Keep the lease until the PTY reports exit. */
        }
      }, 1000)
      try {
        session.process.kill()
      } catch {
        /* The forced kill is already scheduled. */
      }
    }
  }
  private owned(ownerId: number, sessionId: string): Session {
    const session = this.sessions.get(sessionId)
    if (!session || session.owner.id !== ownerId) {
      throw new Error('Credential prompt is unavailable.')
    }
    return session
  }
  private finish(sessionId: string, result: 'completed' | 'cancelled' | 'failed'): void {
    const session = this.sessions.get(sessionId)
    if (!session) {
      return
    }
    this.sessions.delete(sessionId)
    clearTimeout(session.timer)
    clearTimeout(session.forceTimer)
    for (const listener of session.listeners) {
      listener.dispose()
    }
    session.disposeOwner?.()
    session.release?.()
    session.owner.send({ sessionId, type: 'exit', result })
  }
}
