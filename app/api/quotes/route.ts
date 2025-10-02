import { NextRequest, NextResponse } from "next/server";

type Params = {
  driver: any; vehicle: any; coverage: any; location: any;
};

export async function POST(req: NextRequest) {
  const params: Params = await req.json();
  // TODO: replace mocks with real partner API calls using your credentials
  const quotes = await Promise.allSettled([quoteAXA(params), quoteGNP(params), quoteQualitas(params)]);
  const normalized = quotes
    .filter(q => q.status === "fulfilled")
    .map((q:any) => q.value)
    .sort((a:any,b:any)=> (a?.pago?.anual ?? 1e12) - (b?.pago?.anual ?? 1e12));

  return NextResponse.json(normalized);
}

async function quoteAXA(p: Params) {
  await delay(200);
  return {
    carrier: "AXA",
    planLabel: planName(p.coverage?.plan) + " Plus",
    pago: { anual: 12345, mensual: 1150 },
    deducible: p.coverage?.deducible ?? 5,
    rc_civil: 5000000,
    beneficios: ["auto_sustituto","grúa","cristales"],
    asistencias: ["vial","legal"],
    folio: "AXA-ABC123",
    sourceUrl: "https://axa.mx/"
  };
}

async function quoteGNP(p: Params) {
  await delay(240);
  return {
    carrier: "GNP",
    planLabel: planName(p.coverage?.plan),
    pago: { anual: 12990, mensual: 1210 },
    deducible: p.coverage?.deducible ?? 5,
    rc_civil: 6000000,
    beneficios: ["grúa","cristales"],
    asistencias: ["vial"],
    folio: "GNP-XYZ987",
    sourceUrl: "https://gnp.com.mx/"
  };
}

async function quoteQualitas(p: Params) {
  await delay(180);
  return {
    carrier: "Quálitas",
    planLabel: planName(p.coverage?.plan) + " Max",
    pago: { anual: 11850, mensual: 1090 },
    deducible: p.coverage?.deducible ?? 5,
    rc_civil: 4500000,
    beneficios: ["auto_sustituto","cristales"],
    asistencias: ["vial","legal"],
    folio: "QLT-555777",
    sourceUrl: "https://www.qualitas.com.mx/"
  };
}

function planName(plan?: string) {
  if (plan === "rc") return "Responsabilidad Civil";
  if (plan === "limitada") return "Limitada";
  if (plan === "amplia") return "Amplia";
  if (plan === "premium") return "Premium";
  return "Plan";
}

function delay(ms:number) { return new Promise(r => setTimeout(r, ms)); }
