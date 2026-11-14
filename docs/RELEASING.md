# Releasing

A release is a `v*` tag. `.github/workflows/release.yml` builds, tests and signs everything and
leaves a **draft** release; it becomes public only when the owner publishes it, and publishing
turns the older releases back into drafts (SPEC 5.16, 8; ARCHITECTURE decision 46). Keys and
certificates are described in [SIGNING.md](SIGNING.md).

## What a release carries

| File | What it is |
| --- | --- |
| `Kento-Windows-x64-Setup.exe` | The installer people download (per user, no administrator rights) |
| `Kento-Windows-x64-Update.exe` | The same installer under the name updates fetch, so download counts tell the two apart |
| `Kento-Windows-x64-Portable.zip` | `Kento.exe`, `kento.com`, `pdfium\`, `LICENSE.txt`, `THIRD-PARTY-NOTICES.md` |
| `Kento-macOS-Universal.dmg` | The Mac app for Apple silicon and Intel |
| `Kento-macOS-Universal.app.tar.gz` | The archive Mac updates install |
| `latest.json` | What every copy reads to update: version, notes and one signed entry per way Kento is installed |
| `SHA256SUMS.txt` | The SHA-256 of every file above |

The names never change, so `https://github.com/MehmetBurakTaskaya/kento/releases/latest/download/<file>`
always gives the newest one. A failed Mac build leaves a Windows-only release: its notes and
`latest.json` then leave the Mac out.

## Once, before the first release

Set the repository secrets (SIGNING.md has the details): `TAURI_SIGNING_PRIVATE_KEY`,
`MACOS_CERTIFICATE` and `MACOS_CERTIFICATE_PASSWORD`.

```sh
gh secret set TAURI_SIGNING_PRIVATE_KEY < kento-updater.key
base64 -w0 kento-macos-signing.p12 | gh secret set MACOS_CERTIFICATE
gh secret set MACOS_CERTIFICATE_PASSWORD < kento-macos-signing.password.txt
gh secret list
```

## Checklist

### 1. Prepare the version on `main`

- [ ] The version in all three files: `package.json` (with `package-lock.json`:
      `npm version 1.0.0 --no-git-tag-version`), `src-tauri/tauri.conf.json` and the
      `[package]` version in `src-tauri/Cargo.toml` (then `cargo check` in `src-tauri` updates
      `Cargo.lock`). The workflow refuses a tag that differs from any of them.
- [ ] `CHANGELOG.md`: the section `## [1.0.0] - 2026-11-20` with the release date instead of
      `Unreleased`, and its link at the bottom. This section becomes the release notes and what
      Kento shows after updating; the workflow refuses a version without a section.
- [ ] `npm run third-party`, so `THIRD-PARTY-NOTICES.md` and `docs/DEPENDENCIES.md` match the
      dependencies; `npm run check:third-party` passes (the workflow runs it too).
- [ ] Commit, push, and wait for CI to pass on both platforms.

### 2. Tag

```sh
git tag v1.0.0
git push origin v1.0.0
```

### 3. Wait for the draft

Actions → Release. The jobs run one after another:

1. **Windows**: checks the versions, the CHANGELOG section, the notices and the update key; builds
   and signs the installer; starts the portable copy with `--smoke-test` and runs its command
   line; installs the installer silently on the runner, updates it, checks `kento.com`, the
   user's Path and the installed copy's smoke test, uninstalls it and checks what is left; then
   creates the draft release.
2. **macOS** (may fail without stopping the release): signs with the project's certificate, stops
   if the designated requirement differs from `src-tauri/macos-requirement.txt`, checks that every
   program in the bundle is universal and runs on the macOS the bundle claims, runs the signed
   app's smoke test, then adds the `.dmg` and the update archive.
3. **Finish**: writes `latest.json` and `SHA256SUMS.txt` and the final release notes.

