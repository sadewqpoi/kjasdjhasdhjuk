#!/usr/bin/env bash
# =====================================================================
# إعداد/تحديث موقع المشجرة على خادم Ubuntu (Hostinger VPS)
#   bash setup.sh <الدومين> [البريد] [ملف-البيانات.tar.gz]
# يُستدعى تلقائيًا من سكربت الرفع (deploy.ps1) بعد نسخ الكود إلى /opt/alallat/app.new
# آمن للتكرار: أول مرة يثبّت كل شيء، وبعدها يحدّث الكود فقط ويحتفظ بالبيانات.
# =====================================================================
set -euo pipefail

DOMAIN="${1:?الدومين مطلوب}"
EMAIL="${2:-}"
DATA_TAR="${3:-}"
APP_ROOT=/opt/alallat
NEW="$APP_ROOT/app.new"
APP="$APP_ROOT/app"
DATA=/var/lib/alallat
BACKUPS=/var/backups/alallat
ENVF=/etc/alallat.env
SVC=alallat
export DEBIAN_FRONTEND=noninteractive

say() { echo -e "\n\033[1;33m==> $*\033[0m"; }
[ "$(id -u)" = 0 ] || { echo "شغّل السكربت بحساب root"; exit 1; }
[ -f "$NEW/package.json" ] || { echo "لم يُعثر على الكود في $NEW"; exit 1; }

# ---------- 1) الحزم الأساسية ----------
say "تجهيز النظام"
apt-get update -qq
apt-get install -y -qq curl ca-certificates gnupg ufw debian-keyring debian-archive-keyring apt-transport-https >/dev/null

# ---------- 2) Node.js 24 ----------
if ! command -v node >/dev/null || ! node -v | grep -q '^v24\.'; then
  say "تثبيت Node.js 24"
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
echo "Node $(node -v)"

# ---------- 3) Caddy (خادم الويب + شهادة HTTPS تلقائية مجانية) ----------
if ! command -v caddy >/dev/null; then
  say "تثبيت Caddy"
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq && apt-get install -y -qq caddy >/dev/null
fi

# ---------- 4) مستخدم الخدمة ومجلدات البيانات ----------
id "$SVC" >/dev/null 2>&1 || useradd --system --home "$DATA" --shell /usr/sbin/nologin "$SVC"
mkdir -p "$DATA" "$BACKUPS"
chown -R "$SVC:$SVC" "$DATA" "$BACKUPS"
chmod 750 "$DATA" "$BACKUPS"

# ---------- 5) الإعدادات (تُنشأ مرة واحدة، ويُحدَّث الدومين فقط) ----------
if [ ! -f "$ENVF" ]; then
  say "إنشاء ملف الإعدادات $ENVF"
  cat > "$ENVF" <<EOF
NODE_ENV=production
PORT=3000
PUBLIC_URL=https://$DOMAIN
DATA_DIR=$DATA
TRUST_PROXY=1
EOF
else
  sed -i "s|^PUBLIC_URL=.*|PUBLIC_URL=https://$DOMAIN|" "$ENVF"
fi
chmod 600 "$ENVF"

# ---------- 6) تثبيت مكتبات المشروع ----------
say "تثبيت مكتبات المشروع"
cd "$NEW"
npm ci --omit=dev --no-audit --no-fund --loglevel=error
chmod -R a+rX "$NEW"

# ---------- 7) نقل البيانات (أول مرة فقط) ----------
if [ -n "$DATA_TAR" ] && [ -f "$DATA_TAR" ]; then
  if [ -f "$DATA/family.db" ]; then
    echo "ℹ توجد بيانات على الخادم مسبقًا، فلم تُستبدل. للاستبدال استخدم: لوحة الإدارة ← الإعدادات ← استعادة نسخة احتياطية"
  else
    say "تجهيز بياناتك المنقولة"
    runuser -u "$SVC" -- env DATA_DIR="$DATA" node scripts/restore.js "$DATA_TAR"
  fi
  rm -f "$DATA_TAR"
