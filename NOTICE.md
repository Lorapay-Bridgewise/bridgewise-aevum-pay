# Notices

This project's own code is MIT licensed. It is built on the work below. Versions are the ones in
use when this file was written; the lock files (`agent/package-lock.json`, `app/package-lock.json`)
and git submodules (`lib/`) pin the exact ones.

## Templates and snippets

No template or starter project was copied. The QDay Aevum starter kit
(https://github.com/qday-io/aevum-starter-kit, MIT, PQA Labs) was read for network facts
(chain id, RPC limits, tUSD8's EIP-712 domain); none of its code is used. The Android app began
from the standard React Native 0.87 template (`@react-native-community/template`, MIT).

## Contracts (`src/`, `test/`, `script/`)

| Dependency | Version | Licence | Used for |
|---|---|---|---|
| OpenZeppelin Contracts | 5.4.0 | MIT | EIP712, ECDSA, P256, SafeERC20, IERC20Permit |
| forge-std | 1.17.0 | MIT or Apache 2.0 | tests and scripts |

## Settlement agent (`agent/`)

| Dependency | Version | Licence |
|---|---|---|
| viem | 2.58.2 | MIT |
| hono | 4.13.19 | MIT |
| @hono/node-server | 2.1.10 | MIT |
| better-sqlite3 | 13.2.0 | MIT |
| zod | 4.6.7 | MIT |

The allowance agent can call Claude through the Anthropic API when `ANTHROPIC_API_KEY` is set.
No Anthropic code is bundled.

## Android app (`app/`)

| Dependency | Version | Licence |
|---|---|---|
| react, react-native | 19.2.3, 0.87.1 | MIT |
| @react-navigation/native, native-stack, bottom-tabs | 7.x | MIT |
| react-native-screens, react-native-safe-area-context | 4.30.1, 5.11.1 | MIT |
| react-native-svg, react-native-qrcode-svg | 15.16.1, 6.3.54 | MIT |
| react-native-camera-kit | 18.0.1 | MIT |
| react-native-keychain | 10.0.0 | MIT |
| @react-native-async-storage/async-storage | 3.1.1 | MIT |
| @react-native-clipboard/clipboard | 1.16.3 | MIT |
| react-native-get-random-values | 2.1.0 | MIT |
| viem | 2.58.2 | MIT |
| @noble/curves, @noble/hashes | 2.4.0 | MIT |
| zustand | 5.1.0 | MIT |
| zod | 4.6.7 | MIT |
| androidx.biometric | 1.1.0 | Apache 2.0 |
| Inter, Space Grotesk (fonts, in `android/app/src/main/assets/fonts`) | Google Fonts | SIL Open Font License 1.1 (licence files next to the fonts) |
| @bridgewise/mesh-react-native and the Bridgewise Mesh Android SDK | 0.3.0 | Bridgewise's own; not part of this repository |
