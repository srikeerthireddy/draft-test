function isDraftValid(userSelections, playerToDraft, lineupConfig) {
  // Count current selections by position and FLEX
  const counts = {
    QB: 0,
    RB: 0,
    WR: 0,
    TE: 0,
    K: 0,
    DST: 0,
    FLEX: 0
  };
  userSelections.forEach(p => {
    if (p.rosterPosition) {
      counts[p.rosterPosition]++;
    } else {
      counts[p.Position]++;
    }
  });

  // Find position config
  const posConfig = lineupConfig.positions.find(p => p.position === playerToDraft.Position);
  const flexConfig = lineupConfig.positions.find(p => p.position === "FLEX");

  // 1. Main slot
  if (posConfig && counts[playerToDraft.Position] < posConfig.minDraftable) {
    return {
      valid: true,
      position: playerToDraft.Position,
      slot: 'Main'
    };
  }

  // 2. FLEX slot (RB/WR/TE only, only if main is full)
  if (
    flexConfig &&
    ["RB", "WR", "TE"].includes(playerToDraft.Position) &&
    counts.FLEX < flexConfig.maxDraftable &&
    posConfig && counts[playerToDraft.Position] >= posConfig.minDraftable && counts[playerToDraft.Position] < posConfig.maxDraftable
  ) {
    // Only assign to FLEX if main is full (minDraftable reached)
    return {
      valid: true,
      position: "FLEX",
      slot: 'FLEX'
    };
  }

  // 3. Bench slot (if maxDraftable not reached)
  if (posConfig && counts[playerToDraft.Position] < posConfig.maxDraftable) {
    return {
      valid: true,
      position: playerToDraft.Position,
      slot: 'Bench'
    };
  }

  // No valid slot
  return {
    valid: false,
    reason: `No open roster spots for ${playerToDraft.Position}`
  };
}

module.exports = {
  isDraftValid
}; 