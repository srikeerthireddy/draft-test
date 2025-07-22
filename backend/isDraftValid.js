function isDraftValid(userSelections, playerToDraft, lineupConfig) {
  // Count current selections by position
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

  // Check if player can fill a position-specific slot
  const posConfig = lineupConfig.positions.find(p => p.position === playerToDraft.Position);
  if (posConfig && counts[playerToDraft.Position] < posConfig.maxDraftable) {
    return {
      valid: true,
      position: playerToDraft.Position
    };
  }

  // Check if player can fill a FLEX slot
  const flexConfig = lineupConfig.positions.find(p => p.position === "FLEX");
  if (flexConfig && ["RB", "WR", "TE"].includes(playerToDraft.Position) && counts.FLEX < flexConfig.maxDraftable) {
    const rbConfig = lineupConfig.positions.find(p => p.position === "RB");
    const wrConfig = lineupConfig.positions.find(p => p.position === "WR");
    const teConfig = lineupConfig.positions.find(p => p.position === "TE");
    const flexPlayers = userSelections.filter(p => p.rosterPosition === "FLEX").length;
    const rbPlayers = userSelections.filter(p => p.Position === "RB").length;
    const wrPlayers = userSelections.filter(p => p.Position === "WR").length;
    const tePlayers = userSelections.filter(p => p.Position === "TE").length;

    // Check if FLEX is the only option
    if (rbPlayers >= rbConfig.maxDraftable &&
      wrPlayers >= wrConfig.maxDraftable &&
      tePlayers >= teConfig.maxDraftable) {
      return {
        valid: true,
        position: "FLEX"
      };
    }
  }

  return {
    valid: false,
    reason: `No open roster spots for ${playerToDraft.Position}`
  };
}

module.exports = {
  isDraftValid
}; 