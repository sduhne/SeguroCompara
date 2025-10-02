import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const { messages, context } = await req.json();

  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ reply: "Falta OPENAI_API_KEY en el servidor." }, { status: 500 });
  }

  try {
    const r = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        input: [
          { role: "system", content: "Eres un asesor imparcial de seguros de auto en México. Responde de forma clara y concisa." },
          ...messages,
          { role: "system", content: `Contexto: ${JSON.stringify(context).slice(0, 4000)}` }
        ]
      })
    });

    if (!r.ok) {
      const txt = await r.text();
      return NextResponse.json({ reply: "Error consultando OpenAI: " + txt }, { status: 500 });
    }

    const data = await r.json();
    // The Responses API returns in 'output_text' most conveniently
    const reply = data.output_text ?? "Sin respuesta.";
    return NextResponse.json({ reply });
  } catch (e:any) {
    return NextResponse.json({ reply: "Error: " + e.message }, { status: 500 });
  }
}
