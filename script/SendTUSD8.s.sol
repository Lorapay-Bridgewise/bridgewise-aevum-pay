// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Aevum} from "./Aevum.sol";

/// Send 1 tUSD8 to $PAYEE. Proves wallet, gas and token work on Aevum.
///
/// forge script script/SendTUSD8.s.sol --rpc-url aevum --account aevum-payer --broadcast
contract SendTUSD8 is Script {
    function run() external {
        require(block.chainid == Aevum.CHAIN_ID, "not Aevum testnet");
        IERC20 tusd8 = IERC20(Aevum.TUSD8);
        address payee = vm.envAddress("PAYEE");
        uint256 amount = 1_000_000; // 1 tUSD8

        vm.startBroadcast();
        bool ok = tusd8.transfer(payee, amount);
        vm.stopBroadcast();

        require(ok, "transfer failed");
        console.log("payee tUSD8 balance (6 decimals):", tusd8.balanceOf(payee));
    }
}
