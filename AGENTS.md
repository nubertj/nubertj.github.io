# juliannubert.com

Personal site of Julian Nubert, built with Astro and deployed to GitHub Pages on every push to `main`.

## Where content lives

Edit data files, not markup, whenever you can:

| What | File |
|---|---|
| Bio, role, education, honors, links | `src/data/profile.json` (`about` entries may contain inline HTML links) |
| News items (newest first) | `src/data/news.json` |
| Publications | `src/data/publications.json` |
| Works to never import | `src/data/publications.ignore.json` (list of titles) |
| Portrait | `public/portrait.jpg` |

Pages: `src/pages/index.astro` (home) and `src/pages/publications.astro`. Shared layout and styles: `src/layouts/Base.astro`.

## Publications

`node scripts/sync-publications.mjs` pulls from OpenAlex (author `A5014575365`) and ORCID (`0000-0001-8949-6134`). It adds new works and upgrades preprints once they are published. It never overwrites existing fields, and entries with `"locked": true` are never upgraded. Use `--dry-run` to preview. A weekly GitHub Action runs the script and opens a PR.

Entry fields: `title`, `authors` (exact name `Julian Nubert` gets bolded), `year`, `venue`, `type` (`journal` | `conference` | `workshop` | `preprint` | `thesis`), `doi`, `arxiv` (ID only), `links` (`code`, `project`, `video`, `pdf`, `slides` → URL), `award`, `featured` (shown on the home page).

Keep venue names consistent with the existing entries, e.g. `IEEE Intl. Conf. on Robotics and Automation (ICRA)`.

## Rules

- Only add public information. Never add personal contact details beyond what is already in `profile.json`.
- Don't invent facts (dates, awards, affiliations). If something is unclear, leave it out and say so in the PR.
- Run `npm run build` before committing. Changes go through a PR unless Julian says otherwise.

## Development

Node 24 (see `.mise.toml`). Run `npm install`, then `npm run dev`. When starting the dev server from an agent, use `npx astro dev --background`, and manage it with `astro dev stop|status|logs`.
