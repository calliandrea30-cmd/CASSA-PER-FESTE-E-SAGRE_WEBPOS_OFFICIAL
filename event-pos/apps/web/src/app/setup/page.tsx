"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";
import { Loader2 } from "lucide-react";

export default function SetupPage() {
  const router = useRouter();
  const [stations, setStations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [eventId, setEventId] = useState<string | null>(null);

  useEffect(() => {
    async function init() {
      try {
        const events = await apiFetch("/events");
        if (!events?.length) {
          setError("Nessun evento attivo trovato. Configura l'evento dall'Amministrazione.");
          setLoading(false);
          return;
        }
        
        const evId = events[0].id;
        setEventId(evId);

        const stationsData = await apiFetch(`/stations?eventId=${evId}`);
        if (!stationsData?.length) {
          setError("Nessuna stazione configurata per questo evento.");
        } else {
          setStations(stationsData);
        }
      } catch (e: any) {
        setError(`Errore di connessione: ${e?.message || "Impossibile caricare le stazioni"}`);
      } finally {
        setLoading(false);
      }
    }
    init();
  }, []);

  const selectStation = (station: any) => {
    if (!eventId) return;
    localStorage.setItem(
      'pos_station', 
      JSON.stringify({ 
        stationId: station.id, 
        stationName: station.name, 
        eventId 
      })
    );
    router.push('/');
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4" data-theme="dark">
        <Loader2 className="animate-spin w-12 h-12 text-primary" />
        <p className="text-neutral font-body-lg">Caricamento stazioni cassa...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-on-background flex flex-col p-8" data-theme="dark">
      <div className="max-w-4xl mx-auto w-full flex-1 flex flex-col">
        <header className="mb-12 text-center">
          <h1 className="font-headline-lg text-[36px] font-black text-primary uppercase tracking-tighter mb-4">
            SagraPOS — Seleziona la tua Cassa
          </h1>
          <p className="text-neutral text-lg">Scegli quale stazione assegnare a questo dispositivo.</p>
        </header>

        {error ? (
          <div className="bg-error/10 border border-error/20 rounded-2xl p-8 text-center text-error flex flex-col items-center gap-4">
            <span className="material-symbols-outlined text-5xl">error</span>
            <p className="text-xl font-bold">{error}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 flex-1">
            {stations.map(station => (
              <button
                key={station.id}
                onClick={() => selectStation(station)}
                className="bg-surface-container border border-outline-variant rounded-3xl p-8 flex flex-col items-center justify-center gap-4 min-h-[160px] hover:bg-surface-container-high hover:border-primary hover:shadow-xl transition-all active:scale-95 group"
              >
                <span className="text-5xl group-hover:scale-110 transition-transform">🏪</span>
                <span className="font-headline-md text-2xl font-bold text-on-surface group-hover:text-primary transition-colors">
                  {station.name}
                </span>
              </button>
            ))}
          </div>
        )}

        <footer className="mt-12 text-center">
          <p className="text-sm text-neutral/70">
            Questa scelta viene salvata. Puoi cambiarla successivamente dall'interfaccia della cassa.
          </p>
        </footer>
      </div>
    </div>
  );
}
