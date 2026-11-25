// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @dev Robinhood Chain is an Arbitrum chain: inside a contract, block.number is the Ethereum (L1) block.
///      The chain's own block number comes from the ArbSys precompile at address 100.
interface IArbSys {
    function arbBlockNumber() external view returns (uint256);
}

/// @title RubyProof
/// @notice A public record that an answer (for example from an AI agent) was made from a given source,
///         read on Robinhood Chain at a given block. It stores hashes only: never the answer, never the data.
/// @dev No owner, no admin, no upgrade path, no funds. Anyone can record a proof for themselves.
///      What a proof shows: this address said, at this block, that the answer with hash A came from the
///      source with hash S read at block B. It does not show that the answer is true.
contract RubyProof {
    /// @notice A proof was recorded.
    /// @param prover      the address that sent the proof
    /// @param answerHash  sha256 of the exact answer bytes
    /// @param sourceHash  sha256 of the exact source bytes (a Ruby note, or any data the answer used)
    /// @param sourceBlock the Robinhood Chain block the source was read at
    /// @param kind        a short label, for example "pool", "clip", "radar"
    /// @param index       the proof's number, starting at 1
    event Proved(address indexed prover, bytes32 indexed answerHash, bytes32 indexed sourceHash, uint64 sourceBlock, bytes32 kind, uint256 index);

    IArbSys private constant ARB_SYS = IArbSys(address(100));

    /// @notice How many proofs have been recorded.
    uint256 public count;

    /// @notice The Robinhood Chain block at which a prover first recorded an answer hash, or 0 if never.
    mapping(address prover => mapping(bytes32 answerHash => uint256 blockNumber)) public provedAt;

    error EmptyHash();
    error SourceBlockInFuture();

    /// @notice Record a proof. The source block can't be later than the current Robinhood Chain block.
    function prove(bytes32 answerHash, bytes32 sourceHash, uint64 sourceBlock, bytes32 kind) external returns (uint256 index) {
        if (answerHash == bytes32(0) || sourceHash == bytes32(0)) revert EmptyHash();
        uint256 nowBlock = ARB_SYS.arbBlockNumber();
        if (sourceBlock > nowBlock) revert SourceBlockInFuture();
        index = ++count;
        if (provedAt[msg.sender][answerHash] == 0) provedAt[msg.sender][answerHash] = nowBlock;
        emit Proved(msg.sender, answerHash, sourceHash, sourceBlock, kind, index);
    }
}
