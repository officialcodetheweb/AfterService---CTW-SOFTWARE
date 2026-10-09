# After Service — online licence & update server

This small server lets **CTW Software** see every After Service licence in use, extend or cancel licences remotely,
and push updates. It has no dependencies (Node 18 or newer), and stores everything in one folder (`DATA_DIR`).

**Nothing on the server can be forged.** Licences, extensions, cancellations and updates are signed on your PC by the
Licence Manager with your private key. The server checks each signature before accepting it, and After Service checks
them again. Even someone who broke into the server could not cancel, extend or push an update. The private key never
leaves your PC.

## What it needs

| Setting | What it is |
|---|---|
| `ADMIN_TOKEN` | A long secret password (at least 16 characters) used by the Licence Manager. |
| `DATA_DIR` | A folder that survives restarts (a persistent disk). It holds the licence list and the update installers. Allow about 1 GB. |
| `PORT` | Usually set by the host; default 8787. |
| `PUBKEY` *(optional)* | Your public key. If you leave it out, the Licence Manager sends it the first time it connects. |

## Put it online (choose one)

**Render (easiest)**
1. Push the project to a private GitHub repository.
2. On render.com, choose **New → Blueprint** and select the repository. `server/render.yaml` sets everything up, including a 2 GB disk.
3. Open the service. Under **Environment**, copy the generated `ADMIN_TOKEN`, and copy the address (e.g. `https://after-service-licences.onrender.com`).

**Railway / Fly.io / any Docker host**
Use `server/Dockerfile`, mount a volume at `/data`, and set `ADMIN_TOKEN`.

**Your own computer or VPS**
`ADMIN_TOKEN=your-long-secret DATA_DIR=/srv/as-data node server/server.js`, then put it behind HTTPS (e.g. Caddy or Nginx).

## Connect it

1. Open the **Licence Manager**, then **Settings → Online service**. Paste the server address and the admin password, then click **Connect**.
   The server learns your public key, and licences you issued before are uploaded once.
2. In **Settings → Build After Service with these keys**, choose the After Service project folder.
   This writes the server address into `src/license-pub.json`.
3. Build After Service again (`npm run dist:win`) and give that version to your customers.
   From then on, each copy checks in when it starts and every 6 hours.

## What you can then do (Licence Manager)

- **Licences tab:** see every licence: church, Device ID, computer name, active / expired / cancelled, last seen, version.
  - **Extend:** the computer picks up the new end date by itself the next time it is online. An expired, locked copy unlocks itself.
  - **Cancel / Restore:** the computer locks (or unlocks) the next time it checks in.
- **Updates tab:** choose the new `After Service Setup x.y.z.exe` and click **Publish**. Every older copy downloads it in the background,
  checks it is genuine and complete, and asks the user to **Restart and update**. The update installs quietly and keeps the licence,
  workspace and settings.

Without internet, After Service keeps working until its licence date, exactly as before.

## API (for reference)

- `POST /api/checkin`: called by After Service with `{ id, hw, version }`. It returns the newest signed key, any cancellation, and any update.
- `GET /releases/<file>`: downloads the update installer (resumable).
- `/api/admin/*`: used by the Licence Manager (`Authorization: Bearer <ADMIN_TOKEN>`).
