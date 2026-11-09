#!/bin/sh
# Produit une version « artifact » d'index.html (sans doctype/head/body), dans le dossier passé en argument.
out="${1:-dist}"; mkdir -p "$out"
sed -n '/contenu-artifact:debut/,/contenu-artifact:fin/p' index.html | grep -v -e '^</head>$' -e '^<body>$' > "$out/comptoir.html"
