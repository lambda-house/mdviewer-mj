# MDViewer 1.1.0 release handoff

This is the working plan for the first release intended for users. The repository has older tags, including `v1.0.4`, but there is no installed user base. **Do not add upgrade or migration instructions from v1.0.4.** Pushing `v1.1.0` starts the public release workflow, so keep the tag unpushed until the checks below are complete.

## Current state (2026-10-17)

| Item | State |
| --- | --- |
| Repository | `lambda-house/mdviewer-mj`; `main` is the release branch |
| Publisher | **Decided 2026-10-17:** the maintainer as an individual. No Apple Developer Program or Azure account existed at that point |
| Plan for 1.1.0 | **Decided 2026-10-17:** release without paid signing. macOS is ad-hoc signed (users click **Open Anyway** once), Windows is unsigned (SmartScreen "Run anyway"). Apple signing follows in a 1.1.x release; the in-app updater checks its own signature, so users don't reinstall |
| Version | `1.1.0` in `package.json`, `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml` |
| Production bundle ID | `cc.lambdahouse.mdviewer`; the user confirmed control of `lambdahouse.cc` |
| Release notes | `CHANGELOG.md` and the 1.1.0 body in `.github/workflows/release.yml` |
| Updater key | Local private key/password and configured public key match; a local signing probe passed. Both GitHub Actions updater secrets are set. Not yet backed up outside this Mac |
| Build | [Manual Release run 39019722096](https://github.com/lambda-house/mdviewer-mj/actions/runs/39019722096) passed with the ad-hoc macOS signing. Its arm64 app passes `codesign --verify --deep --strict` (ad-hoc, hardened runtime, sealed resources) and launches; `spctl` rejects it as expected without notarization |
| Package channels | AUR registration paused (2026-10-17), so `mdviewer-bin` waits for an account. Created 2026-10-17: [lambda-house/homebrew-tap](https://github.com/lambda-house/homebrew-tap) and [lambda-house/mdviewer-packages](https://github.com/lambda-house/mdviewer-packages) (GitHub Pages on), each with a write deploy key for the release workflow. The `homebrew`, `linux-repo` and `aur` jobs run after a tagged release is published |
| Package checks | Locally with the real packages: the generated cask passes `brew style`; the apt/dnf repository built by `packaging/linux-repo/build.sh` verifies in Ubuntu 24.04 (`InRelease`) and Fedora 42 (`repo_gpgcheck`, `rpm -K`); `mdviewer-bin` builds with `makepkg` and passes `namcap` |
| Public release | `v1.1.0` has **not** been tagged or published; `v1.0.4` remains the latest published tag |

Check current status again before acting:

```bash
git status --short
git log -1 --oneline
gh secret list --repo lambda-house/mdviewer-mj
gh run list --repo lambda-house/mdviewer-mj --branch main --limit 5
```

## Keys

| Key | Where | Backup needed |
| --- | --- | --- |
| Updater (minisign) private key and password | `~/.tauri/` on the current Mac; GitHub secrets `TAURI_SIGNING_PRIVATE_KEY`, `_PASSWORD` | **Yes.** Losing it means installed copies can never update |
| Package signing GPG key, RSA 4096, no passphrase, fingerprint `CF6514F8FF85FCB383F24C14D7A16159C913520B` | `~/.mdviewer-keys/packages-gpg-private.asc` (+ public key, revocation certificate, and a dedicated keyring in `~/.mdviewer-keys/gnupg`); GitHub secret `PACKAGES_GPG_PRIVATE_KEY` | **Yes**, with the revocation certificate. apt/dnf users trust this fingerprint |
| Deploy keys for homebrew-tap and mdviewer-packages | GitHub secrets `HOMEBREW_TAP_DEPLOY_KEY`, `PACKAGES_DEPLOY_KEY` (only the `.pub` files remain in `~/.mdviewer-keys/`) | No; replace by adding a new deploy key |
| AUR SSH key | `~/.mdviewer-keys/aur_ed25519`; GitHub secret `AUR_SSH_PRIVATE_KEY` | No; replace it on the AUR account |

Never commit these files, put their contents in documents, or print them in logs. `gh secret list` shows names and timestamps, not values.

## 1. Before tagging

1. [x] Package channel secrets set 2026-10-17: `HOMEBREW_TAP_DEPLOY_KEY`, `PACKAGES_DEPLOY_KEY`, `PACKAGES_GPG_PRIVATE_KEY`, `AUR_SSH_PRIVATE_KEY`. The local deploy-key private files were deleted afterwards.
2. [ ] **Not a blocker.** AUR registration was paused on 2026-10-17 ("a wave of automated account creation"). When it reopens, register on [aur.archlinux.org](https://aur.archlinux.org/register) (has a CAPTCHA) and add `~/.mdviewer-keys/aur_ed25519.pub` under My Account → SSH Public Key. Until then the `aur` job skips with a notice. After registering, publish the current version by re-running the `aur` job of the latest release run, and add the AUR back to the README install list and the release body.
3. [ ] Back up the updater key with its password, and the GPG key with its revocation certificate, outside this Mac and outside GitHub (for example a password manager). Record who controls the backup.
4. [ ] Install checks on each platform from the manual run's artifacts (section 3). The macOS arm64 build was checked by signature and launch only.

## 2. Publish v1.1.0

1. [ ] Confirm `main` is clean and CI green; review `CHANGELOG.md`, the version fields, and the 1.1.0 release body in `.github/workflows/release.yml`.
2. [ ] Decide to publish. Pushing the tag starts the public release workflow:

   ```bash
   git tag v1.1.0
   git push origin v1.1.0
   ```

3. [ ] Watch the workflow. `release-readiness` requires only the updater key. Tauri creates a **draft** release; `updater-manifest` uploads `latest.json` and `SHA256SUMS`, attests every file, and only then publishes. The `homebrew`, `linux-repo` and `aur` jobs follow; their failure leaves the release published. This tagged path has not run end to end yet.
4. [ ] Inspect the [GitHub Release](https://github.com/lambda-house/mdviewer-mj/releases): two macOS DMGs, Windows MSI and NSIS, Linux DEB/RPM/AppImage, updater packages/signatures, `latest.json` (four platforms with correct URLs) and `SHA256SUMS`. `gh attestation verify <file> --repo lambda-house/mdviewer-mj` should pass for a downloaded file.
5. [ ] Check the channels: `brew install --cask lambda-house/tap/mdviewer`; the apt and dnf instructions on [the packages site](https://lambda-house.github.io/mdviewer-packages/). The `aur` job should end with its "not accepted yet" notice.
6. [ ] Submit winget: a PR to `microsoft/winget-pkgs` for `LambdaHouse.MDViewer` pointing at the NSIS installer (manifests can be written by hand or with `wingetcreate`). Unsigned installers are accepted. Automating later versions needs a GitHub token with `public_repo` for a fork of winget-pkgs (e.g. `vedantmgoyal9/winget-releaser`).
7. [ ] Test the update path with a later version before promising automatic updates to users.

## 3. Install checks

Run the manual workflow from `main` (`gh workflow run release.yml --repo lambda-house/mdviewer-mj --ref main`) and download the four artifacts from its run page. The workflow clears cached bundle output before packaging so stale packages cannot enter a release.

For each OS and installer type, record pass/fail and the machine or VM used:

- [ ] Install and launch the application; confirm version 1.1.0. On macOS, a downloaded DMG's app opens after **Open Anyway** (not "damaged"); on Windows, SmartScreen offers "Run anyway".
- [ ] Open a folder with nested Markdown and unrelated folders. Only directories containing supported Markdown files should appear in the Files view.
- [ ] Use the Files/Agents filter for files inside an opened folder. Expand, hide, and restore the separate Global agent files root.
- [ ] Open `.md` and `.markdown` files from Finder, Explorer, or a Linux file manager with the app closed and while it is already running.
- [ ] Check that the installer **registers** MDViewer as a Markdown handler. An OS can preserve an existing user-selected default; Windows 11 requires user choice in its default-app UI, so do not claim the installer forcibly changes that choice.
- [ ] Check File menu actions, toolbar tooltips, Help links, folder picker feedback, and the workspace control.
- [ ] On Linux, check DEB, RPM, and AppImage on suitable test systems.

## 4. macOS Developer ID signing and notarization (1.1.x)

Needs the individual Apple Developer Program membership ($99/year): an Apple Account with two-factor authentication, the legal name as on government ID; no D-U-N-S number. Enrollment, identity verification and payment are done by the account holder.

1. [ ] Enroll in the Apple Developer Program as an individual. Record the Team ID and the Apple Account used for notarization.
2. [ ] Create a [Developer ID Application certificate](https://developer.apple.com/help/account/certificates/create-developer-id-certificates/) with its private key. Export a password-protected `.p12` and record the exact signing identity.
3. [ ] Create an app-specific Apple Account password for [notarization](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution).
4. [ ] Set the secrets `APPLE_CERTIFICATE` (base64-encoded `.p12`), `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD`, and `APPLE_TEAM_ID`.
5. [ ] Run the manual Release workflow and inspect **both** macOS architectures: `codesign --verify --deep --strict --verbose=2`, `spctl -a -vv` (`source=Notarized Developer ID`) and `xcrun stapler validate` on the installed app, launched from a downloaded DMG.
6. [ ] Add the `APPLE_*` secrets back to the `release-readiness` check, remove the "Open Anyway" notes from the release body, README and cask caveats, and submit the cask to `homebrew/cask`.

The workflow exports the `APPLE_*` values to Tauri during packaging; this path has not been tested with a real certificate.

## 5. Windows installer signing (later)

Azure Artifact Signing serves individuals only in the US and Canada, so an individual elsewhere needs an individual-validated certificate with the key in a cloud HSM (for example SSL.com eSigner), signed from CI through a `signCommand` in place of the workflow's `trusted-signing-cli` one. Alternatively the Microsoft Store (free for individuals) signs MSIX packages itself; see [DISTRIBUTION.md](DISTRIBUTION.md). Once signing works, add its secrets to the `release-readiness` check and check both installers with `Get-AuthenticodeSignature` on a clean Windows x64 machine.

## 6. Further distribution

1. **Flathub:** prepare an offline Flatpak build, desktop/MetaInfo files, sandbox and portal access, and verify `cc.lambdahouse.mdviewer` through `lambdahouse.cc`.
2. **Microsoft Store:** Partner Center listing; MSIX (Store-signed) or the Win32 installer once it's signed.
3. **Mac App Store:** a separate sandboxed build, then an App Store Connect listing.

See [DISTRIBUTION.md](DISTRIBUTION.md) for the broader channel roadmap. Do not assume the direct-download bundles can be submitted unchanged to either app store.
