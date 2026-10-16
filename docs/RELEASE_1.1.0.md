# MDViewer 1.1.0 release handoff

This is the working plan for the first release intended for users. The repository has older tags, including `v1.0.4`, but there is no installed user base. **Do not add upgrade or migration instructions from v1.0.4.** Pushing `v1.1.0` starts the public release workflow, so keep the tag unpushed until signing and install checks are complete.

## Current state (2026-10-16)

| Item | State |
| --- | --- |
| Repository | `lambda-house/mdviewer-mj`; `main` is the release branch |
| Baseline before this document update | `9c9f9da`, with a clean working tree |
| Version | `1.1.0` in `package.json`, `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml` |
| Production bundle ID | `cc.lambdahouse.mdviewer`; the user confirmed control of `lambdahouse.cc` |
| Release notes | `CHANGELOG.md` and the 1.1.0 body in `.github/workflows/release.yml` |
| Updater key | Local private key/password and configured public key match; a local signing probe passed. Both GitHub Actions updater secrets are set |
| Build | [Four-target manual Release workflow passed](https://github.com/lambda-house/mdviewer-mj/actions/runs/38893084953) at `1978097`; [CI passed](https://github.com/lambda-house/mdviewer-mj/actions/runs/38893606077) at `9c9f9da` |
| Packages inspected | macOS DMG and updater archive/signature, Windows MSI and NSIS/signatures, Linux DEB/RPM/AppImage/signatures were present in manual workflow artifacts. The macOS updater archive reports the production bundle ID |
| Installer signing | No Developer ID identity was installed on the current Mac; no `APPLE_*` or `AZURE_*` repository secrets were set at the last check. The manual installers are therefore unsigned |
| Public release | `v1.1.0` has **not** been tagged or published; `v1.0.4` remains the latest published tag |

The last workflow change at `9c9f9da` narrows which macOS updater archive is retained as a manual-run artifact; it does not change packaging. The successful four-target run above used the preceding commit. Check current status again before acting:

```bash
git status --short
git log -1 --oneline
gh secret list --repo lambda-house/mdviewer-mj
gh run list --repo lambda-house/mdviewer-mj --branch main --limit 5
```

The private updater key is under `~/.tauri/` on the current Mac. Do not commit it, put its contents in this document, or print it in logs. `gh secret list` shows secret names and timestamps, not values.

## 1. Settle the legal publisher and accounts

The remaining user decision is whether the signatures and store accounts belong to **Lambda House as a registered legal organization** or to the user **as an individual**. Also establish whether Apple Developer Program and Azure accounts already exist. Domain control is confirmed, but it does not establish the legal signing identity.

| Channel | Registration or account | Who must provide it |
| --- | --- | --- |
| Direct macOS downloads | [Apple Developer Program](https://developer.apple.com/help/account/membership/program-enrollment/) membership and Developer ID Application certificate | Legal publisher/account holder |
| Direct Windows downloads | [Azure Artifact Signing](https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart) Public Trust profile, or a publicly trusted code-signing certificate | Legal publisher/account holder |
| Direct Linux downloads | No signing account for the current DEB/RPM/AppImage plan | None |
| GitHub Release and updater | Existing GitHub repository and updater key | Already configured |
| Mac App Store, later | Same Apple membership plus App Store Connect listing and a separate sandboxed build | Legal publisher/account holder |
| Microsoft Store, later | [Partner Center developer account](https://learn.microsoft.com/en-us/windows/apps/publish/faq/open-developer-account) and listing | Legal publisher/account holder |
| Flathub, later | Flathub submission and app-ID/domain verification | Publisher |
| Homebrew and winget, later | Existing GitHub account for manifest submissions; package-manager accounts/maintainership as required | Publisher or maintainer |

For an Apple organization enrollment, gather legal entity details, D-U-N-S number, work-domain email, public website, and a person authorized to bind the organization. Individual enrollment displays the individual's legal name. Azure Public Trust eligibility depends on publisher type and region; the current plan assumes an eligible organization in the EU. Microsoft currently limits individual Public Trust enrollment to the US and Canada. If the publisher is an ineligible individual, choose a conventional publicly trusted code-signing provider and change the Windows CI signing command before tagging.

## 2. Preserve updater signing access

- [x] `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` are GitHub Actions secrets.
- [x] The public key in `src-tauri/tauri.conf.json` matches the local private key; a local signing probe passed.
- [ ] Make a secure backup of both the private key and password outside this Mac and outside GitHub. Record who controls the backup. A lost key prevents installed versions from verifying future updates.
- [ ] After a public release, check that `latest.json` contains the correct URL and signature for `darwin-aarch64`, `darwin-x86_64`, `windows-x86_64`, and `linux-x86_64`.

The successful manual run produced updater signatures, but it did **not** exercise the tag-only `updater-manifest` job or publish `latest.json`.

## 3. Set up macOS Developer ID signing and notarization

1. [ ] Enroll or confirm the publisher's Apple Developer Program membership. Record the Team ID and the Apple Account used for notarization.
2. [ ] Register `cc.lambdahouse.mdviewer` under Certificates, Identifiers & Profiles if needed for the chosen distribution path.
3. [ ] Create a [Developer ID Application certificate](https://developer.apple.com/help/account/certificates/create-developer-id-certificates/) with its private key. Export a password-protected `.p12` and record the exact signing identity.
4. [ ] Create an app-specific Apple Account password for [notarization](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution).
5. [ ] Set GitHub Actions secrets `APPLE_CERTIFICATE` (base64-encoded `.p12`), `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD`, and `APPLE_TEAM_ID`. Use `gh secret set NAME --repo lambda-house/mdviewer-mj` or the repository Settings UI; do not echo values to logs.
6. [ ] Run the manual Release workflow and inspect **both** macOS architectures. Verify code signature, notarization/stapling, and launch from a downloaded DMG on a clean Mac. Example checks on the installed app: `codesign --verify --deep --strict --verbose=2 /Applications/MDViewer.app`, `spctl -a -vv /Applications/MDViewer.app`, and `xcrun stapler validate /Applications/MDViewer.app` where applicable.

The workflow exports the `APPLE_*` values to Tauri during packaging. This path has not been tested with a real certificate; fix any signing or notarization failure before tagging.

## 4. Set up Windows installer signing

1. [ ] If the legal publisher is eligible, create an Azure subscription, finish [Artifact Signing identity validation](https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart), and create an account with a **Public Trust** certificate profile.
2. [ ] Create an Azure app registration/service principal, assign its [certificate profile signer role](https://learn.microsoft.com/en-us/azure/artifact-signing/concept-resources-roles), and obtain its tenant/client IDs and client secret.
3. [ ] Set `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `AZURE_TENANT_ID`, `AZURE_SIGNING_ENDPOINT`, `AZURE_SIGNING_ACCOUNT`, and `AZURE_SIGNING_PROFILE` as GitHub Actions secrets.
4. [ ] Run the manual Release workflow. Inspect both the MSI and NSIS installer signature with `Get-AuthenticodeSignature` on Windows, then install and launch each package on a clean Windows x64 machine.
5. [ ] If Artifact Signing is unavailable for the chosen publisher, acquire a publicly trusted code-signing certificate and replace the workflow's `trusted-signing-cli` `signCommand` path. Then repeat the Windows checks.

The Azure signing branch in `.github/workflows/release.yml` has not run with real credentials. Treat a green unsigned Windows build as a packaging check only.

## 5. Verify install behavior on all platforms

Run the manual workflow from `main` after signing secrets are present (`gh workflow run release.yml --repo lambda-house/mdviewer-mj --ref main`). Download the four artifacts from its run page. The workflow clears cached bundle output before packaging so stale packages cannot enter a release.

For each OS and installer type, record pass/fail and the machine or VM used:

- [ ] Install and launch the application; confirm version 1.1.0 and expected app identity.
- [ ] Open a folder with nested Markdown and unrelated folders. Only directories containing supported Markdown files should appear in the Files view.
- [ ] Use the Files/Agents filter for files inside an opened folder. Expand, hide, and restore the separate Global agent files root.
- [ ] Open `.md` and `.markdown` files from Finder, Explorer, or a Linux file manager with the app closed and while it is already running.
- [ ] Check that the installer **registers** MDViewer as a Markdown handler. An OS can preserve an existing user-selected default; Windows 11 requires user choice in its default-app UI, so do not claim the installer forcibly changes that choice.
- [ ] Check File menu actions, toolbar tooltips, Help links, folder picker feedback, and the workspace control.
- [ ] Check update package and `.sig` files are paired correctly. The manual artifacts include signatures; OS installer signing is a separate check.
- [ ] On Linux, check DEB, RPM, and AppImage on suitable test systems. There is no separate Linux signing account for these direct downloads.

The local macOS DMG build passed, and its app metadata declared `cc.lambdahouse.mdviewer`, `.md`, and `.markdown`. Manual clean-install UI checks on Windows and Linux are still outstanding.

## 6. Publish v1.1.0 only after the checks pass

1. [ ] Confirm `main` is clean and CI green; review `CHANGELOG.md`, version fields, and the hard-coded 1.1.0 release body in `.github/workflows/release.yml`.
2. [ ] Confirm all updater, Apple, and Windows signing secrets exist and a **signed** manual workflow run and install checks passed.
3. [ ] Decide to publish. Pushing the tag starts the public release workflow:

   ```bash
   git tag v1.1.0
   git push origin v1.1.0
   ```

4. [ ] Watch the release workflow. Its `release-readiness` job checks all required secrets before packaging. Tauri creates a **draft** release; the `updater-manifest` job publishes it only after all four build jobs pass and `latest.json` is uploaded. This tagged path has not yet run end to end.
5. [ ] Inspect the published [GitHub Release](https://github.com/lambda-house/mdviewer-mj/releases): two macOS DMGs, Windows MSI and NSIS, Linux DEB/RPM/AppImage, updater packages/signatures, and `latest.json`. Open `latest.json` and verify its four platforms and asset URLs. If the workflow fails, keep the release draft and repair the failure before publishing.
6. [ ] Download the public installers and perform a final smoke test. Test the update path with a later version before promising automatic updates to users.

## 7. Expand distribution after the direct release

These are follow-on projects, not prerequisites for the first signed GitHub release:

1. **Homebrew:** create a Lambda House tap/cask, then submit to the main cask repository after notarized downloads are stable.
2. **winget:** submit a manifest pointing at the signed Windows installer and automate version/hash updates.
3. **Flathub:** prepare an offline Flatpak build, desktop/MetaInfo files, sandbox and portal access, and verify `cc.lambdahouse.mdviewer` through `lambdahouse.cc`.
4. **Mac App Store:** make a separate sandboxed build, test file access and agent-file permissions, then create an App Store Connect listing and submit for review.
5. **Microsoft Store:** create a Partner Center listing and prepare its chosen Win32 or MSIX submission/update model.

See [DISTRIBUTION.md](DISTRIBUTION.md) for the broader channel roadmap. Do not assume the direct-download bundles can be submitted unchanged to either app store.
