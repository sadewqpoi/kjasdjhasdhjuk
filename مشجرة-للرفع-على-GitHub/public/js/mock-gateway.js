(function () {
  const ref = new URLSearchParams(location.search).get('ref');
  const H = { 'X-Requested-With': 'fetch', 'Content-Type': 'application/json' };
  const err = (m) => { document.getElementById('err').textContent = m; };
  fetch('/api/payments/mock-gateway/' + encodeURIComponent(ref)).then((r) => r.json()).then((g) => {
    if (g.error) return err(g.error);
    document.getElementById('amount').textContent = (g.amount / 100).toFixed(2) + ' ' + (g.currency === 'SAR' ? 'ر.س' : g.currency);
  });
  function complete(outcome) {
    fetch('/api/payments/mock-gateway/' + encodeURIComponent(ref), {
      method: 'POST', headers: H, body: JSON.stringify({ outcome, method: document.getElementById('method').value }),
    }).then((r) => r.json()).then((d) => { if (d.error) err(d.error); else location.href = d.return_url; });
  }
  document.getElementById('pay').onclick = () => complete('pay');
  document.getElementById('fail').onclick = () => complete('fail');
})();
