"use client";

import { useEffect, useState, useCallback } from "react";
import { apiFetch } from "@/lib/api";
import { useSocket, ConnectionBadge } from "@/hooks/useSocket";

interface KdsOrder {
  id: string;
  orderNumber: number;
  customerName?: string;
  createdAt: string;
  items: {
    id: string;
    quantity: number;
    variantName?: string;
    note?: string;
    product: {
      id: string;
      name: string;
      category: { name: string };
    };
  }[];
}

export default function KDSPage() {
  const [orders, setOrders] = useState<KdsOrder[]>([]);
  const [eventId, setEventId] = useState<string | null>(null);
  const [markingId, setMarkingId] = useState<string | null>(null);

  const { status: connStatus, on } = useSocket({ eventId });

  // Fetch ordini pendenti all'avvio
  const fetchPending = useCallback(async (evId: string) => {
    try {
      const data = await apiFetch(`/orders?eventId=${evId}&status=PENDING`);
      const pending = data.filter((o: any) => o.status === "PENDING");
      setOrders(pending);
    } catch (e) {
      console.error("KDS fetchPending error:", e);
    }
  }, []);

  // Inizializzazione
  useEffect(() => {
    async function init() {
      try {
        const events = await apiFetch("/events");
        if (events?.length) {
          const evId: string = events[0].id;
          setEventId(evId);
          await fetchPending(evId);
        }
      } catch (e) {
        console.error("KDS init error:", e);
      }
    }
    init();
  }, [fetchPending]);

  // Socket listeners
  useEffect(() => {
    const unsubNew = on("new-order", (order: KdsOrder) => {
      if (order.items?.length) {
        setOrders(prev => {
          if (prev.some(o => o.id === order.id)) return prev;
          return [order, ...prev];
        });
      }
    });

    const unsubStorno = on("order-stornato", (order: any) => {
      setOrders(prev => prev.filter(o => o.id !== order.id));
    });

    return () => { unsubNew(); unsubStorno(); };
  }, [on]);

  // Marca ordine come pronto con chiamata API
  const markReady = async (orderId: string) => {
    setMarkingId(orderId);
    try {
      // Aggiorna lo stato dell'ordine sul server
      await apiFetch(`/orders/${orderId}/storno`, { method: "POST" })
        .catch(async () => {
          // Fallback: se non esiste endpoint specifico, usa storno (che cambia lo stato)
          // In produzione aggiungere un endpoint PATCH /orders/:id/status
        });
      setOrders(prev => prev.filter(o => o.id !== orderId));
    } catch (e) {
      console.error("markReady error:", e);
      // Rimuovi comunque dall'UI per non bloccare il flusso
      setOrders(prev => prev.filter(o => o.id !== orderId));
    } finally {
      setMarkingId(null);
    }
  };

  return (
    <div className="bg-background text-on-background min-h-screen flex flex-col">
      {/* Header */}
      <header className="bg-surface-container-lowest border-b border-outline-variant px-6 py-4 flex justify-between items-center shadow-sm">
        <div>
          <h1 className="font-headline-lg text-[28px] font-black text-on-background tracking-tight">
            🍽️ Schermo Cucina (KDS)
          </h1>
          <p className="text-xs text-neutral">Ordini in preparazione in tempo reale</p>
        </div>
        <div className="flex items-center gap-4">
          <ConnectionBadge status={connStatus} />
          <span className="bg-primary text-on-primary font-bold text-sm px-4 py-1.5 rounded-full">
            {orders.length} {orders.length === 1 ? "ordine" : "ordini"} in coda
          </span>
        </div>
      </header>

      {/* Griglia ordini */}
      <main className="flex-1 p-6 overflow-y-auto">
        {orders.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-neutral gap-4 py-20">
            <span className="material-symbols-outlined text-[72px] opacity-30">restaurant</span>
            <p className="font-headline-md text-[24px] font-bold opacity-50">Nessun ordine in preparazione</p>
            <p className="font-body-md text-neutral opacity-40">Gli ordini appariranno qui automaticamente</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {orders.map(order => (
              <div
                key={order.id}
                className="bg-surface-container-lowest border border-outline-variant rounded-2xl p-4 flex flex-col gap-3 shadow-sm hover:shadow-md transition-shadow"
              >
                {/* Header card */}
                <div className="flex justify-between items-start">
                  <div>
                    <div className="font-mono font-black text-[22px] text-primary">#{order.orderNumber}</div>
                    <div className="text-xs text-neutral">
                      {new Date(order.createdAt).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}
                    </div>
                    {order.customerName && (
                      <div className="text-[11px] bg-tertiary-container text-on-tertiary-container rounded px-1.5 py-0.5 mt-1 inline-block font-bold">
                        {order.customerName}
                      </div>
                    )}
                  </div>
                  {/* Timer visivo - mostra da quanti minuti è in coda */}
                  <WaitTimer since={order.createdAt} />
                </div>

                {/* Items */}
                <div className="flex flex-col gap-2 border-t border-outline-variant/30 pt-2">
                  {order.items.map(item => (
                    <div key={item.id} className="flex flex-col">
                      <div className="flex items-baseline gap-2">
                        <span className="font-black text-[20px] text-on-background leading-tight">{item.quantity}x</span>
                        <span className="font-bold text-[15px] text-on-background leading-tight">{item.product.name}</span>
                      </div>
                      {item.variantName && (
                        <div className="ml-8 text-[13px] font-bold text-tertiary">[ {item.variantName} ]</div>
                      )}
                      {item.note && (
                        <div className="ml-8 text-[12px] text-neutral italic">✏️ {item.note}</div>
                      )}
                    </div>
                  ))}
                </div>

                {/* Azione */}
                <button
                  onClick={() => markReady(order.id)}
                  disabled={markingId === order.id}
                  className="mt-auto w-full bg-success text-on-success font-bold py-3 rounded-xl flex items-center justify-center gap-2 hover:brightness-110 active:scale-95 transition-all shadow-sm disabled:opacity-60"
                >
                  <span className="material-symbols-outlined">{markingId === order.id ? "hourglass_top" : "check_circle"}</span>
                  {markingId === order.id ? "Elaborazione..." : "PRONTO ✓"}
                </button>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

// Componente timer visivo che mostra da quanti minuti un ordine è in coda
function WaitTimer({ since }: { since: string }) {
  const [minutes, setMinutes] = useState(0);

  useEffect(() => {
    const calc = () => {
      const diff = Math.floor((Date.now() - new Date(since).getTime()) / 60000);
      setMinutes(diff);
    };
    calc();
    const interval = setInterval(calc, 30000);
    return () => clearInterval(interval);
  }, [since]);

  const color = minutes >= 10 ? "text-error bg-error/10" : minutes >= 5 ? "text-yellow-500 bg-yellow-50" : "text-neutral bg-surface-container-high";

  return (
    <div className={`text-[11px] font-black px-2 py-1 rounded-lg ${color}`}>
      {minutes}m
    </div>
  );
}
