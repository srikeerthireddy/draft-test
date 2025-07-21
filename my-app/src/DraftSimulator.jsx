// import React, { useEffect, useState } from "react";

// // Helper: lineup config for LINEUP 1 (can be made dynamic)
// const LINEUP = {
//   QB: { main: 1, max: 3 },
//   RB: { main: 2, max: 5 },
//   WR: { main: 3, max: 6 },
//   TE: { main: 1, max: 4 },
//   K:  { main: 1, max: 3 },
//   DST:{ main: 1, max: 3 },
//   FLEX: { main: 1, max: 1 }, // Only 1 FLEX
//   BENCH: 2 // Only 2 bench slots
// };

// const FLEX_ELIGIBLE = ["RB", "WR", "TE"];

// function getInitialLineup() {
//   return {
//     QB: [],
//     RB: [],
//     WR: [],
//     TE: [],
//     K: [],
//     DST: [],
//     FLEX: [],
//     BENCH: []
//   };
// }

// export default function DraftSimulatorWithPlacement() {
//   const [playerPool, setPlayerPool] = useState([]);
//   const [lineup, setLineup] = useState(getInitialLineup());
//   const [message, setMessage] = useState("");

//   // Fetch player pool from backend
//   useEffect(() => {
//     fetch("/api/players")
//       .then(res => res.json())
//       .then(data => {
//         // Filter to only allowed positions
//         const allowed = ["QB", "RB", "WR", "TE", "K", "DST"];
//         setPlayerPool(data.filter(p => allowed.includes(p.Position)).slice(0, 100)); // Limit for demo
//       });
//   }, []);

//   // Count how many in each slot
//   function countAll(lineup) {
//     return {
//       QB: lineup.QB.length,
//       RB: lineup.RB.length,
//       WR: lineup.WR.length,
//       TE: lineup.TE.length,
//       K: lineup.K.length,
//       DST: lineup.DST.length,
//       FLEX: lineup.FLEX.length,
//       BENCH: lineup.BENCH.length
//     };
//   }

//   // Draft logic
//   function handleDraft(player) {
//     const pos = player.Position;
//     const counts = countAll(lineup);

//     // Already drafted?
//     if (
//       Object.values(lineup)
//         .flat()
//         .some(p => p.PlayerID === player.PlayerID)
//     ) {
//       setMessage("Player already drafted.");
//       return;
//     }

//     // 1. Try to fill main slot
//     if (counts[pos] < LINEUP[pos].main) {
//       setLineup(lu => ({ ...lu, [pos]: [...lu[pos], { ...player, slot: "Main" }] }));
//       setMessage(`${player.Name} assigned to Main (${pos})`);
//       return;
//     }

//     // 2. Try to fill FLEX (if eligible)
//     if (FLEX_ELIGIBLE.includes(pos) && counts.FLEX < LINEUP.FLEX.main) {
//       setLineup(lu => ({ ...lu, FLEX: [...lu.FLEX, { ...player, slot: "FLEX" }] }));
//       setMessage(`${player.Name} assigned to FLEX`);
//       return;
//     }

//     // 3. Try to fill bench (if not full and not exceeding max for position)
//     if (
//       counts.BENCH < LINEUP.BENCH &&
//       counts[pos] < LINEUP[pos].max
//     ) {
//       setLineup(lu => ({ ...lu, BENCH: [...lu.BENCH, { ...player, slot: "Bench", benchPos: pos }] }));
//       setMessage(`${player.Name} assigned to Bench`);
//       return;
//     }

//     setMessage(`Cannot draft ${player.Name}: all slots for ${pos} are full.`);
//   }

//   // For UI: show available players (not yet drafted)
//   const draftedIds = Object.values(lineup).flat().map(p => p.PlayerID);
//   const availablePlayers = playerPool.filter(p => !draftedIds.includes(p.PlayerID));

//   return (
//     <div style={{ maxWidth: 900, margin: "2rem auto", fontFamily: "Arial" }}>
//       <h2>Fantasy Lineup Draft Simulator</h2>
//       <div style={{ marginBottom: 16 }}>
//         <b>Draft a player:</b>
//         <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
//           {availablePlayers.map(player => (
//             <button
//               key={player.PlayerID}
//               onClick={() => handleDraft(player)}
//               style={{
//                 padding: "6px 12px",
//                 borderRadius: 4,
//                 border: "1px solid #ccc",
//                 background: "#f5f5f5",
//                 cursor: "pointer"
//               }}
//             >
//               {player.Name} ({player.Position})
//             </button>
//           ))}
//         </div>
//       </div>
//       {message && <div style={{ color: "#1976d2", marginBottom: 16 }}>{message}</div>}

//       <div style={{ display: "flex", gap: 32, flexWrap: "wrap" }}>
//         {/* Main Lineup */}
//         <div>
//           <h3>Main Lineup</h3>
//           <ul>
//             {["QB", "RB", "WR", "TE", "K", "DST"].map(pos =>
//               lineup[pos].map((p, i) => (
//                 <li key={p.PlayerID}>
//                   {p.Name} <span style={{ color: "#888" }}>({pos})</span>
//                 </li>
//               ))
//             )}
//             {FLEX_ELIGIBLE.map(pos =>
//               lineup.FLEX
//                 .filter(p => p.Position === pos)
//                 .map((p, i) => (
//                   <li key={p.PlayerID}>
//                     {p.Name} <span style={{ color: "#888" }}>(FLEX: {pos})</span>
//                   </li>
//                 ))
//             )}
//           </ul>
//         </div>
//         {/* Bench */}
//         <div>
//           <h3>Bench</h3>
//           <ul>
//             {lineup.BENCH.map((p, i) => (
//               <li key={p.PlayerID}>
//                 {p.Name} <span style={{ color: "#888" }}>({p.benchPos})</span>
//               </li>
//             ))}
//           </ul>
//         </div>
//       </div>
//       {/* Show counts */}
//       <div style={{ marginTop: 24 }}>
//         <b>Lineup Counts:</b>
//         <ul>
//           {Object.entries(countAll(lineup)).map(([pos, count]) => (
//             <li key={pos}>
//               {pos}: {count}
//               {LINEUP[pos]?.main && ` (Main: ${LINEUP[pos].main})`}
//               {LINEUP[pos]?.max && ` (Max: ${LINEUP[pos].max})`}
//             </li>
//           ))}
//         </ul>
//       </div>
//     </div>
//   );
// }