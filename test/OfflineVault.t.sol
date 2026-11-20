// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {OfflineVault} from "../src/OfflineVault.sol";
import {MockTUSD8} from "./mocks/MockTUSD8.sol";

contract OfflineVaultTest is Test {
    uint256 constant ONE = 1e6; // 1 tUSD8
    uint256 constant P256_N = 0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551;

    MockTUSD8 token;
    OfflineVault vault;

    uint256 ownerPk = 0xA11CE;
    address owner;
    uint256 phonePk = 0xB0B; // stands in for the Keystore key
    bytes32 qx;
    bytes32 qy;

    address payee = makeAddr("payee");
    address agent = makeAddr("agent");

    bytes32 sessionId;

    function setUp() public {
        vm.warp(1_766_000_000);
        owner = vm.addr(ownerPk);
        token = new MockTUSD8();
        vault = new OfflineVault(token);

        (uint256 x, uint256 y) = vm.publicKeyP256(phonePk);
        qx = bytes32(x);
        qy = bytes32(y);

        token.mint(owner, 100 * ONE);
        vm.startPrank(owner);
        token.approve(address(vault), type(uint256).max);
        vault.deposit(20 * ONE);
        sessionId =
            vault.openSession(qx, qy, uint128(5 * ONE), uint128(10 * ONE), uint64(block.timestamp + 3 days));
        vm.stopPrank();
    }

    // ------------------------------------------------------------ helpers

    function _voucher(uint256 amount, bytes32 nonce) internal view returns (OfflineVault.Voucher memory) {
        return OfflineVault.Voucher({
            sessionId: sessionId,
            payee: payee,
            amount: amount,
            maxFee: ONE / 50, // 0.02 tUSD8
            nonce: nonce,
            validBefore: uint64(block.timestamp + 1 days)
        });
    }

    function _sign(OfflineVault.Voucher memory v) internal view returns (bytes32 r, bytes32 s) {
        return vm.signP256(phonePk, vault.voucherSigningHash(v));
    }

    function _settle(OfflineVault.Voucher memory v, uint256 fee) internal {
        (bytes32 r, bytes32 s) = _sign(v);
        vm.prank(agent);
        vault.settle(v, r, s, fee, agent);
    }

    function _ownerSig(bytes32 structHash) internal view returns (bytes memory) {
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", vault.domainSeparator(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ownerPk, digest);
        return abi.encodePacked(r, s, v);
    }

    // ------------------------------------------------------------ happy path

    function test_settle_paysPayeeAndAgent() public {
        OfflineVault.Voucher memory v = _voucher(2 * ONE, keccak256("n1"));
        _settle(v, ONE / 100);

        assertEq(token.balanceOf(payee), 2 * ONE);
        assertEq(token.balanceOf(agent), ONE / 100);
        assertEq(vault.balanceOf(owner), 20 * ONE - 2 * ONE - ONE / 100);
        assertEq(vault.remainingToday(sessionId), 8 * ONE);
        assertTrue(vault.voucherUsed(sessionId, keccak256("n1")));
    }

    function test_settle_twoOfflineVouchersInAnyOrder() public {
        OfflineVault.Voucher memory a = _voucher(1 * ONE, keccak256("a"));
        OfflineVault.Voucher memory b = _voucher(1 * ONE, keccak256("b"));
        _settle(b, 0); // arrives first over the mesh
        _settle(a, 0);
        assertEq(token.balanceOf(payee), 2 * ONE);
    }

    function test_settle_acceptsHighS() public {
        OfflineVault.Voucher memory v = _voucher(ONE, keccak256("hs"));
        (bytes32 r, bytes32 s) = _sign(v);
        bytes32 highS = uint256(s) > P256_N / 2 ? s : bytes32(P256_N - uint256(s));
        vm.prank(agent);
        vault.settle(v, r, highS, 0, agent);
        assertEq(token.balanceOf(payee), ONE);
    }

    function test_dailyCapResetsNextDay() public {
        _settle(_voucher(5 * ONE, keccak256("d1")), 0);
        _settle(_voucher(5 * ONE, keccak256("d2")), 0);
        assertEq(vault.remainingToday(sessionId), 0);

        vm.warp(block.timestamp + 1 days);
        assertEq(vault.remainingToday(sessionId), 10 * ONE);
        _settle(_voucher(1 * ONE, keccak256("d3")), 0);
    }

    // ------------------------------------------------------------ failures

    function test_revert_replay() public {
        OfflineVault.Voucher memory v = _voucher(ONE, keccak256("r"));
        (bytes32 r, bytes32 s) = _sign(v);
        vault.settle(v, r, s, 0, agent);
        vm.expectRevert(OfflineVault.VoucherReused.selector);
        vault.settle(v, r, s, 0, agent);
    }

    function test_revert_overPaymentCap() public {
        OfflineVault.Voucher memory v = _voucher(6 * ONE, keccak256("big"));
        (bytes32 r, bytes32 s) = _sign(v);
        vm.expectRevert(OfflineVault.OverPaymentCap.selector);
        vault.settle(v, r, s, 0, agent);
    }

    function test_revert_overDailyCap() public {
        _settle(_voucher(5 * ONE, keccak256("1")), 0);
        _settle(_voucher(5 * ONE, keccak256("2")), 0);
        OfflineVault.Voucher memory v = _voucher(ONE, keccak256("3"));
        (bytes32 r, bytes32 s) = _sign(v);
        vm.expectRevert(OfflineVault.OverDailyCap.selector);
        vault.settle(v, r, s, 0, agent);
    }

    function test_revert_feeAboveSignedMax() public {
        OfflineVault.Voucher memory v = _voucher(ONE, keccak256("fee"));
        (bytes32 r, bytes32 s) = _sign(v);
        vm.expectRevert(OfflineVault.FeeTooHigh.selector);
        vault.settle(v, r, s, v.maxFee + 1, agent);
    }

    function test_revert_tamperedAmount() public {
        OfflineVault.Voucher memory v = _voucher(ONE, keccak256("t"));
        (bytes32 r, bytes32 s) = _sign(v);
        v.amount = 2 * ONE; // a relay tries to change the amount
        vm.expectRevert(OfflineVault.BadSignature.selector);
        vault.settle(v, r, s, 0, agent);
    }

    function test_revert_tamperedPayee() public {
        OfflineVault.Voucher memory v = _voucher(ONE, keccak256("p"));
        (bytes32 r, bytes32 s) = _sign(v);
        v.payee = makeAddr("thief");
        vm.expectRevert(OfflineVault.BadSignature.selector);
        vault.settle(v, r, s, 0, agent);
    }

    function test_revert_wrongKey() public {
        OfflineVault.Voucher memory v = _voucher(ONE, keccak256("k"));
        (bytes32 r, bytes32 s) = vm.signP256(0xBAD, vault.voucherSigningHash(v));
        vm.expectRevert(OfflineVault.BadSignature.selector);
        vault.settle(v, r, s, 0, agent);
    }

    function test_revert_voucherExpired() public {
        OfflineVault.Voucher memory v = _voucher(ONE, keccak256("e"));
        (bytes32 r, bytes32 s) = _sign(v);
        vm.warp(v.validBefore);
        vm.expectRevert(OfflineVault.VoucherExpired.selector);
        vault.settle(v, r, s, 0, agent);
    }

    function test_revert_sessionExpired() public {
        vm.warp(block.timestamp + 3 days);
        OfflineVault.Voucher memory v = _voucher(ONE, keccak256("se"));
        (bytes32 r, bytes32 s) = _sign(v);
        vm.expectRevert(OfflineVault.SessionExpired.selector);
        vault.settle(v, r, s, 0, agent);
    }

    function test_revert_afterRevoke() public {
        vm.prank(owner);
        vault.revokeSession(sessionId);
        OfflineVault.Voucher memory v = _voucher(ONE, keccak256("rv"));
        (bytes32 r, bytes32 s) = _sign(v);
        vm.expectRevert(OfflineVault.SessionRevokedErr.selector);
        vault.settle(v, r, s, 0, agent);
    }

    function test_revert_insufficientBalance() public {
        vm.prank(owner);
        vault.withdraw(owner, 19 * ONE);
        OfflineVault.Voucher memory v = _voucher(2 * ONE, keccak256("ib"));
        (bytes32 r, bytes32 s) = _sign(v);
        vm.expectRevert(OfflineVault.InsufficientBalance.selector);
        vault.settle(v, r, s, 0, agent);
    }

    function test_revert_onlyOwnerRevokes() public {
        vm.expectRevert(OfflineVault.NotOwner.selector);
        vault.revokeSession(sessionId);
    }

    function test_revert_sameKeyTwice() public {
        vm.prank(owner);
        vm.expectRevert(OfflineVault.SessionExists.selector);
        vault.openSession(qx, qy, uint128(ONE), uint128(ONE), uint64(block.timestamp + 1 days));
    }

    function test_revert_invalidKey() public {
        vm.prank(owner);
        vm.expectRevert(OfflineVault.InvalidKey.selector);
        vault.openSession(
            bytes32(uint256(1)),
            bytes32(uint256(2)),
            uint128(ONE),
            uint128(ONE),
            uint64(block.timestamp + 1 days)
        );
    }

    // ------------------------------------------------------------ gasless owner actions

    function test_revokeBySig_relayedByAgent() public {
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _ownerSig(keccak256(abi.encode(vault.REVOKE_TYPEHASH(), sessionId, deadline)));
        vm.prank(agent);
        vault.revokeBySig(sessionId, deadline, sig);
        assertTrue(vault.getSession(sessionId).revoked);
    }

    function test_revokeBySig_rejectsStranger() public {
        uint256 deadline = block.timestamp + 1 hours;
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                vault.domainSeparator(),
                keccak256(abi.encode(vault.REVOKE_TYPEHASH(), sessionId, deadline))
            )
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(0xEE, digest);
        vm.expectRevert(OfflineVault.BadSignature.selector);
        vault.revokeBySig(sessionId, deadline, abi.encodePacked(r, s, v));
    }

    function test_openSessionBySig_andWithdrawBySig() public {
        (uint256 x2, uint256 y2) = vm.publicKeyP256(0xC0FFEE);
        uint256 deadline = block.timestamp + 1 hours;
        uint64 exp = uint64(block.timestamp + 1 days);
        bytes memory sig = _ownerSig(
            keccak256(
                abi.encode(
                    vault.OPEN_SESSION_TYPEHASH(),
                    owner,
                    bytes32(x2),
                    bytes32(y2),
                    uint128(ONE),
                    uint128(2 * ONE),
                    exp,
                    vault.ownerNonce(owner),
                    deadline
                )
            )
        );
        vm.prank(agent);
        OfflineVault.SessionParams memory p = OfflineVault.SessionParams({
            qx: bytes32(x2),
            qy: bytes32(y2),
            perPaymentCap: uint128(ONE),
            dailyCap: uint128(2 * ONE),
            expiresAt: exp
        });
        bytes32 id2 = vault.openSessionBySig(owner, p, deadline, sig);
        assertEq(vault.getSession(id2).owner, owner);

        bytes memory wsig = _ownerSig(
            keccak256(
                abi.encode(
                    vault.WITHDRAW_TYPEHASH(), owner, owner, 5 * ONE, vault.ownerNonce(owner), deadline
                )
            )
        );
        vm.prank(agent);
        vault.withdrawBySig(owner, owner, 5 * ONE, deadline, wsig);
        assertEq(vault.balanceOf(owner), 15 * ONE);

        // the same signature cannot be used twice
        vm.expectRevert(OfflineVault.BadSignature.selector);
        vault.withdrawBySig(owner, owner, 5 * ONE, deadline, wsig);
    }

    function test_depositWithPermit_gasless() public {
        uint256 amount = 10 * ONE;
        uint256 deadline = block.timestamp + 1 hours;
        bytes32 permitHash = keccak256(
            abi.encode(
                keccak256(
                    "Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"
                ),
                owner,
                address(vault),
                amount,
                token.nonces(owner),
                deadline
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", token.DOMAIN_SEPARATOR(), permitHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ownerPk, digest);

        vm.prank(owner);
        token.approve(address(vault), 0);

        vm.prank(agent);
        vault.depositWithPermit(owner, amount, deadline, v, r, s);
        assertEq(vault.balanceOf(owner), 30 * ONE);
    }

    // ------------------------------------------------------------ fuzz

    function testFuzz_neverSpendsMoreThanDailyCap(uint96[5] memory amounts) public {
        uint256 settled;
        for (uint256 i; i < amounts.length; i++) {
            uint256 a = bound(amounts[i], 1, 5 * ONE);
            OfflineVault.Voucher memory v = _voucher(a, keccak256(abi.encode(i)));
            (bytes32 r, bytes32 s) = _sign(v);
            try vault.settle(v, r, s, 0, agent) {
                settled += a;
            } catch {}
        }
        assertLe(settled, 10 * ONE);
        assertEq(token.balanceOf(payee), settled);
    }
}
