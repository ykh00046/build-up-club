// ─── Build-Up Lab 정적 시나리오 데이터 ──────────────────────────
// 20개의 전술 훈련 레벨 정보
const LEVELS = [
  // ─── Phase 1: Free Man & Blocked Lanes (Levels 1-5) ───
  {
    id: 1,
    name: 'Find the Free Man',
    intro: 'Pass to the unmarked teammate in the Pivot Zone!',
    passLimit: 3,
    optimalPasses: 2,
    players: [
      { x: 50, y: 128, hasBall: true },
      { x: 170, y: 80 },
      { x: 280, y: 128 }
    ],
    defenders: [
      { x: 170, y: 140, type: 'static', blockRadius: 28 } // blocks the lower space
    ],
    targetZone: { x: 250, y: 90, w: 70, h: 76, label: 'Pivot Zone' },
    tacticalActions: { bounce: 0, thirdMan: 0, switchPlay: 0, dropPivot: 0 },
  },
  {
    id: 2,
    name: 'Avoid the Press',
    intro: 'Navigate around the defender\'s pressing circle!',
    passLimit: 3,
    optimalPasses: 2,
    players: [
      { x: 50, y: 60, hasBall: true },
      { x: 140, y: 130 },
      { x: 230, y: 60 }
    ],
    defenders: [
      { x: 140, y: 55, type: 'static', blockRadius: 32 }
    ],
    targetZone: { x: 210, y: 35, w: 60, h: 60, label: 'Wing Area' },
    tacticalActions: { bounce: 0, thirdMan: 0, switchPlay: 0, dropPivot: 0 },
  },
  {
    id: 3,
    name: 'Cover Shadow Entry',
    intro: 'Beware of the defender\'s orange cover shadow blocking the lane!',
    passLimit: 3,
    optimalPasses: 2,
    players: [
      { x: 45, y: 128, hasBall: true },
      { x: 150, y: 65 },
      { x: 170, y: 190 },
      { x: 290, y: 128 }
    ],
    defenders: [
      { x: 150, y: 110, type: 'presser', blockRadius: 18, coverShadowAngle: 40, coverShadowLength: 90 }
    ],
    targetZone: { x: 260, y: 90, w: 75, h: 76, label: 'Half-Space' },
    tacticalActions: { bounce: 0, thirdMan: 0, switchPlay: 0, dropPivot: 0 },
  },
  {
    id: 4,
    name: 'Dynamic Press Shift',
    intro: 'Wait for the patrolling midfielder to move away!',
    passLimit: 4,
    optimalPasses: 3,
    players: [
      { x: 45, y: 128, hasBall: true },
      { x: 150, y: 70 },
      { x: 220, y: 190 },
      { x: 300, y: 110 }
    ],
    defenders: [
      { x: 150, y: 140, type: 'static', blockRadius: 28 },
      { x: 210, y: 80, type: 'patrol', blockRadius: 24, patrolPath: [{x:210,y:50},{x:210,y:150}], speed: 1.2 }
    ],
    targetZone: { x: 270, y: 80, w: 70, h: 70, label: 'Pocket Area' },
    tacticalActions: { bounce: 0, thirdMan: 0, switchPlay: 0, dropPivot: 0 },
  },
  {
    id: 5,
    name: 'Mid-Block Barrier',
    intro: 'Find a way through a 2-man defensive line!',
    passLimit: 4,
    optimalPasses: 3,
    players: [
      { x: 40, y: 128, hasBall: true },
      { x: 120, y: 55 },
      { x: 130, y: 200 },
      { x: 230, y: 128 },
      { x: 310, y: 128 }
    ],
    defenders: [
      { x: 120, y: 110, type: 'presser', blockRadius: 18, coverShadowAngle: 35, coverShadowLength: 75 },
      { x: 210, y: 70, type: 'static', blockRadius: 26 }
    ],
    targetZone: { x: 280, y: 90, w: 70, h: 76, label: 'Advanced Pivot' },
    tacticalActions: { bounce: 0, thirdMan: 0, switchPlay: 0, dropPivot: 0 },
  },

  // ─── Phase 2: Tactical Actions Basics (Levels 6-10) ───
  {
    id: 6,
    name: 'Bounce Pass Intro',
    intro: 'Activate [Bounce] to bypass the press with a quick one-two!',
    passLimit: 2,
    optimalPasses: 1,
    players: [
      { x: 45, y: 128, hasBall: true },
      { x: 160, y: 128 }, // Connector player
      { x: 290, y: 80 }   // Final receiver
    ],
    defenders: [
      { x: 180, y: 90, type: 'presser', blockRadius: 20, coverShadowAngle: 35, coverShadowLength: 90 }
    ],
    targetZone: { x: 250, y: 40, w: 90, h: 70, label: 'Weak Side Wing' },
    tacticalActions: { bounce: 1, thirdMan: 0, switchPlay: 0, dropPivot: 0 },
  },
  {
    id: 7,
    name: 'Third-Man Combination',
    intro: 'Use [Third Man] action to connect and trigger a blind-side run!',
    passLimit: 2,
    optimalPasses: 1,
    players: [
      { x: 45, y: 128, hasBall: true },
      { x: 160, y: 70 },   // Connector
      { x: 170, y: 190 },  // Intermediary
      { x: 290, y: 128 }   // Runner
    ],
    defenders: [
      { x: 130, y: 130, type: 'presser', blockRadius: 22, coverShadowAngle: 40, coverShadowLength: 90 },
      { x: 230, y: 138, type: 'static', blockRadius: 24 } // Shifted down to block straight pass
    ],
    targetZone: { x: 260, y: 90, w: 70, h: 76, label: 'Between Lines' },
    tacticalActions: { bounce: 0, thirdMan: 1, switchPlay: 0, dropPivot: 0 },
  },
  {
    id: 8,
    name: 'Switch Play!',
    intro: 'Unlock the weak-side winger using the [Switch] action!',
    passLimit: 2,
    optimalPasses: 1,
    players: [
      { x: 45, y: 190, hasBall: true },
      { x: 150, y: 190 }, // Sideline fullback
      { x: 280, y: 65 }   // Opposite winger
    ],
    defenders: [
      { x: 110, y: 160, type: 'static', blockRadius: 26 },
      { x: 180, y: 140, type: 'presser', blockRadius: 20, coverShadowAngle: 40, coverShadowLength: 100 }
    ],
    targetZone: { x: 240, y: 30, w: 100, h: 70, label: 'Isolation Zone' },
    tacticalActions: { bounce: 0, thirdMan: 0, switchPlay: 1, dropPivot: 0 },
  },
  {
    id: 9,
    name: 'Drop Pivot Support',
    intro: 'Use [Drop Pivot] to drop a midfielder deep to create a passing angle!',
    passLimit: 3,
    optimalPasses: 2,
    players: [
      { x: 45, y: 180, hasBall: true },
      { x: 160, y: 80 },  // Midfielder
      { x: 220, y: 160 }
    ],
    defenders: [
      { x: 105, y: 90, type: 'static', blockRadius: 24 },
      { x: 180, y: 110, type: 'presser', blockRadius: 20, coverShadowAngle: 35, coverShadowLength: 80 }
    ],
    targetZone: { x: 200, y: 130, w: 80, h: 60, label: 'Free Space' },
    tacticalActions: { bounce: 0, thirdMan: 0, switchPlay: 0, dropPivot: 1 },
  },
  {
    id: 10,
    name: 'Action Convergence',
    intro: 'Decide whether a [Bounce] or [Third Man] is better to escape!',
    passLimit: 2,
    optimalPasses: 1,
    players: [
      { x: 40, y: 128, hasBall: true },
      { x: 130, y: 60 },
      { x: 130, y: 190 },
      { x: 240, y: 128 },
      { x: 310, y: 60 }
    ],
    defenders: [
      { x: 120, y: 125, type: 'presser', blockRadius: 20, coverShadowAngle: 35, coverShadowLength: 85 },
      { x: 210, y: 80, type: 'chase', blockRadius: 22, alertRange: 80, speed: 1.0 }
    ],
    targetZone: { x: 270, y: 30, w: 80, h: 65, label: 'Advanced Half-space' },
    tacticalActions: { bounce: 1, thirdMan: 1, switchPlay: 0, dropPivot: 0 },
  },

  // ─── Phase 3: Switches & Side Traps (Levels 11-15) ───
  {
    id: 11,
    name: 'Overloaded Sideline',
    intro: 'The opponent overloaded your left flank. Switch play!',
    passLimit: 2,
    optimalPasses: 1,
    players: [
      { x: 50, y: 190, hasBall: true },
      { x: 120, y: 180 },
      { x: 140, y: 220 },
      { x: 280, y: 60 }
    ],
    defenders: [
      { x: 90, y: 180, type: 'static', blockRadius: 24 },
      { x: 150, y: 180, type: 'presser', blockRadius: 22, coverShadowAngle: 45, coverShadowLength: 90 },
      { x: 200, y: 130, type: 'static', blockRadius: 25 }
    ],
    targetZone: { x: 240, y: 30, w: 90, h: 70, label: 'Weak Side Escape' },
    tacticalActions: { bounce: 0, thirdMan: 0, switchPlay: 1, dropPivot: 0 },
  },
  {
    id: 12,
    name: 'The Chasing Sentinel',
    intro: 'A fast chaser blocks the middle. Use tactical movements!',
    passLimit: 2,
    optimalPasses: 1,
    players: [
      { x: 45, y: 60, hasBall: true },
      { x: 150, y: 190 },
      { x: 230, y: 60 },
      { x: 300, y: 128 }
    ],
    defenders: [
      { x: 140, y: 90, type: 'chase', blockRadius: 22, alertRange: 100, speed: 1.4 },
      { x: 230, y: 140, type: 'static', blockRadius: 26 }
    ],
    targetZone: { x: 260, y: 95, w: 80, h: 65, label: 'Pocket Zone' },
    tacticalActions: { bounce: 1, thirdMan: 0, switchPlay: 0, dropPivot: 1 },
  },
  {
    id: 13,
    name: 'Sideline Press Trap',
    intro: 'Break the sideline trap using a drop pivot or third-man sequence!',
    passLimit: 4,
    optimalPasses: 3,
    players: [
      { x: 45, y: 190, hasBall: true },
      { x: 140, y: 110 },
      { x: 150, y: 200 },
      { x: 290, y: 160 }
    ],
    defenders: [
      { x: 95, y: 180, type: 'static', blockRadius: 25 },
      { x: 150, y: 170, type: 'presser', blockRadius: 20, coverShadowAngle: 40, coverShadowLength: 85 }
    ],
    targetZone: { x: 250, y: 120, w: 90, h: 70, label: 'Free Pocket' },
    tacticalActions: { bounce: 0, thirdMan: 1, switchPlay: 0, dropPivot: 1 },
  },
  {
    id: 14,
    name: 'Central Congestion',
    intro: 'The center is congested. Work around the block!',
    passLimit: 3,
    optimalPasses: 2,
    players: [
      { x: 40, y: 128, hasBall: true },
      { x: 110, y: 70 },
      { x: 110, y: 180 },
      { x: 200, y: 128 },
      { x: 280, y: 128 }
    ],
    defenders: [
      { x: 110, y: 125, type: 'presser', blockRadius: 22, coverShadowAngle: 35, coverShadowLength: 80 },
      { x: 180, y: 75, type: 'static', blockRadius: 24 },
      { x: 180, y: 180, type: 'static', blockRadius: 24 }
    ],
    targetZone: { x: 250, y: 95, w: 80, h: 65, label: 'Zone 14' },
    tacticalActions: { bounce: 1, thirdMan: 1, switchPlay: 0, dropPivot: 0 },
  },
  {
    id: 15,
    name: 'Half-Space Penetration',
    intro: 'Penetrate the defensive block into the targeted Half-space!',
    passLimit: 2,
    optimalPasses: 1,
    players: [
      { x: 45, y: 80, hasBall: true },
      { x: 130, y: 160 },
      { x: 150, y: 50 },
      { x: 220, y: 100 },
      { x: 290, y: 180 }
    ],
    defenders: [
      { x: 100, y: 100, type: 'static', blockRadius: 25 },
      { x: 170, y: 110, type: 'presser', blockRadius: 22, coverShadowAngle: 40, coverShadowLength: 90 },
      { x: 220, y: 170, type: 'patrol', blockRadius: 22, patrolPath: [{x:220,y:140},{x:220,y:200}], speed: 1.0 }
    ],
    targetZone: { x: 250, y: 140, w: 90, h: 70, label: 'Half-Space Right' },
    tacticalActions: { bounce: 1, thirdMan: 0, switchPlay: 1, dropPivot: 0 },
  },

  // ─── Phase 4: Full Pressing Blocks (Levels 16-20) ───
  {
    id: 16,
    name: 'Beat the 4-4-2 High Press',
    intro: 'Opponent defends in a compact 4-4-2. Break their first lines!',
    passLimit: 5,
    optimalPasses: 4,
    players: [
      { x: 45, y: 180, hasBall: true }, // LCB
      { x: 45, y: 80 },  // RCB
      { x: 140, y: 128 }, // DM (Pivot)
      { x: 160, y: 210 }, // LB
      { x: 290, y: 128 }  // AM
    ],
    defenders: [
      { x: 100, y: 175, type: 'presser', blockRadius: 26, coverShadowAngle: 35, coverShadowLength: 80 }, // Fwd 1
      { x: 100, y: 90, type: 'static', blockRadius: 24 },  // Fwd 2
      { x: 200, y: 128, type: 'chase', blockRadius: 22, alertRange: 80, speed: 1.1 }  // CM
    ],
    targetZone: { x: 250, y: 95, w: 90, h: 65, label: 'Between the Lines' },
    tacticalActions: { bounce: 1, thirdMan: 1, switchPlay: 0, dropPivot: 1 },
  },
  {
    id: 17,
    name: 'Beat the 4-3-3 Mid Press',
    intro: 'Escape the 3-man frontline pressing trap!',
    passLimit: 2,
    optimalPasses: 1,
    players: [
      { x: 40, y: 128, hasBall: true }, // GK
      { x: 90, y: 60 },   // LCB
      { x: 90, y: 196 },  // RCB
      { x: 180, y: 128 }, // DM
      { x: 280, y: 128 }  // CM
    ],
    defenders: [
      { x: 120, y: 95, type: 'presser', blockRadius: 20, coverShadowAngle: 35, coverShadowLength: 75 }, // LW
      { x: 120, y: 160, type: 'presser', blockRadius: 20, coverShadowAngle: 35, coverShadowLength: 75 }, // RW
      { x: 140, y: 128, type: 'static', blockRadius: 22 }, // CF
      { x: 220, y: 128, type: 'chase', blockRadius: 22, alertRange: 70, speed: 1.0 }  // CM
    ],
    targetZone: { x: 250, y: 95, w: 80, h: 65, label: 'Deep Pivot' },
    tacticalActions: { bounce: 1, thirdMan: 1, switchPlay: 0, dropPivot: 1 },
  },
  {
    id: 18,
    name: 'Man-Oriented Block',
    intro: 'Every teammate is tightly marked. Shift them with tactical runs!',
    passLimit: 4,
    optimalPasses: 3,
    players: [
      { x: 40, y: 128, hasBall: true },
      { x: 130, y: 70 },
      { x: 130, y: 180 },
      { x: 230, y: 128 },
      { x: 320, y: 170 } // Moved outside target zone
    ],
    defenders: [
      { x: 130, y: 105, type: 'static', blockRadius: 24 }, // Mark player 1
      { x: 130, y: 145, type: 'presser', blockRadius: 20, coverShadowAngle: 40, coverShadowLength: 80 }, // Mark center
      { x: 220, y: 160, type: 'chase', blockRadius: 22, alertRange: 80, speed: 1.2 }
    ],
    targetZone: { x: 260, y: 70, w: 90, h: 65, label: 'Pivot Hole' },
    tacticalActions: { bounce: 1, thirdMan: 1, switchPlay: 0, dropPivot: 1 },
  },
  {
    id: 19,
    name: 'The Wing Trap Escape',
    intro: 'Opponent seals the flank. Switch or bounce to escape!',
    passLimit: 2,
    optimalPasses: 1,
    players: [
      { x: 50, y: 200, hasBall: true },
      { x: 130, y: 200 },
      { x: 150, y: 140 },
      { x: 280, y: 60 }
    ],
    defenders: [
      { x: 90, y: 190, type: 'static', blockRadius: 24 },
      { x: 150, y: 195, type: 'presser', blockRadius: 22, coverShadowAngle: 45, coverShadowLength: 85 },
      { x: 180, y: 150, type: 'static', blockRadius: 26 },
      { x: 220, y: 100, type: 'chase', blockRadius: 22, alertRange: 90, speed: 1.0 }
    ],
    targetZone: { x: 240, y: 30, w: 90, h: 70, label: 'Isolation Area' },
    tacticalActions: { bounce: 0, thirdMan: 1, switchPlay: 1, dropPivot: 1 },
  },
  {
    id: 20,
    name: 'Build-Up Masterclass',
    intro: 'Beat the aggressive high press block using every tactical tool!',
    passLimit: 3,
    optimalPasses: 2,
    players: [
      { x: 35, y: 128, hasBall: true }, // GK
      { x: 95, y: 60 },   // LCB
      { x: 95, y: 196 },  // RCB
      { x: 175, y: 128 }, // DM
      { x: 200, y: 55 },   // LB
      { x: 325, y: 215 }  // AM
    ],
    defenders: [
      { x: 105, y: 100, type: 'presser', blockRadius: 22, coverShadowAngle: 35, coverShadowLength: 80 },
      { x: 105, y: 155, type: 'presser', blockRadius: 22, coverShadowAngle: 35, coverShadowLength: 80 },
      { x: 195, y: 105, type: 'chase', blockRadius: 22, alertRange: 90, speed: 1.3 },
      { x: 250, y: 75, type: 'patrol', blockRadius: 20, patrolPath: [{x:220,y:75},{x:270,y:75}], speed: 1.1 },
      { x: 225, y: 128, type: 'presser', blockRadius: 22, coverShadowAngle: 35, coverShadowLength: 85 }
    ],
    targetZone: { x: 255, y: 95, w: 90, h: 65, label: 'Escape Zone' },
    tacticalActions: { bounce: 1, thirdMan: 1, switchPlay: 1, dropPivot: 1 },
  },
  // ─── Phase 5: GED FUTBOL Tactical Series (Levels 21-25) ───
  {
    id: 21,
    name: 'Pin & Attract',
    intro: 'Carry the ball to attract the defender, opening the passing lane to the free man!',
    passLimit: 3,
    optimalPasses: 2,
    players: [
      { x: 45, y: 190, hasBall: true }, // LCB
      { x: 130, y: 220 }, // LB
      { x: 140, y: 128 }, // DM
      { x: 280, y: 128 }  // AM (Target)
    ],
    defenders: [
      { x: 110, y: 170, type: 'presser', blockRadius: 22, coverShadowAngle: 40, coverShadowLength: 90 }, // Fwd 1
      { x: 210, y: 155, type: 'chase', blockRadius: 18, alertRange: 80, speed: 1.1 }  // CM
    ],
    targetZone: { x: 250, y: 90, w: 70, h: 76, label: 'AM Pocket' },
    tacticalActions: { bounce: 1, thirdMan: 0, switchPlay: 0, dropPivot: 0 },
  },
  {
    id: 22,
    name: 'The Third Man Rondo',
    intro: 'The direct lane to the forward is blocked. Use a connector to find the third man!',
    passLimit: 2,
    optimalPasses: 1,
    players: [
      { x: 50, y: 128, hasBall: true }, // CB
      { x: 160, y: 128 }, // DM (Connector)
      { x: 180, y: 55 },  // RB (Intermediary)
      { x: 290, y: 80 }   // RW (Runner)
    ],
    defenders: [
      { x: 150, y: 75, type: 'presser', blockRadius: 24, coverShadowAngle: 45, coverShadowLength: 100 }, // LW
      { x: 180, y: 160, type: 'static', blockRadius: 20 } // CM
    ],
    targetZone: { x: 250, y: 40, w: 90, h: 70, label: 'Weak Side LHS' },
    tacticalActions: { bounce: 0, thirdMan: 1, switchPlay: 0, dropPivot: 0 },
  },
  {
    id: 23,
    name: 'Attract & Play Wide',
    intro: 'Attract the press inside using a bounce pass, then switch play to the isolated winger!',
    passLimit: 3,
    optimalPasses: 2,
    players: [
      { x: 45, y: 180, hasBall: true }, // LCB
      { x: 130, y: 140 }, // DM
      { x: 160, y: 110 }, // CM
      { x: 300, y: 45 }   // RW (Target — wide & high, just outside the zone)
    ],
    defenders: [
      { x: 100, y: 170, type: 'presser', blockRadius: 22, coverShadowAngle: 35, coverShadowLength: 80 },
      { x: 150, y: 135, type: 'static', blockRadius: 24 },
      { x: 180, y: 110, type: 'chase', blockRadius: 20, alertRange: 90, speed: 1.0 }
    ],
    targetZone: { x: 250, y: 75, w: 90, h: 60, label: 'Isolation Wing' },
    tacticalActions: { bounce: 1, thirdMan: 0, switchPlay: 1, dropPivot: 0 },
  },
  {
    id: 24,
    name: 'La Salida Lavolpiana',
    intro: 'Drop the pivot between centerbacks to escape the high two-forward press!',
    passLimit: 4,
    optimalPasses: 3,
    players: [
      { x: 50, y: 180, hasBall: true }, // LCB
      { x: 50, y: 80 },  // RCB
      { x: 150, y: 130 }, // DM (Pivot to drop)
      { x: 150, y: 230 }, // LB (deeper — no direct entry to the zone)
      { x: 310, y: 175 }  // CM (Target — outside the zone, needs a final entry pass)
    ],
    defenders: [
      { x: 110, y: 165, type: 'presser', blockRadius: 24, coverShadowAngle: 35, coverShadowLength: 90 }, // ST1
      { x: 110, y: 95, type: 'static', blockRadius: 22 }  // ST2
    ],
    targetZone: { x: 250, y: 95, w: 90, h: 65, label: 'Zone 14' },
    tacticalActions: { bounce: 1, thirdMan: 0, switchPlay: 0, dropPivot: 1 },
  },
  {
    id: 25,
    name: 'GED FUTBOL Masterclass',
    intro: 'Bypass the entire mid-block using a combination of all tactical tools!',
    passLimit: 3,
    optimalPasses: 2,
    players: [
      { x: 35, y: 128, hasBall: true }, // GK/DM
      { x: 95, y: 180 }, // LCB
      { x: 95, y: 80 },  // RCB
      { x: 180, y: 215 }, // LB
      { x: 200, y: 128 }, // CM
      { x: 310, y: 38 }   // AM (Target — wide & high, just outside the zone)
    ],
    defenders: [
      { x: 140, y: 128, type: 'presser', blockRadius: 22, coverShadowAngle: 35, coverShadowLength: 85 },
      { x: 160, y: 175, type: 'static', blockRadius: 22 },
      { x: 170, y: 85, type: 'static', blockRadius: 22 },
      { x: 250, y: 100, type: 'chase', blockRadius: 22, alertRange: 80, speed: 1.2 }
    ],
    targetZone: { x: 250, y: 55, w: 90, h: 65, label: 'LHS Pocket' },
    tacticalActions: { bounce: 1, thirdMan: 1, switchPlay: 1, dropPivot: 1 },
  }
];

// Expose for the engine (global LEVELS) and index.html (window.LEVELS)
if (typeof window !== 'undefined') {
  window.LEVELS = LEVELS;
}
