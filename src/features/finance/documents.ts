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
      @page { size: A4; margin: 18mm 16mm; }
      body > *:not(#tages-print-root) { display: none !important; }
      #tages-print-root { display: block !important; color: #171717; font-family: Arial, Helvetica, sans-serif; font-size: 12px; line-height: 1.55; }
      #tages-print-root * { box-sizing: border-box; }
      #tages-print-root .document { max-width: 180mm; margin: 0 auto; }
      #tages-print-root h1 { margin: 0 0 24px; text-align: center; font-size: 18px; letter-spacing: .04em; }
      #tages-print-root p { margin: 0 0 12px; }
      #tages-print-root .meta { margin: 20px 0; padding: 14px 16px; border: 1px solid #d8d8d8; border-radius: 8px; }
      #tages-print-root .meta p { margin: 4px 0; }
      #tages-print-root .signature { margin-top: 42px; }
      #tages-print-root .signature p { margin: 3px 0; }
      #tages-print-root .muted { color: #555; }
      #tages-print-root .right { text-align: right; }
      #tages-print-root table { width: 100%; border-collapse: collapse; margin: 18px 0; }
      #tages-print-root th, #tages-print-root td { border: 1px solid #d7d7d7; padding: 8px 9px; text-align: left; vertical-align: top; }
      #tages-print-root th { background: #f3f3f3; font-size: 11px; }
      #tages-print-root .totals { margin-top: 18px; border-top: 1px solid #d8d8d8; padding-top: 14px; }
      #tages-print-root .totals p { margin: 4px 0; }
      #tages-print-root .focus { background: #fffbe8; }
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
    <h1>RECIBO DE PAGAMENTO</h1>
    <p>Declaro que recebi de <strong>${escapeHtml(patient.full_name)}</strong>, CPF nº <strong>${escapeHtml(formatCpf(patient.cpf))}</strong>, a importância de <strong>${escapeHtml(money(amount))} (${escapeHtml(amountInWordsBRL(amount))})</strong>, referente a <strong>${escapeHtml(cleanDescription(entry.description))}</strong>.</p>
    <div class="meta">
      ${installment}
      <p><strong>Data do pagamento:</strong> ${escapeHtml(dateLabel(entry.received_at))}</p>
      <p><strong>Forma de pagamento:</strong> ${escapeHtml(method)}</p>
    </div>
    <p>Para os devidos fins, emito o presente recibo como comprovante do pagamento acima identificado.</p>
    <p style="margin-top:32px">${placeAndDate}</p>
    <div class="signature">
      <p><strong>${escapeHtml(profile.professional_name)}</strong></p>
      <p>CPF: ${escapeHtml(formatCpf(profile.cpf))}</p>
      <p>CRP: ${escapeHtml(profile.crp)}</p>
    </div>`;
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
    <h1>NOTA DE COBRANÇA</h1>
    <div class="meta">
      <p><strong>Paciente:</strong> ${escapeHtml(patient.full_name)}</p>
      <p><strong>CPF:</strong> ${escapeHtml(formatCpf(patient.cpf))}</p>
      <p><strong>Referente a:</strong> ${escapeHtml(cleanDescription(entry.description))}</p>
      <p><strong>Parcela:</strong> ${escapeHtml(installmentLabel(entry))}</p>
      <p><strong>Vencimento:</strong> ${escapeHtml(dateLabel(entry.due_date ?? entry.competence_date))}</p>
      <p><strong>Valor da cobrança:</strong> ${escapeHtml(money(Number(entry.amount || 0)))}</p>
      <p><strong>Valor já recebido:</strong> ${escapeHtml(money(Number(entry.received_amount || 0)))}</p>
      <p><strong>Valor pendente:</strong> ${escapeHtml(money(pending))}</p>
      <p><strong>Situação:</strong> ${escapeHtml(statusLabel(entry))}</p>
    </div>
    <p>Este documento registra, para fins de organização e acompanhamento financeiro, a cobrança pendente identificada acima.</p>
    <p style="margin-top:26px"><strong>Data de emissão:</strong> ${escapeHtml(emissionDate)}</p>
    <div class="signature">
      <p><strong>${escapeHtml(profile.professional_name)}</strong></p>
      <p>CPF: ${escapeHtml(formatCpf(profile.cpf))}</p>
      <p>CRP: ${escapeHtml(profile.crp)}</p>
    </div>`;
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
    <h1>RESUMO FINANCEIRO</h1>
    <div class="meta">
      <p><strong>Paciente:</strong> ${escapeHtml(patient.full_name)}</p>
      <p><strong>CPF:</strong> ${escapeHtml(formatCpf(patient.cpf))}</p>
      <p><strong>Referente a:</strong> ${escapeHtml(cleanDescription(first.description))}</p>
      <p><strong>Valor total:</strong> ${escapeHtml(money(total))}</p>
      <p><strong>Quantidade de parcelas:</strong> ${escapeHtml(totalInstallments)}</p>
    </div>
    <p>Este documento apresenta, para fins de organização e acompanhamento financeiro, os valores e as respectivas datas relacionados ao atendimento ou pacote informado acima.</p>
    <table>
      <thead><tr><th>Parcela</th><th>Valor</th><th>Data de pagamento / vencimento</th><th>Situação</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="totals">
      <p><strong>Valor total:</strong> ${escapeHtml(money(total))}</p>
      <p><strong>Valor recebido:</strong> ${escapeHtml(money(received))}</p>
      <p><strong>Valor a receber:</strong> ${escapeHtml(money(toReceive))}</p>
    </div>
    <p style="margin-top:26px"><strong>Data de emissão:</strong> ${escapeHtml(emissionDate)}</p>
    <div class="signature">
      <p><strong>${escapeHtml(profile.professional_name)}</strong></p>
      <p>CPF: ${escapeHtml(formatCpf(profile.cpf))}</p>
      <p>CRP: ${escapeHtml(profile.crp)}</p>
    </div>`;
  openPrintWindow(`Resumo financeiro - ${patient.full_name}`, content);
}
