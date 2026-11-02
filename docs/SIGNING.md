# Signing

Kento signs its updates from the first release, and the Mac app is code-signed with the project's
own certificate. Windows code signing (Authenticode) is not in place, because certificates cost
money and the project uses only free tools (SPEC 8). How a release is made is in
[RELEASING.md](RELEASING.md).

## What users see today

The installer, `Kento.exe` and `kento.com` are not code-signed, so Windows SmartScreen may stop
the first start with "Windows protected your PC". Choose **More info → Run anyway**. The warning
comes from missing reputation, not from anything found in the file, and each new version starts
without reputation again.

On macOS the equivalent is **System Settings → Privacy & Security → Open Anyway** (see "macOS"
below).

Every release lists the SHA-256 of each file in `SHA256SUMS.txt`. To compare a download in
PowerShell:

```powershell
Get-FileHash .\Kento-Windows-x64-Setup.exe -Algorithm SHA256
```

On a Mac: `shasum -a 256 Kento-macOS-Universal.dmg`.

## Update signatures

The updater installs only packages signed with the project's update key (SPEC 5.16, ARCHITECTURE
decision 46).

- The key pair was made on 2026-11-02 with `tauri signer generate` (Tauri CLI 2.12.4), without a
  password. The public key is in `src-tauri/tauri.conf.json` (`plugins.updater.pubkey`).
- The private key exists only in the repository's GitHub Secrets, as `TAURI_SIGNING_PRIVATE_KEY`
  (the text of the key file, not its path), and in the owner's offline backup, for example a
  password manager. It is never committed. To store it: `gh secret set TAURI_SIGNING_PRIVATE_KEY <
  kento-updater.key`. Without a password there is no `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` secret;
  the workflow passes an empty one.
- `release.yml` stops before building when the secret is missing. `tauri build` signs the installer
  and the Mac update archive with it, and the workflow signs the portable ZIP with the same key for
  its version (`tauri signer sign --app-version`), so the portable copy can update itself. The
  signatures go into `latest.json`; no `.sig` file appears on the release page.
- Every update signature carries the version it was made for, and the app refuses one whose
  version differs from what `latest.json` announces (`requireSignedVersion`), so an altered
  `latest.json` cannot offer an older signed release as a new one.
- If the private key is lost, installed copies cannot accept updates signed with a new key: users
  have to install the next version by hand once.
- Every action the workflows use is pinned to a commit, with its release in a comment, so a moved
  or taken-over tag cannot alter a step that runs while this key or the Mac certificate is in
  reach. Nothing updates the pins by itself: for a new release of an action, look up its tag's
  commit (`gh api repos/<owner>/<repo>/git/ref/tags/<tag>`, then `git/tags/<sha>` when the tag is
  annotated) and change the SHA and the comment together.
- To replace the key: make a new pair, ship one release signed with the old key that carries the
  new public key, then switch the secret to the new private key.

## Free code signing through SignPath Foundation

SignPath Foundation signs open-source projects for free, with certificates it issues itself. Its
conditions (signpath.org/terms) and where Kento stands:

| Condition | Kento |
| --- | --- |
| Every component under an OSI-approved licence, no proprietary parts | MIT; Rust dependencies limited to the allow-list in `src-tauri/deny.toml`, the npm packages that ship checked by `npm run check:licenses`, PDFium under BSD-3-Clause. **To do:** the UnRAR library built into Kento for RAR extraction carries the UnRAR licence, which is not OSI-approved; ask SignPath, or leave RAR extraction out of the signed build. The tools downloaded on request (FFmpeg, LibreOffice, yt-dlp, Deno, ExifTool, ONNX Runtime, the background-removal model) are never shipped |
| No malware, no potentially unwanted programs, no hacking tools | Yes |
| Actively maintained, and already released in the form to be signed | After v1.0.0 is published |
| Functionality described on the download page | README and `website-kit/` |
| Only the team's own binaries, built verifiably from source | `kento.exe`, `kento.com` and the installer are built by `release.yml` on GitHub Actions. `pdfium.dll` is an upstream binary (pdfium-binaries, pinned by SHA-256) and must not be signed; the WebView2 bootstrapper is downloaded by the installer, and the optional tools by Kento on request |
| Data sent to other systems is described in a privacy policy, shown during installation, and can be turned off | Kento goes online for tool downloads and web downloads the user starts, and for update checks, which fetch `latest.json` and send nothing about the user. Updates are mandatory (SPEC 5.16). **To do:** show the privacy note during installation (for example on an installer page), and ask SignPath whether an update check that cannot be turned off is acceptable |
| No system changes without warning; an uninstaller | Start at sign-in, the Explorer context menu and Send To are opt-in in Settings; the installer puts its folder on the user's Path for the `kento` command line, which the release notes say; the uninstaller removes all of them |
| Multi-factor authentication for every team member on GitHub and SignPath | **To do:** confirm MFA on both accounts |
| Code signing roles: authors, reviewers, approvers | **To do:** name them (today all three are Mehmet Burak Taşkaya) |
| A "Code signing policy" section on the home page and on download or release pages | **To do:** add it to the README, the website and the release notes, with the statement "Free code signing provided by SignPath.io, certificate by SignPath Foundation", the roles and a link to the privacy section |
| Artifact configuration: product name equals the project name, the same product version in each build, no upstream binaries signed | **To do** when setting up the SignPath project |
| Manual approval of every signing request | Accepted |

