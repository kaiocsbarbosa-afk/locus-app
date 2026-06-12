import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "https://esm.sh/web-push@3.6.7";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Configura o web-push com as chaves VAPID (variáveis de ambiente)
webpush.setVapidDetails(
  "mailto:contato@locus-app.com",
  Deno.env.get("VAPID_PUBLIC_KEY") ?? "BHweJ-6fq5qkclX2bcySbRjfkqAItvHfxrano1xatzoZJW7eyR621fcQ8xLstojUOdjJafsX5SSzVzr0hs7VlU0",
  Deno.env.get("VAPID_PRIVATE_KEY") ?? "G69ZTzJxd-OdL4hMnXFyqXbP-BOqTzY_KLE_vbIl2Do"
);

interface PayloadNotificacao {
  titulo: string;
  corpo: string;
  // 'professor' envia para um professor_id específico
  // 'coordenacao' envia para todas as inscrições do tipo coordenacao
  destino: "professor" | "coordenacao";
  professor_id?: string;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Método não permitido." }),
      { status: 405, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  }

  try {
    const body: PayloadNotificacao = await req.json();
    const { titulo, corpo, destino, professor_id } = body;

    if (!titulo || !corpo || !destino) {
      return new Response(
        JSON.stringify({ error: "Campos obrigatórios: titulo, corpo, destino." }),
        { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "https://ixhuqbfzwkobhrvlzwgm.supabase.co/rest/v1/",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml4aHVxYmZ6d2tvYmhydmx6d2dtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MDAyMjI5OCwiZXhwIjoyMDk1NTk4Mjk4fQ.iGBswJLz631x3zuFJwOh0boQWHzu14w8FSA6Qp32ACQ"
    );

    // Busca as inscrições corretas
    let query = supabase.from("inscricoes_push").select("*");

    if (destino === "professor") {
      if (!professor_id) {
        return new Response(
          JSON.stringify({ error: "professor_id é obrigatório quando destino = 'professor'." }),
          { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
        );
      }
      query = query.eq("professor_id", professor_id).eq("tipo", "professor");
    } else {
      query = query.eq("tipo", "coordenacao");
    }

    const { data: inscricoes, error } = await query;

    if (error) {
      console.error("Erro ao buscar inscrições:", error.message);
      return new Response(
        JSON.stringify({ error: "Erro ao buscar inscrições." }),
        { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }

    if (!inscricoes || inscricoes.length === 0) {
      return new Response(
        JSON.stringify({ enviados: 0, motivo: "Nenhuma inscrição encontrada." }),
        { status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }

    const payload = JSON.stringify({ title: titulo, body: corpo });

    let enviados = 0;
    let removidos = 0;

    // Envia para cada inscrição. Se o endpoint estiver morto (410), remove do banco.
    await Promise.all(inscricoes.map(async (inscricao) => {
      const subscription = {
        endpoint: inscricao.endpoint,
        keys: { p256dh: inscricao.p256dh, auth: inscricao.auth },
      };

      try {
        await webpush.sendNotification(subscription, payload);
        enviados++;
      } catch (err: any) {
        console.warn("Falha ao enviar push:", err?.statusCode, err?.message);
        if (err?.statusCode === 410 || err?.statusCode === 404) {
          await supabase.from("inscricoes_push").delete().eq("id", inscricao.id);
          removidos++;
        }
      }
    }));

    return new Response(
      JSON.stringify({ enviados, removidos, total: inscricoes.length }),
      { status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );

  } catch (err) {
    console.error("Erro inesperado:", err);
    return new Response(
      JSON.stringify({ error: "Erro inesperado no servidor." }),
      { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  }
});
