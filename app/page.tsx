"use client";
import React, { useMemo, useState } from "react";

type Driver = {
  nombre: string; apellido: string; fechaNacimiento: string;
  genero: "M"|"F"|"X"; email: string; telefono: string;
};
type Vehicle = { marca: string; modelo: string; anio: number; version?: string; };
type Coverage = { plan: "rc"|"limitada"|"amplia"|"premium"; deducible: number; };
type Location = { codigoPostal: string; estado?: string; ciudad?: string; };
type Quote = {
  carrier: string;
  planLabel: string;
  pago?: { anual?: number; mensual?: number };
  deducible?: number;
  rc_civil?: number;
  beneficios?: string[];
  asistencias?: string[];
  folio?: string;
  sourceUrl?: string;
};

const Label = ({children}:{children: React.ReactNode}) => (
  <label className="block text-sm font-medium text-gray-700 mb-1">{children}</label>
);
const Input = (props:any) => (
  <input {...props} className={"w-full rounded-xl border px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 " + (props.className??"")} />
);
const Select = (props:any) => (
  <select {...props} className={"w-full rounded-xl border px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 " + (props.className??"")} />
);
const Button = ({children, className="", ...rest}:any) => (
  <button {...rest} className={"rounded-2xl bg-indigo-600 px-4 py-2 text-white text-sm font-semibold shadow hover:bg-indigo-700 disabled:opacity-50 " + className}>{children}</button>
);
const Card = ({children}:{children: React.ReactNode}) => (
  <div className="rounded-2xl border bg-white p-4 shadow-sm">{children}</div>
);

