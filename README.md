# Roll Count

A phone-friendly headcount tool for a classroom. Tap once per student on a
big tally button (with undo), or use the camera-based photo scan to get an
AI-suggested count you can correct before adding it to the total.

## Files
- `index.html` — page structure
- `style.css` — all styling
- `script.js` — camera access, tally logic, and the AI photo-scan mode

## Host it on GitHub Pages
1. Create a new GitHub repo and upload these three files to the root
   (not inside a subfolder).
2. Go to the repo's **Settings → Pages**.
3. Under "Build and deployment", set **Source** to `Deploy from a branch`,
   choose the `main` branch and `/ (root)` folder, then **Save**.
4. GitHub gives you a link like `https://yourusername.github.io/reponame/`.
   Open that on your phone — camera access needs `https://`, which GitHub
   Pages provides, so it will work there (a plain local file won't let the
   camera turn on).
5. Share that link with the CR. It can be bookmarked or added to the phone's
   home screen like an app.

No build step, server, or account signup is needed beyond GitHub itself —
it's static HTML/CSS/JS, and the AI model loads from a CDN at runtime.
