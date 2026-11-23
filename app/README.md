# Aevum Pay (Android app)

Pay with tUSD8 when you have no signal. The phone signs a payment voucher with a key held in its
secure hardware (Android Keystore), nearby phones carry it over Bluetooth (Bridgewise Mesh), and the
settlement agent settles it on Aevum testnet as soon as any of them is online. The receipt comes back
the same way, signed by the agent.

React Native 0.87.1, Android only (the mesh and Keystore are Android features).

## What the person does

The app talks in plain words and dollars (tUSD8 is a test dollar). Chain words only appear under
Details, or with "Show technical details" turned on in Safety.

1. **First run, once, with signal.** Welcome, then a name, then one tap: the app creates its
   wallet, asks the agent for starter test money (a small tUSD8 gift, so nobody needs the Discord
   faucet), makes it ready for offline (a gasless deposit into the OfflineVault), and turns on
   offline pay with safe limits ($5 a payment, $10 a day, renewed every 7 days). The phone's
   fingerprint or screen lock prompt appears once, to tie the payment key to the person. Then the
   person picks a 6 digit app PIN.
2. **Pay, with or without signal.** Scan the other person's code (or pick a contact, or paste an
   address), type the amount on the keypad, check the total and the fee ("2 cents at most"), and
   touch the fingerprint sensor. The payment reads *On its way* until a phone with signal carries
   it, then *Paid*. If it fails, the reason is in plain words, with *Pay again*.
3. **Receive.** Show your code. It holds your wallet address and your name, and optionally an
   amount you ask for.
4. **Contacts and registered names.** People you pay are kept by name on this phone. A name
   registered in the PayeeRegistry (Confirmation of Payee) gets a green "Registered name" mark;
   the app keeps a copy so the mark still shows offline. If a code's name differs from the
   registered one, the app warns before paying. Safety can refuse unregistered payees altogether.
   You can register your own name in Safety, without gas, and find a registered shop by name in
   Contacts.
5. **Money in.** Payments to your wallet show on Home as "Received", with the payer's registered
   name when they have one.
6. **Paying with your own internet.** When the paying phone is online, the voucher goes straight to
   the agent (`POST /v1/pay`) and the mesh is the fallback; the receipt is checked the same way.
7. **Allowance agent.** In Limits, say it in your own words ("$10 a day this week, nothing over $3
   at once"); the agent proposes limits, you approve them with your fingerprint, the vault enforces them.
8. **Safety.** Limits and what is left today, change limits, move offline money back to the
   balance, turn offline pay off, open with fingerprint, lock now. The contract enforces the
   limits, so even a stolen phone cannot spend more.

## How it works inside

| Part | Where |
|---|---|
| Vouchers, EIP-712 digests, owner signatures, receipt checks | `src/core` (no React Native code; tested against the real contracts) |
| Payment engine: limits worked out offline, signing, sending over the mesh, retries | `src/payments/engine.ts` |
| Keystore key (P-256, StrongBox where available), SHA256withECDSA, raw r and s | `android/app/src/main/java/io/bridgewise/aevumpay/keystore/KeystoreModule.kt`, `src/native/keystore.ts` |
| The person's wallet (secp256k1, encrypted with a Keystore key) | `src/wallet/ownerWallet.ts` |
| Bridgewise Mesh (webhook mode, Cloud at mesh.lorapay.io) | `src/mesh.ts` |
| Saved state, so it works offline | `src/state/store.ts` (AsyncStorage) |
| Screens, tab bar, lock | `src/screens`, `src/app` (the redesign canvas is the reference) |
| App PIN (salted PBKDF2 hash in the keychain, waits after 5 wrong tries) | `src/security/pin.ts` |
| Payment codes (`aevumpay:0x…?name=…&amount=…`) | `src/core/qr.ts` |
| Look: colours, Inter and Space Grotesk (bundled, SIL Open Font License) | `src/ui/theme.ts`, `android/app/src/main/assets/fonts` |

Safety details:

- **A receipt counts only if the agent signed it** (EIP-712, checked against the agent's address),
  for this exact payment. The Cloud and the relay phones carry it but cannot fake it.
- **The same voucher is sent again until it is answered.** The agent answers repeats from its
  records and the vault refuses a voucher twice, so retries can never pay twice.
- **Each phone key is used for one session only.** Removing a phone retires its key for good.
- **The payment key needs the person.** On a phone with a screen lock, the Keystore key is made
  with user authentication required: it signs only for 30 seconds after the phone's own
  fingerprint or PIN prompt. Keystore enforces this, not the app, so a copied or hijacked app
  cannot pay. On a phone with no screen lock, the app PIN confirms each payment instead.
- **The app locks** on every start and after a minute in the background.
- The wallet key has no backup phrase in this version: testnet only.

## Build and run

On Windows, build from a short path (see Troubleshooting) and from PowerShell.

You need Node 22+, the Android SDK (as for any React Native app) and the Bridgewise Mesh SDK checked
out next to this repository (`../../mesh-sdk`, as in the Lorapay workspace).

```bash
cd app
npm install
npm test                      # core tests need Foundry's anvil and `forge build` in the repo root
npx react-native run-android  # a phone with USB debugging, or an emulator
```

A release APK for testers:

```bash
cd android
./gradlew assembleRelease     # app/build/outputs/apk/release/app-release.apk
```

The release build is signed with the debug key from the React Native template. Fine for a demo,
not for a store.

## Settings

`src/core/config.ts`: chain, contracts, the agent's URL and address, the highest fee a phone signs
for (0.02 tUSD8), how long a voucher stays valid (3 days), and the Mesh Cloud app key.

## Troubleshooting (Windows)

- **"Filename longer than 260 characters"** in a C++ step: give the project a short drive letter
  and build from there: `subst B: C:\Users\<you>\Documents\project-lorapay`, then work in
  `B:\bridgewise-aevum-pay\app`. Delete `android\app\.cxx` once after switching.
- **"Unexpected lock protocol found in lock file"**: `cd android; .\gradlew --stop`, close every
  Java process, delete `android\.gradle`, `android\build`, `android\app\build` and
  `%USERPROFILE%\.gradle\caches`, then build again. Excluding the project and `.gradle` folders
  from Windows Defender stops it coming back and makes builds faster.
- **Metro "Failed to start watch mode"**: `metro.config.js` already leaves the Android build
  folders out. Start Metro from the `app` folder with `npx react-native start --reset-cache`.
