#!/usr/bin/env bash
# Publishes this OpenLifter fork on kraken (host nginx, static files) in front of the GR Cup platform gateway.
#
#   deploy/desplegar.sh qa                         grcup-qa-openlifter.menustudioai.com → gateway of grcup-qa
#                                                  (tailnet only, like the rest of QA)
#   deploy/desplegar.sh prod --confirmo-produccion grcup-openlifter.menustudioai.com → gateway of grcup (public);
#                                                  refuses while the platform is not deployed in namespace grcup
#
# Automatic connection (no login): if GRCUP_OPENLIFTER_KEY_QA / GRCUP_OPENLIFTER_KEY_PROD (a grc_ personal token with
# scope directo.operar on the competition GRCUP_SLUG, default «grcup») is in the environment or ~/.env, nginx adds it
# to /api/admin/competiciones/<cid>/openlifter/* and the app publishes /grcup-config.json so every browser connects
# to that competition by default. The key lives only in /etc/nginx/grcup-openlifter/ (root, 0600) on kraken.
# Production: MESA_IPS="a.b.c.d,e.f.g.h" limits who can use the key (the venue's public IP); without it anyone who
# opens the public URL can write to the live.
#
# Steps: build (cgrun) → release in /var/www/grcup-openlifter-<env>/releases/<commit> (keeps 5) → certificate
# (Let's Encrypt DNS-01 with kraken's Cloudflare credentials) → nginx site, `nginx -t`, reload (the previous site is
# put back if the test fails) → DNS record in Cloudflare (DNS only), with CLOUDFLARE_USER / CLOUDFLARE_API_KEY from
# the environment or ~/.env (never printed).
set -euo pipefail
cd "$(dirname "$0")/.."
ENTORNO="${1:-}"
KRAKEN="${KRAKEN:-kraken}"
ZONE="menustudioai.com"
case "$ENTORNO" in
  qa)
    HOST="grcup-qa-openlifter.$ZONE"; NS=grcup-qa; UPSTREAM="10.43.240.10:8080"; IP="100.66.235.72"
    LISTEN80="listen 100.66.235.72:80;"; LISTEN443="listen 100.66.235.72:443 ssl;"
    ALLOW="allow 100.64.0.0/10; allow 127.0.0.1; deny all;"; COMMENT="OpenLifter GR Cup fork QA (tailnet only)" ;;
  prod)
    [ "${2:-}" = "--confirmo-produccion" ] || { echo "✗ producción necesita --confirmo-produccion" >&2; exit 1; }
    HOST="grcup-openlifter.$ZONE"; NS=grcup; UPSTREAM="10.43.241.10:8080"; IP="65.109.100.94"
    LISTEN80="listen 80; listen [::]:80;"; LISTEN443="listen 443 ssl; listen [::]:443 ssl;"
    ALLOW=""; COMMENT="OpenLifter GR Cup fork (competition desk)" ;;
  *) echo "uso: $0 <qa|prod> [--confirmo-produccion]" >&2; exit 2 ;;
esac
ROOT="/var/www/grcup-openlifter-$ENTORNO/current"
SLUG="${GRCUP_SLUG:-grcup}"
KEYVAR="GRCUP_OPENLIFTER_KEY_$(echo "$ENTORNO" | tr '[:lower:]' '[:upper:]')"

# only the variables this script needs are read from ~/.env (the file is not sourced)
envvar() {
  if [ -z "${!1:-}" ] && [ -f "$HOME/.env" ]; then
    local val
    val=$(grep -E "^$1=" "$HOME/.env" | tail -1 | cut -d= -f2- | sed -E 's/^["'"'"']//; s/["'"'"']$//')
    export "$1=$val"
  fi
}
envvar "$KEYVAR"
KEY="${!KEYVAR:-}"

ssh "$KRAKEN" "sudo k3s kubectl -n $NS get svc gateway >/dev/null 2>&1" ||
  { echo "✗ la plataforma GR Cup no está desplegada en el namespace $NS" >&2; exit 1; }

