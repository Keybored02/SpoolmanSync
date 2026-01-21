# SpoolmanSync

![Build Status](https://github.com/gibz104/SpoolmanSync/actions/workflows/docker-publish.yml/badge.svg)

Sync Bambu Lab AMS trays with [Spoolman](https://github.com/Donkie/Spoolman) via Home Assistant.

SpoolmanSync automatically tracks which filament spools are loaded in your Bambu Lab printer's AMS units and syncs this information with Spoolman for accurate filament inventory management.

## Features

- **Dashboard** - View all your printers, AMS units, and tray assignments at a glance
- **Spool Assignment** - Click any tray to assign a spool from your Spoolman inventory
- **QR Code Scanning** - Scan Spoolman QR codes or custom barcodes to quickly look up and assign spools
- **Bambu Cloud Login** - Add printers by logging in with your Bambu Cloud account
- **Bundled Home Assistant** - Includes a pre-configured Home Assistant with ha-bambulab integration
- **Webhook Integration** - Receives tray change events from Home Assistant automations
- **Activity Logging** - Track all spool changes and sync events

## Quick Install (Pre-built Images)

The fastest way to get started using pre-built Docker images:

```bash
# Download the compose file
curl -O https://raw.githubusercontent.com/gibz104/SpoolmanSync/main/docker-compose.prebuilt.yml

# Start with embedded Home Assistant (recommended for most users)
docker compose -f docker-compose.prebuilt.yml --profile embedded up -d

# Or, if you already have Home Assistant with ha-bambulab
docker compose -f docker-compose.prebuilt.yml --profile external up -d
```

Then open http://localhost:3000 and follow the setup steps below.

---

## Building from Source

If you prefer to build locally or want to contribute:

### 1. Clone the Repository

```bash
git clone https://github.com/gibz104/SpoolmanSync.git
cd SpoolmanSync
```

### 2. Choose Your Mode

SpoolmanSync requires a Docker Compose profile. Choose based on your setup:

| Mode | Command | Best For |
|------|---------|----------|
| **Embedded** | `docker compose --profile embedded up -d` | Most users - includes bundled Home Assistant |
| **External** | `docker compose --profile external up -d` | Users who already have Home Assistant with ha-bambulab |

---

## Embedded Mode Setup (Recommended)

Use this if you don't have Home Assistant or want a simpler setup.

### Step 1: Start the Application

```bash
docker compose --profile embedded up -d
```

### Step 2: Open the UI

Go to http://localhost:3000 in your browser.

### Step 3: Add Your Printer

1. Go to **Settings** in the navigation
2. Click **Add Printer**
3. Log in with your Bambu Cloud email and password
4. Enter the verification code sent to your email
5. Select your printer from the list
6. Click **Continue**

https://github.com/user-attachments/assets/51e006da-cdae-4db8-b261-bd622802ff62

### Step 4: Connect Spoolman

1. In **Settings**, scroll to the Spoolman section
2. Enter your Spoolman URL (e.g., `http://127.0.0.1:7912`)
3. Click **Connect**

https://github.com/user-attachments/assets/47153c92-0a99-4749-8519-a24f1baad8a6

### Step 5: Set Up Automations

This enables automatic tray change detection.

1. Go to **Automations** in the navigation
2. Click **Configure Automations**
3. The automations are automatically created in the embedded Home Assistant

https://github.com/user-attachments/assets/4019ee5d-b2bb-4ae9-9c52-f581ec43f8c5

### You're Done!

Your dashboard should now show your printer with AMS trays. Click any tray to assign a spool from your Spoolman inventory.

---

## External Mode Setup

Use this if you already have Home Assistant with [ha-bambulab](https://github.com/greghesp/ha-bambulab) configured.

### Step 1: Start the Application

```bash
docker compose --profile external up -d
```

### Step 2: Open the UI

Go to http://localhost:3000 in your browser.

### Step 3: Connect Home Assistant

1. Go to **Settings** in the navigation
2. Enter your Home Assistant URL (e.g., `http://127.0.0.1:8123`)
3. Click **Connect with Home Assistant**
4. You'll be redirected to Home Assistant to authorize SpoolmanSync
5. Enter you Home Assistant credentials and click "Log in"

https://github.com/user-attachments/assets/1f711fd2-28cd-41b5-8a41-06e991baec83

Your printers should automatically appear on the dashboard (discovered from ha-bambulab).

### Step 4: Connect Spoolman

1. In **Settings**, scroll to the Spoolman section
2. Enter your Spoolman URL (e.g., `http://127.0.0.1:7912`)
3. Click **Connect**

https://github.com/user-attachments/assets/915a321a-a6a8-4f81-85ae-5e7f6121f536

### Step 5: Set Up Automations

This enables automatic spool tracking and filament usage monitoring.

1. Go to **Automations** in the navigation
2. Enter the **SpoolmanSync URL** - the address where Home Assistant can reach SpoolmanSync (e.g., `http://192.168.1.100:3000`). Use your machine's IP address, not `localhost`, if Home Assistant is on a different machine.
3. Click **Generate Configuration**
4. You'll see two YAML configurations:
   - **configuration.yaml** - Copy and add to your Home Assistant's `configuration.yaml`
   - **automations.yaml** - Copy and add to your Home Assistant's `automations.yaml`
5. Restart Home Assistant
6. Return to SpoolmanSync and click **Mark as Configured**

https://github.com/user-attachments/assets/06f0c220-e30a-4d19-9960-d8d6c10ae257

### You're Done!

Your dashboard should now show your printers with AMS trays. Click any tray to assign a spool from your Spoolman inventory.

---

## Stopping and Restarting

Always use the same profile you used to start:

```bash
# Embedded mode
docker compose --profile embedded down      # Stop
docker compose --profile embedded up -d     # Start

# External mode
docker compose --profile external down      # Stop
docker compose --profile external up -d     # Start
```

---

## How It Works

1. **Discovery**: SpoolmanSync connects to Home Assistant and discovers Bambu Lab printers via the ha-bambulab integration entities.

2. **Manual Assignment**: Users can manually assign spools to trays via the dashboard or by scanning QR codes.

3. **Automatic Sync**: When Home Assistant automations detect tray changes, they call the SpoolmanSync webhook with tray information (color, material, tag UID). SpoolmanSync matches this to spools in Spoolman and updates the `active_tray` extra field.

4. **Spoolman Integration**: All spool assignments are stored in Spoolman's `extra` field as `active_tray`, making it compatible with other Spoolman integrations.

---

## Troubleshooting

### "No service selected" when running docker compose

You must specify a profile:
```bash
docker compose --profile embedded up -d
# or
docker compose --profile external up -d
```

### No printers found

**Embedded mode:**
- Make sure you've added a printer via the **Add Printer** button
- Check that your Bambu Cloud credentials are correct

**External mode:**
- Ensure ha-bambulab integration is installed and configured in your Home Assistant
- Verify your Home Assistant URL is correct and you authorized SpoolmanSync
- Check the Logs page for error messages

### Webhook not working
- Verify the automations were added to Home Assistant
- Make sure you clicked **Mark as Configured** after adding the automations
- Check that the SpoolmanSync URL you entered is reachable from Home Assistant (use your machine's IP address, not `localhost`)
- Check that SpoolmanSync is accessible from Home Assistant's network

### QR scanner not working
- Ensure you've granted camera permissions in your browser
- Try using a different camera if available
- Use manual search as a fallback

---

## License

MIT License - see [LICENSE.txt](LICENSE.txt)

## Contributing

Contributions are welcome! Please open an issue or pull request.
