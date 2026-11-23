// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {PayeeRegistry} from "../src/PayeeRegistry.sol";

/// Deploys the PayeeRegistry (Confirmation of Payee) to Aevum testnet.
///
///   forge script script/DeployRegistry.s.sol --rpc-url aevum --account aevum-payer --broadcast
///
/// Then put the address in the agent's .env as PAYEE_REGISTRY and restart the agent.
contract DeployRegistry is Script {
    function run() external {
        vm.startBroadcast();
        PayeeRegistry reg = new PayeeRegistry();
        vm.stopBroadcast();
        console.log("PayeeRegistry:", address(reg));
        console.log("Next: PAYEE_REGISTRY=%s in /opt/bwpay-agent/agent/.env, then restart the agent", address(reg));
    }
}
