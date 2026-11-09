# Security boundaries

## Markdown and local UI

The UI is bundled locally. Raw HTML and fenced HTML are rendered as text. Mermaid uses strict mode and disables HTML labels. HTML pasted as rich text is sanitized before conversion to Markdown. No Markdown content is evaluated as JavaScript or a command. The application does not use React Server Components or expose a local HTTP execution endpoint.

The WebView disables developer tools, grants no requested permissions, blocks navigation away from the application origin and accepts bridge messages only from that origin. The production UI has no development editing hooks. CSP restricts executable scripts to bundled files. HTTP/HTTPS images in documents may still cause network requests. An image URL is never passed to a command interpreter.

UNC and encoded network filesystem image paths are rejected before probing the filesystem, to avoid automatic Windows network authentication from an untrusted document. Local and HTTP/HTTPS image references remain available.

Browser links are limited to HTTP/HTTPS with no control characters, whitespace or credentials. `file:`, `javascript:`, custom protocols, executables and command strings are rejected in both the UI and native layer. Only an explicit Ctrl+click/double click opens a link.

The development CSP permits the loopback WebSocket used by Vite's hot reload. The production build removes this exception and blocks form submission. `style-src 'unsafe-inline'` is retained for editor-generated styling and the HTML preview's internal styles; executable inline scripts remain blocked. HTTP/HTTPS images are intentionally allowed and can reach the network.

## Preview isolation and detached panes

HTML preview is read-only. Raw input is parsed in an inert template, sanitized with DOMPurify and placed in a sandboxed iframe without permissions. The iframe has its own restrictive CSP, blocks external resource loading and scripts, and does not allow links or forms. Local Markdown images can resolve to absolute paths or relative paths outside the document directory; only permitted image formats are served, and UNC or encoded network paths are rejected. A local Markdown file should therefore still be treated as untrusted input.

Local image previews are limited to 32 MiB per file and are read asynchronously; a file that grows beyond that limit while being read is rejected. This cap does not apply to remote HTTP/HTTPS images.

When saving to an existing regular file, the application writes a separate temporary file and uses a file-replacement operation. A destination whose final path component is a reparse point, such as a symbolic link, is rejected; open the target itself to save. These checks do not guarantee preservation of all hard-link, alternate-stream or filesystem-specific metadata and do not prevent every race with another process having the same filesystem access. Windows-specific behavior requires real-device testing.

Detached source and preview panes share the owner's document model. A pane must be explicitly opened by the application, registered by its opener, and match the expected origin, path, side and active document before attaching. A compromised application-origin page is within this trust boundary; detached panes do not create an independent security sandbox.

CSV/TSV view sidecars are optional. Before reading or writing, their JSON schema, version, size, value types and ranges are checked; a sidecar is kept alongside an existing CSV/TSV and reparse-point sidecars are rejected. These checks protect the application from malformed settings, not from a local attacker with equivalent filesystem access.

## Update trust

1. The native process queries the fixed GitHub repository `Ptcr8-tool/md-csv_split_viewer` over HTTPS. It accepts only stable, increasing three-part version numbers.
2. The setup and its Sigstore bundle must come from exact release paths in that repository. Redirects are limited to GitHub release hosts over HTTPS on the default port. Legacy RSA-signed manifests remain accepted only after their original signature verification.
3. The user confirms the version. The executable is streamed to a native-controlled temporary path with bounds on time and size. A bundled, pinned GitHub CLI and Sigstore trust roots verify the signed build provenance, the repository and its numeric ID, the exact GitHub-hosted release workflow, the release tag, a witnessed timestamp, and the installer digest.
4. The installer is accepted only after its full SHA-256 and length match and the provenance verifies. Interrupted or invalid downloads are removed.
5. Before starting the setup, the native process verifies the executable again. An older or equal version cannot be an automatic update. The UI cannot supply an executable path, arbitrary repository, download URL, command or shell arguments.
6. Each window prepares recovery and resolves unsaved documents. Waiting windows are locked. Any cancellation aborts the update for all windows. The verified setup is launched directly using `ProcessStartInfo` with `UseShellExecute=false`; no `cmd`, PowerShell, downloaded script or remote archive extraction is involved.

The provenance is independent of GitHub's asset digest. A release page change alone cannot produce an accepted update; the configured GitHub Actions workflow must attest the specific tagged build. Someone able to change and execute that trusted workflow can create valid provenance. This does not protect a machine already controlled by an attacker with the user's own filesystem privileges. Bundled verifier and trust-root hashes are embedded in the app; replacing the verifier requires a deliberately trusted application update.

The installer is not Authenticode-signed. GitHub provenance does not establish Windows publisher identity for a first download. No code-signing certificate or Windows real-device test is implied.

## Offline installer and repair

The NSIS setup contains the self-contained .NET application, local UI and complete fixed WebView2 Runtime. It contains no network-download plugin. It uses the current user's privileges, creates a dedicated writable folder and offers optional current-user Windows registrations. It never overwrites Windows UserChoice to force the default Markdown application.

Existing data under `Data` is preserved on repair and upgrade. Known previous ZIP settings/recovery/images are copied once without replacing current settings. Downgrades are blocked. Repairing a newer installed version delegates to that installed application's same-version cached setup; its receipt and SHA-256 are checked. A missing or corrupt cache requires the correct setup again. Local cache receipts detect corruption and are not a substitute for publisher signatures on internet updates.

Installer and uninstaller reject drive roots, broad profile/system folders and reparse-point ancestors. The uninstaller requires the application's ownership marker before recursively removing the installation directory. External `.md` and `.assets` files are not selected for deletion. A user who stores documents inside the installation directory must move them before uninstalling. Manual folder deletion cannot remove optional Windows registry entries or shortcuts; use the uninstaller for those.

The fixed WebView2 runtime is pinned by version and SHA-256 at build time. It does not independently update itself. Maintainers must release application updates containing current runtime security fixes. See [Microsoft distribution guidance](https://learn.microsoft.com/microsoft-edge/webview2/concepts/distribution).

## Regex and input bounds

Windows uses .NET regex with a 250 ms per-match timeout, a 2-second enumeration budget, 100,000-match cap, 4,096-character patterns, 65,536-character replacement templates and a 64 MiB document/output cap. Captures are expanded directly and bounds are checked before adding repeated data. The browser development UI uses a worker that is terminated after 1.5 seconds. Regex expressions are never evaluated as code. This follows [Microsoft's regex guidance](https://learn.microsoft.com/dotnet/standard/base-types/best-practices).

These checks reduce specific attack paths; they do not constitute an external security audit. Windows installer behavior and update/restart require real-device validation before broad distribution. Report reproducible security issues without posting private signing material or personal documents.

