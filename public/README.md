# Public Assets

These files are served statically by Next.js.

## Logo Files (MUST be committed to git)

- `logo-full.png` — Full brand logo with golf ball, tartan cap, beer, silhouettes shield. Used on the login/signup splash screen.
- `logo-app.png` — Simplified app icon. Used in the navigation header.

**Important:** When deploying, confirm both PNG files are present in your git repository before pushing. Run `git status` and ensure both appear as tracked files.

If logos are missing in production, run:
```
git add public/logo-full.png public/logo-app.png
git commit -m "Add logo assets"
git push
```
