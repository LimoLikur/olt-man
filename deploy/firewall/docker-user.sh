#!/usr/bin/env bash
# Host firewall for published Docker ports (SPEC §4 port table, §9). Docker bypasses ufw for
# published ports; the DOCKER-USER chain is where host policy goes. Run as root on the VPS
# (J2), after `docker compose up`. Idempotent: the chain is rebuilt from scratch.
#
#   EXT_IF        public interface (e.g. eth0)
#   OLT_IPS       space-separated real OLT management IPs (trap source, deferred WP5)
#   ADMIN_SSH_IPS not handled here: host SSH is the host firewall's job (ufw / nftables)
set -euo pipefail

EXT_IF="${EXT_IF:?set EXT_IF, e.g. eth0}"
OLT_IPS="${OLT_IPS:-}"

iptables -N DOCKER-USER 2>/dev/null || true
iptables -F DOCKER-USER

# Replies to connections the containers opened (worker -> OLT, worker -> Telegram).
iptables -A DOCKER-USER -m conntrack --ctstate ESTABLISHED,RELATED -j RETURN
# Anything not coming in from the internet side is left to Docker's own rules.
iptables -A DOCKER-USER ! -i "$EXT_IF" -j RETURN
# Internet -> caddy only (after DNAT the destination port is the container port).
iptables -A DOCKER-USER -i "$EXT_IF" -p tcp -m conntrack --ctorigdstport 443 -j RETURN
iptables -A DOCKER-USER -i "$EXT_IF" -p tcp -m conntrack --ctorigdstport 80 -j RETURN
# SNMP traps (deferred, WP5): only from the OLTs.
for ip in $OLT_IPS; do
  iptables -A DOCKER-USER -i "$EXT_IF" -p udp -s "$ip" -m conntrack --ctorigdstport 162 -j RETURN
done
iptables -A DOCKER-USER -i "$EXT_IF" -j DROP

echo "DOCKER-USER:"
iptables -S DOCKER-USER