VERSION="$(git rev-parse --short HEAD)"
git diff --quiet HEAD || VERSION="$VERSION-wip$(date +%H%M%S)"
echo "→ build $VERSION"
command -v cgrun >/dev/null && RUN=(cgrun -m 6G -n openlifter-build --) || RUN=()
[ -d node_modules ] || "${RUN[@]}" npx -y yarn@1.22.22 install --frozen-lockfile --ignore-engines
"${RUN[@]}" npx -y yarn@1.22.22 build >/tmp/openlifter-grcup-build.log 2>&1 || { tail -30 /tmp/openlifter-grcup-build.log; exit 1; }
echo "$VERSION" >build/version.txt

MESA=""
if [ -n "$KEY" ]; then
  # the competition the key opens (header from stdin: the key never appears on a command line)
  comp=$(printf 'Authorization: Bearer %s\n' "$KEY" | ssh "$KRAKEN" "curl -sf -H @- http://$UPSTREAM/api/admin/competiciones") ||
    { echo "✗ la clave $KEYVAR no es válida en $NS" >&2; exit 1; }
  CFG=$(SLUG="$SLUG" python3 -c '
import json, os, sys
cs = [c for c in json.load(sys.stdin) if c["slug"] == os.environ["SLUG"]]
if not cs: sys.exit("la clave no da acceso a la competición " + os.environ["SLUG"])
c = cs[0]
print(json.dumps({"auto": True, "nombre": "Mesa OpenLifter", "competicion": {"id": c["id"], "slug": c["slug"], "nombre": c["nombre"]}}))' <<<"$comp")
  CID=$(python3 -c 'import json,sys; print(json.load(sys.stdin)["competicion"]["id"])' <<<"$CFG")
  echo "$CFG" >build/grcup-config.json
  ALLOW_MESA="$ALLOW"
  if [ "$ENTORNO" = prod ]; then
    if [ -n "${MESA_IPS:-}" ]; then
      ALLOW_MESA="$(echo "$MESA_IPS" | tr ',' '\n' | sed 's/^ *//; s/ *$//' | awk 'NF{printf "allow %s; ", $0}')allow 127.0.0.1; deny all;"
    else
      echo "⚠ producción sin MESA_IPS: cualquiera con la URL pública puede escribir en el directo con la clave de la mesa" >&2
    fi
  fi
  MESA="    location ^~ /api/admin/competiciones/$CID/openlifter/ {
        $ALLOW_MESA
        include /etc/nginx/grcup-openlifter/$ENTORNO-clave.conf;
        proxy_pass http://$UPSTREAM;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 60s;
    }"
  echo "→ conexión automática a $SLUG ($CID)"
else
  echo '{"auto": false}' >build/grcup-config.json
  echo "→ sin $KEYVAR: la mesa inicia sesión con su cuenta"
fi

t=$(mktemp -d); trap 'rm -rf "$t"' EXIT
sed -e "s|__HOST__|$HOST|g; s|__ENTORNO__|$ENTORNO|g; s|__ROOT__|$ROOT|g; s|__UPSTREAM__|$UPSTREAM|g; s|__LISTEN80__|$LISTEN80|g; s|__LISTEN443__|$LISTEN443|g; s|__ALLOW__|$ALLOW|g" \
  deploy/openlifter.conf.tpl >"$t/site.tpl"
MESA="$MESA" python3 -c 'import os,sys; sys.stdout.write(sys.stdin.read().replace("__MESA__", os.environ["MESA"]))' <"$t/site.tpl" >"$t/site.conf"
[ -n "$KEY" ] && printf '# GR Cup desk key (%s). Do not copy.\nproxy_set_header Authorization "Bearer %s";\n' "$KEYVAR" "$KEY" >"$t/clave.conf"
mkdir "$t/build" && cp -r build/. "$t/build/"

