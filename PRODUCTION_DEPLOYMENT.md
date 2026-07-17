# Production deployment

Netlify publishes the generated `dist/` folder. It no longer publishes the
entire repository.

## Build locally

From the repository root:

```powershell
python build_production.py
```

The command deletes and rebuilds `dist/` from the allowlist in
`build_production.py`. Netlify runs the same command automatically during a
deployment.

## Adding a public file

Creating a file in the repository does not publish it. To make a new page,
script, stylesheet, or asset public:

1. Add its path to the appropriate allowlist in `build_production.py`.
2. Run `python build_production.py`.
3. Confirm the file appears in `dist/`.
4. Test the page locally or in a Netlify deploy preview.

Do not add development tools, credentials, build reports, internal
documentation, or unreleased city folders to the production allowlist.

## Publishing a new city

An unreleased city such as `bluejackets/` remains private because it is not
copied into `dist/`. When the city is ready:

1. Rename or prepare its public folder and configuration.
2. Add only its required runtime files and data to `build_production.py`.
3. Add its live link to `Index.html`.
4. Build and test a deploy preview before publishing.

## Existing missing assets

The build prints warnings for images referenced by current pages but absent
from the repository. These warnings identify existing broken references; they
do not cause unrelated private files to be published.
