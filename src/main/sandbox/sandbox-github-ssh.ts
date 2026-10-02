export const sandboxGithubSshScript = String.raw`python3 - <<'WILLY_GITHUB_SSH'
from pathlib import Path
import re

directory = Path.home() / '.ssh'
directory.mkdir(mode=0o700, exist_ok=True)
directory.chmod(0o700)
config = directory / 'config'
content = config.read_text() if config.exists() else ''
begin = '# BEGIN Willy GitHub SSH'
end = '# END Willy GitHub SSH'
content = re.sub(re.escape(begin) + r'\n.*?' + re.escape(end) + r'\n?', '', content, flags=re.S)
# OpenSSH uses the first value; reset Host scope before the existing config.
block = '\n'.join([begin, 'Host github.com', '    HostName ssh.github.com',
                   '    User git', '    Port 443', 'Host *', end, ''])
config.write_text(block + content)
config.chmod(0o600)
WILLY_GITHUB_SSH
`
