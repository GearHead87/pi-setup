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
PI_NOTIFICATION_RELAY_API_KEY=your-secret-key
```

Notes:

- The same value must be set on the relay process
  (`PI_NOTIFICATION_RELAY_API_KEY=...`) and on the browser extension build
  (`PLASMO_PUBLIC_PI_NOTIFICATION_RELAY_API_KEY=...`). If they don't match,
  the relay will reject the `notify` request with `403`.
- The `.env` file is read from the same directory as
  `project-finish-notify.ts`, so keep it at `extensions/.env`.
- `.env` is already covered by `.gitignore` — do not commit your key.
- After creating or changing `.env`, run `/reload` in Pi (or restart it) so
  the extension picks up the new value.