### Steps

1. Publish v1.0.0 and finish the "To do" rows above.
2. Apply at <https://signpath.org/apply>.
3. When accepted, add SignPath's GitHub integration to `release.yml`. The order matters: sign
   `kento.exe` and the command line before they are bundled (Tauri's `bundle.windows.signCommand`
   runs a custom signing command for that, the uninstaller included), sign the installer, and only
   then create the update signatures, because they must cover the final bytes. The portable ZIP
   is made from the signed programs.
4. Keep the SmartScreen note in the README and the release notes until a signed release has been
   out for a while.

## macOS

Apple silicon runs only signed apps. Every Mac build from CI is signed with the project's own
self-signed certificate, the same for every version, so macOS knows each update as the same app
and keeps the Accessibility and Automation permissions given to Kento; an ad-hoc signature would
change with every build. The certificate is not from Apple: the app has no Developer ID and is not
notarized, so macOS 15 and later block its first opening with "Apple could not verify Kento". The
README gives the way through: close the warning (**Done** on macOS 15 and later, **Cancel**
before), then **System Settings → Privacy & Security → Open Anyway** and the password.

The app is signed with the hardened runtime and the entitlements in `src-tauri/Entitlements.plist`:
`com.apple.security.automation.apple-events`, so the selection shortcut may ask Finder for its
selection (macOS asks the user once), and `com.apple.security.cs.disable-library-validation`,
because the bundled PDFium and the ONNX Runtime downloaded for background removal are libraries
not signed with Kento's certificate. The release's smoke test runs the signed app and its command
line, which load PDFium that way.

### The signing certificate

- Made once, on 2026-11-02, with `scripts/mac-signing.sh new kento-macos-signing.p12 10950 Kento`:
  CN Kento, O Mehmet Burak Taşkaya, RSA 3072, valid until 2056-10-25, SHA-1
  `1F:6E:11:35:0E:43:B6:FB:81:94:F4:6A:62:CF:96:21:59:67:F0:8C`. The app's designated requirement,
  which names it, is in `src-tauri/macos-requirement.txt`.
- The `.p12` and its password exist only in the repository's GitHub Secrets and in the owner's
  offline backup, for example a password manager. They are never committed. To store them:
  `base64 -w0 kento-macos-signing.p12 | gh secret set MACOS_CERTIFICATE` and
  `gh secret set MACOS_CERTIFICATE_PASSWORD < kento-macos-signing.password.txt`.
- `release.yml` imports it into a keychain of the run's own (`scripts/mac-signing.sh import`) and
  passes it to `tauri build` as `APPLE_SIGNING_IDENTITY`, which signs the programs, the app and
  the `.dmg`. Tauri's own import (`APPLE_CERTIFICATE`) takes only certificates named like Apple's.
  The release stops if the app's designated requirement differs from `macos-requirement.txt`. A
  build on a Mac without the certificate is signed ad hoc (`signingIdentity` `-` in
  `src-tauri/tauri.macos.conf.json`).
- Nothing on a Mac trusts the certificate, and nothing has to: `security find-identity` lists it
  as `CSSMERR_TP_NOT_TRUSTED`, `codesign` signs with it all the same, and macOS compares only its
  hash when it matches a later build to a permission.
- Replacing the certificate (lost, or before it expires) costs every Mac user the Accessibility
  and Automation permissions once, and nothing else; the update key is the one that must never be
  lost. Make a new one, store it in the secrets, and change `macos-requirement.txt` in the same
  commit.

### Developer ID and notarization

A Developer ID certificate and notarization need the Apple Developer Program (99 USD a year), which
the project does not use for now (SPEC 8). If that changes:

1. Join, create a "Developer ID Application" certificate and export it as a `.p12` file; create an
   app-specific password for the Apple account and note the Team ID.
2. Add the secrets `APPLE_CERTIFICATE` (the `.p12` in base64), `APPLE_CERTIFICATE_PASSWORD`,
   `APPLE_ID`, `APPLE_PASSWORD` (the app-specific password), `APPLE_TEAM_ID` and
   `KEYCHAIN_PASSWORD`.
3. In the macOS job of `release.yml`, import the certificate into a temporary keychain and pass the
   variables to `tauri build`, which then signs and notarizes (its log says when they are missing).
   The hardened runtime and the entitlements are already in place. The first notarization can take
   hours.
4. Put the Developer ID build's designated requirement in `src-tauri/macos-requirement.txt`. It
   differs from the self-signed one, so the update that switches asks users for their permissions
   once more.
