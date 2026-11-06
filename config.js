// Edit this file to make the dashboard yours.
// Team number and event code can also be set on screen (press S).
window.PIT_CONFIG = {
  team: 7831,          // Titan F1
  teamName: "Titan F1",
  event: "USCALAMVS4", // SoCal F1 Scrimmage 1, Moreno Valley HS, Sat Nov 7 2026
  season: 2026,        // 2026 = BIOBUZZ (2026-27)

  // 3D model shown in judge mode
  robotModel: "models/robot.glb",

  refreshSeconds: 60,
  queueWhenMatchesAway: 3,

  // Switches to judge mode after this many idle minutes (0 = never)
  judgeIdleMinutes: 0,

  checklist: [
    "Battery charged (13 V+)",
    "Spare battery on charger",
    "Driver Hub charged + paired",
    "Correct OpMode selected",
    "Wheels + intake checked for debris",
    "All wires zip-tied, nothing loose",
    "Shooter spins up",
    "Robot fits in the 18 in sizing box",
    "Alliance + auto start position agreed",
  ],

  // Judge-mode slides. Put photos in the slides/ folder.
  slides: [
    {
      title: "Meet our robot",
      image: "",
      bullets: [
        "Dual intake: grabs POLLEN from either side",
        "Roller shooter tuned for NECTAR and POLLEN",
        "Field-centric drive with IMU heading hold",
      ],
    },
    {
      title: "How we designed it",
      image: "",
      bullets: [
        "CAD in Onshape before cutting a single part",
        "Shot simulator to pick launch speed and angle",
        "Plywood + PETG parts bolted to goBILDA metal",
      ],
    },
    {
      title: "Our code",
      image: "",
      bullets: [
        "Pedro Pathing for autonomous",
        "AprilTag aiming on the HIVE cells",
        "Live tuning from the gamepad at meets",
      ],
    },
  ],
};
