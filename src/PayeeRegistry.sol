// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @title PayeeRegistry
/// @notice Confirmation of Payee for Aevum Pay: a public, one to one map between wallet
/// addresses and names.
///
/// A shop registers "Musa's Kiosk" for its wallet. Before paying, the payer's phone looks the
/// address up (and keeps a copy for when it is offline) and shows the registered name, so a
/// payer can tell when a code or an address does not belong to who they think.
///
/// Rules that make a name worth showing:
/// - one name per address, one address per name;
/// - names compare without case ("musa's kiosk" is taken once "Musa's Kiosk" is);
/// - letters, digits, spaces and . ' & - only, 3 to 32 bytes, no leading, trailing or double
///   spaces, so look alike names made with invisible or foreign characters cannot be made;
/// - the owner can give the name up, and only then can someone else take it.
/// Registering is first come, first served: the registry proves who holds a name, not who
/// they are in the world. The app calls it a "registered name", never a checked identity.
///
/// The owner never needs gas: registerBySig and releaseBySig take an EIP-712 signature that
/// the settlement agent relays.
contract PayeeRegistry is EIP712 {
    bytes32 public constant REGISTER_TYPEHASH =
        keccak256("Register(address account,string name,uint256 nonce,uint256 deadline)");
    bytes32 public constant RELEASE_TYPEHASH = keccak256("Release(address account,uint256 nonce,uint256 deadline)");

    uint256 public constant MIN_LENGTH = 3;
    uint256 public constant MAX_LENGTH = 32;

    /// @notice The registered name of an address, or "".
    mapping(address => string) public nameOf;
    /// @notice The address holding a name, by nameKey(name).
    mapping(bytes32 => address) public holderOf;
    /// @notice Signature nonces, one per account.
    mapping(address => uint256) public nonces;

    event NameRegistered(address indexed account, bytes32 indexed key, string name);
    event NameReleased(address indexed account, bytes32 indexed key, string name);

    error BadName();
    error NameTaken();
    error NoName();
    error DeadlinePassed();
    error BadSignature();

    constructor() EIP712("Bridgewise PayeeRegistry", "1") {}

    // ------------------------------------------------------------------ register

    /// @notice Register (or change) the caller's name.
    function register(string calldata name) external {
        _register(msg.sender, name);
    }

    /// @notice Register (or change) a name for `account`, with its signature. Anyone may submit.
    function registerBySig(address account, string calldata name, uint256 deadline, bytes calldata sig) external {
        if (block.timestamp > deadline) revert DeadlinePassed();
        bytes32 structHash =
            keccak256(abi.encode(REGISTER_TYPEHASH, account, keccak256(bytes(name)), nonces[account]++, deadline));
        _checkSig(account, structHash, sig);
        _register(account, name);
    }

    /// @notice Give up the caller's name.
    function release() external {
        _release(msg.sender);
    }

    function releaseBySig(address account, uint256 deadline, bytes calldata sig) external {
        if (block.timestamp > deadline) revert DeadlinePassed();
        bytes32 structHash = keccak256(abi.encode(RELEASE_TYPEHASH, account, nonces[account]++, deadline));
        _checkSig(account, structHash, sig);
        _release(account);
    }

    // ------------------------------------------------------------------ read

    /// @notice The address holding `name` (any case), or address(0).
    function lookup(string calldata name) external view returns (address) {
        return holderOf[nameKey(name)];
    }

    /// @notice Names of many addresses at once ("" where none), for the phone's offline copy.
    function namesOf(address[] calldata accounts) external view returns (string[] memory names) {
        names = new string[](accounts.length);
        for (uint256 i; i < accounts.length; i++) {
            names[i] = nameOf[accounts[i]];
        }
    }

    /// @notice The key a name is held under: keccak256 of the name in lower case.
    /// Reverts for a name that breaks the rules.
    function nameKey(string calldata name) public pure returns (bytes32) {
        return _key(bytes(name));
    }

    function _key(bytes memory b) private pure returns (bytes32) {
        if (b.length < MIN_LENGTH || b.length > MAX_LENGTH) revert BadName();
        bytes memory lower = new bytes(b.length);
        bool letterOrDigit;
        for (uint256 i; i < b.length; i++) {
            bytes1 c = b[i];
            if (c >= "A" && c <= "Z") {
                lower[i] = bytes1(uint8(c) + 32);
                letterOrDigit = true;
                continue;
            }
            if ((c >= "a" && c <= "z") || (c >= "0" && c <= "9")) {
                letterOrDigit = true;
            } else if (c == " ") {
                if (i == 0 || i == b.length - 1 || b[i - 1] == " ") revert BadName();
            } else if (c != "." && c != "'" && c != "&" && c != "-") {
                revert BadName();
            }
            lower[i] = c;
        }
        if (!letterOrDigit) revert BadName();
        return keccak256(lower);
    }

    // ------------------------------------------------------------------ internal

    function _register(address account, string calldata name) private {
        bytes32 key = nameKey(name);
        address holder = holderOf[key];
        if (holder != address(0) && holder != account) revert NameTaken();
        string memory old = nameOf[account];
        if (bytes(old).length != 0) {
            bytes32 oldKey = _key(bytes(old));
            if (oldKey != key) {
                delete holderOf[oldKey];
                emit NameReleased(account, oldKey, old);
            }
        }
        holderOf[key] = account;
        nameOf[account] = name;
        emit NameRegistered(account, key, name);
    }

    function _release(address account) private {
        string memory old = nameOf[account];
        if (bytes(old).length == 0) revert NoName();
        bytes32 key = _key(bytes(old));
        delete holderOf[key];
        delete nameOf[account];
        emit NameReleased(account, key, old);
    }

    /// Wallets here are plain keys (the app's own wallet), so an ECDSA signature is the check.
    /// OpenZeppelin's SignatureChecker would add ERC-1271 wallets but needs Cancun's mcopy,
    /// which Aevum (Shanghai) does not have.
    function _checkSig(address account, bytes32 structHash, bytes calldata sig) private view {
        (address signer, ECDSA.RecoverError err,) = ECDSA.tryRecover(_hashTypedDataV4(structHash), sig);
        if (err != ECDSA.RecoverError.NoError || signer != account || account == address(0)) revert BadSignature();
    }

    /// @notice EIP-712 domain separator, for signers.
    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }
}
