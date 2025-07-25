const { isDraftValid } = require('./isDraftValid');
const lineupConfig = require('./lineupConfigs.json')[0];

// Test data - simulate a user with some selections
const userSelections = [
  { Name: "Teddy Bridgewater", Position: "QB", rosterPosition: "QB" },
  { Name: "Christian McCaffrey", Position: "RB", rosterPosition: "RB" },
  { Name: "A.J. Dillon", Position: "RB", rosterPosition: "RB" },
  { Name: "Jacoby Jones", Position: "WR", rosterPosition: "WR" },
  { Name: "Cody Chrest", Position: "WR", rosterPosition: "WR" },
  { Name: "Kaden Davis", Position: "WR", rosterPosition: "WR" },
  { Name: "J.D. McKissic", Position: "RB", rosterPosition: "FLEX" },
  { Name: "Matthew Stafford", Position: "QB", rosterPosition: "QB" },
  { Name: "Sean Mannion", Position: "QB", rosterPosition: "QB" }
];

// Test players
const testPlayers = [
  { Name: "Test TE", Position: "TE" },
  { Name: "Test K", Position: "K" },
  { Name: "Test DST", Position: "DST" }
];

console.log("=== Auto-Pick Debug Test ===");
console.log("User selections:", userSelections.map(p => `${p.Name} (${p.Position} -> ${p.rosterPosition})`));

// Count positions
const positionCounts = {
  QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DST: 0, FLEX: 0
};

userSelections.forEach(player => {
  const pos = player.rosterPosition || player.Position;
  if (positionCounts.hasOwnProperty(pos)) {
    positionCounts[pos]++;
  }
});

console.log("Position counts:", positionCounts);

// Get open positions
const openPositions = [];
for (const posConfig of lineupConfig.positions) {
  const currentCount = positionCounts[posConfig.position] || 0;
  console.log(`Checking ${posConfig.position}: current=${currentCount}, min=${posConfig.minDraftable}, max=${posConfig.maxDraftable}`);
  if (currentCount < posConfig.minDraftable) {
    openPositions.push(posConfig.position);
    console.log(`✅ Added ${posConfig.position} to open positions (needs ${posConfig.minDraftable - currentCount} more)`);
  }
}

console.log("Open positions:", openPositions);

// Test each player
testPlayers.forEach(player => {
  console.log(`\nTesting ${player.Name} (${player.Position}):`);
  const validation = isDraftValid(userSelections, player, lineupConfig);
  console.log("Validation result:", validation);
  
  if (validation.valid) {
    console.log(`✅ ${player.Name} can be drafted to ${validation.position}`);
  } else {
    console.log(`❌ ${player.Name} cannot be drafted: ${validation.reason}`);
  }
}); 