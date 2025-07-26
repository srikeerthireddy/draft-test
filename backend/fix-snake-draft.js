const fs = require('fs');

// Read the ablyHandler.js file
const filePath = './ablyHandler.js';
let content = fs.readFileSync(filePath, 'utf8');

// Replace all occurrences of room.turnOrder[room.currentTurnIndex] with getCurrentTurnUserId(room)
content = content.replace(/room\.turnOrder\[room\.currentTurnIndex\]/g, 'getCurrentTurnUserId(room)');

// Write the updated content back to the file
fs.writeFileSync(filePath, content, 'utf8');

console.log('✅ Successfully updated all snake draft references in ablyHandler.js');
console.log('All occurrences of room.turnOrder[room.currentTurnIndex] have been replaced with getCurrentTurnUserId(room)'); 