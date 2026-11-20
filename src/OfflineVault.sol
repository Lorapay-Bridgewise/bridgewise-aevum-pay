// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {P256} from "@openzeppelin/contracts/utils/cryptography/P256.sol";

/// @title OfflineVault
/// @notice Offline spending allowances for tUSD8.
///
/// An owner deposits tUSD8 and registers a session key that lives in a phone's
/// Android Keystore (P-256, never leaves the hardware). While offline, the phone signs
/// vouchers with that key. Anyone online (the settlement agent) can submit a voucher;
/// the vault checks the signature, the per payment cap, the daily cap, the expiry and
/// the nonce, pays the payee, and pays the submitter a fee no larger than the signed
/// maximum. The owner never needs the gas token: every owner action also has a
/// signed version that the agent can relay.
contract OfflineVault is EIP712 {
    using SafeERC20 for IERC20;

    // ------------------------------------------------------------------ types

    struct Session {
        address owner;
        uint64 expiresAt;
        bool revoked;
        bytes32 qx; // P-256 public key, x
        bytes32 qy; // P-256 public key, y
        uint128 perPaymentCap;
        uint128 dailyCap;
        uint64 day; // day index of spentToday
        uint128 spentToday;
    }

    struct SessionParams {
        bytes32 qx;
        bytes32 qy;
        uint128 perPaymentCap;
        uint128 dailyCap;
        uint64 expiresAt;
    }

    struct Voucher {
        bytes32 sessionId;
        address payee;
        uint256 amount;
        uint256 maxFee;
        bytes32 nonce; // random, chosen by the phone
        uint64 validBefore;
    }

    // ------------------------------------------------------------------ constants

    bytes32 public constant VOUCHER_TYPEHASH = keccak256(
        "Voucher(bytes32 sessionId,address payee,uint256 amount,uint256 maxFee,bytes32 nonce,uint64 validBefore)"
    );
    bytes32 public constant OPEN_SESSION_TYPEHASH = keccak256(
        "OpenSession(address owner,bytes32 qx,bytes32 qy,uint128 perPaymentCap,uint128 dailyCap,uint64 expiresAt,uint256 nonce,uint256 deadline)"
    );
    bytes32 public constant REVOKE_TYPEHASH = keccak256("Revoke(bytes32 sessionId,uint256 deadline)");
    bytes32 public constant WITHDRAW_TYPEHASH =
        keccak256("Withdraw(address owner,address to,uint256 amount,uint256 nonce,uint256 deadline)");

    /// @dev secp256r1 group order, used to normalise high S signatures from Keystore.
    uint256 private constant P256_N = 0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551;
    uint256 private constant P256_HALF_N = P256_N / 2;

    // ------------------------------------------------------------------ storage

    IERC20 public immutable token;

    mapping(address owner => uint256) public balanceOf;
    mapping(bytes32 sessionId => Session) private _sessions;
    mapping(bytes32 sessionId => mapping(bytes32 nonce => bool)) public voucherUsed;
    mapping(address owner => uint256) public ownerNonce;

    // ------------------------------------------------------------------ events

    event Deposited(address indexed owner, address indexed from, uint256 amount);
    event Withdrawn(address indexed owner, address indexed to, uint256 amount);
    event SessionOpened(
        bytes32 indexed sessionId,
        address indexed owner,
        bytes32 qx,
        bytes32 qy,
        uint128 perPaymentCap,
        uint128 dailyCap,
        uint64 expiresAt
    );
    event SessionRevoked(bytes32 indexed sessionId, address indexed owner);
    event VoucherSettled(
        bytes32 indexed sessionId,
        bytes32 indexed nonce,
        address indexed payee,
        uint256 amount,
        uint256 fee,
        address feeTo
    );

    // ------------------------------------------------------------------ errors

    error ZeroAmount();
    error InvalidKey();
    error InvalidCaps();
    error SessionExists();
    error UnknownSession();
    error NotOwner();
    error SessionRevokedErr();
    error SessionExpired();
    error VoucherExpired();
    error VoucherReused();
    error OverPaymentCap();
    error OverDailyCap();
    error FeeTooHigh();
    error InsufficientBalance();
    error BadSignature();
    error DeadlinePassed();

    constructor(IERC20 token_) EIP712("Bridgewise OfflineVault", "1") {
        token = token_;
    }

    // ------------------------------------------------------------------ deposits

    /// @notice Deposit from msg.sender into msg.sender's vault balance.
    function deposit(uint256 amount) external {
        _deposit(msg.sender, msg.sender, amount);
    }

    /// @notice Gasless deposit: the owner signs an EIP-2612 permit, anyone relays it.
    /// @dev The permit call is wrapped in try/catch so a front run permit does not block the deposit.
    function depositWithPermit(address owner, uint256 amount, uint256 deadline, uint8 v, bytes32 r, bytes32 s)
        external
    {
        try IERC20Permit(address(token)).permit(owner, address(this), amount, deadline, v, r, s) {} catch {}
        _deposit(owner, owner, amount);
    }

    function _deposit(address owner, address from, uint256 amount) private {
        if (amount == 0) revert ZeroAmount();
        balanceOf[owner] += amount;
        token.safeTransferFrom(from, address(this), amount);
        emit Deposited(owner, from, amount);
    }

    // ------------------------------------------------------------------ withdrawals

    function withdraw(address to, uint256 amount) external {
        _withdraw(msg.sender, to, amount);
    }

    /// @notice Gasless withdrawal signed by the owner's main wallet.
    function withdrawBySig(address owner, address to, uint256 amount, uint256 deadline, bytes calldata sig)
        external
    {
        if (block.timestamp > deadline) revert DeadlinePassed();
        bytes32 structHash =
            keccak256(abi.encode(WITHDRAW_TYPEHASH, owner, to, amount, ownerNonce[owner]++, deadline));
        if (ECDSA.recover(_hashTypedDataV4(structHash), sig) != owner) revert BadSignature();
        _withdraw(owner, to, amount);
    }

    function _withdraw(address owner, address to, uint256 amount) private {
        if (amount == 0) revert ZeroAmount();
        if (balanceOf[owner] < amount) revert InsufficientBalance();
        balanceOf[owner] -= amount;
        token.safeTransfer(to, amount);
        emit Withdrawn(owner, to, amount);
    }

    // ------------------------------------------------------------------ sessions

    function openSession(bytes32 qx, bytes32 qy, uint128 perPaymentCap, uint128 dailyCap, uint64 expiresAt)
        external
        returns (bytes32)
    {
        return _openSession(msg.sender, qx, qy, perPaymentCap, dailyCap, expiresAt);
    }

    /// @notice Gasless session opening, signed by the owner's main wallet.
    function openSessionBySig(address owner, SessionParams calldata p, uint256 deadline, bytes calldata sig)
        external
        returns (bytes32)
    {
        if (block.timestamp > deadline) revert DeadlinePassed();
        bytes32 digest = _hashTypedDataV4(_openSessionStructHash(owner, p, ownerNonce[owner]++, deadline));
        if (ECDSA.recover(digest, sig) != owner) revert BadSignature();
        return _openSession(owner, p.qx, p.qy, p.perPaymentCap, p.dailyCap, p.expiresAt);
    }

    function _openSessionStructHash(address owner, SessionParams calldata p, uint256 nonce, uint256 deadline)
        private
        pure
        returns (bytes32)
    {
        return keccak256(
            abi.encode(
                OPEN_SESSION_TYPEHASH,
                owner,
                p.qx,
                p.qy,
                p.perPaymentCap,
                p.dailyCap,
                p.expiresAt,
                nonce,
                deadline
            )
        );
    }

    function _openSession(
        address owner,
        bytes32 qx,
        bytes32 qy,
        uint128 perPaymentCap,
        uint128 dailyCap,
        uint64 expiresAt
    ) private returns (bytes32 id) {
        if (!P256.isValidPublicKey(qx, qy)) revert InvalidKey();
        if (perPaymentCap == 0 || dailyCap < perPaymentCap) revert InvalidCaps();
        if (expiresAt <= block.timestamp) revert SessionExpired();

        id = sessionIdOf(owner, qx, qy);
        // A key is used for one session only. After revocation, the phone makes a new key.
        if (_sessions[id].owner != address(0)) revert SessionExists();

        _sessions[id] = Session({
            owner: owner,
            expiresAt: expiresAt,
            revoked: false,
            qx: qx,
            qy: qy,
            perPaymentCap: perPaymentCap,
            dailyCap: dailyCap,
            day: 0,
            spentToday: 0
        });
        emit SessionOpened(id, owner, qx, qy, perPaymentCap, dailyCap, expiresAt);
    }

    function revokeSession(bytes32 sessionId) external {
        Session storage ss = _sessions[sessionId];
        if (ss.owner == address(0)) revert UnknownSession();
        if (ss.owner != msg.sender) revert NotOwner();
        _revoke(sessionId, ss);
    }

    /// @notice Gasless revocation, signed by the owner's main wallet (for example from a second phone).
    function revokeBySig(bytes32 sessionId, uint256 deadline, bytes calldata sig) external {
        if (block.timestamp > deadline) revert DeadlinePassed();
        Session storage ss = _sessions[sessionId];
        if (ss.owner == address(0)) revert UnknownSession();
        bytes32 structHash = keccak256(abi.encode(REVOKE_TYPEHASH, sessionId, deadline));
        if (ECDSA.recover(_hashTypedDataV4(structHash), sig) != ss.owner) revert BadSignature();
        _revoke(sessionId, ss);
    }

    function _revoke(bytes32 sessionId, Session storage ss) private {
        if (!ss.revoked) {
            ss.revoked = true;
            emit SessionRevoked(sessionId, ss.owner);
        }
    }

    // ------------------------------------------------------------------ settlement

    /// @notice Settle an offline voucher. Permissionless: whoever submits it may take a fee up to maxFee.
    /// @param r P-256 signature r
    /// @param s P-256 signature s (high S is accepted and normalised)
    /// @param fee fee the submitter takes, at most voucher.maxFee
    /// @param feeTo where the fee goes (the settlement agent's wallet)
    function settle(Voucher calldata v, bytes32 r, bytes32 s, uint256 fee, address feeTo) external {
        Session storage ss = _sessions[v.sessionId];
        if (ss.owner == address(0)) revert UnknownSession();
        if (ss.revoked) revert SessionRevokedErr();
        if (block.timestamp >= ss.expiresAt) revert SessionExpired();
        if (block.timestamp >= v.validBefore) revert VoucherExpired();
        if (voucherUsed[v.sessionId][v.nonce]) revert VoucherReused();
        if (v.amount == 0) revert ZeroAmount();
        if (v.amount > ss.perPaymentCap) revert OverPaymentCap();
        if (fee > v.maxFee) revert FeeTooHigh();

        uint64 today = uint64(block.timestamp / 1 days);
        uint256 spent = ss.day == today ? ss.spentToday : 0;
        if (spent + v.amount > ss.dailyCap) revert OverDailyCap();

        if (!P256.verify(voucherSigningHash(v), r, _lowS(s), ss.qx, ss.qy)) revert BadSignature();

        address owner = ss.owner;
        uint256 total = v.amount + fee;
        if (balanceOf[owner] < total) revert InsufficientBalance();

        // effects
        voucherUsed[v.sessionId][v.nonce] = true;
        ss.day = today;
        ss.spentToday = uint128(spent + v.amount);
        balanceOf[owner] -= total;

        // interactions
        token.safeTransfer(v.payee, v.amount);
        if (fee > 0) token.safeTransfer(feeTo, fee);

        emit VoucherSettled(v.sessionId, v.nonce, v.payee, v.amount, fee, feeTo);
    }

    // ------------------------------------------------------------------ views

    function sessionIdOf(address owner, bytes32 qx, bytes32 qy) public pure returns (bytes32) {
        return keccak256(abi.encode(owner, qx, qy));
    }

    function getSession(bytes32 sessionId) external view returns (Session memory) {
        return _sessions[sessionId];
    }

    /// @notice How much the session can still spend today.
    function remainingToday(bytes32 sessionId) external view returns (uint256) {
        Session storage ss = _sessions[sessionId];
        if (ss.owner == address(0) || ss.revoked || block.timestamp >= ss.expiresAt) return 0;
        uint256 spent = ss.day == uint64(block.timestamp / 1 days) ? ss.spentToday : 0;
        return ss.dailyCap - spent;
    }

    /// @notice EIP-712 digest of a voucher. This is the message the phone signs.
    function voucherDigest(Voucher calldata v) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(VOUCHER_TYPEHASH, v.sessionId, v.payee, v.amount, v.maxFee, v.nonce, v.validBefore)
            )
        );
    }

    /// @notice The hash that the P-256 signature covers.
    /// @dev Android Keystore signs with SHA256withECDSA, so it hashes the 32 byte digest once more.
    function voucherSigningHash(Voucher calldata v) public view returns (bytes32) {
        return sha256(abi.encodePacked(voucherDigest(v)));
    }

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    // ------------------------------------------------------------------ internal

    function _lowS(bytes32 s) private pure returns (bytes32) {
        uint256 si = uint256(s);
        // s >= N is left as is; P256.verify rejects it.
        return si > P256_HALF_N && si < P256_N ? bytes32(P256_N - si) : s;
    }
}
