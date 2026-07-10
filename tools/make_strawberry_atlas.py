#!/usr/bin/env python
"""Pack the strawberry leaf + fruit textures into a 3-cell atlas so the canopy
field can keep its single-material instancing.

Layout (1536x512, three 512-wide cells):
  cell 0  u[0.000,0.333]  leaf  (RGBA, alpha = leaf silhouette)
  cell 1  u[0.333,0.667]  fruit (center-cropped square)
  cell 2  u[0.667,1.000]  solid opaque white  (for untextured parts)
"""
import os
from PIL import Image

OUT = "public/assets/textures/strawberry_atlas.png"
CELL = 512


def fit(img, size, pad_transparent=True):
    img = img.convert("RGBA")
    w, h = img.size
    s = min(size / w, size / h)
    img = img.resize((max(1, int(w * s)), max(1, int(h * s))), Image.LANCZOS)
    cell = Image.new("RGBA", (size, size), (0, 0, 0, 0) if pad_transparent else (255, 255, 255, 255))
    cell.paste(img, ((size - img.width) // 2, (size - img.height) // 2), img)
    return cell


def center_crop_square(img, size):
    img = img.convert("RGBA")
    w, h = img.size
    m = min(w, h)
    img = img.crop(((w - m) // 2, (h - m) // 2, (w + m) // 2, (h + m) // 2))
    return img.resize((size, size), Image.LANCZOS)


def main():
    base = "public/assets/textures"
    leaf = fit(Image.open(f"{base}/strawberry_leaf.png"), CELL)
    fruit = center_crop_square(Image.open(f"{base}/strawberry_fruit.jpg"), CELL)
    white = Image.new("RGBA", (CELL, CELL), (255, 255, 255, 255))

    atlas = Image.new("RGBA", (CELL * 3, CELL), (0, 0, 0, 0))
    atlas.paste(leaf, (0, 0), leaf)
    atlas.paste(fruit, (CELL, 0))
    atlas.paste(white, (CELL * 2, 0))
    atlas.save(OUT)
    print(f"wrote {OUT}  ({atlas.size[0]}x{atlas.size[1]})")


if __name__ == "__main__":
    main()
