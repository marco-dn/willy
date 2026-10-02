// Keep transport policy in the sandbox home, outside mounted repository metadata.
export const sandboxGithubHttpsScript = `git config --global --replace-all url.https://github.com/.insteadOf 'git@github.com:' '^git@github[.]com:$'
git config --global --replace-all url.https://github.com/.insteadOf 'ssh://git@github.com/' '^ssh://git@github[.]com/$'
git config --global --replace-all url.https://github.com/.insteadOf 'ssh://git@github.com:22/' '^ssh://git@github[.]com:22/$'
`
