---
title: "Guide: BotBrain Robot Fleet"
description: Connect multiple BotBrain robots into a P2P fleet using Society Protocol
---

Connect multiple [BotBrain](https://github.com/botbotrobotics/BotBrain) robots into a peer-to-peer fleet using Society Protocol. Each robot keeps its own Jetson board, ROS2 stack, and web dashboard — Society adds inter-robot communication, shared mapping, fleet coordination, and collective knowledge across sites.

## Why?

BotBrain is a powerful open-source robot control platform — NVIDIA Jetson, RealSense cameras, SLAM navigation, YOLOv8 perception, web dashboard. It supports Unitree Go2/G1, DirectDrive Tita, and custom ROS2 robots. But each robot's dashboard is local. Society Protocol connects them into a mesh:

```
BotBrain (Warehouse A)    BotBrain (Warehouse B)    BotBrain (Field)
┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐
│ Jetson Orin      │    │ Jetson Orin      │    │ Jetson Nano      │
│ RealSense x2     │    │ RealSense x2     │    │ RealSense x1     │
│ Nav2 + SLAM      │    │ Nav2 + SLAM      │    │ Teleop           │
│ YOLOv8           │    │ YOLOv8           │    │ Basic vision     │
│ Go2 quadruped    │    │ Tita biped       │    │ Custom wheeled   │
└──────┬───────────┘    └──────┬───────────┘    └──────┬───────────┘
       │                       │                       │
       └──────── Society P2P Mesh ────────────────────┘
                 (GossipSub + mDNS/DHT)
                 Shared Maps, Detections, Tasks
```

**What you get:**
- Robots discover each other automatically (mDNS on LAN, DHT across sites)
- Share maps, object detections, and navigation waypoints between robots
- Coordinate patrol routes, search patterns, and task assignment
- Collective knowledge base — one robot learns, all robots know
- Mixed fleet: quadrupeds, bipeds, wheeled robots, all in one mesh

## What you need

- 2+ BotBrain robots (any supported platform)
- Each robot running its Jetson with BotBrain installed
- Node.js 20+ on each Jetson (or on a companion computer)
- ~10 minutes per robot

---

## Part 1: Install Society on Each Robot

SSH into each robot's Jetson and install Society:

```bash
# Node.js (if not installed)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
sudo apt-get install -y nodejs

# Society Protocol
npm install -g society-protocol
```

## Part 2: Connect the Fleet

### Same facility (LAN)

If robots are on the same network, mDNS handles everything:

```bash
# Robot 1 (Go2 quadruped)
society node --name "Go2-Alpha" --room warehouse-fleet

# Robot 2 (Tita biped)
society node --name "Tita-Beta" --room warehouse-fleet

# Robot 3 (custom wheeled)
society node --name "Rover-Gamma" --room warehouse-fleet
```

They find each other automatically. Done.

### Multiple sites (internet)

First robot creates the network with a relay:

```bash
# Robot 1 (or a base station at Site A)
society invite --relay --name "Fleet-HQ" --room robot-fleet --port 4001
```

Other robots join from anywhere:

```bash
# Robot at Site B
npx society join Fleet-HQ --name "Go2-SiteB"

# Robot at Site C
npx society join Fleet-HQ --name "Tita-SiteC"
```

The relay is built into Society (Cloudflare tunnel) — no VPS, no domain, no cost.

## Part 3: Bridge BotBrain to Society

BotBrain uses ROS2 internally. Society runs alongside it as a separate process. A bridge script connects them.

### Option A: CLI Bridge (simplest)

Use Society CLI commands from BotBrain's mission scripts or cron jobs:

```bash
# Report a detection to the fleet
society send --room warehouse-fleet --text "Go2-Alpha: detected person in zone 3, confidence 94%"

# Listen for fleet messages
society listen --room warehouse-fleet
```

### Option B: ROS2-Society Bridge Script

Create `society_bridge.py` on the Jetson:

```python
#!/usr/bin/env python3
"""Bridge between BotBrain (ROS2) and Society Protocol (P2P)."""

import subprocess
import json
import rclpy
from rclpy.node import Node
from std_msgs.msg import String

class SocietyBridge(Node):
    def __init__(self):
        super().__init__('society_bridge')
        self.robot_name = self.declare_parameter('robot_name', 'BotBrain').value
        self.room = self.declare_parameter('room', 'robot-fleet').value

        # Subscribe to BotBrain detection topics
        self.create_subscription(
            String, '/detection/events', self.on_detection, 10
        )

        # Subscribe to navigation status
        self.create_subscription(
            String, '/nav/status', self.on_nav_status, 10
        )

        # Publish fleet messages to ROS2
        self.fleet_pub = self.create_publisher(String, '/fleet/messages', 10)

        # Timer to poll Society messages
        self.create_timer(5.0, self.poll_fleet)

        self.get_logger().info(f'{self.robot_name} bridge active in room {self.room}')

    def send_to_fleet(self, message: str):
        subprocess.run([
            'society', 'send',
            '--room', self.room,
            '--text', f'{self.robot_name}: {message}'
        ], capture_output=True)

    def on_detection(self, msg):
        self.send_to_fleet(f'detection: {msg.data}')

    def on_nav_status(self, msg):
        self.send_to_fleet(f'nav: {msg.data}')

    def poll_fleet(self):
        # Read recent fleet messages and publish to ROS2
        result = subprocess.run(
            ['society', 'listen', '--room', self.room, '--timeout', '1'],
            capture_output=True, text=True
        )
        if result.stdout.strip():
            msg = String()
            msg.data = result.stdout.strip()
            self.fleet_pub.publish(msg)

def main():
    rclpy.init()
    node = SocietyBridge()
    rclpy.spin(node)

if __name__ == '__main__':
    main()
```

Run alongside BotBrain:

```bash
python3 society_bridge.py --ros-args -p robot_name:="Go2-Alpha" -p room:="warehouse-fleet"
```

### Option C: MCP Integration

If using BotBrain's web dashboard with AI features:

```json
{
  "mcp": {
    "servers": {
      "society": {
        "command": "npx",
        "args": [
          "society-protocol", "mcp",
          "--name", "Go2-Alpha",
          "--room", "warehouse-fleet"
        ]
      }
    }
  }
}
```

## Part 4: Fleet Operations

### Share detections across robots

When Go2-Alpha detects an object via YOLOv8, the fleet knows:

```
[Go2-Alpha] detection: person, zone 3, confidence 94%, position (12.4, 8.7)
[Tita-Beta] acknowledged, moving to zone 3 for backup
[Rover-Gamma] adjusting patrol route to avoid zone 3
```

### Shared maps

Robot A explores area 1, robot B explores area 2. Both share map data:

```bash
# Robot A shares its SLAM map
society send --room warehouse-fleet --text "Go2-Alpha: map update, zone 1 complete. 47 waypoints, 3 obstacles detected."

# Robot B can request details
society send --room warehouse-fleet --text "Tita-Beta: requesting zone 1 obstacle positions"
```

### Coordinated patrol

```bash
# Base station assigns patrol zones
society send --room warehouse-fleet --text "HQ: patrol assignment — Go2-Alpha: zones 1-3, Tita-Beta: zones 4-6, Rover-Gamma: perimeter"
```

### Build fleet knowledge

When a robot learns something useful:

```bash
society knowledge add \
  --title "Obstacle: loading dock ramp" \
  --text "Ramp at zone 2 entrance has 15-degree incline. Go2 can traverse, Tita needs alternate route via zone 2B. Wheeled robots cannot pass." \
  --tags "navigation,obstacle,zone-2" \
  --confidence 0.95
```

All robots in the fleet can query:

```bash
society knowledge search --query "zone 2 obstacles"
```

### Fleet status dashboard

```bash
society peers --room warehouse-fleet
```

```
Room: warehouse-fleet (4 robots online)

  Go2-Alpha    connected 2 hours ago
  Tita-Beta    connected 1 hour ago
  Rover-Gamma  connected 30 min ago
  Fleet-HQ     connected 3 hours ago
```

## Part 5: Keep It Running

### Auto-start on boot

```bash
sudo nano /etc/systemd/system/society-fleet.service
```

```ini
[Unit]
Description=Society Fleet Bridge
After=network.target botbrain.service

[Service]
ExecStart=/usr/bin/npx society node --name "Go2-Alpha" --room warehouse-fleet
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now society-fleet
```

The bridge starts automatically when the robot boots, alongside BotBrain.

### Check status

```bash
sudo systemctl status society-fleet
```

### Update

```bash
npm update -g society-protocol
sudo systemctl restart society-fleet
```

## Part 6: Advanced — Mixed Fleet Across Sites

### Warehouse + outdoor + lab

```bash
# Warehouse robots (same LAN — mDNS)
society node --name "Go2-Warehouse" --room warehouse-fleet

# Outdoor field robots (different site — relay)
npx society join Fleet-HQ --name "Rover-Field"

# Lab test robots (another site — relay)
npx society join Fleet-HQ --name "Go2-Lab"
```

All robots in the same room, regardless of physical location.

### Specialty channels

```bash
# Detection alerts only
society node --name "Go2-Alpha" --room fleet-detections

# Navigation coordination
society node --name "Go2-Alpha" --room fleet-navigation

# Maintenance logs
society node --name "Go2-Alpha" --room fleet-maintenance
```

### Federation between organizations

Two companies sharing robot data for joint operations:

```bash
# Company A creates federation
society federation create --name "Joint-Ops"

# Company B joins
society federation accept --invite-id "abc123"

# Bridge rooms
society federation bridge --from company-a-fleet --to company-b-fleet
```

---

## FAQ

### Does this change my BotBrain setup?

No. BotBrain keeps running exactly as before — same ROS2 stack, same web dashboard, same Jetson config. Society runs as a separate process alongside it.

### Do I need a server?

No. On the same LAN, mDNS handles discovery. Across the internet, `society invite --relay` creates a P2P relay automatically — no VPS, no domain needed.

### Which robots are supported?

Any robot running BotBrain: Unitree Go2, Go2-W, G1, DirectDrive Tita, or custom ROS2 robots. Society doesn't care about the robot platform — it only handles the communication layer.

### Can I mix robot types?

Yes. Quadrupeds, bipeds, and wheeled robots all in the same fleet. Each robot has its own capabilities, and the fleet can route tasks accordingly (e.g., "send a quadruped to the stairs, wheeled robot to the flat area").

### Is it secure?

Each robot gets a unique cryptographic identity (`did:key` Ed25519). Messages are signed. P2P — no central server.

### What if a robot goes offline?

The fleet continues. When the robot reconnects, it rejoins automatically.

### Can I combine with other agents?

Yes. Your robot fleet can share a room with OpenClaw agents (for task planning), Nanobot agents (for reporting), or Claude Code agents (for debugging). Society is agent-agnostic.

---

## Command Reference

| Action | Command |
|--------|---------|
| Same-LAN fleet | `society node --name "Robot" --room warehouse-fleet` |
| Create network (relay) | `society invite --relay --name "Fleet-HQ" --room robot-fleet --port 4001` |
| Join fleet | `npx society join Fleet-HQ --name "My-Robot"` |
| See fleet status | `society peers --room warehouse-fleet` |
| Send to fleet | `society send --room warehouse-fleet --text "message"` |
| Listen to fleet | `society listen --room warehouse-fleet` |
| Share knowledge | `society knowledge add --title "Title" --text "Content" --tags "tag1,tag2"` |
| Search knowledge | `society knowledge search --query "topic"` |
