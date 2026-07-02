# PokeMind — Pokémon GO-style web AR game

Place Pokémon on a real-world map from an admin site; players see and catch them
in AR through their phone's browser (camera + GPS + compass). No app install,
no npm dependencies.

## Run

```bash
node server.js
```

- **Admin map (laptop):** http://localhost:8080/admin.html — pick a Pokémon, click the map to place it.
  Click inside a blue 🏠 building polygon and it asks which floor to hide it on.
- **AR game (phone):** open `https://<your-mac-ip>:8443/ar.html` on a phone on the same Wi-Fi
  (the exact URL and a QR code are shown at http://localhost:8080). Allow camera, location,
  and motion permissions. The certificate is self-signed, so tap *Show details → Visit website*
  past the browser warning. The 🗺️ Map button shows your live position, your 40 m catch
  radius, and every wild Pokémon around you.
- **Map My House (phone):** `https://<your-mac-ip>:8443/mapper.html` (second QR on the landing
  page) — trace your building's roof on satellite imagery by tapping its corners, set a name
  and floor count, save. Saved buildings appear on the admin map so Pokémon can be hidden
  inside on any floor; in AR they float at ~3 m per floor.

## How to play

Walk to within **40 m** of a Pokémon and tap it to catch. Caught Pokémon go to your
Pokédex (stored per-phone in localStorage). The status bar shows the nearest Pokémon
and its distance. The AR view refreshes every 20 s, so newly placed Pokémon appear live.

## Stack

- `server.js` — zero-dependency Node HTTP/HTTPS server + JSON API (`data/objects.json`)
- `public/ar.html` — A-Frame 1.3 + AR.js 3.4.5 location-based AR (`gps-new-camera`)
- `public/admin.html` — Leaflet + OpenStreetMap placement map
- Sprites hotlinked from the PokeAPI official-artwork set

## Notes

- GPS AR is best **outdoors**; indoors the position drifts.
- If your Mac's IP changes, regenerate the cert (`certs/`) or just accept the warning again:
  ```bash
  openssl req -x509 -newkey rsa:2048 -keyout certs/key.pem -out certs/cert.pem \
    -days 365 -nodes -subj "/CN=pokemind" -addext "subjectAltName=IP:<new-ip>,DNS:localhost"
  ```
- To play beyond your Wi-Fi, expose the HTTP port with a tunnel (real HTTPS, no warning):
  `npx cloudflared tunnel --url http://localhost:8080`
