# outbrief-app

[中文](README.md)

OutBrief client (Tauri 2 + React 19 + TypeScript). When an AI agent finishes, the app rings like a video call. You answer, hear a spoken brief with cards, type to interrupt, and hang up with a reply back into the original session.

- Server: [`outbrief-server`](https://github.com/outbriefapp/outbrief-server) (design notes and ADRs live there)
- Resident process and agent hooks: [`outbrief-daemon`](https://github.com/outbriefapp/outbrief-daemon)

The Chinese README is the map of the source tree, the call behavior, voice platforms, and the LLM page. This page is how to install the desktop app and the phone app, in which order, and how they pair with the daemon.

The interface follows Settings → Display language: the system language, 中文, or English. In Chinese the product name is 启奏. In English it stays OutBrief. Menu paths below are the English ones. The Chinese paths are 设置 → 设备 → 添加设备 and 设置 → 加密.

## Install order

Calls stay inside one anonymous account. Let the daemon on the computer that runs the agents create the account. This app, on the desktop and on the phone, joins that account.

1. **Deploy [outbrief-server](https://github.com/outbriefapp/outbrief-server).** Run exactly one process. On a private deploy (the default), every start prints a one-time claim code while the server has no owner yet: `Claim code: XXXX-XXXX-XXXX`. Write down the server URL. Phones and other computers must be able to open that URL. `http://127.0.0.1:8787` works only on the machine that runs the server. When a phone will pair, put a LAN IP or a public `https://` URL in the daemon and in the app.
2. **Install [outbrief-daemon](https://github.com/outbriefapp/outbrief-daemon)** on the computer that runs the agents. After `pnpm install`, run `node src/cli.ts login --server <server-url>` and enter the claim code. The terminal prints a QR code and a 6-digit code. On macOS, then run `node src/cli.ts install` (start at login, and write the Claude Code / Codex Stop hooks). `install` stores the absolute path of node and `src/cli.ts` in launchd, so leave that checkout where it is.
3. **Install the desktop app** from this repo on that same computer. Next section. When the daemon is already running, the first launch joins that daemon's account.
4. **Install the phone app** from this same repo. Next section. On a device that is already paired, open Settings → Devices → Add a device, or run `node src/cli.ts pair` on the computer, and scan the QR code with the phone camera.

For local development, `pnpm dev:all` starts the MySQL container, the server in the sibling directory, and the desktop window. That is the development entry. A production deploy still follows the order above.

### Install this repo

Node ≥ 22.18, pnpm 9, Rust stable ≥ 1.85, and the [Tauri prerequisites](https://tauri.app/start/prerequisites/).

Desktop:

```bash
pnpm install
pnpm tauri build
```

Installers land in `src-tauri/target/release/bundle/`. The build machine produces the installers for its own OS. Hot reload during development:

```bash
pnpm tauri dev
```

The phone app is this same project. The Android and iOS projects are not checked in. Generate them locally, then compile. Android needs Android Studio. iOS needs Xcode. See the mobile section of the Tauri prerequisites.

```bash
pnpm install
pnpm tauri android init
pnpm tauri icon app-icon.json   # init writes Tauri's default icons; this swaps in OutBrief's
pnpm tauri android dev      # device or emulator; scripts/build-android.sh for an installable APK
pnpm tauri ios init
pnpm tauri ios dev          # pnpm tauri ios build for a release
```

This repo does not ship a store binary.

`pnpm dev` runs only the web UI in a browser (port 1520). A desktop window is `pnpm tauri dev`.

### Pairing

There is no login and no shared password. The first device creates the account. Later devices join with a 6-digit code. The code lasts 10 minutes and works once. The QR code and the link look like `outbrief://pair?server=<server-url>&code=<6 digits>&key=obk1_…`. The server URL and the end-to-end key go from device to device. The server never sees the key. The server URL inside the link has to be one the new device can open.

| Already in the account | Device joining | What to do |
|---|---|---|
| Daemon running on this computer | Desktop app on the same computer | Automatic. The app reads `~/.outbrief/local-api.key` and asks `127.0.0.1:8790` for a pairing code and the key. If the daemon is installed and stopped, the welcome screen waits, and the app joins once the daemon is running |
| Desktop app, or the daemon (`node src/cli.ts pair`) | Phone app | Scan the QR code from Settings → Devices → Add a device, or the QR code in the terminal |
| Phone, or an app on another computer | Daemon on a computer | Copy the command from Add a device and run `node src/cli.ts login 'outbrief://pair?…'` on that computer |
| Any paired device | Desktop app on another computer | Paste the pairing link into the welcome screen. The desktop app does not open the camera |
| 6 digits only | Daemon or app | Also enter the same sentence from Settings → Encryption (at least 12 characters). When that sentence was never set, use the QR code or the link that carries `key=` |

The app can create the account instead. On the welcome screen, enter the server URL and the claim code, then choose Create a new account. Copy the link from Add a device and `login` the computer with it. After the daemon on that computer is paired and running, the desktop app on that computer joins the daemon's account.

Phone only, no desktop app: deploy the server, `login` the daemon, and scan the QR code in the terminal. Multica, the LLM, and the report language on the phone are encrypted and relayed through the server to that computer's daemon. The computer has to be online. When the account has several computers, pick one at the top of the settings page.

On a public server, set `OUTBRIEF_OPEN_SIGNUP=true`. The first device creates an account with no claim code.

After pairing, the pages you fill in on each device:

- Settings → Voice — report language and the speech platform. Speech is requested from this device.
- Settings → LLM — the model used for questions during a call. Saving also writes it to the local daemon when that daemon is running, which is what generates the brief.
- Settings → Multica — your Multica API token. It is stored on the computer's daemon. From the phone it is encrypted and relayed. The server does not see it.

## Commands

| Command | What it does |
|---|---|
| `pnpm dev:all` | Local MySQL + sibling outbrief-server + desktop window |
| `pnpm tauri dev` | Desktop window with hot reload (the UI dev server is on port 1520) |
| `pnpm dev` | UI only, in a browser |
| `pnpm tauri build` | Desktop installers |
| `pnpm tauri android init` / `ios init` | Generate the local mobile project. Then `dev` or `build`. See [Install this repo](#install-this-repo) |
| `scripts/build-android.sh` | Build an installable arm64 APK at `dist-android/OutBrief.apk` (server defaults to `https://api.outbriefapp.com`; adds camera / microphone permissions and signs with a key kept in `~/.outbrief-android/`, outside the repo) |
| `pnpm lint` / `pnpm format` | Biome check / write |
| `pnpm typecheck` | `tsc` |
| `pnpm test` | Vitest |

## License

[OutBrief License](LICENSE) (Apache License 2.0 plus extra terms, following the [Multica License](https://github.com/multica-ai/multica/blob/main/LICENSE)).
