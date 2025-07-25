function isDraftValid(userSelections, playerToDraft, lineupConfig) {
  // Step 1: Determine Open Lineup Slots
  // Count current selections by position and FLEX
  const counts = {
    QB: 0,
    RB: 0,
    WR: 0,
    TE: 0,
    K: 0,
    DST: 0,
    FLEX: 0,
    BENCH: 0
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
  const benchConfig = lineupConfig.positions.find(p => p.position === "BENCH");

  // Step 2: Check if player can fit in any available slot
  // NO POSITION PRIORITIZATION - JUST CHECK IF SLOT IS AVAILABLE

  // 1. Main position slot
  if (posConfig && counts[playerToDraft.Position] < posConfig.maxDraftable) {
    return {
      valid: true,
      position: playerToDraft.Position,
      slot: 'Main'
    };
  }

  // 2. FLEX slot (RB/WR/TE only, if FLEX is available)
  if (
    flexConfig &&
    ["RB", "WR", "TE"].includes(playerToDraft.Position) &&
    counts.FLEX < flexConfig.maxDraftable
  ) {
    return {
      valid: true,
      position: "FLEX",
      slot: 'FLEX'
    };
  }

  // 3. Bench slot (if bench is available)
  if (benchConfig && counts.BENCH < benchConfig.maxDraftable) {
    return {
      valid: true,
      position: "BENCH",
      slot: 'Bench'
    };
  }

  // No valid slot available
  return {
    valid: false,
    reason: `No open roster spots for ${playerToDraft.Position}`
  };
}

module.exports = {
  isDraftValid
}; 