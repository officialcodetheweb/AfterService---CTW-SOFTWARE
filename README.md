# After Service (CTW Software) — v2.6.0

Run in dev:  `npm install` then `npm start`   (licence checks are skipped in dev; use `set AS_LICENSE=1` to test them)
First time only:  `npm run license`  (creates your licence keys — see "Licences" below)
Build installer:  `npm run dist:win`  → `dist/After Service Setup 2.6.0.exe`
Licence Manager installer:  `npm run dist:manager`  → `dist/licence-manager/After Service Licence Manager Setup 1.0.0.exe`
Licence server:  see `server/README.md`

After unzipping run `npm install` once — v1.7/1.8 add the `heic-convert` and `qrcode` packages.

`npm install` also downloads the video engine (ffmpeg-static). It is bundled into the installer automatically.

Workspace layout (created inside Documents\<YourName>): Presets/, Overlays/, Exports/, Sounds/

## Picture editing
- Hover a thumbnail → trash button deletes it. Ctrl+click to select several → "Delete". The Delete key also works.
  Deleted pictures go to the Recycle Bin (recoverable).
- Presets are saved as **.aspreset** files (After Service Preset) — a packed binary format only After Service reads,
  with its own file icon. The overlay picture is packed inside, so a preset can be copied to another PC.
  Double-clicking an .aspreset file opens After Service and loads it. Old .json presets are converted automatically.

## Video editing
- Add videos (MP4, MOV, MKV, AVI, WMV, MTS…). iPhone HEVC and 4K videos are converted once into a smooth editing copy
  (kept in %APPDATA%\After Service\cache); export always uses the original file.
- Timeline: overlay layers (one row each) · V1 video clips · A1 video sound · A2 music.
  Drag clip edges to trim, drag clips to reorder, S to split, I / O to trim start/end at the playhead.
- Overlays: Text (Title, Lower third, Caption, Scripture), Shapes, Images — each with opacity, fade in/out, show from/until.
  Drag on the preview to move, mouse wheel to resize.
