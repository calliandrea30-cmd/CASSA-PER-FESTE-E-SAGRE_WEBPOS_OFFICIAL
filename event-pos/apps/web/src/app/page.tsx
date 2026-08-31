"use client";

import { useEffect, useState, useRef, useMemo, useCallback } from "react";
import { useCartStore } from "@/store/useCartStore";
import { Product, ProductVariant } from "@event-pos/shared-types";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { useSocket, ConnectionBadge } from "@/hooks/useSocket";

// ─── Tipi locali ──────────────────────────────────────────────────────────────
interface CategoryDef {
  id: string;
  name: string;
  orderIndex: number;
  quickNotes?: string;
}

// ─── Componente principale POS ────────────────────────────────────────────────
export default function POS() {
  const [categories, setCategories] = useState<CategoryDef[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [eventId, setEventId] = useState<string | null>(null);
  const [stationId, setStationId] = useState<string | null>(null);
  const [stationName, setStationName] = useState<string>("Cassa");
  const [loading, setLoading] = useState(true);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [showCheckout, setShowCheckout] = useState(false);
  const [selectedProductForVariant, setSelectedProductForVariant] = useState<Product | null>(null);
  const [customerName, setCustomerName] = useState<string>("");
  const [suspendedOrders, setSuspendedOrders] = useState<any[]>([]);
  const [noteModalItem, setNoteModalItem] = useState<any>(null);
  const [customNoteText, setCustomNoteText] = useState("");
  const [initError, setInitError] = useState<string | null>(null);

  // Checkout states
  const [cashReceived, setCashReceived] = useState<string>("");
  const [fixedDiscount, setFixedDiscount] = useState<string>("");
  const [percentDiscount, setPercentDiscount] = useState<string>("");
  const [freeItems, setFreeItems] = useState<Set<string>>(new Set());

  const cart = useCartStore();

  // Ref per eventId sempre aggiornato (fix closure stale nei listener socket)
  const eventIdRef = useRef<string | null>(null);
  const stationIdRef = useRef<string | null>(null);
  useEffect(() => { eventIdRef.current = eventId; }, [eventId]);
  useEffect(() => { stationIdRef.current = stationId; }, [stationId]);

  // ── Socket.IO ──────────────────────────────────────────────────────────────
  const { status: connStatus, on } = useSocket({ eventId });

  // ── Fetch prodotti ─────────────────────────────────────────────────────────
  const fetchProducts = useCallback(async (evId: string) => {
    try {
      const data = await apiFetch(`/products?eventId=${evId}`);
      setProducts(data);
    } catch (e) {
      console.error("fetchProducts error:", e);
    }
  }, []);

  const fetchCategories = useCallback(async (evId: string) => {
    try {
      const data = await apiFetch(`/categories?eventId=${evId}`);
      setCategories(data);
    } catch (e) {
      console.error("fetchCategories error:", e);
    }
  }, []);

  const fetchSuspended = useCallback(async () => {
    const evId = eventIdRef.current;
    if (!evId) return;
    try {
      const data = await apiFetch(`/orders/suspended?eventId=${evId}`);
      setSuspendedOrders(data);
    } catch {}
  }, []);

  // ── Inizializzazione ───────────────────────────────────────────────────────
  useEffect(() => {
    async function init() {
      try {
        const events = await apiFetch("/events");
        if (!events?.length) {
          setInitError("Nessun evento attivo trovato. Configura l'evento dall'Amministrazione.");
          return;
        }

        const evId: string = events[0].id;
        setEventId(evId);

        const [stationsData, catsData] = await Promise.all([
          apiFetch(`/stations?eventId=${evId}`),
          apiFetch(`/categories?eventId=${evId}`),
        ]);

        if (!stationsData?.length) {
          setInitError("Nessuna stazione configurata per questo evento.");
          return;
        }

        // Leggi stazione da localStorage (impostata dalla pagina /setup)
        const savedStation = (() => {
          try { return JSON.parse(localStorage.getItem('pos_station') || 'null'); } catch { return null; }
        })();

        if (savedStation?.stationId && stationsData.find((s: any) => s.id === savedStation.stationId)) {
          setStationId(savedStation.stationId);
          setStationName(savedStation.stationName || 'Cassa');
        } else if (stationsData.length === 1) {
          // Solo una stazione: usa quella automaticamente e salvala
          setStationId(stationsData[0].id);
          setStationName(stationsData[0].name || 'Cassa 1');
          localStorage.setItem('pos_station', JSON.stringify({ stationId: stationsData[0].id, stationName: stationsData[0].name, eventId: evId }));
        } else {
          // Più stazioni e nessuna salvata: reindirizza a /setup
          localStorage.removeItem('pos_station');
          window.location.href = '/setup';
          return;
        }

        setCategories(catsData || []);
        await fetchProducts(evId);
        await fetchSuspended();
      } catch (e: any) {
        console.error("Init error:", e);
        setInitError(`Impossibile connettersi al server. Verifica che sia avviato. (${e?.message || ""})`);
      } finally {
        setLoading(false);
      }
    }
    init();
  }, [fetchProducts, fetchSuspended]);

  // ── Listener Socket (usando ref per evitare closure stale) ─────────────────
  useEffect(() => {
    const unsubUpdated = on("product-updated", () => {
      if (eventIdRef.current) fetchProducts(eventIdRef.current);
    });
    const unsubDeleted = on("product-deleted", () => {
      if (eventIdRef.current) fetchProducts(eventIdRef.current);
    });
    const unsubNew = on("new-product", () => {
      if (eventIdRef.current) fetchProducts(eventIdRef.current);
    });
    const unsubBulk = on("bulk-products-created", () => {
      if (eventIdRef.current) fetchProducts(eventIdRef.current);
    });
    const unsubOrder = on("new-order", () => {
      if (eventIdRef.current) fetchProducts(eventIdRef.current);
    });
    const unsubAvail = on("product-availability-changed", (data: any) => {
      setProducts(prev =>
        prev.map(p => p.id === data.productId ? { ...p, available: data.available } : p)
      );
    });
    const unsubCat = on("category-updated", () => {
      if (eventIdRef.current) fetchCategories(eventIdRef.current);
    });
    const unsubStorno = on("order-stornato", () => {
      fetchSuspended();
    });

    return () => {
      unsubUpdated();
      unsubDeleted();
      unsubNew();
      unsubBulk();
      unsubOrder();
      unsubAvail();
      unsubCat();
      unsubStorno();
    };
  }, [on, fetchProducts, fetchCategories, fetchSuspended]);

  // ── Handlers prodotto e varianti ───────────────────────────────────────────
  const handleProductClick = (p: any) => {
    if (!p.available || (p.stock !== undefined && p.stock <= 0)) return;
    if (p.variants?.length > 0) {
      setSelectedProductForVariant(p);
    } else {
      cart.addItem(p);
    }
  };

  const handleVariantSelect = (v: ProductVariant) => {
    if (selectedProductForVariant) {
      cart.addItem(selectedProductForVariant, v);
      setSelectedProductForVariant(null);
    }
  };

  // ── Calcoli checkout ───────────────────────────────────────────────────────
  const initialTotal = cart.items.reduce(
    (sum, item) => sum + (item.product.price + (item.variant?.priceDelta || 0)) * item.quantity,
    0,
  );
  const freeItemsDiscount = cart.items
    .filter(item => freeItems.has(item.id))
    .reduce((sum, item) => sum + (item.product.price + (item.variant?.priceDelta || 0)) * item.quantity, 0);

  const subtotalAfterFree = initialTotal - freeItemsDiscount;
  const pd = Number(percentDiscount) || 0;
  const percentDiscountAmount = (subtotalAfterFree * pd) / 100;
  const fd = Math.min(Number(fixedDiscount) || 0, subtotalAfterFree); // non può superare il subtotale
  const finalTotal = Math.max(0, subtotalAfterFree - percentDiscountAmount - fd);
  const totalDiscounts = initialTotal - finalTotal;
  const cash = Number(cashReceived) || 0;
  const change = Math.max(0, cash - finalTotal);

  const resetCheckout = () => {
    setShowCheckout(false);
    setCashReceived("");
    setFixedDiscount("");
    setPercentDiscount("");
    setFreeItems(new Set());
  };

  // ── Sospendi ordine ────────────────────────────────────────────────────────
  const saveSuspended = async () => {
    if (cart.items.length === 0 || !eventId || !stationId) return;
    const name = prompt("Inserisci Nome o Numero Tavolo per questo Sospeso:");
    if (!name) return;

    try {
      const users = await apiFetch(`/users?eventId=${eventId}`);
      const validUserId = users?.[0]?.id ?? null;

      await apiFetch("/orders", {
        method: "POST",
        body: JSON.stringify({
          eventId,
          stationId,
          userId: validUserId,
          items: cart.items.map((i: any) => ({
            productId: i.product.id,
            variantId: i.variant?.id,
            variantName: i.variant?.name,
            quantity: i.quantity,
            price: freeItems.has(i.id) ? 0 : i.product.price + (i.variant?.priceDelta || 0),
          })),
          status: "SUSPENDED",
          customerName: name,
        }),
      });

      cart.clearCart();
      setCustomerName("");
      await fetchSuspended();
    } catch (e: any) {
      alert(`Errore salvataggio sospeso: ${e?.message || "Errore sconosciuto"}`);
    }
  };

  const loadSuspended = async (order: any) => {
    cart.clearCart();
    order.items.forEach((i: any) => {
      for (let j = 0; j < i.quantity; j++) {
        cart.addItem(
          i.product,
          i.variantName
            ? {
                id: i.variantId || "note",
                productId: i.productId,
                name: i.variantName,
                priceDelta: i.priceAtTime - i.product.price,
              }
            : undefined,
        );
      }
    });
    setCustomerName(order.customerName || "");
    try {
      await apiFetch(`/orders/${order.id}`, { method: "DELETE" });
    } catch {}
    await fetchSuspended();
  };

  // ── Checkout ───────────────────────────────────────────────────────────────
  const checkout = async (paymentType: string = "CASH") => {
    if (cart.items.length === 0 || !eventId || !stationId || checkoutLoading) return;
    setCheckoutLoading(true);

    try {
      const users = await apiFetch(`/users?eventId=${eventId}`);
      const validUserId = users?.[0]?.id ?? null;
      if (!validUserId) {
        alert("Errore: nessun utente cassa trovato per questo evento.\nConfiguralo dall'Amministrazione.");
        return;
      }

      await apiFetch("/orders", {
        method: "POST",
        body: JSON.stringify({
          eventId,
          stationId,
          userId: validUserId,
          paymentType,
          customerName: customerName || "Asporto / Generico",
          discount: totalDiscounts,
          items: cart.items.map(i => ({
            productId: i.product.id,
            variantId: i.variant?.id,
            variantName: i.variant?.name,
            quantity: i.quantity,
            price: freeItems.has(i.id) ? 0 : i.product.price + (i.variant?.priceDelta || 0),
          })),
        }),
      });

      cart.clearCart();
      resetCheckout();
      setCustomerName("");
      await fetchSuspended();
    } catch (e: any) {
      alert(`Errore durante il checkout: ${e?.message || "Errore di rete"}`);
    } finally {
      setCheckoutLoading(false);
    }
  };

  // ── Utilities ──────────────────────────────────────────────────────────────
  const getStockColor = (stock: number | undefined | null) => {
    if (stock === undefined || stock === null) return "bg-success";
    if (stock <= 0) return "bg-error";
    if (stock <= 10) return "bg-yellow-400";
    return "bg-success";
  };

  const getCategoryNotes = (categoryId: string) => {
    const cat = categories.find((c) => c.id === categoryId);
    return cat?.quickNotes ? cat.quickNotes.split(",").map((s) => s.trim()).filter(Boolean) : [];
  };

  const toggleFreeItem = (id: string) => {
    setFreeItems(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const filteredProducts = useMemo(() =>
    products.filter(p => {
      if (activeCategory && p.categoryId !== activeCategory) return false;
      if (searchQuery && !p.name.toLowerCase().includes(searchQuery.toLowerCase())) return false;
      return true;
    }),
    [products, activeCategory, searchQuery],
  );

  const bestSellers = useMemo(() => {
    if (searchQuery || activeCategory) return [];
    return [...products]
      .filter(p => p.popularity > 0 && p.available)
      .sort((a, b) => b.popularity - a.popularity)
      .slice(0, 4);
  }, [products, searchQuery, activeCategory]);

  // ── Loading / Error screens ────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-background gap-4">
        <Loader2 className="animate-spin w-10 h-10 text-primary" />
        <p className="text-neutral font-body-md">Connessione al server in corso...</p>
      </div>
    );
  }

  if (initError) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-background gap-6 p-8 text-center">
        <span className="material-symbols-outlined text-[64px] text-error">wifi_off</span>
        <h2 className="font-headline-lg text-[24px] font-black text-error">Impossibile avviare la Cassa</h2>
        <p className="text-neutral font-body-md max-w-md">{initError}</p>
        <Link href="/admin" className="bg-primary text-on-primary px-6 py-3 rounded-xl font-bold shadow-md hover:brightness-110">
          Vai all&apos;Amministrazione
        </Link>
        <button onClick={() => window.location.reload()} className="text-neutral hover:text-primary underline text-sm">
          Riprova
        </button>
      </div>
    );
  }

  // ── Vista Checkout ─────────────────────────────────────────────────────────
  if (showCheckout) {
    return (
      <div className="bg-background text-on-background min-h-screen flex flex-col font-body-md overflow-hidden">
        <header className="bg-primary text-on-primary border-b border-primary flex justify-between items-center w-full px-gutter h-[64px] docked full-width top-0 z-10 shadow-md">
          <div className="flex items-center gap-4">
            <h1 className="font-display-lg text-[24px] font-bold uppercase tracking-tighter">Checkout Ordine</h1>
          </div>
          <div className="flex items-center gap-4">
            <ConnectionBadge status={connStatus} />
            <button onClick={resetCheckout} className="bg-on-primary text-primary hover:bg-white/90 active:scale-95 transition-transform px-6 py-2 rounded-full font-bold shadow-sm">
              Annulla e Torna
            </button>
          </div>
        </header>

        <div className="flex flex-1 overflow-hidden">
          <main className="flex-1 flex flex-col md:flex-row p-margin-page gap-margin-page overflow-y-auto md:overflow-hidden">
            {/* Colonna sinistra: riepilogo e sconti */}
            <section className="flex-1 bg-surface-container-lowest rounded-xl flex flex-col border border-outline-variant overflow-hidden shadow-sm">
              <div className="p-4 bg-surface-container-high border-b border-outline-variant/30">
                <h2 className="font-headline-md text-[24px] font-bold text-on-surface">Riepilogo Ordine</h2>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {cart.items.map(item => {
                  const basePrice = (item.product.price + (item.variant?.priceDelta || 0)) * item.quantity;
                  const isFree = freeItems.has(item.id);
                  return (
                    <div key={item.id} className="flex justify-between items-center bg-background p-3 rounded-lg border border-outline-variant">
                      <div className="flex items-center gap-3">
                        <span className="font-body-lg text-[18px] text-on-tertiary bg-tertiary w-8 h-8 flex items-center justify-center rounded-lg font-bold shadow-sm">{item.quantity}</span>
                        <div>
                          <p className="font-body-lg text-[18px] font-medium text-on-surface leading-tight">{item.product.name}</p>
                          {item.variant && <p className="text-neutral text-sm">{item.variant.name}</p>}
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="text-right">
                          {isFree ? (
                            <span className="font-body-lg text-[18px] font-bold text-success uppercase">Omaggio</span>
                          ) : (
                            <span className="font-body-lg text-[18px] font-bold text-on-surface">€ {basePrice.toFixed(2)}</span>
                          )}
                        </div>
                        <button
                          onClick={() => toggleFreeItem(item.id)}
                          className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors ${isFree ? "bg-success text-on-success" : "bg-surface-container-high text-neutral hover:bg-surface-container-highest hover:text-on-surface"}`}
                          title="Imposta come Omaggio"
                        >
                          <span className="material-symbols-outlined text-[20px]">{isFree ? "redeem" : "card_giftcard"}</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Area sconti */}
              <div className="bg-surface-container p-4 border-t border-outline-variant/30 flex gap-4">
                <div className="flex-1">
                  <label className="font-label-lg text-neutral mb-1 block">Sconto Fisso (€)</label>
                  <input
                    type="number" min="0" step="0.5"
                    value={fixedDiscount}
                    onChange={e => setFixedDiscount(e.target.value)}
                    placeholder="0.00"
                    className="w-full bg-background border-outline-variant border rounded-lg p-2 font-body-lg"
                  />
                </div>
                <div className="flex-1">
                  <label className="font-label-lg text-neutral mb-1 block">Sconto Perc. (%)</label>
                  <input
                    type="number" min="0" max="100"
                    value={percentDiscount}
                    onChange={e => setPercentDiscount(e.target.value)}
                    placeholder="0%"
                    className="w-full bg-background border-outline-variant border rounded-lg p-2 font-body-lg"
                  />
                </div>
              </div>

              {/* Totali */}
              <div className="bg-surface-container-highest p-6 border-t border-outline-variant/30 flex flex-col gap-2">
                <div className="flex justify-between items-center text-neutral">
                  <span className="font-body-lg text-[18px]">Totale Iniziale</span>
                  <span className="font-body-lg text-[18px]">€ {initialTotal.toFixed(2)}</span>
                </div>
                {totalDiscounts > 0 && (
                  <div className="flex justify-between items-center text-success font-bold">
                    <span className="font-body-lg text-[18px]">Sconti Applicati</span>
                    <span className="font-body-lg text-[18px]">- € {totalDiscounts.toFixed(2)}</span>
                  </div>
                )}
                <div className="flex justify-between items-center mt-2 pt-2 border-t border-outline-variant">
                  <span className="font-headline-lg text-[28px] font-bold text-on-surface">Totale da Pagare</span>
                  <span className="font-price-display text-[42px] font-black text-primary">€ {finalTotal.toFixed(2)}</span>
                </div>
              </div>
            </section>

            {/* Colonna destra: calcolatore resto e pagamento */}
            <section className="w-full md:w-[400px] lg:w-[450px] flex flex-col gap-margin-page">
              <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-5 shadow-sm">
                <h3 className="font-headline-md text-[20px] font-bold text-on-background mb-4">Calcolatore Resto</h3>
                <div className="flex flex-col gap-3">
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-neutral font-bold text-[24px]">€</span>
                    <input
                      type="number"
                      value={cashReceived}
                      onChange={e => setCashReceived(e.target.value)}
                      placeholder="Importo ricevuto"
                      className="w-full bg-surface-container-high border-outline-variant border rounded-xl py-4 pl-10 pr-4 font-body-lg text-[24px] font-bold"
                    />
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {[5, 10, 20, 50, 100].map(v => (
                      <button key={v} onClick={() => setCashReceived(String((Number(cashReceived) || 0) + v))} className="bg-surface-container border border-outline-variant py-2 rounded-lg font-bold hover:bg-surface-container-highest">
                        +{v}€
                      </button>
                    ))}
                    <button onClick={() => setCashReceived(String(finalTotal))} className="bg-tertiary/10 text-tertiary border border-tertiary/30 py-2 rounded-lg font-bold hover:bg-tertiary/20">
                      Esatto
                    </button>
                  </div>
                  <div className="mt-4 bg-background border border-outline-variant rounded-xl p-4 flex justify-between items-center">
                    <span className="font-body-lg text-[20px] font-bold text-neutral">RESTO</span>
                    <span className={`font-price-display text-[32px] font-black ${change > 0 ? "text-success" : "text-neutral"}`}>
                      € {change.toFixed(2)}
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex-1 bg-surface-container-lowest border border-outline-variant rounded-xl p-5 shadow-sm flex flex-col">
                <h3 className="font-headline-md text-[20px] font-bold text-on-background mb-4">Metodo di Pagamento</h3>
                <div className="grid grid-cols-1 gap-4 flex-1">
                  <button
                    onClick={() => checkout("CASH")}
                    disabled={checkoutLoading}
                    className="bg-primary text-on-primary border-2 border-primary rounded-xl flex flex-col items-center justify-center gap-2 active:scale-95 transition-all shadow-md hover:brightness-110 flex-1 min-h-[120px] disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {checkoutLoading ? <Loader2 className="animate-spin w-8 h-8" /> : <span className="material-symbols-outlined text-[42px]">payments</span>}
                    <span className="font-label-lg text-[20px] font-bold uppercase tracking-wide">Paga in Contanti</span>
                  </button>
                  <button
                    onClick={() => checkout("CARD")}
                    disabled={checkoutLoading}
                    className="bg-tertiary text-on-tertiary hover:brightness-110 border-2 border-tertiary rounded-xl flex flex-col items-center justify-center gap-2 active:scale-95 transition-all shadow-md flex-1 min-h-[120px] disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {checkoutLoading ? <Loader2 className="animate-spin w-8 h-8" /> : <span className="material-symbols-outlined text-[42px]">credit_card</span>}
                    <span className="font-label-lg text-[20px] font-bold uppercase tracking-wide">Paga con Carta</span>
                  </button>
                </div>
              </div>
            </section>
          </main>
        </div>
      </div>
    );
  }

  // ── Vista principale POS ───────────────────────────────────────────────────
  return (
    <div className="bg-background text-on-background h-screen overflow-hidden flex flex-col md:flex-row selection:bg-primary-container selection:text-on-primary-container relative">

      {/* Modal note */}
      {noteModalItem && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-surface-container-lowest w-full max-w-md rounded-3xl p-6 shadow-xl relative overflow-hidden flex flex-col gap-6">
            <div className="flex justify-between items-center">
              <h2 className="font-headline-sm text-[24px] font-black text-on-surface">Note rapide</h2>
              <button onClick={() => setNoteModalItem(null)} className="w-10 h-10 rounded-full bg-surface-container-highest hover:bg-outline-variant flex items-center justify-center transition-colors">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <p className="text-sm font-bold text-neutral">Aggiungi una nota a: <span className="text-primary">{noteModalItem.product.name}</span></p>
            <div className="flex flex-col gap-2 mb-4">
              <label className="text-sm font-bold text-neutral">Nota Libera</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={customNoteText}
                  onChange={e => setCustomNoteText(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === "Enter" && customNoteText.trim()) {
                      cart.appendNote(noteModalItem.id, customNoteText.trim());
                      setCustomNoteText("");
                      setNoteModalItem(null);
                    }
                  }}
                  placeholder="Es. Senza sale..."
                  className="flex-1 bg-surface-container-highest border border-outline-variant p-3 rounded-xl font-bold text-sm outline-none focus:border-primary"
                />
                <button
                  onClick={() => {
                    if (customNoteText.trim()) {
                      cart.appendNote(noteModalItem.id, customNoteText.trim());
                      setCustomNoteText("");
                      setNoteModalItem(null);
                    }
                  }}
                  className="bg-primary text-on-primary font-bold px-4 rounded-xl flex items-center gap-1 hover:brightness-110 transition-all"
                >
                  <span className="material-symbols-outlined text-sm">add</span> Aggiungi
                </button>
              </div>
            </div>
            <div className="w-full h-px bg-outline-variant/50" />
            <div className="flex flex-wrap gap-2">
              {getCategoryNotes(noteModalItem.product.categoryId).map((note: string, idx: number) => (
                <button
                  key={idx}
                  onClick={() => { cart.appendNote(noteModalItem.id, note); setNoteModalItem(null); }}
                  className="bg-surface-container-high border border-outline-variant text-on-surface px-4 py-2 rounded-xl font-bold text-sm hover:border-primary hover:text-primary transition-colors"
                >
                  {note}
                </button>
              ))}
              {getCategoryNotes(noteModalItem.product.categoryId).length === 0 && (
                <p className="text-sm text-neutral w-full text-center py-4">Nessuna nota configurata per questo reparto.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal selezione variante */}
      {selectedProductForVariant && (
        <div className="absolute inset-0 bg-secondary/80 backdrop-blur-sm z-50 flex items-center justify-center p-6">
          <div className="bg-surface-container-lowest rounded-3xl p-8 max-w-lg w-full shadow-2xl flex flex-col gap-6">
            <div className="flex justify-between items-center border-b border-outline-variant/30 pb-4">
              <h2 className="font-headline-lg text-[24px] font-bold text-on-background">Scegli Variante</h2>
              <button onClick={() => setSelectedProductForVariant(null)} className="text-neutral hover:text-error bg-surface-container-high rounded-full p-2">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <p className="font-body-md text-[16px] text-neutral">Seleziona il formato per <strong className="text-primary">{selectedProductForVariant.name}</strong>:</p>
            <div className="grid grid-cols-1 gap-4">
              {selectedProductForVariant.variants?.map(v => (
                <button
                  key={v.id}
                  onClick={() => handleVariantSelect(v)}
                  className="bg-surface-container-high hover:bg-tertiary hover:text-on-tertiary hover:shadow-md text-on-background border border-outline-variant rounded-xl p-4 flex justify-between items-center transition-all active:scale-95"
                >
                  <span className="font-body-lg text-[18px] font-medium">{v.name}</span>
                  <span className="font-body-lg text-[18px] font-bold">€ {(selectedProductForVariant.price + v.priceDelta).toFixed(2)}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Sidebar desktop */}
      <aside className="bg-surface-container-lowest border-r border-outline-variant hidden md:flex flex-col h-full py-section-padding docked left-0 w-64 z-40 shrink-0 shadow-sm">
        <div className="px-6 mb-8">
          <div className="font-headline-lg text-[28px] font-black text-primary uppercase tracking-tighter mb-4">SagraPOS</div>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-tertiary-container flex items-center justify-center text-tertiary">
              <span className="material-symbols-outlined text-[24px]">point_of_sale</span>
            </div>
            <div>
              <div className="font-label-lg text-[14px] font-bold text-on-background flex items-center gap-2">
                {stationName}
                <button
                  onClick={() => {
                    if (confirm('Vuoi cambiare la stazione di questa cassa?')) {
                      localStorage.removeItem('pos_station');
                      window.location.href = '/setup';
                    }
                  }}
                  className="text-[10px] text-neutral hover:text-primary underline"
                  title="Cambia Cassa"
                >
                  Cambia
                </button>
              </div>
              <div className="font-body-md text-[12px] text-neutral flex items-center gap-1">
                <ConnectionBadge status={connStatus} />
              </div>
            </div>
          </div>
        </div>
        <nav className="flex-1 px-4 space-y-2 overflow-y-auto no-scrollbar">
          <button className="w-full flex items-center gap-3 bg-primary text-on-primary rounded-xl px-4 py-3 shadow-md transition-opacity">
            <span className="material-symbols-outlined text-[20px]">restaurant</span>
            <span className="font-body-md text-[15px] font-medium">POS Vendita</span>
          </button>
          <Link href="/admin" className="w-full flex items-center gap-3 text-neutral hover:text-primary hover:bg-primary-container/30 rounded-xl px-4 py-3 transition-all">
            <span className="material-symbols-outlined text-[20px]">admin_panel_settings</span>
            <span className="font-body-md text-[15px] font-medium">Amministrazione</span>
          </Link>
        </nav>

        {/* Sospesi */}
        {suspendedOrders.length > 0 && (
          <div className="px-4 pb-4">
            <div className="border-t border-outline-variant/30 pt-4 mb-2">
              <p className="text-[11px] font-bold text-neutral uppercase tracking-wider">
                Ordini Sospesi ({suspendedOrders.length})
              </p>
            </div>
            <div className="space-y-2 max-h-40 overflow-y-auto no-scrollbar">
              {suspendedOrders.map(o => (
                <button
                  key={o.id}
                  onClick={() => loadSuspended(o)}
                  className="w-full text-left bg-surface-container-high border border-outline-variant rounded-lg p-2 hover:border-primary hover:bg-primary/5 transition-all"
                >
                  <p className="font-bold text-[13px] text-on-background truncate">{o.customerName || "Senza nome"}</p>
                  <p className="text-[11px] text-neutral">€ {o.totalAmount.toFixed(2)} · {o.items.length} art.</p>
                </button>
              ))}
            </div>
          </div>
        )}
      </aside>

      {/* Area principale */}
      <main className="flex-1 flex flex-col h-full bg-surface relative overflow-hidden">
        {/* Barra ricerca e categorie */}
        <div className="w-full bg-surface-container-lowest z-10 border-b border-outline-variant shrink-0 shadow-sm flex flex-col">
          <div className="p-3 px-4 border-b border-outline-variant/30 flex items-center gap-3">
            <span className="material-symbols-outlined text-neutral">search</span>
            <input
              type="text"
              placeholder="Cerca prodotto..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full bg-transparent outline-none font-body-md text-[16px] text-on-background placeholder:text-neutral/70"
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery("")} className="text-neutral hover:text-error">
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            )}
            {/* Nome cliente */}
            <input
              type="text"
              value={customerName}
              onChange={e => setCustomerName(e.target.value)}
              placeholder="Nome tavolo / cliente..."
              className="hidden md:block bg-surface-container border border-outline-variant rounded-lg px-3 py-1.5 text-sm outline-none focus:border-primary w-48"
            />
          </div>
          <div className="w-full overflow-x-auto no-scrollbar flex gap-2 p-3 px-4">
            <button
              onClick={() => setActiveCategory(null)}
              className={`px-6 py-2 font-body-md text-[15px] whitespace-nowrap transition-all rounded-full border ${activeCategory === null ? "bg-on-background text-surface-container-lowest border-on-background" : "bg-transparent text-on-surface border-outline-variant hover:border-neutral"}`}
            >
              Tutti
            </button>
            {categories
              .filter(c => products.some(p => p.categoryId === c.id))
              .map(c => (
                <button
                  key={c.id}
                  onClick={() => setActiveCategory(c.id)}
                  className={`px-6 py-2 font-body-md text-[15px] whitespace-nowrap transition-all rounded-full border ${activeCategory === c.id ? "bg-on-background text-surface-container-lowest border-on-background" : "bg-transparent text-on-surface border-outline-variant hover:border-neutral"}`}
                >
                  {c.name}
                </button>
              ))}
          </div>
        </div>

        {/* Griglia prodotti */}
        <div className="flex-1 overflow-y-auto p-4 pb-32 md:pb-4 space-y-6">
          {bestSellers.length > 0 && (
            <section>
              <h3 className="font-body-md font-bold text-neutral text-[13px] uppercase tracking-wider mb-3 flex items-center gap-2">
                <span className="material-symbols-outlined text-[16px]">local_fire_department</span> Più Venduti
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {bestSellers.map(p => (
                  <ProductCard key={`best-${p.id}`} p={p} onClick={() => handleProductClick(p)} getStockColor={getStockColor} />
                ))}
              </div>
            </section>
          )}
          <section>
            {bestSellers.length > 0 && (
              <h3 className="font-body-md font-bold text-neutral text-[13px] uppercase tracking-wider mb-3 mt-2">Tutti i Prodotti</h3>
            )}
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3 pb-10">
              {filteredProducts.map(p => (
                <ProductCard key={p.id} p={p} onClick={() => handleProductClick(p)} getStockColor={getStockColor} />
              ))}
              {filteredProducts.length === 0 && (
                <div className="col-span-full py-10 text-center text-neutral font-body-md">Nessun prodotto trovato.</div>
              )}
            </div>
          </section>
        </div>
      </main>

      {/* Carrello laterale */}
      <aside className="w-[350px] lg:w-[400px] bg-surface-container-lowest border-l border-outline-variant hidden md:flex flex-col h-full shrink-0 z-40 shadow-xl">
        <div className="p-5 border-b border-outline-variant bg-surface-container-high flex justify-between items-center shrink-0">
          <h2 className="font-headline-md text-[20px] font-bold text-on-background">Carrello</h2>
          <div className="flex items-center gap-2">
            {cart.items.length > 0 && (
              <button
                onClick={saveSuspended}
                className="text-neutral hover:text-tertiary hover:bg-tertiary/10 active:scale-90 transition-all p-2 flex items-center justify-center rounded-full"
                title="Sospendi ordine"
              >
                <span className="material-symbols-outlined text-[20px]">pause_circle</span>
              </button>
            )}
            <button onClick={cart.clearCart} className="text-neutral hover:text-error hover:bg-error/10 active:scale-90 transition-all p-2 flex items-center justify-center rounded-full">
              <span className="material-symbols-outlined text-[20px]">delete_sweep</span>
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3 no-scrollbar bg-surface-container-low/50">
          {cart.items.map(item => (
            <div key={item.id} className="bg-surface-container-lowest border border-outline-variant/80 rounded-xl p-3 flex flex-col gap-2 relative shadow-sm">
              <button onClick={() => cart.removeItem(item.id)} className="absolute top-2 right-2 text-neutral hover:text-error">
                <span className="material-symbols-outlined text-[16px]">close</span>
              </button>
              <div className="pr-6">
                <span className="font-body-md text-[15px] font-medium text-on-background leading-tight block">{item.product.name}</span>
                {item.variant && <span className="text-neutral text-[12px] font-normal block">{item.variant.name}</span>}
              </div>
              <div className="flex justify-between items-center mt-1">
                <button
                  onClick={() => { setNoteModalItem(item); setCustomNoteText(""); }}
                  className="text-[10px] bg-surface-container-high px-2 py-1 rounded-md font-bold text-neutral hover:brightness-95 flex items-center gap-1"
                >
                  <span className="material-symbols-outlined text-[12px]">edit_note</span> Note
                </button>
                <div className="flex items-center bg-surface-container rounded-full p-1 border border-outline-variant/50">
                  <button
                    onClick={() => item.quantity > 1 ? cart.updateQuantity(item.id, item.quantity - 1) : cart.removeItem(item.id)}
                    className="w-8 h-8 rounded-full bg-surface-container-lowest hover:bg-outline-variant flex items-center justify-center text-on-background active:scale-90 shadow-sm transition-transform"
                  >
                    <span className="material-symbols-outlined text-[16px]">remove</span>
                  </button>
                  <span className="w-10 text-center font-body-md text-[16px] font-bold text-on-background">{item.quantity}</span>
                  <button
                    onClick={() => cart.updateQuantity(item.id, item.quantity + 1)}
                    className="w-8 h-8 rounded-full bg-surface-container-lowest hover:bg-outline-variant flex items-center justify-center text-on-background active:scale-90 shadow-sm transition-transform"
                  >
                    <span className="material-symbols-outlined text-[16px]">add</span>
                  </button>
                </div>
                <span className="font-body-lg text-[18px] font-bold text-on-background">
                  € {((item.product.price + (item.variant?.priceDelta || 0)) * item.quantity).toFixed(2)}
                </span>
              </div>
            </div>
          ))}
          {cart.items.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-neutral opacity-50">
              <span className="material-symbols-outlined text-[48px] mb-3">shopping_cart</span>
              <p className="font-body-md text-[14px]">Il carrello è vuoto</p>
            </div>
          )}
        </div>

        <div className="p-5 bg-surface-container-lowest border-t border-outline-variant shrink-0 shadow-[0_-5px_15px_rgba(0,0,0,0.02)]">
          <div className="flex justify-between items-end mb-4">
            <span className="font-body-md text-[16px] text-neutral">Totale</span>
            <span className="font-body-lg text-[32px] font-bold text-primary tracking-tight">
              € {cart.items.reduce((sum, item) => sum + (item.product.price + (item.variant?.priceDelta || 0)) * item.quantity, 0).toFixed(2)}
            </span>
          </div>
          <button
            disabled={cart.items.length === 0}
            onClick={() => setShowCheckout(true)}
            className="w-full py-4 bg-primary text-on-primary font-body-lg text-[18px] font-bold rounded-xl flex items-center justify-center gap-2 active:scale-95 transition-all shadow-md hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <span className="material-symbols-outlined text-[24px]">shopping_cart_checkout</span>
            VAI ALLA CASSA
          </button>
        </div>
      </aside>
    </div>
  );
}

// ─── Componente Card Prodotto ──────────────────────────────────────────────────
function ProductCard({
  p,
  onClick,
  getStockColor,
}: {
  p: any;
  onClick: () => void;
  getStockColor: (s: number | undefined | null) => string;
}) {
  const outOfStock = p.stock !== undefined && p.stock !== null && p.stock <= 0;
  return (
    <button
      onClick={onClick}
      disabled={outOfStock || !p.available}
      className={`relative text-left bg-surface-container-lowest border border-outline-variant p-4 h-24 rounded-xl flex flex-col justify-between transition-all outline-none ${outOfStock || !p.available ? "opacity-40 cursor-not-allowed bg-surface" : "hover:border-neutral active:scale-[0.98] shadow-sm hover:shadow"}`}
    >
      <div className={`absolute top-3 right-3 w-3 h-3 rounded-full ${getStockColor(p.stock)}`} />
      <h3 className="font-body-md text-[15px] font-medium text-on-background leading-tight pr-6 line-clamp-2">{p.name}</h3>
      <div className="flex justify-between items-end w-full">
        <span className="font-body-lg text-[18px] font-bold text-on-background">€ {p.price.toFixed(2)}</span>
        {p.variants?.length > 0 && (
          <span className="text-[10px] uppercase font-bold text-neutral bg-surface-container-high px-1.5 py-0.5 rounded">Varianti</span>
        )}
      </div>
      {(outOfStock || !p.available) && (
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="font-body-md font-bold text-error bg-surface-container-lowest/80 px-2 py-1 rounded">
            {outOfStock ? "ESAURITO" : "NON DISP."}
          </span>
        </div>
      )}
    </button>
  );
}
