# Ressources des documents PDF

- `DejaVuSans.ttf`, `DejaVuSans-Bold.ttf` : polices DejaVu (licence libre Bitstream Vera, voir `DejaVu-LICENCE.txt`). Elles sont intégrées en sous-ensemble dans les factures Factur-X.
- `sRGB.icc` : profil de couleur sRGB, utilisé comme intention de sortie (OutputIntent) des PDF/A. Il a été généré par la bibliothèque LittleCMS (via Pillow, `ImageCms.createProfile('sRGB')`).
