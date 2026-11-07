# Font for document icon generation

`DejaVuSans-Bold-Subset.ttf` is a subset of DejaVu Sans Bold 2.37. It contains
only the uppercase Latin letters and digits used in filename extensions. The
full DejaVu/Bitstream Vera copyright and redistribution license is included in
`../../licenses/DejaVu-LICENSE.txt`; the installer includes that license file.
The font is used to rasterize letters into the generated ICO images. No system
font or network download is needed to regenerate them.

Original font: `DejaVuSans-Bold.ttf` from DejaVu 2.37,
SHA-256 `5c1247acef7f2b8522a31742c76d6adcb5569bacc0be7ceaa4dc39dd252ce895`.
The file was subset with fontTools 4.61.1 as follows:

```sh
pyftsubset DejaVuSans-Bold.ttf \
  --text='ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789' \
  --output-file=DejaVuSans-Bold-Subset.ttf \
  --layout-features='' --no-hinting --name-IDs='*' --name-languages='*'
```

The included subset retains the DejaVu Sans name, which does not contain the
reserved names “Bitstream” or “Vera” restricted by the font license. The ICO
outputs are raster images and do not contain the font itself.
