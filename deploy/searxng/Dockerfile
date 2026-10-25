# SearXNG with this stack's settings baked in. Coolify deploys only the compose file to the
# server, so a bind mount of ./deploy/searxng/settings.yml would find no file there and Docker
# would mount an empty directory instead; the build context does contain the repository.
FROM searxng/searxng:latest
COPY settings.yml /etc/searxng/settings.yml
