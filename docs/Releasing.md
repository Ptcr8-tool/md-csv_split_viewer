# Releasing MD-CSV Split Editor

The app reads anonymous public GitHub Releases. The release repository is `Ptcr8-tool/md-csv_split_viewer`. Publish only complete, verified releases. If releases are inaccessible, show a short nonmodal toast and keep editing available. Do not embed credentials or require login.


Every published stable version has one complete Windows x64 Setup.exe. Releases also contain two machine-readable update-verification sidecars; users do not need to download them manually.

Builds and CI use Node.js 24 or later. `@codemirror/language-data` is intentionally pinned at 6.5.2 for repeatable language support; when upgrading it, update the lockfile and recheck syntax highlighting and editor UI tests.

CI audits production npm dependencies, checks the actual production web bundle in Chromium, and caches only the original WebView2 CAB using a key derived from `installer/runtime.json`. Before extraction, the packager verifies the CAB's pinned byte count and SHA-256 even after a cache hit. Dependabot proposes npm, NuGet, and GitHub Actions updates; review each change and its effects before merging. The offline end-user setup does not use those services.

Keep the bundled Microsoft fixed-runtime license in sync with the official download page and review changes before enabling silent upgrades to a runtime with different terms. The initial interactive setup displays the complete terms and retains them offline under Licenses.

1. Update `package.json`, the lockfile root versions, `native/MdSplit.csproj`, `BuildIdentity.Version`, the installer default and the runtime pin if needed. Run `npm run check:version`; the build and CI also enforce this consistency check. Do not change the update verification key without a key-rotation plan.
2. Run JavaScript, native and UI checks. Publish the Windows self-contained application and package with NSIS. Use `MDSPLIT_SIGNING_KEY_PATH` pointing to the securely stored private RSA key matching `native/update-public.pem`. The packaging script verifies that match before signing.
3. Test fresh installation offline, upgrade from the prior version with non-default settings and unsaved tabs, same/newer-version maintenance choices, repair cache, optional registrations and uninstall on Windows 10/11 x64.
4. Inspect `MD-Split-VERSION-Setup.exe`, `update-manifest.json`, `update-manifest.sig` and `SHA256SUMS.txt`. The manifest is signed over its exact UTF-8 bytes with RSA-PSS/SHA-256 and a digest-length salt. Verify it with the public key. Never publish the private key or a key backup.
5. Commit the tested source with the chosen release identity and tag exactly `vVERSION`. Keep the README download row marked as pending until the public assets are verified.
6. Create a stable GitHub Release in `Ptcr8-tool/md-csv_split_viewer`. Upload the Setup.exe, both verification sidecars and SHA256SUMS.txt **before publishing**. Leave incomplete releases as drafts. Do not overwrite assets for an already published version; issue a new version if a fix is needed.
7. Verify the published release, files and hashes through GitHub. Then update the four-column README download table using `python scripts/add-download.py --published VERSION "Release summary"` and verify the resulting button. Test an actual installed previous version checking, confirming, downloading, preparing documents, installing and reopening. The application checks the GitHub latest stable endpoint and ignores prereleases/drafts.

The installer build does not require any signing key for a local manual installation. Without a key, packaging omits the detached signature and the app refuses to consume that release as an automatic update. Authenticode signing, if configured by the owner later, is separate and must happen **before** the manifest hash/signature are generated.

The `checks.yml` workflow validates source and creates a build artifact. It does not have write permissions and does not publish a release or receive signing keys. The initial release can use the locally verified/signature-protected artifacts. Enabling a CI signing secret or public release workflow is a separate repository-owner configuration task.

## Offline runtime pin

`installer/runtime.json` contains the official Microsoft fixed-runtime CAB URL, version, size and SHA-256. `scripts/package-installer.py` checks the CAB, extracts it and bundles the runtime. Set `MDSPLIT_RUNTIME` to an already verified extracted runtime for repeat builds. The end-user setup never downloads a runtime.

To compare installer compression, first run the normal Windows publish and packaging steps so `release/MD-Split` contains the complete payload, including its verified runtime. Then run `python scripts/compare-installer-compression.py --makensis "C:\Program Files (x86)\NSIS\makensis.exe" --runs 3` on Windows. It compiles the same payload with solid zlib and solid lzma, reports each size and elapsed build time, and deletes the temporary installers. It does not install, publish, sign, or download anything. Compare extraction time and memory on actual Windows machines separately before changing the default; this optional benchmark does not run in routine CI.

Do not commit `release/`, signing keys, credentials, machine data, `Data/`, native build outputs or dependencies. The checked-in public verification key is safe to publish. Historical ZIP versions 0.1–0.2 precede the single-exe release format; do not invent download assets for them.
