# juliannubert.com

Source for [juliannubert.com](https://juliannubert.com). Built with [Astro](https://astro.build) and hosted on GitHub Pages.

- Content lives in `src/data/*.json`. See [AGENTS.md](AGENTS.md) for the layout and the editing rules (these apply to agents and humans alike).
- Publications sync weekly from OpenAlex and ORCID through a pull request (`.github/workflows/sync-publications.yml`).
- Every push to `main` deploys the site (`.github/workflows/deploy.yml`).

```sh
npm install
npm run dev        # http://localhost:4321
node scripts/sync-publications.mjs --dry-run
```
