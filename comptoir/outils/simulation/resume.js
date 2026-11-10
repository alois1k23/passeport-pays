// Regroupe les anomalies d'un fichier de résultats par type.
const r = require(process.argv[2]);
console.log(r.marchandsOk ?? r.marchands, JSON.stringify(r.reussites || r.okParType));
const g = {};
for (const a of r.anomalies) (g[a.quoi] = g[a.quoi] || []).push(a.qui + ': ' + a.detail.slice(0, 170));
for (const [k, v] of Object.entries(g).sort((a, b) => b[1].length - a[1].length)) console.log('\n[' + v.length + '] ' + k + '\n  ' + v.slice(0, 4).join('\n  '));