export default function Page() {
  const [driver, setDriver] = useState<Driver>({ nombre:"", apellido:"", fechaNacimiento:"", genero:"M", email:"", telefono:"" });
  const [vehicle, setVehicle] = useState<Vehicle>({ marca:"", modelo:"", anio:2021, version:"" });
  const [coverage, setCoverage] = useState<Coverage>({ plan:"amplia", deducible:5 });
  const [location, setLocation] = useState<Location>({ codigoPostal:"" });
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [loadingQuotes, setLoadingQuotes] = useState(false);

  const [assist, setAssist] = useState<{role:"user"|"assistant"|"system", content:string}[]>([
    { role:"system", content:"Eres un asesor imparcial de seguros de auto en México." },
    { role:"user", content:"Hola, ¿me ayudas a elegir el mejor plan?" }
  ]);
  const [assistInput, setAssistInput] = useState("");
  const [assistBusy, setAssistBusy] = useState(false);

  const canQuote = useMemo(()=>(
    driver.nombre && driver.apellido && driver.fechaNacimiento && vehicle.marca && vehicle.modelo && vehicle.anio && location.codigoPostal
  ), [driver, vehicle, location]);

  async function getQuotes() {
    setLoadingQuotes(true);
    try {
      const res = await fetch("/api/quotes", {
        method:"POST",
        headers: { "Content-Type":"application/json" },
        body: JSON.stringify({ driver, vehicle, coverage, location })
      });
      if (!res.ok) throw new Error("Quotes API error");
      const data = await res.json();
      setQuotes(data);
    } catch (e:any) {
      alert("Error al obtener cotizaciones (mock). Implementa tus conectores reales.");
    } finally {
      setLoadingQuotes(false);
    }
  }

  async function askAssist() {
    if (!assistInput.trim()) return;
    const next = [...assist, { role:"user" as const, content:assistInput }];
    setAssist(next);
    setAssistBusy(true);
    setAssistInput("");

    try {
      const res = await fetch("/api/assist", {
        method:"POST",
        headers: { "Content-Type":"application/json" },
        body: JSON.stringify({ messages: next, context: { driver, vehicle, coverage, location, quotes } })
      });
      const data = await res.json();
      setAssist([...next, { role:"assistant", content: data.reply }]);
    } catch (e:any) {
      setAssist([...next, { role:"assistant", content:"Hubo un problema consultando al asistente." }]);
    } finally {
      setAssistBusy(false);
    }
  }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b bg-white/80 backdrop-blur">
        <div className="mx-auto max-w-7xl px-4 py-4 flex items-center justify-between">
          <h1 className="text-xl font-bold">Comparador de Seguros de Auto (MX)</h1>
          <div className="text-xs text-gray-500">Demo — Requiere backend real</div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <Card>
            <h2 className="text-lg font-semibold mb-3">Conductor</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div><Label>Nombre</Label><Input value={driver.nombre} onChange={(e:any)=>setDriver({...driver, nombre:e.target.value})} placeholder="Juan"/></div>
              <div><Label>Apellido</Label><Input value={driver.apellido} onChange={(e:any)=>setDriver({...driver, apellido:e.target.value})} placeholder="Pérez"/></div>
              <div><Label>Fecha de nacimiento</Label><Input type="date" value={driver.fechaNacimiento} onChange={(e:any)=>setDriver({...driver, fechaNacimiento:e.target.value})}/></div>
              <div><Label>Género</Label><Select value={driver.genero} onChange={(e:any)=>setDriver({...driver, genero:e.target.value})}><option value="M">Masculino</option><option value="F">Femenino</option><option value="X">Otro</option></Select></div>
              <div><Label>Email</Label><Input type="email" value={driver.email} onChange={(e:any)=>setDriver({...driver, email:e.target.value})} placeholder="juan@correo.com"/></div>
              <div><Label>Teléfono</Label><Input value={driver.telefono} onChange={(e:any)=>setDriver({...driver, telefono:e.target.value})} placeholder="55 1234 5678"/></div>
            </div>
          </Card>

          <Card>
            <h2 className="text-lg font-semibold mb-3">Vehículo</h2>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div><Label>Marca</Label><Input value={vehicle.marca} onChange={(e:any)=>setVehicle({...vehicle, marca:e.target.value})} placeholder="Nissan"/></div>
              <div><Label>Modelo</Label><Input value={vehicle.modelo} onChange={(e:any)=>setVehicle({...vehicle, modelo:e.target.value})} placeholder="Versa"/></div>
              <div><Label>Año</Label><Input type="number" value={vehicle.anio} onChange={(e:any)=>setVehicle({...vehicle, anio:Number(e.target.value)})}/></div>
              <div><Label>Versión</Label><Input value={vehicle.version} onChange={(e:any)=>setVehicle({...vehicle, version:e.target.value})} placeholder="Advance"/></div>
            </div>
          </Card>

          <Card>
            <h2 className="text-lg font-semibold mb-3">Cobertura</h2>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div><Label>Plan</Label><Select value={coverage.plan} onChange={(e:any)=>setCoverage({...coverage, plan:e.target.value})}><option value="rc">Responsabilidad Civil</option><option value="limitada">Limitada</option><option value="amplia">Amplia</option><option value="premium">Premium</option></Select></div>
              <div><Label>Deducible (%)</Label><Input type="number" value={coverage.deducible} onChange={(e:any)=>setCoverage({...coverage, deducible:Number(e.target.value)})}/></div>
              <div><Label>Código Postal</Label><Input value={location.codigoPostal} onChange={(e:any)=>setLocation({...location, codigoPostal:e.target.value})} placeholder="11000"/></div>
              <div><Label>Ciudad</Label><Input value={location.ciudad} onChange={(e:any)=>setLocation({...location, ciudad:e.target.value})} placeholder="CDMX"/></div>
            </div>
          </Card>

          <div className="flex items-center gap-3">
            <Button onClick={getQuotes} disabled={!canQuote || loadingQuotes}>
              {loadingQuotes ? "Consultando aseguradoras..." : "Obtener cotizaciones (mock)"}
            </Button>
            <div className="text-xs text-gray-500">Después reemplaza el mock por tus conectores reales.</div>
          </div>

          <Card>
            <h2 className="text-lg font-semibold mb-3">Resultados</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {quotes.length === 0 && <div className="text-sm text-gray-500">Sin resultados aún.</div>}
              {quotes.map((q, i)=>(
                <div key={i} className="rounded-xl border p-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm text-gray-500">{q.carrier}</div>
                      <div className="text-base font-semibold">{q.planLabel}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-2xl font-bold">{q.pago?.anual ? `$${q.pago.anual.toLocaleString("es-MX")}` : "—"}</div>
                      <div className="text-xs text-gray-500">{q.pago?.mensual ? `$${q.pago.mensual.toLocaleString("es-MX")}/mes` : "—"}</div>
                    </div>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                    <div className="rounded-lg bg-gray-50 p-2"><div className="text-gray-500">Deducible</div><div className="font-semibold">{q.deducible}%</div></div>
                    <div className="rounded-lg bg-gray-50 p-2"><div className="text-gray-500">RC civil</div><div className="font-semibold">{q.rc_civil?.toLocaleString("es-MX") ?? "—"}</div></div>
                    <div className="rounded-lg bg-gray-50 p-2 col-span-2"><div className="text-gray-500">Beneficios</div><div className="font-medium">{q.beneficios?.join(", ") ?? "—"}</div></div>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <h2 className="text-lg font-semibold mb-3">Asistente (ChatGPT)</h2>
            <div className="h-80 overflow-y-auto rounded-xl border p-3 bg-gray-50">
              {assist.map((m, idx)=>(
                <div key={idx} className={"mb-2 whitespace-pre-wrap " + (m.role === "assistant" ? "text-gray-900" : "text-gray-700")}>
                  <span className="inline-block min-w-[64px] text-xs font-semibold mr-2 text-gray-500">{m.role}</span>
                  {m.content}
                </div>
              ))}
            </div>
            <div className="mt-3 flex gap-2">
              <Input value={assistInput} onChange={(e:any)=>setAssistInput(e.target.value)} placeholder="Pregúntale al asistente..." />
              <Button onClick={askAssist} disabled={assistBusy}>Enviar</Button>
            </div>
            <p className="mt-2 text-[11px] text-gray-500">El asistente explica coberturas, deducibles, RC y exclusiones. No decide por el usuario.</p>
          </Card>

          <Card>
            <h3 className="text-base font-semibold mb-2">Privacidad</h3>
            <p className="text-xs text-gray-600">
              Antes de producción, agrega aviso de privacidad, consentimiento y controles ARCO. Minimiza datos y registra trazabilidad de cotizaciones.
            </p>
          </Card>
        </div>
      </main>

      <footer className="mx-auto max-w-7xl px-4 py-8 text-xs text-gray-500">
        © {new Date().getFullYear()} Comparador MX · Demo. Reemplaza los mocks por conectores reales.
      </footer>
    </div>
  );
}
