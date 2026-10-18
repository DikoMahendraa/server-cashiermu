import { JOB_STATUSES, JOB_STATUS_LABELS, type JobStatusValue } from '../transactions/job';

export interface ReceiptView {
  store: { name: string; address: string; phone: string; header: string; footer: string };
  invoiceNumber: string;
  createdAt: Date;
  voided: boolean;
  customerName: string;
  job: { status: JobStatusValue; updatedAt: Date | null; dueAt: Date | null } | null;
  items: { name: string; quantity: number; unitPrice: number; subtotal: number; variants: string[]; note: string }[];
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  serviceChargeAmount: number;
  grandTotal: number;
  payments: { method: string; amount: number }[];
  note: string;
}

const PAYMENT_LABELS: Record<string, string> = {
  cash: 'Tunai',
  qris: 'QRIS',
  transfer: 'Transfer',
  debit_card: 'Kartu debit',
  credit_card: 'Kartu kredit',
};

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function formatRupiah(amount: number): string {
  const rounded = Math.round(amount);
  const digits = Math.abs(rounded)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${rounded < 0 ? '-' : ''}Rp ${digits}`;
}

/** 2 → "2", 1.5 → "1,5", 0.25 → "0,25" (Decimal(12,3) never needs more than 3 digits). */
export function formatQuantity(quantity: number): string {
  return String(Math.round(quantity * 1000) / 1000).replace('.', ',');
}

const dateFormat = new Intl.DateTimeFormat('id-ID', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Asia/Jakarta',
});

export function formatDateTime(date: Date): string {
  return `${dateFormat.format(date).replace(/\./g, ':')} WIB`;
}

const STYLE = `
*{box-sizing:border-box}body{margin:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#0f172a;line-height:1.45}
main{max-width:460px;margin:0 auto;padding:16px}
.card{background:#fff;border-radius:16px;padding:20px;box-shadow:0 1px 3px rgba(15,23,42,.08);margin-bottom:12px}
h1{font-size:20px;margin:0 0 2px}h2{font-size:13px;margin:0 0 10px;text-transform:uppercase;letter-spacing:.06em;color:#64748b}
.muted{color:#64748b;font-size:13px}.center{text-align:center}
.row{display:flex;justify-content:space-between;gap:12px;padding:3px 0}.row.total{font-weight:800;font-size:17px;border-top:1px dashed #cbd5e1;margin-top:6px;padding-top:10px}
.item{padding:8px 0;border-bottom:1px solid #f1f5f9}.item:last-child{border-bottom:0}.item small{display:block;color:#64748b}
.badge{display:inline-block;padding:4px 12px;border-radius:999px;font-weight:700;font-size:13px}
.s-pending{background:#fef3c7;color:#92400e}.s-in_progress{background:#dbeafe;color:#1e40af}.s-ready{background:#dcfce7;color:#166534}.s-completed{background:#e2e8f0;color:#334155}.s-voided{background:#fee2e2;color:#991b1b}
ol.steps{display:flex;list-style:none;padding:0;margin:14px 0 0;gap:4px}ol.steps li{flex:1;text-align:center;font-size:11px;color:#94a3b8;border-top:4px solid #e2e8f0;padding-top:6px}
ol.steps li.done{color:#0f172a;border-top-color:#1B9E6A;font-weight:700}
`;

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>${escapeHtml(title)}</title><style>${STYLE}</style></head>
<body><main>${body}</main></body></html>`;
}

function statusSection(view: ReceiptView): string {
  if (view.voided) {
    return `<div class="card center"><span class="badge s-voided">Dibatalkan</span></div>`;
  }
  if (!view.job) return '';
  const { status, updatedAt, dueAt } = view.job;
  const reached = JOB_STATUSES.indexOf(status);
  const steps = JOB_STATUSES.map(
    (key, index) => `<li class="${index <= reached ? 'done' : ''}">${escapeHtml(JOB_STATUS_LABELS[key])}</li>`,
  ).join('');
  return `<div class="card center"><h2>Status pesanan</h2>
<span class="badge s-${status}">${escapeHtml(JOB_STATUS_LABELS[status])}</span>
${dueAt ? `<p class="muted" style="margin:10px 0 0">Estimasi selesai: <strong>${escapeHtml(formatDateTime(dueAt))}</strong></p>` : ''}
${updatedAt ? `<p class="muted" style="margin:4px 0 0">Diperbarui ${escapeHtml(formatDateTime(updatedAt))}</p>` : ''}
<ol class="steps">${steps}</ol></div>`;
}

export function renderReceiptPage(view: ReceiptView): string {
  const { store } = view;
  const items = view.items
    .map(
      item => `<div class="item"><div class="row"><span>${escapeHtml(item.name)}</span><strong>${formatRupiah(item.subtotal)}</strong></div>
<small>${formatQuantity(item.quantity)} × ${formatRupiah(item.unitPrice)}${item.variants.length ? ` · ${escapeHtml(item.variants.join(', '))}` : ''}${item.note ? ` · ${escapeHtml(item.note)}` : ''}</small></div>`,
    )
    .join('');
  const line = (label: string, amount: number, sign = ''): string =>
    amount > 0 ? `<div class="row"><span>${label}</span><span>${sign}${formatRupiah(amount)}</span></div>` : '';

  const body = `
<div class="card center"><h1>${escapeHtml(store.name)}</h1>
${store.header ? `<p class="muted" style="margin:4px 0">${escapeHtml(store.header)}</p>` : ''}
${store.address ? `<p class="muted" style="margin:4px 0">${escapeHtml(store.address)}</p>` : ''}
${store.phone ? `<p class="muted" style="margin:4px 0">${escapeHtml(store.phone)}</p>` : ''}</div>
${statusSection(view)}
<div class="card"><h2>Struk</h2>
<div class="row"><span class="muted">No. struk</span><strong>${escapeHtml(view.invoiceNumber)}</strong></div>
<div class="row"><span class="muted">Tanggal</span><span>${escapeHtml(formatDateTime(view.createdAt))}</span></div>
${view.customerName ? `<div class="row"><span class="muted">Pelanggan</span><span>${escapeHtml(view.customerName)}</span></div>` : ''}
</div>
<div class="card"><h2>Rincian</h2>${items}
<div style="margin-top:10px">
<div class="row"><span>Subtotal</span><span>${formatRupiah(view.subtotal)}</span></div>
${line('Diskon', view.discountAmount, '-')}${line('Pajak', view.taxAmount)}${line('Biaya layanan', view.serviceChargeAmount)}
<div class="row total"><span>Total</span><span>${formatRupiah(view.grandTotal)}</span></div></div>
${view.payments.map(p => `<div class="row muted"><span>${escapeHtml(PAYMENT_LABELS[p.method] ?? p.method)}</span><span>${formatRupiah(p.amount)}</span></div>`).join('')}
${view.note ? `<p class="muted">Catatan: ${escapeHtml(view.note)}</p>` : ''}</div>
${store.footer ? `<p class="muted center">${escapeHtml(store.footer)}</p>` : ''}
<p class="muted center">Dibuat dengan CashierMu</p>`;
  return page(`Struk ${view.invoiceNumber} · ${store.name}`, body);
}

export function renderReceiptNotFound(): string {
  return page(
    'Struk tidak ditemukan',
    `<div class="card center"><h1>Struk tidak ditemukan</h1><p class="muted">Tautan ini tidak valid atau sudah tidak berlaku. Hubungi toko yang mengirimkannya.</p></div>`,
  );
}
