// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {OfflineVault} from "../src/OfflineVault.sol";
import {Aevum} from "./Aevum.sol";

/// Deploy OfflineVault for tUSD8 on Aevum testnet.
///
/// forge script script/DeployVault.s.sol --rpc-url aevum --account aevum-payer --broadcast
contract DeployVault is Script {
    function run() external returns (OfflineVault vault) {
        require(block.chainid == Aevum.CHAIN_ID, "not Aevum testnet");
        vm.startBroadcast();
        vault = new OfflineVault(IERC20(Aevum.TUSD8));
        vm.stopBroadcast();
        console.log("OfflineVault:", address(vault));
    }
}