echo "→ release en $KRAKEN:/var/www/grcup-openlifter-$ENTORNO"
tar -C "$t" -cf - . | ssh "$KRAKEN" "sudo bash -c '
set -euo pipefail
tmp=\$(mktemp -d); trap \"rm -rf \$tmp\" EXIT; tar -C \$tmp -xf -
base=/var/www/grcup-openlifter-$ENTORNO
install -d -m 0755 \$base/releases
rm -rf \$base/releases/$VERSION && cp -r \$tmp/build \$base/releases/$VERSION
chmod -R a+rX \$base/releases/$VERSION
ln -sfn \$base/releases/$VERSION \$base/current.new && mv -Tf \$base/current.new \$base/current
ls -1dt \$base/releases/* | tail -n +6 | xargs -r rm -rf
if [ ! -f /etc/letsencrypt/live/$HOST/fullchain.pem ]; then
  certbot certonly --non-interactive --agree-tos --dns-cloudflare --dns-cloudflare-credentials /etc/letsencrypt/cloudflare.ini \
    --dns-cloudflare-propagation-seconds 30 --cert-name $HOST -d $HOST
fi
install -d -m 0700 /etc/nginx/grcup-openlifter
if [ -f \$tmp/clave.conf ]; then install -m 0600 \$tmp/clave.conf /etc/nginx/grcup-openlifter/$ENTORNO-clave.conf; fi
site=/etc/nginx/sites-available/$HOST.conf
[ -f \$site ] && cp \$site \$tmp/anterior.conf
install -m 0644 \$tmp/site.conf \$site
ln -sf \$site /etc/nginx/sites-enabled/$HOST.conf
if nginx -t 2>\$tmp/nginx.log; then
  systemctl reload nginx && echo \"nginx recargado\"
else
  cat \$tmp/nginx.log
  if [ -f \$tmp/anterior.conf ]; then install -m 0644 \$tmp/anterior.conf \$site; else rm -f /etc/nginx/sites-enabled/$HOST.conf; fi
  echo \"nginx -t falló: se deja el sitio anterior y no se recarga\" >&2; exit 1
fi
rm -rf \$tmp
'"

echo "→ DNS $HOST → $IP"
envvar CLOUDFLARE_USER
envvar CLOUDFLARE_API_KEY
: "${CLOUDFLARE_USER:?falta CLOUDFLARE_USER}" "${CLOUDFLARE_API_KEY:?falta CLOUDFLARE_API_KEY}"
HOST="$HOST" IP="$IP" ZONE="$ZONE" COMMENT="$COMMENT" python3 - <<'PY'
import json, os, urllib.request
H = {"X-Auth-Email": os.environ["CLOUDFLARE_USER"], "X-Auth-Key": os.environ["CLOUDFLARE_API_KEY"], "Content-Type": "application/json"}
def call(method, path, body=None):
    req = urllib.request.Request("https://api.cloudflare.com/client/v4" + path, method=method, headers=H, data=json.dumps(body).encode() if body else None)
    with urllib.request.urlopen(req, timeout=30) as r:
        d = json.load(r)
    if not d.get("success"):
        raise SystemExit(f"Cloudflare: {d.get('errors')}")
    return d["result"]
zone = call("GET", f"/zones?name={os.environ['ZONE']}")[0]["id"]
host = os.environ["HOST"]
rec = {"type": "A", "name": host, "content": os.environ["IP"], "ttl": 300, "proxied": False, "comment": os.environ["COMMENT"] + " · openlifter-grcup/deploy/desplegar.sh"}
found = call("GET", f"/zones/{zone}/dns_records?name={host}")
if any(r["type"] != "A" for r in found):
    raise SystemExit(f"{host} ya tiene registros de otro tipo: no se toca")
if found and found[0]["content"] == rec["content"] and not found[0]["proxied"]:
    print(f"= {host} → {rec['content']}")
elif found:
    call("PUT", f"/zones/{zone}/dns_records/{found[0]['id']}", rec); print(f"~ {host} → {rec['content']}")
else:
    call("POST", f"/zones/{zone}/dns_records", rec); print(f"+ {host} → {rec['content']}")
PY
echo "✓ https://$HOST ($VERSION)"
