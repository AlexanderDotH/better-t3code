# syntax=docker/dockerfile:1.7

FROM rust:1.97-bookworm AS resource-monitor-builder
WORKDIR /source
COPY native/resource-monitor ./native/resource-monitor
RUN cargo build --locked --release --manifest-path native/resource-monitor/Cargo.toml

FROM node:24-bookworm AS server-builder
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
WORKDIR /source

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches ./patches
COPY apps/server/package.json ./apps/server/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY packages/client-runtime/package.json ./packages/client-runtime/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json
COPY packages/effect-acp/package.json ./packages/effect-acp/package.json
COPY packages/effect-codex-app-server/package.json ./packages/effect-codex-app-server/package.json
COPY packages/shared/package.json ./packages/shared/package.json
COPY packages/ssh/package.json ./packages/ssh/package.json
COPY packages/tailscale/package.json ./packages/tailscale/package.json
COPY scripts/package.json ./scripts/package.json
RUN corepack enable \
  && corepack prepare pnpm@11.10.0 --activate
RUN pnpm install --frozen-lockfile --ignore-scripts \
  --filter=t3... \
  --filter=@t3tools/web... \
  --filter=@t3tools/scripts...
COPY . .
RUN pnpm rebuild esbuild \
  && node scripts/clean-tsgo-backups.mjs \
  && ./node_modules/.bin/effect-tsgo patch \
  && ./node_modules/.bin/vp config --no-agent
RUN pnpm exec vp run --filter @t3tools/web build \
  && pnpm exec vp run --filter t3 build
RUN pnpm --config.allow-unused-patches=true \
  --filter t3 deploy --prod --legacy /output/server \
  && cd /output/server \
  && node -e "require('node-pty')"

FROM node:24-bookworm-slim AS runtime

ARG TARGETARCH
ARG CODEX_VERSION=0.148.0
ARG CLAUDE_VERSION=2.1.238
ARG OPENCODE_VERSION=1.18.19
ARG GLAB_VERSION=1.109.0

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get -o Acquire::Retries=5 update \
  && apt-get install -y --no-install-recommends \
    bash \
    build-essential \
    ca-certificates \
    curl \
    file \
    git \
    git-lfs \
    gh \
    jq \
    lsof \
    openssh-client \
    python3 \
    python3-pip \
    procps \
    ripgrep \
    tini \
    unzip \
    zip \
  && glab_arch="${TARGETARCH:-$(dpkg --print-architecture)}" \
  && case "${glab_arch}" in amd64|arm64) ;; *) echo "Unsupported glab architecture: ${glab_arch}" >&2; exit 1 ;; esac \
  && install -d /tmp/glab \
  && curl -fsSL "https://gitlab.com/gitlab-org/cli/-/releases/v${GLAB_VERSION}/downloads/glab_${GLAB_VERSION}_linux_${glab_arch}.tar.gz" -o /tmp/glab.tar.gz \
  && tar -xzf /tmp/glab.tar.gz -C /tmp/glab \
  && install -m 0755 /tmp/glab/bin/glab /usr/local/bin/glab \
  && curl -fsSL https://aka.ms/InstallAzureCLIDeb -o /tmp/install-azure-cli.sh \
  && bash /tmp/install-azure-cli.sh \
  && install -d /opt/az-extensions \
  && AZURE_EXTENSION_DIR=/opt/az-extensions az extension add --name azure-devops \
  && chmod -R a+rX /opt/az-extensions \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/* /tmp/glab /tmp/glab.tar.gz /tmp/install-azure-cli.sh

RUN npm install --global --prefix /opt/provider-tools \
    --allow-scripts=@anthropic-ai/claude-code,opencode-ai \
    "@openai/codex@${CODEX_VERSION}" \
    "@anthropic-ai/claude-code@${CLAUDE_VERSION}" \
    "opencode-ai@${OPENCODE_VERSION}"

# Cursor and Grok currently publish their supported Linux CLI through vendor
# installers. They run only at image-build time; credentials are mounted later.
RUN mkdir -p /tmp/cursor-home /opt/provider-tools/bin /opt/provider-tools/cursor-agent \
  && curl -fsSL https://cursor.com/install -o /tmp/install-cursor.sh \
  && HOME=/tmp/cursor-home bash /tmp/install-cursor.sh \
  && cursor_entry="$(readlink -f /tmp/cursor-home/.local/bin/cursor-agent)" \
  && cp -a "$(dirname "${cursor_entry}")/." /opt/provider-tools/cursor-agent/ \
  && ln -s "../cursor-agent/$(basename "${cursor_entry}")" /opt/provider-tools/bin/cursor-agent \
  && rm -rf /tmp/cursor-home /tmp/install-cursor.sh

RUN mkdir -p /tmp/grok-home /opt/provider-tools/bin \
  && curl -fsSL https://x.ai/cli/install.sh -o /tmp/install-grok.sh \
  && HOME=/tmp/grok-home bash /tmp/install-grok.sh \
  && install -m 0755 /tmp/grok-home/.grok/bin/grok /opt/provider-tools/bin/grok \
  && rm -f /usr/local/bin/agent /usr/local/bin/grok \
  && rm -rf /tmp/grok-home /tmp/install-grok.sh

COPY --from=server-builder /output/server /app
COPY --from=resource-monitor-builder \
  /source/native/resource-monitor/target/release/t3-resource-monitor \
  /tmp/t3-resource-monitor

RUN detected_arch="${TARGETARCH:-$(dpkg --print-architecture)}" \
  && case "${detected_arch}" in \
      amd64) resource_arch=x64 ;; \
      arm64) resource_arch=arm64 ;; \
      *) echo "Unsupported container architecture: ${detected_arch}" >&2; exit 1 ;; \
    esac \
  && install -d "/app/dist/resource-monitor/linux-${resource_arch}" \
  && install -m 0755 /tmp/t3-resource-monitor "/app/dist/resource-monitor/linux-${resource_arch}/t3-resource-monitor" \
  && groupmod --new-name t3 node \
  && usermod --login t3 --home /home/t3 --move-home --shell /bin/bash node \
  && install -d -o t3 -g t3 /data /workspace /home/t3/.config \
  && chown -R t3:t3 /app /opt/provider-tools

ENV HOME=/home/t3 \
  PATH=/opt/provider-tools/bin:/usr/local/bin:/usr/bin:/bin \
  AZURE_EXTENSION_DIR=/opt/az-extensions \
  T3CODE_DEPLOYMENT=container \
  T3CODE_HOME=/data \
  T3CODE_HOST=0.0.0.0 \
  T3CODE_PORT=3773 \
  T3CODE_NO_BROWSER=true \
  DISABLE_AUTOUPDATER=1

WORKDIR /workspace
VOLUME ["/data", "/home/t3", "/workspace"]
EXPOSE 3773
USER t3

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=4 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3773/readyz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "/app/dist/bin.mjs", "serve", "--host", "0.0.0.0", "--port", "3773", "--base-dir", "/data", "/workspace"]
