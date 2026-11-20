// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {OfflineVault} from "../src/OfflineVault.sol";
import {Aevum} from "./Aevum.sol";

/// End to end on chain proof, before the phone exists:
///   1. deposit 3 tUSD8 into the vault
///   2. open a session for a P-256 test key (stands in for the Android Keystore key)
///   3. sign a 1 tUSD8 voucher with that key, as the offline phone would
///   4. settle it, as the settlement agent would, taking a 0.01 tUSD8 fee
///
/// Env: VAULT (deployed vault), PAYEE, SESSION_P256_KEY (any random 32 byte hex, test only)
///
/// forge script script/DemoOfflinePayment.s.sol --rpc-url aevum --account aevum-payer --sender $PAYER --broadcast
contract DemoOfflinePayment is Script {
    uint256 constant ONE = 1e6;

    function run() external {
        require(block.chainid == Aevum.CHAIN_ID, "not Aevum testnet");
        IERC20 tusd8 = IERC20(Aevum.TUSD8);
        OfflineVault vault = OfflineVault(vm.envAddress("VAULT"));
        address payee = vm.envAddress("PAYEE");
        uint256 sessionKey = vm.envUint("SESSION_P256_KEY");
        (uint256 qx, uint256 qy) = vm.publicKeyP256(sessionKey);
        address owner = msg.sender;

        bytes32 sessionId = vault.sessionIdOf(owner, bytes32(qx), bytes32(qy));
        bool needsSession = vault.getSession(sessionId).owner == address(0);

        vm.startBroadcast();
        tusd8.approve(address(vault), 3 * ONE);
        vault.deposit(3 * ONE);
        if (needsSession) {
            vault.openSession(
                bytes32(qx), bytes32(qy), uint128(2 * ONE), uint128(5 * ONE), uint64(block.timestamp + 7 days)
            );
        }
        vm.stopBroadcast();

        // offline part: build and sign the voucher (no network needed for this step)
        OfflineVault.Voucher memory v = OfflineVault.Voucher({
            sessionId: sessionId,
            payee: payee,
            amount: ONE,
            maxFee: ONE / 50,
            nonce: keccak256(abi.encode(block.timestamp, payee, owner)),
            validBefore: uint64(block.timestamp + 1 days)
        });
        (bytes32 r, bytes32 s) = vm.signP256(sessionKey, vault.voucherSigningHash(v));

        // agent part: settle
        vm.startBroadcast();
        vault.settle(v, r, s, ONE / 100, owner);
        vm.stopBroadcast();

        console.log("session id:");
        console.logBytes32(sessionId);
        console.log("voucher nonce:");
        console.logBytes32(v.nonce);
        console.log("payee tUSD8 balance:", tusd8.balanceOf(payee));
        console.log("vault balance left:", vault.balanceOf(owner));
    }
}
