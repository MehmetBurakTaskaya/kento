# Security policy

## Supported versions

Only the newest release of Kento is supported. Updates are mandatory, so every copy that goes
online moves to the newest release by itself; fixes are not made for older versions.

## Reporting a vulnerability

Please do not report security problems in public issues, discussions or pull requests. Report them
privately through GitHub instead: open the repository's **Security** tab and choose
**Report a vulnerability**, or go straight to
<https://github.com/MehmetBurakTaskaya/kento/security/advisories/new>. Only the maintainer sees the
report, and the conversation stays private until a fix is published.

Please include:

- the Kento version (Settings → About) and the system: Windows or macOS version, x64, Apple silicon
  or Intel;
- what an attacker can do, and what they need first: a file the user converts, a link, something
  dragged onto the wheel, a folder a rule watches, access to the computer;
- the steps to reproduce it, with a sample file or a proof of concept if you have one (attach it to
  the private report only);
- whether one of the tools Kento downloads is involved (FFmpeg, LibreOffice, ExifTool, yt-dlp, Deno,
  ONNX Runtime), and which version.

You will get an answer as soon as possible. A confirmed problem is fixed in a new release, which
reaches users through the mandatory update, and is then described in a GitHub security advisory.
You are credited there and in the changelog if you wish. Please keep the details private until the
fixed release is out.

## Scope

In scope is everything built from this repository:

- reading untrusted files: pictures, PDF, archives, documents, spreadsheets, subtitles and the
  metadata in them, for example a file that makes Kento write outside the chosen folder, overwrite
  an existing file, follow a link out of an archive, run code, or exhaust the disk;
- how Kento downloads, checks, unpacks and runs the optional tools, and the arguments it passes them;
- the update path: `latest.json`, the signature check and the installation of an update, for the
  installer, the portable ZIP and the Mac app;
- web downloads: how links are checked, and the pictures the core fetches for the download dialog;
- the boundary between the page and the core: Tauri permissions, the content security policy, the
  asset protocol and the commands that take paths;
- any network use beyond what the [README](README.md#privacy) describes, and any file content that
  reaches a log;
- the command line, folder automation, the shelf, the Explorer integration and the installers.

Out of scope:

- vulnerabilities in the downloaded tools themselves, in WebView2 or in the operating system:
  please report them to their projects. Do tell us when Kento should move to a fixed version of a
  tool it pins;
- the SmartScreen and Gatekeeper warnings on first launch, which come from builds that are not
  signed by Microsoft or notarised by Apple ([docs/SIGNING.md](docs/SIGNING.md) explains why);
- attacks that need an attacker who already runs programs as the user or as an administrator;
- what a downloaded video or document contains, as long as Kento only stores it.

## How updates and downloads are protected

- Every update is signed with the project's update key. Its public key is built into Kento
  (`src-tauri/tauri.conf.json`); the private key exists only in the repository's GitHub Secrets and
  in the author's offline backup, never in the repository.
- Kento installs an update only when its signature is valid and was made for exactly the version
  `latest.json` announces, so an altered `latest.json` can neither offer other files nor bring back
  an older signed release.
- `latest.json` and the updates come over HTTPS from github.com. The check sends nothing about the
  user.
- Every Mac build is signed with the project's own certificate, the same for every version.
- Each release lists the SHA-256 of every file in `SHA256SUMS.txt`.
- The optional tools are pinned in `src-tauri/toolchain.lock.json` with their HTTPS address, size and
  SHA-256; a file that fails the check is never unpacked or run.
- Every action in the GitHub workflows is pinned to a commit, so a moved tag cannot change a step.

How the keys are made, kept and replaced is described in [docs/SIGNING.md](docs/SIGNING.md).
