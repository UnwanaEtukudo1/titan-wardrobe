# Titan Wardrobe

**Play it:** https://unwanaetukudo1.github.io/titan-wardrobe/

A mobile outfit-select screen for the Minotaur Titan, built with Three.js. It is a plain static
site with no build step: upload this folder as it is.

| File | What it is |
|---|---|
| `index.html` | the page |
| `style.css` | layout: portrait (stage on top, pills below) and landscape (side panel) |
| `main.js` | 3D scene, piece toggles, motions, drag-to-turn |
| `minotaur.glb` | the character, 9 wardrobe pieces, Idle / Walking / Running, body-fit morphs (2.5 MB, meshopt + WebP) |

Three.js 0.165.0 and the fonts (Marcellus, Figtree) load from public CDNs, so the page needs an
internet connection.

## Run it on your computer

```bash
python3 -m http.server 8765
```

Then open http://localhost:8765. Opening `index.html` straight from the file system does not
work, because browsers block loading the model from `file://`.

## Put it online

- **GitHub Pages:** this repository is already set up: every push to `main` republishes the site.
- **Netlify:** drag this folder onto https://app.netlify.com/drop.
- **Vercel:** `npx vercel deploy`.

All three give you an https link that opens on any phone.

## Updating the model

After changing the Blender file, re-export `Minotaur_Wardrobe.glb` and shrink it for the web:

```bash
npx @gltf-transform/cli@4 optimize Minotaur_Wardrobe.glb minotaur.glb --compress meshopt --texture-compress webp --texture-size 1024 --join false --flatten false --instance false --simplify false --palette false
```

The `--join/--flatten/--instance false` flags keep every wardrobe piece as its own mesh, which the
page needs to show and hide pieces.

## Jacket

The jacket is a shell offset from the Minotaur's own skin and uses the skin's exact bone weights, so it
bends with the body in every motion without tearing or webbing. No per-frame correction is needed.