A failure the runner caused (a download that timed out, a missing secret) needs only a re-run of
the failed job from the run's page; the jobs after it run again too. A failure in the code needs
a new commit: delete the draft and the tag (`gh release delete v1.0.0 --cleanup-tag`), fix, and
tag again.

### 4. Test the draft

Download the draft's files: `gh release download v1.0.0 --dir kento-1.0.0`.

- [ ] `sha256sum -c SHA256SUMS.txt` in that folder (Git Bash on Windows) prints `OK` for every
      file.
- [ ] The release page lists the seven files above and no `.sig` file.
- [ ] `latest.json`: the new version; the notes are the CHANGELOG section; `windows-x86_64` points
      at `Kento-Windows-x64-Update.exe`, `windows-x86_64-portable` at the ZIP, `darwin-aarch64`
      and `darwin-x86_64` at the app archive; every URL starts with
      `https://github.com/MehmetBurakTaskaya/kento/releases/download/v1.0.0/` (never
      `api.github.com`); every entry has a signature.
- [ ] **Installer**, on a Windows test machine: opening it shows only a progress bar and Kento
      starts by itself; SmartScreen's **More info → Run anyway** works; a new terminal finds
      `kento --version`; Settings → Apps → Kento → Uninstall removes the program, the Start menu
      entry and the Path entry, and keeps `%LOCALAPPDATA%\Kento` unless "Delete the application
      data" is ticked.
- [ ] **Portable ZIP**: unzipped into a folder with Turkish letters in its name, `Kento.exe` starts
      and `kento.com --version` answers there.
- [ ] **DMG**, on a Mac: drag Kento into Applications; the first opening is blocked until
      **System Settings → Privacy & Security → Open Anyway**; the selection shortcut asks once
      for Automation (Finder); `/Applications/Kento.app/Contents/MacOS/kento-cli --version`
      answers.
- [ ] `--smoke-test` on each copy prints the report's path, and the report says
      `"passed": true` with no check skipped that a release needs:
  - installed: `"%LOCALAPPDATA%\Kento\kento.exe" --smoke-test`, report
    `%LOCALAPPDATA%\Kento\smoke-test.json`;
  - portable: `set KENTO_REQUIRE_RELEASE=1` and then `Kento.exe --smoke-test` in its folder, same
    report;
  - Mac: `/Applications/Kento.app/Contents/MacOS/kento --smoke-test`, report
    `~/Library/Application Support/Kento/smoke-test.json`.
- [ ] **Update from the previous version** (from 1.0.1 on): on a test machine with the previous
      version installed and in use, run the new `Kento-Windows-x64-Update.exe /S /UPDATE /R`, as
      the updater does; Kento restarts as the new version with its settings, Library, Path entry
      and Explorer entries as they were. After publishing, a copy of the previous version finds
      the update by itself and installs it (SPEC 5.16); check that on Windows, in the portable
      copy and on a Mac. When a Windows update does not install, `%LOCALAPPDATA%\Kento\logs\installer.log`
      says what the installer found using `kento.exe`, which of those still ran and how long it
      waited, and `%LOCALAPPDATA%\Kento\update-attempt.json` names the version that did not install.

### 5. Publish

- [ ] Read the notes on the draft (the finish job wrote them; edit them only after the workflow
      has finished, since a re-run writes them again) and press **Publish release**.

### 6. After publishing

- [ ] Actions → Hide old releases ran, and the release page shows only the new release; the older
      ones are drafts with their files and download counts.
- [ ] `https://github.com/MehmetBurakTaskaya/kento/releases/latest/download/latest.json` serves the
      new version, and the download links of the README and the website give the new files.
- [ ] Bring `website-kit/` to the new version (its version and, through `npm run catalog:export`,
      `catalog.json`) and update the author's website.
- [ ] Later: Actions → Download numbers, or `npm run stats`, shows how often each file was
      downloaded and about how many copies are in use.

If the new version turns out broken after publishing: save it back as a draft (Edit → Save as
draft), then publish the previous release again. Copies that already updated stay on the new
version until a fixed one is released; never reuse a version number that was published.
