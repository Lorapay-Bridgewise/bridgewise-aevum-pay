# Bridgewise Aevum Pay

Stablecoin payments with tUSD8 that go through when the payer has no signal.
Built for the Aevum Builder Challenge #1 on QDay Aevum testnet (chain 44005).

The payer's phone signs a payment voucher offline with a key held in Android Keystore.
The voucher travels over Bridgewise Mesh (Bluetooth, phone to phone) until a phone with
internet uploads it. A settlement agent submits it to the `OfflineVault` contract, pays the
gas, and sends a receipt back over the mesh.

> Status: work in progress. This repo currently holds the contract, tests and scripts.
> The Android app and the settlement agent come next.

## Network

| | |
|---|---|
| Network | QDay Aevum Testnet |
| Chain ID | 44005 |
| RPC | https://rpc-test.qday.info |
| Explorer | https://explorer-test.qday.info |
| Faucet | https://faucet.qday.info/en |
| Gas token | tQDAY |
| tUSD8 | `0x456569838f1d43009A91ebA4263147Afd7233483` (ERC-20, 6 decimals) |
| EVM version | Shanghai |

## How it works

```
 payer phone (offline)        relay phones          gateway phone        settlement agent         Aevum testnet
 ┌──────────────────┐  BLE  ┌──────────────┐  BLE  ┌─────────────┐ HTTPS ┌────────────────┐  tx   ┌──────────────┐
 │ Keystore P-256   │ ────▶ │ carry sealed │ ────▶ │ uploads     │ ────▶ │ checks, pays   │ ────▶ │ OfflineVault │
 │ signs voucher    │       │ voucher      │       │             │       │ gas, settles   │       │ pays payee   │
 │                  │ ◀──── │              │ ◀──── │             │ ◀──── │ signed receipt │ ◀──── │ and fee      │
 └──────────────────┘       └──────────────┘       └─────────────┘       └────────────────┘       └──────────────┘
```

1. **Deposit.** The owner moves tUSD8 into the vault (`deposit`, or `depositWithPermit` relayed by the agent).
2. **Open a session.** The phone creates a P-256 key in Android Keystore. The owner registers its public
   key with a per payment cap, a daily cap and an expiry (`openSession` or `openSessionBySig`).
3. **Pay offline.** The phone signs a `Voucher` (payee, amount, max fee, random nonce, valid before).
4. **Settle.** Anyone online can call `settle`. The vault checks the signature, the caps, the expiry and the
   nonce, pays the payee, and pays the submitter a fee no larger than the signed `maxFee`.
5. **Revoke.** The owner can revoke a session at any time (`revokeSession` or `revokeBySig` from another device),
   and withdraw what is left.

The owner never needs tQDAY: every owner action has a signed version the agent can relay, and the agent
pays gas in exchange for the fee in tUSD8.

## Safety controls

| Control | Where |
|---|---|
| Key never leaves hardware | Session key is an Android Keystore P-256 key, checked on chain with OpenZeppelin `P256` |
| Least privilege | A session key can only spend from its owner's vault balance, nothing else |
| Budget caps | Per payment cap and daily cap, enforced on chain |
| Expiry | Session expiry and per voucher `validBefore` |
| Revocation | `revokeSession`, or `revokeBySig` relayed from any device |
| Replay protection | Random 32 byte nonce per voucher, stored once used |
| Tamper protection | Payee, amount, fee and expiry are all signed; relays cannot change them |
| Fee limit | The settler cannot take more than the `maxFee` the payer signed |
| Audit trail | `Deposited`, `SessionOpened`, `SessionRevoked`, `VoucherSettled`, `Withdrawn` events |

## Voucher signing format

```
Voucher(bytes32 sessionId,address payee,uint256 amount,uint256 maxFee,bytes32 nonce,uint64 validBefore)
EIP-712 domain: name "Bridgewise OfflineVault", version "1", chainId 44005, verifyingContract = vault
```

The phone computes the EIP-712 digest and signs it with `SHA256withECDSA` in Android Keystore.
Keystore hashes its input, so the contract verifies the P-256 signature over `sha256(digest)`
(`voucherSigningHash`). Convert the DER signature from Keystore to raw `r` and `s`. High S values are accepted.

## Run it

Needs [Foundry](https://getfoundry.sh). On Windows, use Git Bash.

```bash
git clone --recursive https://github.com/<you>/bridgewise-aevum-pay
cd bridgewise-aevum-pay
forge test
```

Deploy and try it on Aevum testnet:

```bash
cast wallet import aevum-payer --interactive          # once
export PAYER=0xYourAddress PAYEE=0xPayeeAddress

forge script script/SendTUSD8.s.sol    --rpc-url aevum --account aevum-payer --broadcast
forge script script/DeployVault.s.sol  --rpc-url aevum --account aevum-payer --broadcast

export VAULT=0xDeployedVault
export SESSION_P256_KEY=0x$(openssl rand -hex 32)    # test key standing in for the phone
forge script script/DemoOfflinePayment.s.sol --rpc-url aevum --account aevum-payer --sender $PAYER --broadcast
```

## Contract addresses (Aevum testnet)

| Contract | Address |
|---|---|
| OfflineVault | [`0x5E6f3d12AaeB6732840432D19BCc26a35e0F0184`](https://explorer-test.qday.info/address/0x5E6f3d12AaeB6732840432D19BCc26a35e0F0184) |
| tUSD8 | [`0x456569838f1d43009A91ebA4263147Afd7233483`](https://explorer-test.qday.info/address/0x456569838f1d43009A91ebA4263147Afd7233483) |

### First run on Aevum testnet (20 Nov 2026)

| Step | Transaction |
|---|---|
| Deploy OfflineVault | [`0xba63...2b53`](https://explorer-test.qday.info/tx/0xba6351e01859e8cd31a3eb376e641dbfbcfb25e3b3192b61673850f41b632b53) |
| Settle an offline voucher (1 tUSD8, 375,947 gas) | [`0x1a29...ec6c`](https://explorer-test.qday.info/tx/0x1a29140abbd17f5dcc26bdcbd8eafa4a99171dfa2132714cf1344a89e679ec6c) |

Full logs of every run are in `broadcast/`.

## Known limits

1. **Spending across merchants while offline.** Two merchants can each accept a voucher before either is
   settled. If both together exceed the vault balance, the later one fails. Caps bound the loss, and payees
   see "pending" until settlement.
2. **Daily cap counts by settlement day,** not by the day the voucher was signed, because the phone's clock
   cannot be trusted.
3. **Permissionless settlement.** Anyone holding a voucher may settle it and take the fee (up to `maxFee`).
   The payee is always paid the signed amount.
4. **Gas.** The P-256 check runs in Solidity (about 376k gas per settlement on Aevum) because Aevum has no P-256
   precompile yet. The contract uses the RIP-7212 precompile automatically if one appears.

## License

MIT
