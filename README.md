# pi-setup

This repository contains my personal Pi setup and configuration.
I’ll keep updating it over time as my workflow evolves.

Clone this repository into your `.pi/agent` folder.

## Extensions environment variables

The `extensions/project-finish-notify.ts` extension talks to the local
[Pi notification relay](https://github.com/GearHead87/pi-notification-browser-extension)
and must authenticate with an API key. Create a `.env` file inside the
`extensions/` folder so the extension can pick the key up at load time.

```bash
# /home/hosan/.pi/agent/extensions/.env

# Required — must match PI_NOTIFICATION_RELAY_API_KEY in the relay's own .env
PI_NOTIFICATION_RELAY_API_KEY=your-secret-key

# Optional — defaults to http://127.0.0.1:48291/notify
# PI_BROWSER_NOTIFICATION_RELAY_URL=http://127.0.0.1:48291/notify
```

Notes:

- The **same** value must be set in three places:
  1. The relay process (`PI_NOTIFICATION_RELAY_API_KEY` in `relay/.env`).
  2. This Pi extension (`extensions/.env`, shown above).
  3. The browser extension — configured through its UI, **not** via env
     anymore. Click the extension icon in Chrome → ⚙️ Settings → paste the
     key into the `x-api-key` field and save.

  If they don't match, the relay rejects `notify` requests with `403`.
- The `.env` file is read from the same directory as
  `project-finish-notify.ts`, so keep it at `extensions/.env`.
- `.env` is already covered by `.gitignore` — do not commit your key.
- After creating or changing `.env`, run `/reload` in Pi (or restart it) so
  the extension picks up the new value.
