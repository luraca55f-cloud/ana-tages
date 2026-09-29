import type { AppSettingsRow } from "../clinic/types";
import type { BillingEntry, PatientIdentity, PaymentMethod } from "./types";

const paymentMethodLabels: Record<PaymentMethod, string> = {
  pix: "Pix",
  bank_transfer: "Transferência bancária",
  cash: "Dinheiro",
  credit_card: "Cartão de crédito",
  debit_card: "Cartão de débito",
  other: "Outro",
};

export { paymentMethodLabels };

function escapeHtml(value: string | number | null | undefined) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function money(value: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value || 0);
}

function dateLabel(value: string | null | undefined) {
  if (!value) return "—";
  const [year, month, day] = value.slice(0, 10).split("-");
  return `${day}/${month}/${year}`;
}

function formatCpf(value: string | null | undefined) {
  const digits = (value ?? "").replace(/\D/g, "").slice(0, 11);
  if (!digits) return "—";
  return digits
    .replace(/^(\d{3})(\d)/, "$1.$2")
    .replace(/^(\d{3}\.\d{3})(\d)/, "$1.$2")
    .replace(/^(\d{3}\.\d{3}\.\d{3})(\d{1,2})$/, "$1-$2");
}

function joinHundreds(value: number) {
  const units = ["", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove"];
  const teens = ["dez", "onze", "doze", "treze", "quatorze", "quinze", "dezesseis", "dezessete", "dezoito", "dezenove"];
  const tens = ["", "", "vinte", "trinta", "quarenta", "cinquenta", "sessenta", "setenta", "oitenta", "noventa"];
  const hundreds = ["", "cento", "duzentos", "trezentos", "quatrocentos", "quinhentos", "seiscentos", "setecentos", "oitocentos", "novecentos"];
  if (value === 0) return "";
  if (value === 100) return "cem";
  const parts: string[] = [];
  const h = Math.floor(value / 100);
  const rest = value % 100;
  if (h) parts.push(hundreds[h] ?? "");
  if (rest >= 10 && rest <= 19) parts.push(teens[rest - 10] ?? "");
  else {
    const t = Math.floor(rest / 10);
    const u = rest % 10;
    if (t) parts.push(tens[t] ?? "");
    if (u) parts.push(units[u] ?? "");
  }
  return parts.filter(Boolean).join(" e ");
}

function integerToWords(value: number) {
  if (value === 0) return "zero";
  const parts: string[] = [];
  const millions = Math.floor(value / 1_000_000);
  const thousands = Math.floor((value % 1_000_000) / 1_000);
  const hundreds = value % 1_000;

  if (millions) parts.push(millions === 1 ? "um milhão" : `${joinHundreds(millions)} milhões`);
  if (thousands) parts.push(thousands === 1 ? "mil" : `${joinHundreds(thousands)} mil`);
  if (hundreds) parts.push(joinHundreds(hundreds));

  return parts.join(" e ");
}

function amountInWordsBRL(value: number) {
  const totalCents = Math.round(Math.max(0, value) * 100);
  const reais = Math.floor(totalCents / 100);
  const cents = totalCents % 100;
  const parts: string[] = [];
  if (reais > 0) {
    const deReais = reais >= 1_000_000 && reais % 1_000_000 === 0;
    parts.push(`${integerToWords(reais)}${deReais ? " de" : ""} ${reais === 1 ? "real" : "reais"}`);
  }
  if (cents > 0) parts.push(`${integerToWords(cents)} ${cents === 1 ? "centavo" : "centavos"}`);
  return parts.length ? parts.join(" e ") : "zero reais";
}

function cleanDescription(description: string) {
  return description
    .replace(/\s*[—-]\s*parcela\s+\d+\/\d+\s*$/i, "")
    .replace(/\s*[—-]\s*pagamento único\s*$/i, "")
    .trim();
}

function statusLabel(entry: BillingEntry) {
  const remaining = Math.max(0, Number(entry.amount) - Number(entry.received_amount || 0));
  if (remaining <= 0) return "Paga";
  const today = new Date();
  const isoToday = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  if (entry.due_date && entry.due_date < isoToday) return "Vencida";
  if (entry.status === "partial") return "Parcial";
  return "Pendente";
}

function installmentLabel(entry: BillingEntry) {
  if (entry.installment_number && entry.installment_count) return `${entry.installment_number} de ${entry.installment_count}`;
  return "Pagamento único";
}

function validateProfile(profile: AppSettingsRow) {
  if (!profile.professional_name?.trim() || !profile.cpf || !profile.crp?.trim()) {
    throw new Error("Preencha Nome completo, CPF e CRP em Configurações antes de emitir documentos financeiros.");
  }
}

function validatePatient(patient: PatientIdentity) {
  if (!patient.full_name?.trim() || !patient.cpf) {
    throw new Error("Cadastre o CPF do paciente antes de emitir o documento financeiro.");
  }
}


function documentHeader(title: string, subtitle: string) {
  return `<div class="brandbar">
    <div class="brandmark">AK</div>
    <div class="brandcopy"><strong>TAGES | Consultório Anna</strong><span>${escapeHtml(subtitle)}</span></div>
    <div class="doclabel">${escapeHtml(title)}</div>
  </div>
  <div class="titleblock"><p class="kicker">DOCUMENTO FINANCEIRO</p><h1>${escapeHtml(title)}</h1></div>`;
}

function professionalSignature(profile: AppSettingsRow) {
  return `<div class="signature-card">
    <div class="signature-line"></div>
    <p class="signature-name">${escapeHtml(profile.professional_name)}</p>
    <p>CPF ${escapeHtml(formatCpf(profile.cpf))} &nbsp;•&nbsp; CRP ${escapeHtml(profile.crp)}</p>
  </div>`;
}

function openPrintWindow(title: string, content: string) {
  // Evita depender de pop-ups: alguns navegadores bloqueiam window.open() mesmo quando
  // o clique parte de um botão. A impressão é preparada na própria página, acionada e
  // removida assim que o diálogo do navegador é fechado.
  const existing = document.getElementById("tages-print-root");
  existing?.remove();
  document.getElementById("tages-print-style")?.remove();

  const printRoot = document.createElement("section");
  printRoot.id = "tages-print-root";
  printRoot.setAttribute("aria-hidden", "true");
  printRoot.innerHTML = `<div class="document">${content}</div>`;

  const style = document.createElement("style");
  style.id = "tages-print-style";
  style.textContent = `
    #tages-print-root { display: none; }
    @media print {
      @page { size: A4; margin: 14mm 14mm 16mm; }
      body > *:not(#tages-print-root) { display: none !important; }
      #tages-print-root { display: block !important; color: #24372d; font-family: "Segoe UI", Arial, sans-serif; font-size: 11.5px; line-height: 1.5; }
      #tages-print-root * { box-sizing: border-box; }
      #tages-print-root .document { max-width: 182mm; min-height: 250mm; margin: 0 auto; }
      #tages-print-root .brandbar { display:flex; align-items:center; gap:10px; padding:10px 12px; border:1px solid #dbe2dc; border-radius:12px; background:#f7f8f5; }
      #tages-print-root .brandmark { display:grid; place-items:center; width:34px; height:34px; border-radius:50%; background:#294536; color:#fff; font-family:Georgia,serif; font-weight:700; }
      #tages-print-root .brandcopy { display:flex; flex-direction:column; flex:1; line-height:1.25; }
      #tages-print-root .brandcopy strong { font-size:11px; }
      #tages-print-root .brandcopy span { color:#6c766f; font-size:8.5px; margin-top:2px; }
      #tages-print-root .doclabel { color:#294536; font-size:8px; font-weight:700; letter-spacing:.08em; text-transform:uppercase; }
      #tages-print-root .titleblock { padding:24px 2px 12px; }
      #tages-print-root .kicker { margin:0 0 4px; color:#7b827d; font-size:8px; font-weight:700; letter-spacing:.16em; }
      #tages-print-root h1 { margin:0; color:#20382b; font-family:Georgia,"Times New Roman",serif; font-size:22px; font-weight:500; letter-spacing:0; text-align:left; }
      #tages-print-root p { margin: 0 0 10px; }
      #tages-print-root .lead { font-size:12.5px; line-height:1.65; color:#2c3731; }
      #tages-print-root .meta { display:grid; grid-template-columns:1fr 1fr; gap:8px 18px; margin:12px 0 18px; padding:14px 16px; border:1px solid #dbe2dc; border-radius:12px; background:#fbfcfa; }
      #tages-print-root .meta p { margin:0; }
      #tages-print-root .meta p strong { color:#526158; font-size:9px; text-transform:uppercase; letter-spacing:.03em; }
      #tages-print-root .amount-box { margin:16px 0; padding:14px 16px; border-left:4px solid #294536; border-radius:0 12px 12px 0; background:#f2f5f1; }
      #tages-print-root .amount-box span { display:block; color:#6c766f; font-size:9px; text-transform:uppercase; }
      #tages-print-root .amount-box strong { display:block; margin-top:2px; font-family:Georgia,serif; font-size:19px; color:#20382b; }
      #tages-print-root .signature-card { width:58%; margin-top:42px; padding-top:6px; color:#4f5c54; }
      #tages-print-root .signature-line { width:72%; border-top:1px solid #859189; margin-bottom:8px; }
      #tages-print-root .signature-card p { margin:2px 0; font-size:9.5px; }
      #tages-print-root .signature-name { color:#20382b; font-size:11px !important; font-weight:700; }
      #tages-print-root .muted { color: #6c766f; }
      #tages-print-root .right { text-align: right; }
      #tages-print-root table { width:100%; border-collapse:separate; border-spacing:0; margin:16px 0; border:1px solid #dbe2dc; border-radius:10px; overflow:hidden; }
      #tages-print-root th, #tages-print-root td { border-bottom:1px solid #e5e9e5; padding:8px 9px; text-align:left; vertical-align:top; }
      #tages-print-root tr:last-child td { border-bottom:0; }
      #tages-print-root th { background:#f1f4f0; color:#526158; font-size:8.5px; letter-spacing:.05em; text-transform:uppercase; }
      #tages-print-root .totals { display:grid; grid-template-columns:repeat(3,1fr); gap:8px; margin-top:16px; padding-top:14px; border-top:1px solid #dbe2dc; }
      #tages-print-root .totals p { margin:0; padding:10px; border-radius:9px; background:#f7f8f5; }
      #tages-print-root .focus { background:#f5f7ee; }
      #tages-print-root .document-footer { margin-top:22px; padding-top:10px; border-top:1px solid #e1e6e1; color:#7b827d; font-size:8.5px; }
    }
  `;


  const previousTitle = document.title;
  const cleanup = () => {
    printRoot.remove();
    style.remove();
    document.title = previousTitle;
    window.removeEventListener("afterprint", cleanup);
  };

  document.head.appendChild(style);
  document.body.appendChild(printRoot);
  document.title = title;
  window.addEventListener("afterprint", cleanup, { once: true });

  try {
    // window.print() é disparado diretamente no gesto do usuário, sem nova aba/janela.
    window.print();
  } catch (error) {
    cleanup();
    throw error;
  }

  // Fallback para navegadores que não disparam afterprint de forma confiável.
  window.setTimeout(() => {
    if (document.getElementById("tages-print-root")) cleanup();
  }, 60_000);
}

export function printPaymentReceipt({
  entry,
  patient,
  profile,
}: {
  entry: BillingEntry;
  patient: PatientIdentity;
  profile: AppSettingsRow;
}) {
  validateProfile(profile);
  validatePatient(patient);
  if (!entry.received_at || Number(entry.received_amount || 0) <= 0) throw new Error("Este lançamento ainda não possui pagamento recebido para emissão de recibo.");

  const amount = Number(entry.received_amount || 0);
  const method = entry.payment_method ? paymentMethodLabels[entry.payment_method] : "Não informado";
  const emissionDate = dateLabel(new Date().toISOString().slice(0, 10));
  const placeAndDate = profile.city?.trim() ? `${escapeHtml(profile.city)}, ${escapeHtml(emissionDate)}` : escapeHtml(emissionDate);
  const installment = entry.installment_number && entry.installment_count
    ? `<p><strong>Parcela:</strong> ${escapeHtml(entry.installment_number)} de ${escapeHtml(entry.installment_count)}</p>`
    : "";

  const content = `
    ${documentHeader("Recibo de pagamento", "Comprovante de recebimento")}
    <p class="lead">Declaro que recebi de <strong>${escapeHtml(patient.full_name)}</strong>, CPF nº <strong>${escapeHtml(formatCpf(patient.cpf))}</strong>, o valor abaixo referente a <strong>${escapeHtml(cleanDescription(entry.description))}</strong>.</p>
    <div class="amount-box"><span>Valor recebido</span><strong>${escapeHtml(money(amount))}</strong><small>${escapeHtml(amountInWordsBRL(amount))}</small></div>
    <div class="meta">
      ${installment}
      <p><strong>Data do pagamento</strong><br>${escapeHtml(dateLabel(entry.received_at))}</p>
      <p><strong>Forma de pagamento</strong><br>${escapeHtml(method)}</p>
      <p><strong>Paciente</strong><br>${escapeHtml(patient.full_name)}</p>
    </div>
    <p class="muted">Para os devidos fins, emito o presente recibo como comprovante do pagamento acima identificado.</p>
    <p style="margin-top:24px">${placeAndDate}</p>
    ${professionalSignature(profile)}
    <div class="document-footer">Documento emitido pelo TAGES | Consultório Anna.</div>`;
  openPrintWindow(`Recibo - ${patient.full_name}`, content);
}


export function printCollectionNotice({
  entry,
  patient,
  profile,
}: {
  entry: BillingEntry;
  patient: PatientIdentity;
  profile: AppSettingsRow;
}) {
  validateProfile(profile);
  validatePatient(patient);
  const pending = Math.max(0, Number(entry.amount || 0) - Number(entry.received_amount || 0));
  if (pending <= 0) throw new Error("Esta cobrança não possui valor pendente para emissão de nota de cobrança.");
  const emissionDate = dateLabel(new Date().toISOString().slice(0, 10));
  const content = `
    ${documentHeader("Nota de cobrança", "Cobrança financeira pendente")}
    <div class="meta">
      <p><strong>Paciente</strong><br>${escapeHtml(patient.full_name)}</p>
      <p><strong>CPF</strong><br>${escapeHtml(formatCpf(patient.cpf))}</p>
      <p><strong>Referente a</strong><br>${escapeHtml(cleanDescription(entry.description))}</p>
      <p><strong>Parcela</strong><br>${escapeHtml(installmentLabel(entry))}</p>
      <p><strong>Vencimento</strong><br>${escapeHtml(dateLabel(entry.due_date ?? entry.competence_date))}</p>
      <p><strong>Situação</strong><br>${escapeHtml(statusLabel(entry))}</p>
    </div>
    <div class="amount-box"><span>Valor pendente</span><strong>${escapeHtml(money(pending))}</strong><small>Cobrança: ${escapeHtml(money(Number(entry.amount || 0)))} • Recebido: ${escapeHtml(money(Number(entry.received_amount || 0)))}</small></div>
    <p class="muted">Este documento registra, para fins de organização e acompanhamento financeiro, a cobrança pendente identificada acima.</p>
    <p style="margin-top:24px"><strong>Data de emissão:</strong> ${escapeHtml(emissionDate)}</p>
    ${professionalSignature(profile)}
    <div class="document-footer">Documento emitido pelo TAGES | Consultório Anna.</div>`;
  openPrintWindow(`Nota de cobrança - ${patient.full_name}`, content);
}

export function printFinancialSummary({
  entries,
  patient,
  profile,
  focusEntryId,
}: {
  entries: BillingEntry[];
  patient: PatientIdentity;
  profile: AppSettingsRow;
  focusEntryId?: string;
}) {
  validateProfile(profile);
  validatePatient(patient);
  if (!entries.length) throw new Error("Não há cobranças para emitir o resumo financeiro.");

  const ordered = [...entries].sort((a, b) => (a.due_date ?? a.competence_date).localeCompare(b.due_date ?? b.competence_date));
  const first = ordered[0]!;
  const total = ordered.reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
  const received = ordered.reduce((sum, entry) => sum + Number(entry.received_amount || 0), 0);
  const toReceive = Math.max(0, total - received);
  const totalInstallments = Math.max(
    ordered.length,
    ...ordered.map((entry) => Number(entry.installment_count || 0)),
  );
  const rows = ordered.map((entry, index) => {
    const date = entry.received_at && Number(entry.received_amount || 0) >= Number(entry.amount)
      ? entry.received_at
      : entry.due_date ?? entry.competence_date;
    return `<tr${focusEntryId === entry.id ? ' class="focus"' : ""}>
      <td>${escapeHtml(entry.installment_number ? String(entry.installment_number) : String(index + 1))}${totalInstallments > 1 ? `/${escapeHtml(totalInstallments)}` : ""}</td>
      <td>${escapeHtml(money(Number(entry.amount || 0)))}</td>
      <td>${escapeHtml(dateLabel(date))}</td>
      <td>${escapeHtml(statusLabel(entry))}</td>
    </tr>`;
  }).join("");
  const emissionDate = dateLabel(new Date().toISOString().slice(0, 10));

  const content = `
    ${documentHeader("Resumo financeiro", "Acompanhamento de cobranças e pagamentos")}
    <div class="meta">
      <p><strong>Paciente</strong><br>${escapeHtml(patient.full_name)}</p>
      <p><strong>CPF</strong><br>${escapeHtml(formatCpf(patient.cpf))}</p>
      <p><strong>Referente a</strong><br>${escapeHtml(cleanDescription(first.description))}</p>
      <p><strong>Quantidade de parcelas</strong><br>${escapeHtml(totalInstallments)}</p>
    </div>
    <p class="muted">Valores e datas relacionados ao atendimento ou pacote selecionado.</p>
    <table>
      <thead><tr><th>Parcela</th><th>Valor</th><th>Pagamento / vencimento</th><th>Situação</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="totals">
      <p><strong>Valor total</strong><br>${escapeHtml(money(total))}</p>
      <p><strong>Valor recebido</strong><br>${escapeHtml(money(received))}</p>
      <p><strong>Valor a receber</strong><br>${escapeHtml(money(toReceive))}</p>
    </div>
    <p style="margin-top:24px"><strong>Data de emissão:</strong> ${escapeHtml(emissionDate)}</p>
    ${professionalSignature(profile)}
    <div class="document-footer">Documento emitido pelo TAGES | Consultório Anna.</div>`;
  openPrintWindow(`Resumo financeiro - ${patient.full_name}`, content);
}
