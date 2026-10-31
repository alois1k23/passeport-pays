(() => {
  const CLE = "passeport-pays:visites";
  const monde = window.WORLD;
  const noms = window.NOMS_FR;

  // --- Données ---------------------------------------------------------
  const features = topojson.feature(monde, monde.objects.countries).features;
  features.forEach(f => {
    f.cle = f.id || f.properties.name; // quelques territoires n'ont pas de code ISO
    f.nom = noms[f.cle] || f.properties.name;
  });
  const parCle = new Map(features.map(f => [f.cle, f]));
  const total = features.length;

  let visites = new Set();
  try { visites = new Set(JSON.parse(localStorage.getItem(CLE)) || []); } catch (_) {}
  const sauver = () => { try { localStorage.setItem(CLE, JSON.stringify([...visites])); } catch (_) {} };

  // --- Carte -----------------------------------------------------------
  const conteneur = document.getElementById("carte");
  const svg = d3.select(conteneur).append("svg");
  const g = svg.append("g");
  const projection = d3.geoNaturalEarth1();
  const chemin = d3.geoPath(projection);

  const pays = g.selectAll("path")
    .data(features)
    .join("path")
    .attr("class", "pays")
    .on("click", (e, f) => basculer(f.cle))
    .on("mousemove", (e, f) => montrerInfo(e, f))
    .on("mouseleave", cacherInfo);

  function dimensionner() {
    const { width, height } = conteneur.getBoundingClientRect();
    svg.attr("viewBox", [0, 0, width, height]);
    projection.fitExtent([[10, 10], [width - 10, height - 10]], { type: "Sphere" });
    pays.attr("d", chemin);
    zoom.translateExtent([[0, 0], [width, height]]);
  }

  const zoom = d3.zoom().scaleExtent([1, 40]).on("zoom", e => g.attr("transform", e.transform));
  svg.call(zoom).on("dblclick.zoom", null);
  window.addEventListener("resize", dimensionner);
  dimensionner();

  document.getElementById("zplus").onclick = () => svg.transition().call(zoom.scaleBy, 1.6);
  document.getElementById("zmoins").onclick = () => svg.transition().call(zoom.scaleBy, 1 / 1.6);
  document.getElementById("zreset").onclick = () => svg.transition().duration(600).call(zoom.transform, d3.zoomIdentity);

  function centrerSur(f) {
    const { width, height } = conteneur.getBoundingClientRect();
    const [[x0, y0], [x1, y1]] = chemin.bounds(f);
    const k = Math.min(20, 0.6 / Math.max((x1 - x0) / width, (y1 - y0) / height));
    const t = d3.zoomIdentity.translate(width / 2, height / 2).scale(k).translate(-(x0 + x1) / 2, -(y0 + y1) / 2);
    svg.transition().duration(800).call(zoom.transform, t);
    const el = pays.filter(d => d === f);
    el.classed("flash", true);
    setTimeout(() => el.classed("flash", false), 500);
  }

  // --- Infobulle -------------------------------------------------------
  const info = document.getElementById("infobulle");
  function montrerInfo(e, f) {
    info.innerHTML = "";
    info.append(f.nom);
    if (visites.has(f.cle)) { const em = document.createElement("em"); em.textContent = "✓ visité"; info.append(em); }
    info.hidden = false;
    info.style.left = e.clientX + 14 + "px";
    info.style.top = e.clientY + 14 + "px";
  }
  function cacherInfo() { info.hidden = true; }

  // --- État & rendu ----------------------------------------------------
  function basculer(cle, forcer) {
    const ajouter = forcer ?? !visites.has(cle);
    ajouter ? visites.add(cle) : visites.delete(cle);
    sauver();
    rendre();
  }

  const liste = document.getElementById("visites");
  function rendre() {
    pays.classed("visite", f => visites.has(f.cle));
    const n = visites.size;
    document.getElementById("nb").textContent = n;
    document.getElementById("pct").textContent = (n / total * 100).toFixed(1).replace(".", ",") + " %";
    document.getElementById("vide").hidden = n > 0;

    liste.innerHTML = "";
    [...visites].map(c => parCle.get(c)).filter(Boolean)
      .sort((a, b) => a.nom.localeCompare(b.nom, "fr"))
      .forEach(f => {
        const li = document.createElement("li");
        const span = document.createElement("span");
        span.textContent = f.nom;
        const btn = document.createElement("button");
        btn.textContent = "×";
        btn.title = "Retirer";
        btn.onclick = e => { e.stopPropagation(); basculer(f.cle, false); };
        li.append(span, btn);
        li.onclick = () => centrerSur(f);
        liste.append(li);
      });
  }

  // --- Recherche -------------------------------------------------------
  const recherche = document.getElementById("recherche");
  const datalist = document.getElementById("liste-pays");
  const parNom = new Map();
  features.slice().sort((a, b) => a.nom.localeCompare(b.nom, "fr")).forEach(f => {
    parNom.set(normaliser(f.nom), f);
    const opt = document.createElement("option");
    opt.value = f.nom;
    datalist.append(opt);
  });
  function normaliser(s) { return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim(); }

  function chercher() {
    const q = normaliser(recherche.value);
    if (!q) return;
    let f = parNom.get(q);
    if (!f) f = [...parNom].find(([k]) => k.startsWith(q))?.[1];
    if (!f) return;
    basculer(f.cle, true);
    centrerSur(f);
    recherche.value = "";
  }
  recherche.addEventListener("change", chercher);
  recherche.addEventListener("keydown", e => { if (e.key === "Enter") chercher(); });

  // --- Export / import / reset -----------------------------------------
  document.getElementById("exporter").onclick = () => {
    const donnees = [...visites].map(c => ({ code: c, nom: parCle.get(c)?.nom }));
    const blob = new Blob([JSON.stringify(donnees, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "mes-pays.json";
    a.click();
    URL.revokeObjectURL(a.href);
  };
  document.getElementById("importer").onchange = async e => {
    const fichier = e.target.files[0];
    if (!fichier) return;
    try {
      const donnees = JSON.parse(await fichier.text());
      const codes = donnees.map(d => (typeof d === "string" ? d : d.code)).filter(c => parCle.has(c));
      visites = new Set([...visites, ...codes]);
      sauver();
      rendre();
    } catch (_) { alert("Fichier invalide."); }
    e.target.value = "";
  };
  document.getElementById("reinit").onclick = () => {
    if (visites.size && confirm("Effacer tous les pays visités ?")) { visites.clear(); sauver(); rendre(); }
  };

  rendre();
})();
