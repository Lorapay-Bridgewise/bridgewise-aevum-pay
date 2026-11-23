// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {PayeeRegistry} from "../src/PayeeRegistry.sol";

contract PayeeRegistryTest is Test {
    PayeeRegistry reg;
    uint256 musaKey = 0xA11CE;
    address musa;
    address ada = makeAddr("ada");

    function setUp() public {
        reg = new PayeeRegistry();
        musa = vm.addr(musaKey);
    }

    function _sigRegister(uint256 pk, address account, string memory name, uint256 deadline) internal view returns (bytes memory) {
        bytes32 structHash = keccak256(
            abi.encode(reg.REGISTER_TYPEHASH(), account, keccak256(bytes(name)), reg.nonces(account), deadline)
        );
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(pk, keccak256(abi.encodePacked("\x19\x01", reg.domainSeparator(), structHash)));
        return abi.encodePacked(r, s, v);
    }

    function test_registerAndLookUp() public {
        vm.prank(musa);
        reg.register("Musa's Kiosk");
        assertEq(reg.nameOf(musa), "Musa's Kiosk");
        assertEq(reg.lookup("musa's kiosk"), musa);
        assertEq(reg.lookup("MUSA'S KIOSK"), musa);
    }

    function test_nameIsTakenWhateverTheCase() public {
        vm.prank(musa);
        reg.register("Musa's Kiosk");
        vm.prank(ada);
        vm.expectRevert(PayeeRegistry.NameTaken.selector);
        reg.register("MUSA'S kiosk");
    }

    function test_changingNameFreesTheOldOne() public {
        vm.startPrank(musa);
        reg.register("Musa's Kiosk");
        reg.register("Musa Foods");
        vm.stopPrank();
        assertEq(reg.lookup("Musa's Kiosk"), address(0));
        vm.prank(ada);
        reg.register("Musa's Kiosk");
        assertEq(reg.lookup("Musa's Kiosk"), ada);
        assertEq(reg.lookup("musa foods"), musa);
    }

    function test_sameNameAgainIsFine() public {
        vm.startPrank(musa);
        reg.register("Musa's Kiosk");
        reg.register("musa's kiosk");
        vm.stopPrank();
        assertEq(reg.nameOf(musa), "musa's kiosk");
        assertEq(reg.lookup("Musa's Kiosk"), musa);
    }

    function test_releaseFreesTheName() public {
        vm.prank(musa);
        reg.register("Musa's Kiosk");
        vm.prank(musa);
        reg.release();
        assertEq(reg.nameOf(musa), "");
        assertEq(reg.lookup("Musa's Kiosk"), address(0));
        vm.prank(musa);
        vm.expectRevert(PayeeRegistry.NoName.selector);
        reg.release();
    }

    function test_refusesNamesThatBreakTheRules() public {
        string[9] memory bad = [
            "ab",
            "abcdefghijklmnopqrstuvwxyz0123456",
            " Musa",
            "Musa ",
            "Musa  Kiosk",
            unicode"Musa Kiosk",
            unicode"Мusa",
            "...",
            "Musa_Kiosk"
        ];
        for (uint256 i; i < bad.length; i++) {
            vm.expectRevert(PayeeRegistry.BadName.selector);
            reg.nameKey(bad[i]);
        }
        reg.nameKey("Yemi Pharmacy & Co. 2-3");
    }

    function test_registerBySig() public {
        uint256 deadline = block.timestamp + 600;
        bytes memory sig = _sigRegister(musaKey, musa, "Musa's Kiosk", deadline);
        vm.prank(ada); // anyone can relay
        reg.registerBySig(musa, "Musa's Kiosk", deadline, sig);
        assertEq(reg.nameOf(musa), "Musa's Kiosk");
        // the same signature cannot be used twice
        vm.expectRevert(PayeeRegistry.BadSignature.selector);
        reg.registerBySig(musa, "Musa's Kiosk", deadline, sig);
    }

    function test_registerBySigRefusesOtherNamesSignersAndLateSigs() public {
        uint256 deadline = block.timestamp + 600;
        bytes memory sig = _sigRegister(musaKey, musa, "Musa's Kiosk", deadline);
        vm.expectRevert(PayeeRegistry.BadSignature.selector);
        reg.registerBySig(musa, "Musa Foods", deadline, sig);
        vm.expectRevert(PayeeRegistry.BadSignature.selector);
        reg.registerBySig(ada, "Musa's Kiosk", deadline, sig);
        vm.warp(deadline + 1);
        vm.expectRevert(PayeeRegistry.DeadlinePassed.selector);
        reg.registerBySig(musa, "Musa's Kiosk", deadline, sig);
    }

    function test_releaseBySig() public {
        vm.prank(musa);
        reg.register("Musa's Kiosk");
        uint256 deadline = block.timestamp + 600;
        bytes32 structHash = keccak256(abi.encode(reg.RELEASE_TYPEHASH(), musa, reg.nonces(musa), deadline));
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(musaKey, keccak256(abi.encodePacked("\x19\x01", reg.domainSeparator(), structHash)));
        reg.releaseBySig(musa, deadline, abi.encodePacked(r, s, v));
        assertEq(reg.lookup("Musa's Kiosk"), address(0));
    }

    function test_namesOf() public {
        vm.prank(musa);
        reg.register("Musa's Kiosk");
        address[] memory list = new address[](2);
        list[0] = ada;
        list[1] = musa;
        string[] memory names = reg.namesOf(list);
        assertEq(names[0], "");
        assertEq(names[1], "Musa's Kiosk");
    }
}