fi

# ---------- 8) استبدال الكود القديم بالجديد ----------
say "تشغيل النسخة الجديدة"
systemctl stop "$SVC" 2>/dev/null || true
rm -rf "$APP_ROOT/app.old"
[ -d "$APP" ] && mv "$APP" "$APP_ROOT/app.old"
mv "$NEW" "$APP"
chown -R root:root "$APP" && chmod -R a+rX "$APP"

cat > /etc/systemd/system/$SVC.service <<EOF
[Unit]
Description=Alallat family tree
After=network-online.target
Wants=network-online.target

[Service]
User=$SVC
Group=$SVC
WorkingDirectory=$APP
EnvironmentFile=$ENVF
ExecStart=/usr/bin/node src/server.js
Restart=always
RestartSec=3
NoNewPrivileges=true
ProtectSystem=full
ReadWritePaths=$DATA /tmp

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now "$SVC" >/dev/null
systemctl restart "$SVC"

# أداة إنشاء/ترقية حساب مدير: alallat-admin 05XXXXXXXX "كلمة المرور" "الاسم"
cat > /usr/local/bin/alallat-admin <<EOF
#!/bin/bash
set -a; . $ENVF; set +a
cd $APP && exec runuser -u $SVC -- node scripts/create-admin.js "\$@"
EOF
chmod 755 /usr/local/bin/alallat-admin

# ---------- 9) Caddy: الدومين + HTTPS ----------
say "ضبط الدومين وشهادة HTTPS"
{
  [ -n "$EMAIL" ] && printf '{\n\temail %s\n}\n\n' "$EMAIL"
  cat <<EOF
$DOMAIN {
	encode gzip
	request_body {
		max_size 2GB
	}
	reverse_proxy 127.0.0.1:3000
}

www.$DOMAIN {
	redir https://$DOMAIN{uri} permanent
}
EOF
} > /etc/caddy/Caddyfile
systemctl enable caddy >/dev/null 2>&1 || true
systemctl reload caddy 2>/dev/null || systemctl restart caddy

# ---------- 10) الجدار الناري ----------
ufw allow OpenSSH >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null

# ---------- 11) نسخة احتياطية يومية (يُحتفظ بآخر 14 يومًا) ----------
cat > /etc/cron.daily/alallat-backup <<EOF
#!/bin/bash
set -a; . $ENVF; set +a
cd $APP && runuser -u $SVC -- node scripts/backup.js "$BACKUPS/backup-\$(date +%F).tar.gz" >/dev/null
find "$BACKUPS" -name 'backup-*.tar.gz' -mtime +14 -delete
EOF
chmod 755 /etc/cron.daily/alallat-backup

# ---------- 12) التحقق ----------
say "التحقق من عمل الموقع"
ok=0
for i in $(seq 1 20); do
  if curl -fsS http://127.0.0.1:3000/api/health >/dev/null 2>&1; then ok=1; break; fi
  sleep 1
done
if [ "$ok" = 1 ]; then
  rm -rf "$APP_ROOT/app.old"
  IP=$(curl -fsS -4 https://ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')
  echo -e "\n\033[1;32m✔ الموقع يعمل.\033[0m"
  echo "  الرابط: https://$DOMAIN   (يعمل بعد توجيه الدومين إلى IP الخادم: $IP)"
  echo "  إنشاء حساب مدير:     alallat-admin 05XXXXXXXX \"كلمة المرور\" \"الاسم\""
  echo "  سجل الموقع:           journalctl -u $SVC -f"
  echo "  النسخ الاحتياطية:     $BACKUPS"
else
  echo -e "\n\033[1;31m✖ الموقع لم يبدأ. آخر سطور السجل:\033[0m"
  journalctl -u "$SVC" -n 40 --no-pager
  if [ -d "$APP_ROOT/app.old" ]; then
    echo "للرجوع للنسخة السابقة: rm -rf $APP && mv $APP_ROOT/app.old $APP && systemctl restart $SVC"
  fi
  exit 1
fi
