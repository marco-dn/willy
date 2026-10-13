import { z } from 'zod'
import { quotePosixShell } from '../../shared/wsl-login-shell-command'

export const sandboxGitIdentitySchema = z
  .string()
  .trim()
  .min(1)
  .max(256)
  .refine((value) => !/\p{Cc}/u.test(value))

export function sandboxGitIdentityScript(name?: string, email?: string): string {
  if (!name || !email) {
    return ''
  }
  return `git config --global user.name ${quotePosixShell(name)}
git config --global user.email ${quotePosixShell(email)}`
}
