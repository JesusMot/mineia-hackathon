// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract MineAIActivityLog {
    enum Resource {
        Gold,
        Emeralds,
        Diamonds,
        None
    }

    enum ManagerType {
        Trial,
        Basic,
        Premium
    }

    enum InfrastructureType {
        WoodenCabin,
        StorageHouse,
        MiningWorkshop,
        AIControlCenter
    }

    struct PlayerStats {
        uint256 manualMines;
        uint256 aiDecisions;
        uint256 managerActivations;
        uint256 infrastructureBuilds;
        uint256 lastActivityAt;
    }

    mapping(address => PlayerStats) public playerStats;

    event ManualMineRecorded(
        address indexed player,
        Resource indexed resource,
        uint256 amount,
        uint256 energySpent,
        uint256 timestamp
    );

    event AIManagerActivated(
        address indexed player,
        ManagerType indexed managerType,
        uint256 expiresAt,
        uint256 timestamp
    );

    event AIDecisionRecorded(
        address indexed player,
        Resource indexed resource,
        uint256 amount,
        uint256 energySpent,
        uint256 confidence,
        string decision,
        string result,
        uint256 timestamp
    );

    event InfrastructureBuilt(
        address indexed player,
        InfrastructureType indexed infrastructureType,
        uint256 mineLevel,
        uint256 timestamp
    );

    function recordManualMine(Resource resource, uint256 amount, uint256 energySpent) external {
        PlayerStats storage stats = playerStats[msg.sender];
        stats.manualMines += 1;
        stats.lastActivityAt = block.timestamp;

        emit ManualMineRecorded(msg.sender, resource, amount, energySpent, block.timestamp);
    }

    function recordAIManagerActivation(ManagerType managerType, uint256 expiresAt) external {
        PlayerStats storage stats = playerStats[msg.sender];
        stats.managerActivations += 1;
        stats.lastActivityAt = block.timestamp;

        emit AIManagerActivated(msg.sender, managerType, expiresAt, block.timestamp);
    }

    function recordAIDecision(
        Resource resource,
        uint256 amount,
        uint256 energySpent,
        uint256 confidence,
        string calldata decision,
        string calldata result
    ) external {
        PlayerStats storage stats = playerStats[msg.sender];
        stats.aiDecisions += 1;
        stats.lastActivityAt = block.timestamp;

        emit AIDecisionRecorded(
            msg.sender,
            resource,
            amount,
            energySpent,
            confidence,
            decision,
            result,
            block.timestamp
        );
    }

    function recordInfrastructureBuilt(InfrastructureType infrastructureType, uint256 mineLevel) external {
        PlayerStats storage stats = playerStats[msg.sender];
        stats.infrastructureBuilds += 1;
        stats.lastActivityAt = block.timestamp;

        emit InfrastructureBuilt(msg.sender, infrastructureType, mineLevel, block.timestamp);
    }
}
