# Publishing Minds

Minds is published as `minds-cli`, with the executable named `minds`.
Users need Bun and a logged-in Codex CLI. Node and npm are used by the
maintainer and the release workflow for publishing.

## First npm release

1. Create an account at https://www.npmjs.com, verify your email, and enable
   two-factor authentication. Install a current Node.js LTS release and npm.
2. Commit and push the release workflow and package changes to
   `0xmiki/minds-cli` on GitHub. Do not create a new version tag yet.
3. From a clean checkout, prepare and inspect the first package:

   ```bash
   bun ci
   bun run typecheck
   bun run test
   bun run build
   bun pm pack --filename minds-cli.tgz
   npm publish ./minds-cli.tgz --access public --dry-run
   ```

   Check that the archive contains `dist/index.js`, `dist/app.js`, and the
   bundled `minds/*/mind.json` files. Keep the package and CLI versions in sync
   and use a version that has not already been published.
4. Log in and publish that exact archive. Complete the browser and 2FA prompts:

   ```bash
   npm login
   npm whoami
   npm publish ./minds-cli.tgz --access public
   ```

   This first manual publication creates the package whose settings you
   configure below.
5. On npm, open **minds-cli → Settings → Trusted publishing**, add a GitHub
   Actions publisher, and enter:

   | Field | Value |
   | --- | --- |
   | Organization or user | `0xmiki` |
   | Repository | `minds-cli` |
   | Workflow filename | `release.yml` |
   | Environment | Leave empty |

   Allow direct publishing with `npm publish` if the settings offer an
   allowed-actions choice. No `NPM_TOKEN` secret is needed in GitHub.
6. Verify the public installation:

   ```bash
   bun add -g minds-cli
   minds --version
   minds doctor
   minds
   ```

## Subsequent releases

Update the version in both `package.json` and `src/version.ts`. Refresh the
Bun lockfile with `bun install --lockfile-only` if needed. Commit the changes,
then push the commit and its matching tag. For example, after updating both
versions to `0.5.1`:

```bash
git add package.json src/version.ts bun.lock
git commit -m "Release 0.5.1"
git push origin main
git tag v0.5.1
git push origin v0.5.1
```

The `Release` workflow checks versions, runs tests, builds the package, installs
the archive into a temporary project, publishes that archive to npm, and
attaches it and its checksum to a GitHub Release. Normal branch pushes do not
publish anything.

Stable tags publish to npm's `latest` channel. Versions containing a hyphen,
such as `0.6.0-beta.1`, publish to `next` and create a GitHub prerelease.

Each npm version can be published only once. Do not tag the manually published
first version expecting the workflow to publish it again. If npm succeeds but
the GitHub Release step fails, create the GitHub Release separately rather than
rerunning npm publication. Use a new version for package changes.

The workflow uses GitHub OIDC authentication and npm 11 with Node 24. Public
packages published from public repositories this way receive provenance
automatically. The repository URL in `package.json` must match the trusted
publisher repository.

Sources: [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/)
and [publishing public packages](https://docs.npmjs.com/creating-and-publishing-unscoped-public-packages/).
