# Image de production minimale : aucune dépendance npm à installer.
FROM node:22-alpine
WORKDIR /app
COPY . .
# TZ : heure de Lausanne (année des factures, dates des e-mails). PROXY_DE_CONFIANCE : passerelle Docker,
# par laquelle Caddy (sur la machine hôte) atteint le conteneur ; publiez alors le port sur 127.0.0.1 seulement.
ENV NODE_ENV=production PORT=3000 BASE_DE_DONNEES=/data/comptoir.db TZ=Europe/Zurich PROXY_DE_CONFIANCE=172.17.0.1,127.0.0.1,::1
RUN mkdir -p /data && chown node:node /data
VOLUME /data
EXPOSE 3000
USER node
CMD ["node", "--disable-warning=ExperimentalWarning", "server/server.js"]
