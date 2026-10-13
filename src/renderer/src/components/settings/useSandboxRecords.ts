import { useCallback, useEffect, useRef, useState } from 'react'
import type { ManagedSandbox } from '../../../../shared/sandbox-provisioning-types'

export function useSandboxRecords(revision: number, onInventoryChange: () => void) {
  const [records, setRecords] = useState<ManagedSandbox[]>([])
  const [error, setError] = useState<string>()
  const [loaded, setLoaded] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const signature = useRef<string | undefined>(undefined)
  const reload = useCallback(() => setRefresh((value) => value + 1), [])
  useEffect(() => {
    let stopped = false
    let inFlight = false
    const poll = async () => {
      if (stopped || inFlight) {
        return
      }
      inFlight = true
      try {
        const next = await window.api.sandboxes.listManaged()
        if (!stopped) {
          const nextSignature = JSON.stringify(
            next.map(({ name, sandboxId, status, lifecycle }) => ({
              name,
              sandboxId,
              status,
              lifecycle
            }))
          )
          if (signature.current !== undefined && signature.current !== nextSignature) {
            onInventoryChange()
          }
          signature.current = nextSignature
          setRecords(next)
          setLoaded(true)
          setError(undefined)
        }
      } catch (error) {
        if (!stopped) {
          setError(String(error))
          setLoaded(false)
        }
      } finally {
        inFlight = false
      }
    }
    void poll()
    const timer = setInterval(() => {
      void poll()
    }, 2000)
    const unsubscribe = window.api.repos.onChanged(reload)
    return () => {
      stopped = true
      clearInterval(timer)
      unsubscribe()
    }
  }, [refresh, revision, onInventoryChange, reload])
  return { records, setRecords, error, loaded, reload }
}
