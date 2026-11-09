# =====================================================================
# رفع الموقع إلى خادم Hostinger (أول مرة وكل تحديث لاحق)
# شغّله بالنقر المزدوج على "رفع-الموقع.cmd" في مجلد المشروع.
# يسأل عن عنوان الخادم والدومين أول مرة فقط، ويحفظهما لما بعدها.
# =====================================================================
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$root = Split-Path -Parent $PSScriptRoot
$settingsFile = Join-Path $PSScriptRoot '.deploy-settings.json'

function Ask($label, $default) {
  $hint = if ($default) { " [$default]" } else { '' }
  $v = Read-Host "$label$hint"
  if ([string]::IsNullOrWhiteSpace($v)) { return $default } else { return $v.Trim() }
}

Write-Host "`n=== رفع موقع المشجرة إلى الخادم ===`n" -ForegroundColor Yellow

$s = @{ server = ''; domain = ''; email = ''; user = 'root' }
if (Test-Path $settingsFile) {
  $saved = Get-Content $settingsFile -Raw -Encoding UTF8 | ConvertFrom-Json
  foreach ($k in 'server', 'domain', 'email', 'user') { if ($saved.$k) { $s[$k] = $saved.$k } }
}
$s.server = Ask 'عنوان IP الخادم (من لوحة Hostinger)' $s.server
$s.domain = (Ask 'الدومين (بدون https و www، مثل alallat.com)' $s.domain) -replace '^https?://', '' -replace '^www\.', '' -replace '/.*$', ''
$s.email  = Ask 'بريدك (لتنبيهات شهادة HTTPS، اختياري)' $s.email
if (-not $s.server -or -not $s.domain) { Write-Host 'العنوان والدومين مطلوبان.' -ForegroundColor Red; Read-Host 'اضغط Enter للخروج'; exit 1 }
$s | ConvertTo-Json | Set-Content $settingsFile -Encoding UTF8

$first = -not $saved
$withData = $false
$ans = Ask 'هل تريد نقل بيانات جهازك (الحسابات، المشجرة، الوصايا، الصور) إلى الخادم؟ تُنقل فقط إذا كان الخادم فارغًا (نعم/لا)' ($(if ($first) { 'نعم' } else { 'لا' }))
if ($ans -match '^(نعم|y|yes|1)$') { $withData = $true }

$tmp = Join-Path ([IO.Path]::GetTempPath()) ('alallat-deploy-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory $tmp | Out-Null
$appTar = Join-Path $tmp 'alallat-app.tar.gz'
$dataTar = Join-Path $tmp 'alallat-data.tar.gz'

try {
  Write-Host "`n[1/3] تجهيز ملفات الموقع…" -ForegroundColor Cyan
  Push-Location $root
  & tar -czf $appTar --exclude=./node_modules --exclude=./data --exclude=./.env --exclude=./.git --exclude=./.claude --exclude=./deploy/.deploy-settings.json --exclude='*.tar.gz' .
  if ($LASTEXITCODE -ne 0) { throw 'تعذر تجهيز ملفات الموقع' }
  $files = @($appTar)
  if ($withData) {
    & node scripts/backup.js $dataTar
    if ($LASTEXITCODE -ne 0) { throw 'تعذر إنشاء نسخة البيانات' }
    $files += $dataTar
  }
  Pop-Location

  $target = "$($s.user)@$($s.server)"
  Write-Host "`n[2/3] رفع الملفات إلى الخادم (اكتب كلمة مرور الخادم إذا طُلبت، ولن تظهر أثناء الكتابة)…" -ForegroundColor Cyan
  & scp -o StrictHostKeyChecking=accept-new @files "${target}:/tmp/"
  if ($LASTEXITCODE -ne 0) { throw 'تعذر رفع الملفات. تأكد من عنوان IP وكلمة المرور.' }

  Write-Host "`n[3/3] تثبيت الموقع وتشغيله على الخادم (أول مرة قد يستغرق 3-5 دقائق)…" -ForegroundColor Cyan
  $dataArg = if ($withData) { '/tmp/alallat-data.tar.gz' } else { '' }
  $remote = "set -e; rm -rf /opt/alallat/app.new; mkdir -p /opt/alallat/app.new; tar -xzf /tmp/alallat-app.tar.gz -C /opt/alallat/app.new; rm -f /tmp/alallat-app.tar.gz; sed -i 's/\r$//' /opt/alallat/app.new/deploy/setup.sh; bash /opt/alallat/app.new/deploy/setup.sh '$($s.domain)' '$($s.email)' '$dataArg'"
  & ssh -o StrictHostKeyChecking=accept-new $target $remote
  if ($LASTEXITCODE -ne 0) { throw 'حدث خطأ أثناء التثبيت على الخادم (راجع الرسائل أعلاه).' }

  Write-Host "`n✔ تم. افتح: https://$($s.domain)" -ForegroundColor Green
} catch {
  Write-Host "`n✖ $($_.Exception.Message)" -ForegroundColor Red
} finally {
  # حذف الملفات المؤقتة (ومنها نسخة البيانات). نستخدم .NET لأن مسار المؤقت قد يحوي "~"
  try { [IO.Directory]::Delete($tmp, $true) } catch { Write-Host "تنبيه: احذف المجلد المؤقت يدويًا: $tmp" -ForegroundColor Yellow }
}
Read-Host "`nاضغط Enter للإغلاق"
