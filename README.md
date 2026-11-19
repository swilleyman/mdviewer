# MD Viewer

A Markdown viewer and editor that runs in the browser, works offline, and installs as an app on Android (and on desktop Chrome/Edge). It's plain static files with no build step.

## Features
- GitHub-flavored Markdown: tables, task lists, strikethrough, autolinks, front matter, and syntax-highlighted code with a copy button
- Edit, View and side-by-side Split modes (Split shows on wide screens only)
- Open a file, drag and drop one, open from a URL (GitHub links are converted to raw automatically), or use `?url=` in the address
- Saves your document in the browser as you type; **Save .md** writes the file back (in place on desktop Chrome/Edge, as a download elsewhere)
- Export to standalone HTML, Print / PDF, and Share (on mobile)
- Outline drawer, light/dark/system theme, adjustable text size
- Works offline after the first visit (service worker)
- **Android share target:** once installed, share a `.md` file or a link to *MD Viewer* from any app
- **Desktop "Open with":** the installed app registers itself for `.md` files

## Run locally
```powershell
python -m http.server 8765
```
Then open http://localhost:8765.

## Install on Android
Install needs HTTPS, so host the folder somewhere first. The free, easy option is **GitHub Pages**:
1. Create a GitHub repository and push this folder to it.
2. In the repository, go to **Settings → Pages**, choose **Deploy from a branch**, then `main` / root.
3. On your phone, open `https://<you>.github.io/<repo>/` in Chrome, then use **⋮ → Install app** (or Chrome's menu → *Add to Home screen*).

Netlify, Cloudflare Pages and Vercel also work: drag and drop the folder, no build settings needed.

### Want a real APK or a Play Store listing?
Put the hosted URL into https://www.pwabuilder.com and choose **Android**. It produces a signed APK/AAB (a Trusted Web Activity) that you can sideload or upload to Google Play.

## Releasing updates
Edit the files, then bump `VERSION` in `sw.js` so installed copies refresh their cache. Installed apps pick up the change on the next launch or the one after.

## Files
| File | Purpose |
| --- | --- |
| `index.html` | App shell |
| `app.js` | All app logic |
| `styles.css` | App layout |
| `md.css` | Theme colors and rendered-Markdown styles (also embedded in HTML exports) |
| `sw.js` | Offline cache and share-target handler |
| `manifest.webmanifest` | Install metadata, icons, share target, file handler |
| `icons/` | App icons |

Libraries load from CDNs and are cached for offline use: marked (parser), DOMPurify (sanitizer), highlight.js.