- Sound: add music, volume, fades, mute per clip / per track, noise reduction (export uses ffmpeg's FFT denoiser).
- Export: Landscape 16:9, Vertical 9:16 (Reels/Shorts/TikTok), Square 1:1 · 480p / 720p / 1080p · MP4 (H.264 + AAC).
  There is no length limit on exports — whole services can be exported.

## Sound library
- Documents\<YourName>\Sounds is your default sounds folder. Any MP3, WAV, M4A, AAC, OGG, FLAC or WMA file saved there
  (sub-folders become categories) appears in Video Editing → Sounds automatically — the folder is watched live.
- Add sounds with "+ Add sounds", by dragging files onto the video editor, or by saving downloads straight into the folder.
  Sounds picked with "Browse for a sound file…" are copied into the library too, so everything you add stays there.
- Click ▶ to listen, + (or double-click) to put it on the music track, 🗑 to move it to the Recycle Bin.
- Four starter sounds (assets/sounds) are copied into Sounds\After Service Starter the first time the app runs.

## After Service Player (optional, chosen during install)
- The installer has a page "After Service Player" with two checkboxes: install the Player (Start menu + desktop shortcuts)
  and add it to "Open with" for music/video files. It runs from the same program: `After Service.exe --player [files]`.
  It can also be opened from the "Player" button in the editor header.
- Library: Music, Videos and the workspace Sounds folder by default; add/remove folders; search; All / Music / Videos / Service sounds.
- Shuffle, Repeat playlist, Loop one track, Up next queue, 10-band equalizer with presets (Voice/sermon, Worship hall, Bass boost…),
  visualizer, album covers, video playback with full screen and pop-out (picture-in-picture), keyboard media keys.
- Keeps playing in the background: closing or minimizing while something plays shows a tiny "Now playing" bar with live sound
  waves at the top of the desktop (play/pause, previous, next, open, stop) plus a tray icon.
- Files the built-in decoder can't play (WMA, AVI, iPhone HEVC…) are converted once automatically.
- Shortcuts: Space play/pause · ←/→ seek · ↑/↓ volume · N/P next/previous · S shuffle · R repeat · L loop · E equalizer · F full screen · M mute.

## New in 2.6
**Icons fixed.** On some PCs the tool buttons in Video Editing showed empty boxes, because the editor started before its script had loaded. It now waits for the page to load, so every icon shows from the first moment. Start-up problems are written to `errors.log` in the app data folder.

**Scripture pop-ups.** Video Editing → Text → *Scripture pop-ups*. After Service listens to the sermon (it uses the same transcript as Auto captions) and finds every Bible reference the preacher says: "John 3:16", "First John one nine", "Psalm one hundred and nineteen verse one oh five", "Proverbs 3 verses 5 to 6", "Jude 24". Tick the ones you want, choose *Lower third* or *Centre card*, and each verse appears on screen just after it is read. Words that are also ordinary words ("job", "mark", "numbers", "acts") only count when they are clearly the book. Text → *Add a Bible verse…* adds any verse by hand. Every verse is a normal layer you can move, restyle, retime or delete. The text is the **King James Version** (public domain), built into the app, so it works offline.

**Speech clean-up.** Video Editing → select the audio → *Speech clean-up*. One click turns on:
- **Loudness levelling** to −14 LUFS, the standard for Instagram, TikTok, YouTube and Facebook (measured in two passes, so it is exact);
- **Hum removal** (50 Hz and 60 Hz mains hum and their harmonics);
- **Echo reduction** for big halls (softens the tail of the reverb);
- **Music ducking**: background music gets quieter by itself whenever someone speaks (set the amount with the slider). You hear the ducking in the preview too.
Each part can also be switched on or off on its own.

**Auto-update.** After Service checks in with your licence server when it starts and every 6 hours. When you publish a new version, it downloads in the background (it resumes if the internet drops, and is checked against your signature) and shows *"After Service X is ready — Restart and update"*. The update installs quietly and keeps the licence, workspace and settings.

**Online licence dashboard — the Licence Manager is now an installable app.** Build it with `npm run dist:manager` and install it on your own PC. It has:
- **Licences** — every licence, which computer uses it, when it was last seen and which version it runs; search by church, Device ID or computer name.
- **Extend** — choose a new end date; the customer's After Service picks up the new key on its next check-in (a locked app opens again by itself).
- **Cancel / Restore** — a cancelled licence locks the app at its next check-in; restoring opens it again.
- **New licence** — as before, and it is also sent to the server.
- **Updates** — choose the new installer, type the version and what's new, and press *Publish*. *Withdraw* takes it back.
- **Settings** — your keys (import your existing `license-keys\private.pem` the first time, so the licences you already sent keep working), the server address and admin password, and *Build After Service with these keys*, which writes the public key and the server address into this project.

**Safety.** Every extension, cancellation and update is signed with your private key and checked by After Service. Nobody, not even someone who took over the server, can cancel a licence or push an update. The private key never leaves your PC and is never uploaded. Without internet nothing changes: the licence simply keeps working until its end date.

**Setting it up (once):**
1. Put the server online. Follow `server/README.md` (Render.com in a few clicks, or any VPS with Docker). Choose a long admin password (ADMIN_TOKEN).
2. Install the Licence Manager, import your private key, then in Settings enter the server address and admin password and press *Connect*. The licences you issued before are uploaded.
3. Settings → *Build After Service with these keys* → choose this project folder.
4. `npm run dist:win`, then give this installer to your customers **once by hand**. From then on, publish new versions from the Updates tab and they arrive by themselves.

## New in 2.5

- **iPhone / Android import fixed** — an unlocked iPhone was still shown as "locked":
  - The app now takes a fresh look every few seconds, so it notices as soon as you unlock the phone and tap *Trust*.
  - It also reads iPhone storage that Windows doesn't report as a folder.
  - Android phones are read through *Internal shared storage* → DCIM, or Pictures if there is no DCIM.
  - If a phone still isn't sharing, the import window explains exactly what to tap: *Trust* on iPhone, *File transfer* on Android. For an iPhone it also covers resetting "Don't Trust" and installing the free Apple Devices app if Windows lacks the iPhone driver.
- **No video length limit** — the 5-minute export limit is gone. Export whole services.
- **Auto-reframe (follow the speaker)** — choose *Vertical* (or Square) in Export → Format with a landscape video, and *Fit* switches to *Follow the speaker*.
  - The app watches the video once (the result is kept), finds faces and whose mouth is moving, and moves a virtual camera like an operator would: it holds still while the speaker stays in place and glides when they walk.
  - When someone else starts talking, it cuts to them.
  - The preview shows the result, and the export matches it.
- **Multi-camera** — *Multi-cam* in the Add tools.
  1. Pick 2 or 3 recordings of the same service. Phones can start at different times; their sound lines them up to well under one frame.
  2. Play them side by side and click an angle (or press 1, 2, 3) to switch. *Switch for me* picks close-ups of whoever is talking, with a wide shot now and then.
  3. Choose which phone's sound to use, then *Put on the timeline*: the picture cuts between cameras and the sound stays on that one phone.
- **Export presets** — Export → *Export for…*: tick WhatsApp Status, Instagram, TikTok, YouTube and/or Facebook, then click once.
  - WhatsApp Status is vertical 720p and always under 16 MB. Longer videos are split into "part 1 of 3"… of 60 s each, ready to post in order.
  - Instagram and TikTok are vertical 1080×1920 and follow the speaker. YouTube and Facebook are landscape 1080p.
  - Everything is saved together in *Exports › <service theme> — for social media*.

## New in 2.4

- **Beat montage animation styles** — pick under *Animation*; each tile shows the style moving, using your photos:
  - *Hard cut*, *Flash*, *Slide*, *Whip pan* (fast swipe with motion blur), *Zoom through*, *Spin*, *Glitch* (colour split), *Panels* (strips slide in) and *Photo cards* (prints drop onto a pile).
  - *Mix* switches styles from cut to cut and saves the punchy ones for the loud parts.
  - *Colour*: Clean, Warm, Vivid, Film (grain and vignette) or Black & white.
  - *Pulse on every beat* adds a small bump on each beat, not only on the cuts.
- **Service history** — the date chip in the top bar shows which service your work goes into. Click it for *Services*.
  - Each Sunday is a card with its theme, date, preacher, series, tags and notes.
  - Picture folders, edited photos, designs, videos, sermon clips, montages and card imports are filed automatically, and you can open any of them again from the card.
  - Search with plain words: “Easter 2026”, “Pastor John”, “grace”, “October”, “choir”. Church days are recognised from the date: Easter, Good Friday, Palm Sunday, Pentecost, Mother’s Day, Advent, Christmas, Watch Night and more.
  - New designs start with the service’s theme, preacher and date already filled in.
- **Hot folder** — click *Hot folder* (left side), turn it on and choose:
  - what starts it: a memory card or camera, a phone, and/or a folder (e.g. a camera’s Wi-Fi or phone-sync folder);
  - which preset to apply;
  - which sizes to save (Square, Portrait 4:5, Story 9:16);
  - whether to leave out blurry, duplicate and closed-eye shots;
  - what to do when done: tell you, open the folder, or send the photos to phones.

  Then just insert the card. New photos are copied into *Imports* (HEIC becomes JPG, with the originals kept), edited with your preset and saved to *Exports › <date> <card> — ready to post*. Photos that were imported before are never processed twice.
- **Team mode** — click *Team* in the top bar.
  - One PC clicks *Start a team*; its workspace becomes the shared one, and it shows a 4-digit code.
  - The other PCs click *Join*, pick the team (found automatically on the same Wi-Fi, or type the PC’s address) and type the code.
  - Presets, Overlays, Sounds, Designs, Services, Exports and Imports are copied both ways every few seconds. The newest version of a file wins, and deleting a file only removes your own copy.
  - Everyone sees who is here and what they are doing. A coloured name tag appears on the photo a teammate has open, and you are warned if you open the same photo.
  - The code stays the same, and teammates reconnect by themselves the next time.
  - The first time, Windows Firewall asks to allow After Service on private networks — click *Allow*.

## New in 2.3

- **Beat montage** — click *Beat montage* under a photo (or the montage tool in Video Editing). Drop in photos and a song, or pick a song from your Sounds. The app finds the tempo and every beat, and puts each cut exactly on a beat. *Auto* gives about one photo per second and cuts faster in the loud parts. You can also choose every beat, 2 beats or 4 beats.
  - Length: each photo once, 30 s, 1 min or the whole song.
  - Shape: landscape, vertical or square. In vertical videos, photos of one or two people are cropped around their faces; group photos keep the whole frame on a blurred background.
  - Effects: slow movement and a flash on the beat (both optional).
  - Click the strip under the preview to choose where in the song the video starts, and press Space to preview with the music.
  - *Make video* saves to **Exports › Beat montages** with the song faded out at the end. From there you can play it, send it to phones, or open it in the video editor to add titles.
- **Design: move anything** — click any part of a design (title, subtitle, church name, date, logo, quote mark, a photo, the cut-out) to select it.
  - Drag it to move it, and pull the corner square to resize it.
  - Arrow keys nudge it (Shift for bigger steps), and Delete hides it.
  - Double-click a photo box to move the picture inside the box. Double-click words to edit them.
  - *Reset* puts one item back where the template had it, and *Reset layout* resets everything. *Show hidden* brings hidden items back.
- The template previews on the left now fit neatly inside their cards.
- Fixed: picture thumbnails overlapping after choosing a folder. The bar under the photo now stays on one line on small screens.

## New in 2.2

- **Remove background** — open a photo and click *Remove background* on the bar above it. Choose transparent (PNG), white, blurred or a colour behind the person, then *Save*. Works best on people. *Make a YouTube thumbnail* takes the cut-out straight into the thumbnail template.
- **People** — click *People* (next to *Auto-cull*). Faces in the folder are grouped by person. Click a face to show only their photos; Ctrl/Shift+click to add more people. Double-click a face to name it ("Pastor"). Names are remembered for future folders, and naming several groups the same thing ("Choir") puts them together. Groups are suggestions, so check them before relying on them.
- **Match look** — in the picture filters panel, open a photo you love and click *Use this photo's look*. Every other photo you view or save is matched to its colour and brightness. The slider sets how strong it is; *×* turns it off.
- **Social sizes** — when you click *Apply & Save…*, tick Square 1:1, Portrait 4:5 and/or Story 9:16. Each photo is also saved in those sizes, cropped around the faces, into its own sub-folder.
- **Design** — the *Design* button opens templates. These are Sunday recap collages (4-photo grid, hero, mosaic), an event flyer (social or A4 print), a verse card and a **YouTube thumbnail** (preacher cut-out, big title, glow). Your best photos are filled in automatically (sharp, eyes open, no duplicates). Click a box to swap its photo, drag to move it, type your words, and pick a colour and size. *Save* puts the design in the **Designs** folder of your workspace, and you can send it to phones from there.

## New in 2.1
**Edit by text** (Video side → inspector tab **Text**)
- Shows every word of the timeline like a document. Click a word to jump there; drag across words (or Shift+click) to select.
- **Delete** cuts the selected words out of the video. **Keep only this** keeps just the selection (fast way to make a clip). Ctrl+Z undoes.
- **Remove pauses** (longer than 0.6 / 1 / 1.5 / 2 s) and **Remove “um, uh”** in one click. ✂ marks where the video is already cut.
- Captions now follow every cut and trim automatically, and word fixes show up in both places.

**Sermon clip finder**: new default length **30 – 60 seconds (Reels, Shorts)** and **Make videos** — each chosen moment becomes its own finished vertical video (preacher kept in frame, captions on) in `Exports › Sermon clips <date>`, named after the moment.

**Speech model download**: starts by itself with a small bar in the corner (you can keep working); no big window. “Use a file…” is there if the download fails.

**Small screens**: the Video side's left panel scrolls and becomes compact (icons only, names as tooltips) so the media list and sounds are always visible.

## Auto captions & sermon clip finder — new in 2.0
Speech is turned into text **on this computer** (Whisper / whisper.cpp). The first time, the app downloads a speech model once (Fast 75 MB · Balanced 142 MB — recommended · Best 466 MB) or you can load the file with “I already have the file…”. After that no internet is needed.

**Captions** (Video side → Add → **Captions**)
- Choose the language spoken (English, French, Spanish, Portuguese, Swahili, Yoruba, Hausa, Lingala… or “Detect automatically”) and optionally **Translate into English**.
- Styles: **Pop** (Reels — the spoken word lights up), **Karaoke**, **Box**, **Subtitles**, **Minimal**. Change font, colours, size, outline, words at once, CAPITALS, position (or drag on the preview).
- **Fix words…** to correct anything misheard, **Save subtitles (.srt / .vtt)** for YouTube/Facebook, **Listen again** after big edits.
- Captions are burned into the export exactly as in the preview.

**Find best clips in a sermon** (Video side → **Find best clips in a sermon**)
- Pick the sermon video, the clip length (15 s – 1½ min) and how many.
- It listens to the whole sermon once (a 45-minute sermon takes a few minutes the first time, then it is remembered) and ranks the strongest moments: strong statements, calls to action, scripture references, repeated lines, moments said with emphasis, the church responding. Announcements are skipped. Every clip starts and ends on a full sentence.
- Preview each clip, move its start / end by one sentence, tick the ones you want and **Add to the timeline** — optionally **Vertical 9:16** (keeps the preacher in frame automatically) and **with captions** (instant, the words are already known).

## Auto-cull — find bad shots — new in 1.9
Picture side → **Auto-cull — find bad shots** (after choosing a folder). Everything runs on this computer, no internet.
- Checks every photo for: **blurry** (shake or missed focus, including a face out of focus), **eyes closed**, **duplicates** (the same photo saved twice), **similar shots** (bursts — keeps the best 1, 2 or 3), **too dark**, **washed out**.
- **Suggested to remove** are ticked for you; **Worth a look** are not (e.g. closed eyes on their own — people may be praying).
- Click a photo to tick / untick, double-click for a big view (← → to move, X to tick). Faces with closed eyes are outlined in purple.
- **Gentle / Normal / Strict** changes how picky it is, instantly.
- **Move to “Rejected” folder** (with **Undo**), **Delete…** (Recycle Bin) or **Select in editor**.
- Speed: uses the graphics card when available (fast); otherwise a CPU mode (about 0.2–0.7 s per photo). Results are remembered, so checking the same folder again is instant.

## Phones over Wi-Fi (QR code) — new in 1.8
Works with iPhone (Safari) and Android (Chrome) — nothing to install on the phone, no cable.
- Click **Phones** in the top bar (or "Use Wi-Fi (no cable)" in the import window). A QR code appears.
- The phone joins the **same Wi-Fi** as the computer, opens the **Camera**, points at the code and taps the link.
- **Send to computer:** the person types their name, picks photos and videos, and they arrive in `Imports/<date> Wi-Fi/<name>`. HEIC photos become JPG automatically. Re-sent files are skipped. Then **Edit pictures** / **Add videos to timeline**.
- **Get from computer:** after **Apply & Save** or a video export, click **Send to phones** (or use the **To phones** tab). Phones tap a picture → save it; **Save all** downloads one ZIP.
  - iPhone pictures: touch and hold → **Save to Photos**. iPhone videos: Download, then Share → **Save Video**.
  - Android: Download → appears in Gallery / Downloads.
- Safety: a new secret key is in every QR code; the old one stops working when sharing is stopped or restarted. Sharing switches itself off after 60 minutes of no activity.
- Can't connect? Same Wi-Fi (guest Wi-Fi often blocks devices), click **Allow through firewall** in the Phones window (Windows asks once for permission), or connect the computer to the phone's **Personal Hotspot**.

## Import from phone / camera (USB cable) — new in 1.7
- Plug in an iPhone (tap **Trust**), an Android phone (choose **File transfer**), a camera or a memory card. A small card pops up: **Import**.
- Or click **Import from phone / camera** (Picture side, under Choose Picture Folder) or **Import from phone** (Video side).
- Choose: only new files (already-imported files are remembered per device), convert HEIC → JPG, keep HEIC originals, date range (today / 7 / 30 days), pictures and/or videos, and where to save (default: `<workspace>/Imports/<date> <device>`).
- HEIC pictures become JPG with date, camera and orientation kept. Videos and all other files are copied unchanged. iPhone `.AAE` sidecar files are skipped.
- When done: **Edit pictures** opens the folder on the Picture side, **Add videos to timeline** sends the videos to the editor.
- Choosing a picture folder that contains HEIC files shows a banner: **Convert to JPG** (originals moved to “HEIC originals”).
- Phones are read through Windows' own portable-device support — no drivers or iTunes needed.

## After Service Converter (optional, chosen during install) — new in 1.7
- Own Start-menu / desktop shortcut (`After Service.exe --converter`), the **Converter** button in the editor header, **Convert files** on the Video side, and “Open with” for HEIC and other pictures.
- Pictures in: HEIC, HEIF, JPG, PNG, WEBP, BMP, GIF, TIFF, ICO, AVIF, JFIF → out: JPG, PNG, WEBP, BMP, GIF, TIFF, ICO (multi-size), AVIF, PDF (one or all pictures in one PDF).
- Videos in: MP4, MOV, M4V, MKV, AVI, WMV, WEBM, MTS, M2TS, 3GP, FLV, MPG, TS → out: MP4, MOV, MKV, WEBM, AVI, GIF, or audio MP3, WAV, M4A, FLAC, OGG.
- Audio in: MP3, WAV, M4A, AAC, OGG, FLAC, WMA, OPUS, AIFF, AMR → out: MP3, WAV, M4A, AAC, FLAC, OGG, OPUS, WMA.
- Quick jobs: iPhone → JPG, WhatsApp video, Extract MP3, Make icon, Pictures for web, All into one PDF. Quality, picture size and video size controls. Originals are never changed.

## Player — edit details & pictures — new in 1.7
- Pencil button on every row (or right-click a row), **Edit details** in Now Playing, or right-click the cover in the bottom bar.
- Picture: choose, drop or paste (Ctrl+V) — JPG, PNG, WEBP or HEIC. Remove. “Use this picture for the whole album”.
- Details: title, artist, album, album artist, genre, date / year, track, disc, composer, publisher, copyright, comment, lyrics.
- MP3, M4A and FLAC keep everything inside the file (other players show it too). WAV, OGG, OPUS, MP4, MOV, MKV, WMA keep the text inside the file and the picture in the player. Editing the song that is playing resumes it at the same spot.

## Video editor preview
- Straight-edged preview with Small / Normal / Big sizes and Full screen (F, Esc to exit) in the "My sequence" header.

## Video filters
- Video Editing → Filters tab: 20 looks with live previews — Black & White, Noir, Soft B&W, Sepia, Warm, Cool, Vivid, Faded,
  Cinematic, Golden Hour, Vintage, Sunday Gold, Orange Mono, Royal Purple, Ocean Blue, Rose, Emerald, Blue Mono, Red Mono.
- "Any colour": pick any colour (or a swatch) and set its strength; tick "Black & white first" for a one-colour look.
- Adjust: filter strength, brightness, contrast, saturation, warmth, hue shift, fade, vignette. Undo with Ctrl+Z.
- Filters are per clip (the selected clip, or the one under the playhead); "Apply to all clips" copies the look to every clip.
- The export uses the same colour maths as the preview (baked into a 3D LUT for ffmpeg), so the result matches what you see.

## Transitions
- Every cut between two clips shows a + on the timeline. Click it (or press T for the nearest cut) to open Video Editing → Transitions.
- 12 transitions with animated previews: Cross Dissolve, Dip to Black, Dip to White, Wipe, Soft Wipe, Push, Circle Open,
  Circle Close, Zoom In, Clock Wipe, Pixelize, Squeeze. Wipe, Soft Wipe and Push have Left / Right / Up / Down directions.
- Customize: duration (0.1 s up to half of the shorter clip), direction, Preview, Apply to all cuts, Remove. Drag a transition
  tile onto any cut, or drag the edges of the orange transition bar on the timeline to change its length. Ctrl+Z undoes.
- Clips overlap during a transition (so the video gets shorter by the transition length) and the sound crossfades too.
- Split parts of the same video can overlap because each video gets a second decoder for neighbouring clips.
- Export uses ffmpeg's xfade/acrossfade with the same formulas as the preview, so the result matches what you see.

## Licences (device-locked, with expiry)
**One-time setup (on your PC):**
1. `npm install` (adds the build tools), then `npm run license`. The Licence Generator opens and creates your keys in
   `license-keys/` (private — never share or ship it; back it up). It also writes the public key into
   `src/license-pub.json` and `build/license-pub.nsh`, which the app and installer use to check licences.
2. `npm run dist:win` builds the installer. The build stops with a message if step 1 was not done.

**Selling a licence:**
1. The customer runs the setup. The first page shows their **Device ID** (with a Copy button). They send it to you.
2. In the Licence Generator enter the customer name, their Device ID and how many hours it is valid for
   (quick buttons: 1 hour … 1 year), then Generate. Copy the key or save a `.aslicense` file and send it.
   Every licence is recorded in `license-keys/issued-licences.csv`.
3. The customer pastes the key in the setup. A wrong, forged, expired or other-computer key is refused with a clear
   message; after 5 refusals the setup closes. Cancel = no installation. Silent installs also need a valid licence.

**What the app does:**
- On every start it checks the licence (signature, Device ID, expiry). If it's missing, expired or for another PC,
  the activation window opens and nothing else runs until a valid key is entered (paste or "Open licence file…").
- While running it re-checks every minute: when the licence expires the app closes its windows (an export in
  progress is stopped) and asks for a new key. Turning the computer clock back is detected.
- The installer writes `resources\install.bind` with the Device ID of the computer it was installed on. If the
  installed folder is copied to another computer, starting it shows a **THEFT ALERT** and nothing can be opened.
  Theft alerts, refused keys and activations are recorded in `%APPDATA%\After Service\security.log`.
- Device ID = hardware fingerprint (motherboard UUID + CPU + Windows machine ID), computed by `resources\aslic.exe`
  (source in `tools/aslic`, rebuild with mingw: see the top of aslic.c). Reinstalling Windows can change it — issue a new licence.

**Protection level:** licences can't be forged or moved without your private key. The app also only loads its code
from app.asar and can't be started as a Node.js runner or with debugging flags (scripts/after-pack.js). Like all
desktop software it is not immune to a determined cracker who edits the program itself.

## Build fix (MUI_HEADER_TEXT not found)
electron-builder reads build/installer.nsh before it loads the Modern UI, so the script now includes `MUI2.nsh` itself,
and installer-only pages/variables are hidden from the uninstaller pass (where unused items are treated as errors).
Publishing is disabled (`--publish never`) so the build no longer fails at the end looking for an update server.

## Build fix (EBUSY: resource busy or locked)
`npm run dist:win` now runs scripts/build-win.js, which closes any After Service started from dist\\, clears dist\\win-unpacked,
and waits/retries when Windows briefly locks a file (Windows Defender scan, OneDrive syncing the Desktop, a running copy).
If it still reports a locked file: close After Service and the Player (tray icon), close Explorer windows on dist, pause
OneDrive, or add the project folder to Windows Security → Virus & threat protection → Exclusions.
