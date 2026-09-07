"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Product } from "@event-pos/shared-types";
import { apiFetch } from "@/lib/api";
import { useSocket, ConnectionBadge } from "@/hooks/useSocket";

type AdminTab = "CASSA" | "STORICO" | "CATALOGO" | "IMPOSTAZIONI" | "SETUP";

// ─── Componente principale Admin ──────────────────────────────────────────────
export default function AdminDashboard() {
  const [eventId, setEventId] = useState<string | null>(null);
  const [eventName, setEventName] = useState<string>("Evento");
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [addMode, setAddMode] = useState<"MANUAL" | "TEXT" | "CSV">("MANUAL");
  const [activeTab, setActiveTab] = useState<AdminTab>("CASSA");
  const [sessionData, setSessionData] = useState<any>(null);
  const [reportStationId, setReportStationId] = useState<string>("");
  const [allStations, setAllStations] = useState<any[]>([]);
  const [historyDate, setHistoryDate] = useState(new Date().toISOString().split("T")[0]);
  const [historyOrders, setHistoryOrders] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedOrder, setExpandedOrder] = useState<string | null>(null);
  const [newProduct, setNewProduct] = useState({
    categoryId: "", name: "", price: 0, stock: 999, variants: [] as any[],
    isCombo: false, comboItems: [] as any[],
  });
  const [bulkText, setBulkText] = useState("");
  const [showCategoriesModal, setShowCategoriesModal] = useState(false);
  const [editingCategory, setEditingCategory] = useState<any>(null);
  const [newCategoryName, setNewCategoryName] = useState("");

  // Setup tab state
  const [stations, setStations] = useState<any[]>([]);
  const [newStationName, setNewStationName] = useState("");
  const [editingStation, setEditingStation] = useState<any>(null);
  const [showPrinterModal, setShowPrinterModal] = useState<string | null>(null); // stationId
  const [serverIPs, setServerIPs] = useState<string[]>([]); // tutti gli IP del server per hotspot
  const [newPrinter, setNewPrinter] = useState({
    name: "Stampante", type: "USB", role: "CASHIER",
    usbVendorId: "", usbProductId: "", networkHost: "", networkPort: "9100",
  });

  const [settings, setSettings] = useState({
    headerName: "CAVAGLIO SOTTO LE STELLE",
    headerSubtitle: "AREA FESTE · VIA ASILO\nCAVAGLIO D'AGOGNA (NO)",
    headerAddress: "", headerVat: "", headerPhone: "",
    headerAlign: "ct", headerSize: "NORMAL",
    headerLogoBase64: "", footerLogoBase64: "",
    bodyFont: "b", showOriginalPrice: true, showChangeAndDiscount: true,
    dateFormat: "SHORT", prepItemSize: "NORMAL", prepNoteSize: "NORMAL",
    prepShowMetadata: true, prepVariantFormat: "BRACKETS",
    footerText: "GRAZIE E ARRIVEDERCI!", footerShowCount: true,
    comandaGreeting: "",
    comandaShowHeader: false,
    comandaShowPrice: true,
    comandaShowGreeting: false,
    printToDepartments: false,
  });

  // ── Socket ─────────────────────────────────────────────────────────────────
  const { status: connStatus, on } = useSocket({ eventId });

  // ── Fetch helpers ──────────────────────────────────────────────────────────
  const fetchProducts = useCallback(async (evId: string) => {
    try {
      const data = await apiFetch(`/products?eventId=${evId}&all=true`);
      setProducts(data);
    } catch {}
  }, []);

  const fetchCategories = useCallback(async (evId: string) => {
    try {
      const data = await apiFetch(`/categories?eventId=${evId}`);
      setCategories(data);
    } catch {}
  }, []);

  const fetchStations = useCallback(async (evId: string) => {
    try {
      const data = await apiFetch(`/stations?eventId=${evId}`);
      setStations(data);
      setAllStations(data);
    } catch {}
  }, []);

  const fetchSession = useCallback(async (evId?: string, sId?: string) => {
    const id = evId || eventId;
    if (!id) return;
    try {
      const url = sId
        ? `/sessions/current?eventId=${id}&stationId=${sId}`
        : `/sessions/current?eventId=${id}`;
      const data = await apiFetch(url);
      setSessionData(data);
    } catch {}
  }, [eventId]);

  const fetchHistory = useCallback(async (evId?: string) => {
    const id = evId || eventId;
    if (!id) return;
    try {
      const data = await apiFetch(`/orders?eventId=${id}&date=${historyDate}`);
      setHistoryOrders(data);
    } catch {}
  }, [eventId, historyDate]);

  const fetchSettings = useCallback(async () => {
    try {
      const data = await apiFetch("/settings");
      setSettings(s => ({ ...s, ...data }));
    } catch {}
  }, []);

  // ── Inizializzazione ───────────────────────────────────────────────────────
  useEffect(() => {
    async function init() {
      try {
        const events = await apiFetch("/events");
        if (!events?.length) return;
        const evId: string = events[0].id;
        setEventId(evId);
        setEventName(events[0].name || "Evento");

        await Promise.all([
          fetchProducts(evId),
          fetchCategories(evId),
          fetchStations(evId),
          fetchSession(evId),
          fetchSettings(),
        ]);

        // Recupera tutti gli IP del server (WiFi, LAN, hotspot)
        try {
          const info = await apiFetch('/server-info');
          setServerIPs(info?.localIPs || []);
        } catch {}

      } catch (e) {
        console.error("Admin init error:", e);
      }
    }
    init();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Effetti socket ─────────────────────────────────────────────────────────
  useEffect(() => {
    const u1 = on("product-updated", () => { if (eventId) fetchProducts(eventId); });
    const u2 = on("new-product", () => { if (eventId) fetchProducts(eventId); });
    const u3 = on("product-deleted", () => { if (eventId) fetchProducts(eventId); });
    const u4 = on("bulk-products-created", () => { if (eventId) fetchProducts(eventId); });
    const u5 = on("category-updated", () => { if (eventId) fetchCategories(eventId); });
    const u6 = on("new-order", () => { if (eventId) { fetchSession(eventId, reportStationId || undefined); fetchHistory(eventId); }});
    const u7 = on("order-stornato", () => { if (eventId) { fetchSession(eventId, reportStationId || undefined); fetchHistory(eventId); }});
    const u8 = on("station-heartbeat", (data: any) => {
      setStations(prev => prev.map(s => s.id === data.stationId ? { ...s, status: data.status, lastSeenAt: data.lastSeenAt } : s));
    });
    return () => { u1(); u2(); u3(); u4(); u5(); u6(); u7(); u8(); };
  }, [on, eventId, reportStationId, fetchProducts, fetchCategories, fetchSession, fetchHistory]);

  useEffect(() => {
    if (eventId) fetchSession(eventId, reportStationId || undefined);
  }, [reportStationId, eventId, fetchSession]);

  useEffect(() => {
    if (eventId && activeTab === "STORICO") fetchHistory(eventId);
  }, [historyDate, activeTab, eventId, fetchHistory]);

  // ── Preset stampa ──────────────────────────────────────────────────────────
  const applyPreset = (preset: string) => {
    if (preset === "ECO") {
      setSettings(s => ({ ...s, headerSize: "NORMAL", bodyFont: "b", showChangeAndDiscount: false, dateFormat: "SHORT", prepItemSize: "NORMAL", prepShowMetadata: false, footerText: "", footerShowCount: false }));
    } else if (preset === "RESTO") {
      setSettings(s => ({ ...s, headerAlign: "ct", headerSize: "DOUBLE_HEIGHT", bodyFont: "a", showChangeAndDiscount: true, dateFormat: "FULL", prepItemSize: "DOUBLE_HEIGHT", footerShowCount: true, prepVariantFormat: "BRACKETS" }));
    } else if (preset === "BAR") {
      setSettings(s => ({ ...s, headerSize: "NORMAL", bodyFont: "b", showChangeAndDiscount: false, dateFormat: "SHORT", prepItemSize: "GIANT", prepNoteSize: "DOUBLE_HEIGHT", prepShowMetadata: true, prepVariantFormat: "ASTERISK" }));
    }
  };

  // ── Salva impostazioni ─────────────────────────────────────────────────────
  const saveSettings = async () => {
    try {
      await apiFetch("/settings", { method: "PUT", body: JSON.stringify(settings) }); // ← FIX: era POST
      alert("Impostazioni salvate ✓");
    } catch (e: any) {
      alert(`Errore salvataggio: ${e?.message}`);
    }
  };

  const printTest = async () => {
    try {
      await apiFetch("/settings/print-test", { method: "POST", body: JSON.stringify(settings) });
      alert("Stampa di prova inviata!");
    } catch {
      alert("Errore invio stampa");
    }
  };

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>, field: 'headerLogoBase64' | 'footerLogoBase64') => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.includes('png') && !file.type.includes('image')) {
      alert("Seleziona un'immagine in formato PNG");
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const b64 = ev.target?.result as string;
      setSettings(s => ({ ...s, [field]: b64 }));
    };
    reader.readAsDataURL(file);
  };

  const removeLogo = (field: 'headerLogoBase64' | 'footerLogoBase64') => {
    setSettings(s => ({ ...s, [field]: "" }));
  };

  // ── Report X / Chiusura Z ──────────────────────────────────────────────────
  const printReportX = async () => {
    try {
      await apiFetch("/sessions/print-x", { method: "POST", body: JSON.stringify({ eventId }) });
      alert("Lettura X inviata alla stampante!");
    } catch (e: any) {
      alert(`Errore: ${e?.message}`);
    }
  };

  const closeSessionZ = async () => {
    if (!confirm("ATTENZIONE: Confermi la chiusura definitiva della cassa?\nI dati verranno azzerati e verrà stampata la Lettura Z.")) return;
    try {
      await apiFetch("/sessions/close", { method: "POST", body: JSON.stringify({ eventId, initialCash: 0 }) });
      alert("Cassa chiusa. Lettura Z in stampa!");
      if (eventId) fetchSession(eventId);
    } catch (e: any) {
      alert(`Errore chiusura: ${e?.message}`);
    }
  };

  const exportCSV = () => {
    if (!sessionData) return;
    let csv = "RESOCONTO CASSA\n\n";
    csv += `Apertura;"${new Date(sessionData.openedAt).toLocaleString("it-IT")}"\n`;
    csv += `Ordini Totali;${sessionData.orderCount}\n`;
    csv += `Incasso Lordo;${sessionData.totalGross.toFixed(2).replace(".", ",")}\n`;
    csv += `Sconti Applicati;${sessionData.totalDiscount.toFixed(2).replace(".", ",")}\n`;
    csv += `INCASSO NETTO;${sessionData.totalNet.toFixed(2).replace(".", ",")}\n`;

    if (sessionData.paymentBreakdown) {
      csv += `  - Contanti;${(sessionData.paymentBreakdown.CASH || 0).toFixed(2).replace(".", ",")}\n`;
      csv += `  - Carta;${(sessionData.paymentBreakdown.CARD || 0).toFixed(2).replace(".", ",")}\n`;
    }

    csv += "\nRIPARTIZIONE CATEGORIE\nCategoria;Incasso\n";
    Object.entries(sessionData.categoryBreakdown).forEach(([cat, amount]: any) => {
      csv += `"${cat}";${amount.toFixed(2).replace(".", ",")}\n`;
    });

    csv += "\nVENDITE ARTICOLI\nArticolo;Quantita;Incasso\n";
    Object.entries(sessionData.productStats).forEach(([prod, stat]: any) => {
      csv += `"${prod}";${stat.qty};${stat.total.toFixed(2).replace(".", ",")}\n`;
    });

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Resoconto_Cassa_${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const filteredOrders = historyOrders.filter(o => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      o.orderNumber.toString().includes(q) ||
      (o.customerName?.toLowerCase().includes(q)) ||
      new Date(o.createdAt).toLocaleTimeString("it-IT").includes(q) ||
      o.items.some((i: any) => i.product.name.toLowerCase().includes(q) || i.variantName?.toLowerCase().includes(q))
    );
  });

  const ristampaTotale = async (id: string) => {
    try {
      await apiFetch(`/orders/${id}/reprint`, { method: "POST" });
      alert("Ristampa totale inviata!");
    } catch { alert("Errore ristampa"); }
  };
  const ristampaSingolo = async (id: string, itemId: string) => {
    try {
      await apiFetch(`/orders/${id}/reprint-item/${itemId}`, { method: "POST" });
      alert("Ristampa singolo inviata!");
    } catch { alert("Errore ristampa"); }
  };
  const stornareOrdine = async (orderId: string) => {
    if (!confirm("Confermi lo storno di questo ordine?")) return;
    try {
      await apiFetch(`/orders/${orderId}/storno`, { method: "POST" });
      if (eventId) { fetchHistory(eventId); fetchSession(eventId); }
    } catch (e: any) { alert(`Errore storno: ${e?.message}`); }
  };

  // ── Gestione prodotti ──────────────────────────────────────────────────────
  const handleSaveProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingProduct) return;
    try {
      await apiFetch(`/products/${editingProduct.id}`, {
        method: "PUT",
        body: JSON.stringify({
          name: editingProduct.name,
          categoryId: editingProduct.categoryId,
          price: editingProduct.price,
          stock: editingProduct.stock,
          variants: editingProduct.variants,
          isCombo: editingProduct.isCombo,
          comboItems: (editingProduct as any).comboItems,
        }),
      });
      setEditingProduct(null);
    } catch (e: any) { alert(`Errore salvataggio: ${e?.message}`); }
  };

  const handleDeleteProduct = async (id: string) => {
    if (!confirm("Sei sicuro di voler eliminare questo prodotto?")) return;
    try {
      await apiFetch(`/products/${id}`, { method: "DELETE" });
      setProducts(prev => prev.filter(p => p.id !== id));
    } catch (e: any) { alert(`Errore: ${e?.message}`); }
  };

  const handleAddManual = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!eventId) return;
    try {
      await apiFetch("/products", {
        method: "POST",
        body: JSON.stringify({ eventId, ...newProduct }),
      });
      setShowAddModal(false);
      setNewProduct({ categoryId: categories[0]?.id || "", name: "", price: 0, stock: 999, variants: [], isCombo: false, comboItems: [] });
    } catch (e: any) { alert(`Errore creazione: ${e?.message}`); }
  };

  const handleAddBulkText = async () => {
    if (!eventId || !bulkText.trim()) return;
    const lines = bulkText.split("\n").map(l => l.trim()).filter(l => l);
    const parsedProducts = lines.map(line => {
      const parts = line.split("|").map(p => p.trim());
      return {
        categoryName: parts[0] || "Generale",
        name: parts[1] || "Sconosciuto",
        price: parseFloat(parts[2]) || 0,
        stock: parseInt(parts[3]) || 999,
        variants: parts.slice(4).filter(v => v).map(v => ({ name: v, priceDelta: 0 })),
      };
    });
    try {
      await apiFetch("/products/bulk", {
        method: "POST",
        body: JSON.stringify({ eventId, products: parsedProducts }),
      });
      setShowAddModal(false);
      setBulkText("");
    } catch (e: any) { alert(`Errore importazione: ${e?.message}`); }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const text = evt.target?.result as string;
      if (text) { setBulkText(text); setAddMode("TEXT"); }
    };
    reader.readAsText(file);
  };

  // ── Gestione categorie ─────────────────────────────────────────────────────
  const handleAddCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!eventId || !newCategoryName.trim()) return;
    try {
      await apiFetch("/categories", {
        method: "POST",
        body: JSON.stringify({ eventId, name: newCategoryName.trim(), orderIndex: categories.length }),
      });
      setNewCategoryName("");
    } catch (e: any) { alert(`Errore: ${e?.message}`); }
  };

  const handleUpdateCategory = async (id: string, name: string, orderIndex: number, extra?: any) => {
    try {
      await apiFetch(`/categories/${id}`, {
        method: "PUT",
        body: JSON.stringify({ name, orderIndex, ...extra }),
      });
      setEditingCategory(null);
    } catch (e: any) { alert(`Errore: ${e?.message}`); }
  };

  const handleDeleteCategory = async (id: string) => {
    if (!confirm("Eliminare questa categoria?")) return;
    try {
      await apiFetch(`/categories/${id}`, { method: "DELETE" });
    } catch (e: any) { alert(e?.message || "Errore eliminazione"); }
  };

  const moveCategory = async (index: number, direction: "UP" | "DOWN") => {
    if (direction === "UP" && index === 0) return;
    if (direction === "DOWN" && index === categories.length - 1) return;
    const newCats = [...categories];
    const ti = direction === "UP" ? index - 1 : index + 1;
    const temp = newCats[index].orderIndex;
    newCats[index].orderIndex = newCats[ti].orderIndex;
    newCats[ti].orderIndex = temp;
    await handleUpdateCategory(newCats[index].id, newCats[index].name, newCats[index].orderIndex);
    await handleUpdateCategory(newCats[ti].id, newCats[ti].name, newCats[ti].orderIndex);
  };

  // ── Gestione stazioni e stampanti (Setup tab) ──────────────────────────────
  const handleAddStation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!eventId || !newStationName.trim()) return;
    try {
      await apiFetch("/stations", {
        method: "POST",
        body: JSON.stringify({ eventId, name: newStationName.trim() }),
      });
      setNewStationName("");
      if (eventId) await fetchStations(eventId);
    } catch (e: any) { alert(`Errore creazione stazione: ${e?.message || e}`); }
  };

  const handleDeleteStation = async (id: string) => {
    if (!confirm("Eliminare questa stazione?")) return;
    try {
      await apiFetch(`/stations/${id}`, { method: "DELETE" });
      if (eventId) await fetchStations(eventId);
    } catch (e: any) { alert(`Errore eliminazione stazione: ${e?.message || e}`); }
  };

  const handleAddPrinter = async () => {
    if (!showPrinterModal) return;
    try {
      const parseHex = (val: string) => {
        if (!val) return null;
        const clean = val.trim().replace(/^0x/i, "");
        const num = parseInt(clean, 16);
        return isNaN(num) ? null : num;
      };

      await apiFetch(`/stations/${showPrinterModal}/printers`, {
        method: "POST",
        body: JSON.stringify({
          name: newPrinter.name || "Stampante",
          type: newPrinter.type,
          role: newPrinter.role,
          usbVendorId: newPrinter.type === "USB" ? parseHex(newPrinter.usbVendorId) : null,
          usbProductId: newPrinter.type === "USB" ? parseHex(newPrinter.usbProductId) : null,
          networkHost: newPrinter.type === "NETWORK" ? (newPrinter.networkHost || "").trim() : null,
          networkPort: newPrinter.type === "NETWORK" ? (parseInt(newPrinter.networkPort) || 9100) : null,
        }),
      });
      setShowPrinterModal(null);
      setNewPrinter({ name: "Stampante", type: "USB", role: "CASHIER", usbVendorId: "", usbProductId: "", networkHost: "", networkPort: "9100" });
      if (eventId) await fetchStations(eventId);
    } catch (e: any) { alert(`Errore aggiunta stampante: ${e?.message || e}`); }
  };

  const handleDeletePrinter = async (printerId: string) => {
    try {
      await apiFetch(`/stations/printers/${printerId}`, { method: "DELETE" });
      if (eventId) await fetchStations(eventId);
    } catch (e: any) { alert(`Errore eliminazione stampante: ${e?.message || e}`); }
  };

  // ─── RENDER ───────────────────────────────────────────────────────────────
  return (
    <div className="bg-background text-on-background min-h-screen flex relative">

      {/* ── Modal Categorie ── */}
      {showCategoriesModal && (
        <div className="absolute inset-0 bg-secondary/80 backdrop-blur-sm z-50 flex items-center justify-center p-6 overflow-y-auto">
          <div className="bg-surface-container-lowest rounded-3xl p-8 max-w-lg w-full shadow-2xl flex flex-col gap-6 my-auto">
            <div className="flex justify-between items-center border-b border-outline-variant/30 pb-4">
              <h2 className="font-headline-lg text-[28px] font-black text-on-background">Gestione Categorie</h2>
              <button type="button" onClick={() => setShowCategoriesModal(false)} className="text-neutral hover:text-error bg-surface-container-high rounded-full p-2">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <form onSubmit={handleAddCategory} className="flex gap-2">
              <input type="text" placeholder="Nuova categoria..." value={newCategoryName} onChange={e => setNewCategoryName(e.target.value)} className="flex-1 bg-surface-container-high border-outline-variant border rounded-lg p-3 font-body-lg" />
              <button type="submit" disabled={!newCategoryName.trim()} className="bg-primary text-on-primary px-4 py-2 rounded-lg font-bold shadow-md hover:brightness-110 disabled:opacity-50">Aggiungi</button>
            </form>
            <div className="flex flex-col gap-2 max-h-[50vh] overflow-y-auto no-scrollbar">
              {categories.map((c, index) => (
                <div key={c.id} className="flex items-center justify-between bg-surface-container-high border border-outline-variant rounded-xl p-3">
                  {editingCategory === c.id ? (
                    <input type="text" defaultValue={c.name} autoFocus
                      onBlur={e => handleUpdateCategory(c.id, e.target.value, c.orderIndex)}
                      onKeyDown={e => e.key === "Enter" && handleUpdateCategory(c.id, e.currentTarget.value, c.orderIndex)}
                      className="flex-1 bg-surface-container-lowest border border-outline-variant rounded p-1 font-body-lg mr-2"
                    />
                  ) : (
                    <span className="font-body-lg font-bold flex-1">{c.name}</span>
                  )}
                  <div className="flex gap-1 items-center">
                    <button onClick={() => setEditingCategory(c.id)} className="text-tertiary hover:bg-tertiary/10 p-2 rounded-lg"><span className="material-symbols-outlined text-sm">edit</span></button>
                    <button onClick={() => handleDeleteCategory(c.id)} className="text-error hover:bg-error/10 p-2 rounded-lg"><span className="material-symbols-outlined text-sm">delete</span></button>
                    <div className="w-px h-6 bg-outline-variant/50 mx-1" />
                    <div className="flex flex-col">
                      <button onClick={() => moveCategory(index, "UP")} disabled={index === 0} className="text-neutral hover:text-on-background disabled:opacity-30"><span className="material-symbols-outlined text-sm">expand_less</span></button>
                      <button onClick={() => moveCategory(index, "DOWN")} disabled={index === categories.length - 1} className="text-neutral hover:text-on-background disabled:opacity-30"><span className="material-symbols-outlined text-sm">expand_more</span></button>
                    </div>
                  </div>
                </div>
              ))}
              {categories.length === 0 && <p className="text-neutral text-center p-4">Nessuna categoria.</p>}
            </div>
          </div>
        </div>
      )}

      {/* ── Modal Modifica Prodotto ── */}
      {editingProduct && (
        <div className="absolute inset-0 bg-secondary/80 backdrop-blur-sm z-50 flex items-center justify-center p-6 overflow-y-auto">
          <form onSubmit={handleSaveProduct} className="bg-surface-container-lowest rounded-3xl p-8 max-w-lg w-full shadow-2xl flex flex-col gap-6 my-auto">
            <div className="flex justify-between items-center border-b border-outline-variant/30 pb-4">
              <h2 className="font-headline-lg text-[28px] font-black text-on-background">Modifica Prodotto</h2>
              <button type="button" onClick={() => setEditingProduct(null)} className="text-neutral hover:text-error bg-surface-container-high rounded-full p-2">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="font-label-lg text-neutral mb-1 block">Categoria</label>
                  <select value={editingProduct.categoryId} onChange={e => setEditingProduct({ ...editingProduct, categoryId: e.target.value })} className="w-full bg-surface-container-high border-outline-variant border rounded-lg p-3 font-body-lg appearance-none">
                    {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="font-label-lg text-neutral mb-1 block">Nome</label>
                  <input type="text" value={editingProduct.name} onChange={e => setEditingProduct({ ...editingProduct, name: e.target.value })} className="w-full bg-surface-container-high border-outline-variant border rounded-lg p-3 font-body-lg" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="font-label-lg text-neutral mb-1 block">Prezzo (€)</label>
                  <input type="number" step="0.01" value={editingProduct.price} onChange={e => setEditingProduct({ ...editingProduct, price: parseFloat(e.target.value) })} className="w-full bg-surface-container-high border-outline-variant border rounded-lg p-3 font-body-lg" />
                </div>
                <div>
                  <label className="font-label-lg text-neutral mb-1 block">Stock</label>
                  <input type="number" value={editingProduct.stock || 0} onChange={e => setEditingProduct({ ...editingProduct, stock: parseInt(e.target.value) })} className="w-full bg-surface-container-high border-outline-variant border rounded-lg p-3 font-body-lg" />
                </div>
              </div>
              <div>
                <label className="font-label-lg text-neutral mb-1 flex justify-between">
                  <span>Varianti</span>
                  <button type="button" onClick={() => setEditingProduct({ ...editingProduct, variants: [...(editingProduct.variants || []), { id: Date.now().toString(), productId: editingProduct.id, name: "", priceDelta: 0 }] })} className="text-tertiary flex items-center text-sm"><span className="material-symbols-outlined text-sm">add</span> Aggiungi</button>
                </label>
                <div className="space-y-2">
                  {editingProduct.variants?.map((v, i) => (
                    <div key={v.id} className="flex gap-2 items-center">
                      <input type="text" placeholder="Nome" value={v.name} onChange={e => { const nv = [...editingProduct.variants!]; nv[i].name = e.target.value; setEditingProduct({ ...editingProduct, variants: nv }); }} className="flex-1 bg-surface-container-high border-outline-variant border rounded-lg p-2 text-sm" />
                      <input type="number" step="0.01" placeholder="+€" value={v.priceDelta} onChange={e => { const nv = [...editingProduct.variants!]; nv[i].priceDelta = parseFloat(e.target.value); setEditingProduct({ ...editingProduct, variants: nv }); }} className="w-20 bg-surface-container-high border-outline-variant border rounded-lg p-2 text-sm" />
                      <button type="button" onClick={() => setEditingProduct({ ...editingProduct, variants: editingProduct.variants?.filter(x => x.id !== v.id) })} className="text-error"><span className="material-symbols-outlined text-sm">delete</span></button>
                    </div>
                  ))}
                  {(!editingProduct.variants || editingProduct.variants.length === 0) && <p className="text-sm text-neutral">Nessuna variante.</p>}
                </div>
              </div>
              {/* Combo */}
              <div className="flex flex-col gap-2">
                <label className="flex items-center gap-2 text-sm font-bold bg-surface-container-highest p-2 rounded-xl">
                  <input type="checkbox" checked={(editingProduct as any).isCombo || false} onChange={e => setEditingProduct({ ...editingProduct, isCombo: e.target.checked } as any)} className="w-4 h-4 accent-primary" />
                  Articolo Combo / Menu
                </label>
                {(editingProduct as any).isCombo && (
                  <div className="bg-surface-container-highest p-4 rounded-xl flex flex-col gap-3">
                    <label className="text-xs font-bold text-neutral">Elementi inclusi</label>
                    {((editingProduct as any).comboItems || []).map((ci: any, idx: number) => {
                      const cp = products.find(p => p.id === ci.componentId);
                      return (
                        <div key={idx} className="flex gap-2 items-center">
                          <span className="font-bold flex-1 text-sm bg-surface-container-high p-2 rounded-lg">{ci.quantity}x {cp?.name || "Prodotto"}</span>
                          <button type="button" onClick={() => { const nc = [...((editingProduct as any).comboItems || [])]; nc.splice(idx, 1); setEditingProduct({ ...editingProduct, comboItems: nc } as any); }} className="text-error material-symbols-outlined text-sm p-1">delete</button>
                        </div>
                      );
                    })}
                    <div className="flex gap-2 items-center mt-2">
                      <select id="newComboComp" className="flex-1 bg-surface-container-high border-outline-variant border rounded-lg p-2 text-sm appearance-none">
                        <option value="">-- Seleziona un prodotto --</option>
                        {products.filter(p => !(p as any).isCombo && p.id !== editingProduct.id).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                      <input type="number" id="newComboQty" defaultValue="1" min="1" className="w-16 bg-surface-container-high border-outline-variant border rounded-lg p-2" />
                      <button type="button" onClick={() => {
                        const compId = (document.getElementById("newComboComp") as HTMLSelectElement).value;
                        const qty = parseInt((document.getElementById("newComboQty") as HTMLInputElement).value) || 1;
                        if (compId) setEditingProduct({ ...editingProduct, comboItems: [...((editingProduct as any).comboItems || []), { componentId: compId, quantity: qty }] } as any);
                      }} className="bg-tertiary text-on-tertiary p-2 rounded-lg font-bold">Aggiungi</button>
                    </div>
                  </div>
                )}
              </div>
            </div>
            <div className="flex gap-4 justify-between border-t border-outline-variant/30 pt-6 mt-4">
              <button type="button" onClick={() => { handleDeleteProduct(editingProduct.id); setEditingProduct(null); }} className="px-6 py-3 font-bold text-error hover:bg-error/10 rounded-xl flex items-center gap-2">
                <span className="material-symbols-outlined">delete</span> Elimina
              </button>
              <div className="flex gap-4">
                <button type="button" onClick={() => setEditingProduct(null)} className="px-6 py-3 font-bold text-neutral hover:bg-surface-container-high rounded-xl">Annulla</button>
                <button type="submit" className="px-8 py-3 font-bold bg-primary text-on-primary rounded-xl shadow-md hover:brightness-110 flex items-center gap-2">
                  <span className="material-symbols-outlined">save</span> Salva
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {/* ── Modal Aggiungi Prodotto ── */}
      {showAddModal && (
        <div className="absolute inset-0 bg-secondary/80 backdrop-blur-sm z-50 flex items-center justify-center p-6 overflow-y-auto">
          <div className="bg-surface-container-lowest rounded-3xl p-8 max-w-2xl w-full shadow-2xl flex flex-col gap-6 my-auto">
            <div className="flex justify-between items-center border-b border-outline-variant/30 pb-4">
              <h2 className="font-headline-lg text-[28px] font-black text-on-background">Aggiungi Prodotti</h2>
              <button type="button" onClick={() => setShowAddModal(false)} className="text-neutral hover:text-error bg-surface-container-high rounded-full p-2"><span className="material-symbols-outlined">close</span></button>
            </div>
            <div className="flex gap-2 bg-surface-container-high p-1 rounded-xl">
              {(["MANUAL", "TEXT", "CSV"] as const).map(m => (
                <button key={m} onClick={() => setAddMode(m)} className={`flex-1 py-2 font-bold rounded-lg ${addMode === m ? "bg-surface-container-lowest shadow-sm text-primary" : "text-neutral"}`}>
                  {m === "MANUAL" ? "Manuale" : m === "TEXT" ? "Testo Libero" : "Carica CSV"}
                </button>
              ))}
            </div>
            {addMode === "MANUAL" && (
              <form onSubmit={handleAddManual} className="flex flex-col gap-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="font-label-lg text-neutral mb-1 block">Categoria</label>
                    <select required value={newProduct.categoryId} onChange={e => setNewProduct({ ...newProduct, categoryId: e.target.value })} className="w-full bg-surface-container-high border-outline-variant border rounded-lg p-3 font-body-lg appearance-none">
                      {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="font-label-lg text-neutral mb-1 block">Nome Prodotto</label>
                    <input required type="text" value={newProduct.name} onChange={e => setNewProduct({ ...newProduct, name: e.target.value })} className="w-full bg-surface-container-high border-outline-variant border rounded-lg p-3 font-body-lg" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="font-label-lg text-neutral mb-1 block">Prezzo (€)</label>
                    <input required type="number" step="0.01" value={newProduct.price} onChange={e => setNewProduct({ ...newProduct, price: parseFloat(e.target.value) })} className="w-full bg-surface-container-high border-outline-variant border rounded-lg p-3 font-body-lg" />
                  </div>
                  <div>
                    <label className="font-label-lg text-neutral mb-1 block">Stock Iniziale</label>
                    <input required type="number" value={newProduct.stock} onChange={e => setNewProduct({ ...newProduct, stock: parseInt(e.target.value) })} className="w-full bg-surface-container-high border-outline-variant border rounded-lg p-3 font-body-lg" />
                  </div>
                </div>
                <div className="flex gap-4 justify-end pt-4">
                  <button type="button" onClick={() => setShowAddModal(false)} className="px-6 py-3 font-bold text-neutral hover:bg-surface-container-high rounded-xl">Annulla</button>
                  <button type="submit" className="px-8 py-3 font-bold bg-primary text-on-primary rounded-xl shadow-md hover:brightness-110">Inserisci Prodotto</button>
                </div>
              </form>
            )}
            {addMode === "TEXT" && (
              <div className="flex flex-col gap-4">
                <p className="text-sm text-neutral">Formato: <strong>Categoria | Nome | Prezzo | Stock | Variante1 | ...</strong></p>
                <textarea value={bulkText} onChange={e => setBulkText(e.target.value)} placeholder={"Bar | Birra | 4.00 | 50 | Bionda | Rossa\nCucina | Panino | 5.50 | 100"} className="w-full h-48 bg-surface-container-high border-outline-variant border rounded-lg p-3 font-mono text-sm" />
                <div className="flex gap-4 justify-end">
                  <button type="button" onClick={() => setShowAddModal(false)} className="px-6 py-3 font-bold text-neutral hover:bg-surface-container-high rounded-xl">Annulla</button>
                  <button onClick={handleAddBulkText} className="px-8 py-3 font-bold bg-tertiary text-on-tertiary rounded-xl shadow-md hover:brightness-110 flex items-center gap-2">
                    <span className="material-symbols-outlined">playlist_add</span> Inserisci Multipli
                  </button>
                </div>
              </div>
            )}
            {addMode === "CSV" && (
              <div className="flex flex-col gap-4 items-center justify-center h-48 border-2 border-dashed border-outline-variant rounded-xl relative group">
                <span className="material-symbols-outlined text-4xl text-neutral group-hover:text-primary transition-colors">upload_file</span>
                <p className="font-bold text-neutral group-hover:text-primary transition-colors">Clicca per selezionare un file CSV</p>
                <input type="file" accept=".csv,.txt" onChange={handleFileUpload} className="absolute inset-0 opacity-0 cursor-pointer" />
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Modal Aggiungi Stampante ── */}
      {showPrinterModal && (
        <div className="absolute inset-0 bg-secondary/80 backdrop-blur-sm z-50 flex items-center justify-center p-6">
          <div className="bg-surface-container-lowest rounded-3xl p-8 max-w-md w-full shadow-2xl flex flex-col gap-5">
            <div className="flex justify-between items-center pb-4 border-b border-outline-variant/30">
              <h2 className="font-headline-lg text-[22px] font-black text-on-background">Aggiungi Stampante</h2>
              <button onClick={() => setShowPrinterModal(null)} className="text-neutral hover:text-error bg-surface-container-high rounded-full p-2"><span className="material-symbols-outlined">close</span></button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-bold text-neutral mb-1 block">Nome</label>
                <input type="text" value={newPrinter.name} onChange={e => setNewPrinter(p => ({ ...p, name: e.target.value }))} className="w-full bg-surface-container-high border border-outline-variant rounded-lg p-2 text-sm" />
              </div>
              <div>
                <label className="text-xs font-bold text-neutral mb-1 block">Ruolo</label>
                <select value={newPrinter.role} onChange={e => setNewPrinter(p => ({ ...p, role: e.target.value }))} className="w-full bg-surface-container-high border border-outline-variant rounded-lg p-2 text-sm appearance-none">
                  <option value="CASHIER">Scontrino Cassa</option>
                  <option value="KITCHEN">Cucina</option>
                  <option value="BAR">Bar</option>
                  <option value="PREP">Preparazione (generico)</option>
                </select>
              </div>
            </div>
            <div>
              <label className="text-xs font-bold text-neutral mb-1 block">Tipo Connessione</label>
              <div className="flex gap-2">
                {["USB", "NETWORK"].map(t => (
                  <button key={t} type="button" onClick={() => setNewPrinter(p => ({ ...p, type: t }))} className={`flex-1 py-2 rounded-lg font-bold text-sm border ${newPrinter.type === t ? "bg-primary text-on-primary border-primary" : "bg-surface-container-high border-outline-variant text-neutral"}`}>
                    {t === "USB" ? "🔌 USB" : "🌐 Rete (IP)"}
                  </button>
                ))}
              </div>
            </div>
            {newPrinter.type === "USB" ? (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-neutral mb-1 block">Vendor ID (hex)</label>
                  <input type="text" placeholder="es. 1FC9" value={newPrinter.usbVendorId} onChange={e => setNewPrinter(p => ({ ...p, usbVendorId: e.target.value }))} className="w-full bg-surface-container-high border border-outline-variant rounded-lg p-2 font-mono text-sm" />
                </div>
                <div>
                  <label className="text-xs font-bold text-neutral mb-1 block">Product ID (hex)</label>
                  <input type="text" placeholder="es. 2016" value={newPrinter.usbProductId} onChange={e => setNewPrinter(p => ({ ...p, usbProductId: e.target.value }))} className="w-full bg-surface-container-high border border-outline-variant rounded-lg p-2 font-mono text-sm" />
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <label className="text-xs font-bold text-neutral mb-1 block">Indirizzo IP</label>
                  <input type="text" placeholder="192.168.1.100" value={newPrinter.networkHost} onChange={e => setNewPrinter(p => ({ ...p, networkHost: e.target.value }))} className="w-full bg-surface-container-high border border-outline-variant rounded-lg p-2 text-sm" />
                </div>
                <div>
                  <label className="text-xs font-bold text-neutral mb-1 block">Porta</label>
                  <input type="number" value={newPrinter.networkPort} onChange={e => setNewPrinter(p => ({ ...p, networkPort: e.target.value }))} className="w-full bg-surface-container-high border border-outline-variant rounded-lg p-2 text-sm" />
                </div>
              </div>
            )}
            <div className="flex gap-3 justify-end pt-2 border-t border-outline-variant/30">
              <button onClick={() => setShowPrinterModal(null)} className="px-5 py-2 font-bold text-neutral hover:bg-surface-container-high rounded-xl">Annulla</button>
              <button onClick={handleAddPrinter} className="px-6 py-2 font-bold bg-primary text-on-primary rounded-xl shadow-md hover:brightness-110">Salva Stampante</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Sidebar ── */}
      <aside className="bg-surface-container-lowest border-r border-outline-variant hidden md:flex flex-col h-full py-section-padding docked left-0 w-64 z-40 shrink-0 shadow-sm">
        <div className="px-6 mb-8">
          <div className="font-headline-lg text-[32px] font-black text-primary uppercase tracking-tighter mb-1">SagraPOS</div>
          <div className="text-xs font-bold text-neutral mb-4">{eventName}</div>
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-tertiary-container flex items-center justify-center text-tertiary">
              <span className="material-symbols-outlined text-[28px]">admin_panel_settings</span>
            </div>
            <div>
              <div className="font-label-lg text-[16px] font-bold text-on-background">Amministrazione</div>
              <ConnectionBadge status={connStatus} />
            </div>
          </div>
        </div>
        <nav className="flex-1 px-4 space-y-2 overflow-y-auto no-scrollbar">
          <Link href="/" className="w-full flex items-center gap-3 text-neutral hover:text-primary hover:bg-primary-container/30 rounded-xl px-4 py-3 transition-all font-bold">
            <span className="material-symbols-outlined">restaurant</span>
            <span className="font-label-lg text-[15px]">POS Vendita</span>
          </Link>
          <button className="w-full flex items-center gap-3 bg-primary text-on-primary rounded-xl px-4 py-3 shadow-md font-bold">
            <span className="material-symbols-outlined">admin_panel_settings</span>
            <span className="font-label-lg text-[15px]">Amministrazione</span>
          </button>
        </nav>
      </aside>

      {/* ── Main Content ── */}
      <main className="flex-1 flex flex-col h-screen overflow-hidden bg-surface">
        <div className="flex-1 overflow-y-auto p-margin-page space-y-8">
          <div className="flex justify-between items-end mb-4">
            <div>
              <h2 className="font-headline-lg text-[42px] font-black text-on-background tracking-tight">Dashboard</h2>
              <p className="font-body-md text-[18px] text-neutral mt-1">Riepilogo in tempo reale · {eventName}</p>
            </div>
          </div>

          {/* Tab navigation */}
          <div className="flex gap-1 border-b border-outline-variant/30 pb-0 mb-4 overflow-x-auto">
            {(["CASSA", "STORICO", "CATALOGO", "IMPOSTAZIONI", "SETUP"] as AdminTab[]).map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`font-bold text-base px-4 py-2 rounded-t-xl transition-colors whitespace-nowrap ${activeTab === tab ? "bg-primary/10 text-primary border-b-2 border-primary" : "text-neutral hover:bg-surface-container-high"}`}
              >
                {tab === "CASSA" ? "Resoconto Cassa" : tab === "STORICO" ? "Storico & Storni" : tab === "CATALOGO" ? "Catalogo" : tab === "IMPOSTAZIONI" ? "Stampa" : "⚙️ Setup"}
              </button>
            ))}
          </div>

          {/* ── TAB: CASSA ── */}
          {activeTab === "CASSA" && (
            <>
              {sessionData && (
                <div className="mb-4 flex items-center gap-4 bg-surface-container-high p-4 rounded-2xl">
                  <span className="font-bold text-neutral">Vista Resoconto:</span>
                  <select value={reportStationId} onChange={e => setReportStationId(e.target.value)} className="bg-surface-container-lowest border border-outline-variant p-2 rounded-lg font-bold">
                    <option value="">GLOBALE (Tutte le casse)</option>
                    {allStations.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
              )}
              {sessionData ? (
                <div className="flex gap-6">
                  <div className="flex-1 flex flex-col gap-6">
                    <div className="grid grid-cols-4 gap-4">
                      <div className="bg-surface-container-lowest border border-outline-variant rounded-2xl p-4 shadow-sm">
                        <div className="text-xs text-neutral font-bold mb-1">APERTURA CASSA</div>
                        <div className="text-[14px] font-black text-on-background">{new Date(sessionData.openedAt).toLocaleString("it-IT")}</div>
                      </div>
                      <div className="bg-surface-container-lowest border border-outline-variant rounded-2xl p-4 shadow-sm">
                        <div className="text-xs text-neutral font-bold mb-1">N° ORDINI</div>
                        <div className="text-lg font-black text-on-background">{sessionData.orderCount}</div>
                      </div>
                      <div className="bg-surface-container-lowest border border-outline-variant rounded-2xl p-4 shadow-sm">
                        <div className="text-xs text-neutral font-bold mb-1">SCONTI EROGATI</div>
                        <div className="text-lg font-black text-error">€{sessionData.totalDiscount.toFixed(2)}</div>
                      </div>
                      <div className="bg-primary-container border border-primary/20 rounded-2xl p-4 shadow-sm">
                        <div className="text-xs text-primary font-bold mb-1">INCASSO NETTO</div>
                        <div className="text-2xl font-black text-primary">€{sessionData.totalNet.toFixed(2)}</div>
                        <div className="text-[10px] text-primary/70 mt-1">Lordo: €{sessionData.totalGross.toFixed(2)}</div>
                      </div>
                    </div>

                    {/* Metodi pagamento */}
                    {sessionData.paymentBreakdown && (
                      <div className="grid grid-cols-2 gap-4">
                        <div className="bg-surface-container-lowest border border-outline-variant rounded-2xl p-4 shadow-sm">
                          <div className="text-xs text-neutral font-bold mb-1">💵 CONTANTI</div>
                          <div className="text-xl font-black text-on-background">€{(sessionData.paymentBreakdown.CASH || 0).toFixed(2)}</div>
                        </div>
                        <div className="bg-surface-container-lowest border border-outline-variant rounded-2xl p-4 shadow-sm">
                          <div className="text-xs text-neutral font-bold mb-1">💳 CARTA</div>
                          <div className="text-xl font-black text-on-background">€{(sessionData.paymentBreakdown.CARD || 0).toFixed(2)}</div>
                        </div>
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-6">
                      <div className="bg-surface-container-lowest border border-outline-variant rounded-3xl p-6 shadow-sm">
                        <h3 className="font-bold text-lg mb-4 flex items-center gap-2"><span className="material-symbols-outlined text-primary">category</span> Totali per Reparto</h3>
                        <div className="flex flex-col gap-3">
                          {Object.entries(sessionData.categoryBreakdown).map(([cat, amount]: any) => (
                            <div key={cat} className="flex justify-between items-center border-b border-outline-variant/30 pb-2">
                              <span className="font-bold text-sm text-on-background">{cat}</span>
                              <span className="font-black text-primary">€{amount.toFixed(2)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                      <div className="bg-surface-container-lowest border border-outline-variant rounded-3xl p-6 shadow-sm overflow-y-auto max-h-[400px]">
                        <h3 className="font-bold text-lg mb-4 flex items-center gap-2"><span className="material-symbols-outlined text-primary">inventory_2</span> Quantità Vendute</h3>
                        <div className="flex flex-col gap-2">
                          {Object.entries(sessionData.productStats).map(([prod, stat]: any) => (
                            <div key={prod} className="flex justify-between items-center bg-surface-container-high rounded-lg p-2 px-3">
                              <span className="text-sm font-bold truncate max-w-[200px]">{prod}</span>
                              <div className="flex gap-4 items-center">
                                <span className="text-sm text-neutral font-mono">x{stat.qty}</span>
                                <span className="text-sm font-black text-on-background">€{stat.total.toFixed(2)}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Azioni cassa */}
                  <div className="w-[280px] shrink-0 bg-surface-container-lowest border border-outline-variant rounded-3xl p-6 shadow-sm flex flex-col gap-4">
                    <h3 className="font-black text-lg mb-2">Azioni di Cassa</h3>
                    <p className="text-xs text-neutral">La Lettura X stampa un resoconto parziale senza azzerare nulla.</p>
                    <button onClick={printReportX} className="bg-surface-container-high text-on-background font-bold px-4 py-3 rounded-xl border border-outline-variant hover:brightness-95 flex justify-center items-center gap-2">
                      <span className="material-symbols-outlined text-sm">receipt_long</span> Stampa Lettura X
                    </button>
                    <button onClick={exportCSV} className="bg-surface-container-high text-on-background font-bold px-4 py-3 rounded-xl border border-outline-variant hover:brightness-95 flex justify-center items-center gap-2">
                      <span className="material-symbols-outlined text-sm">download</span> Esporta CSV (Excel)
                    </button>
                    <div className="w-full h-px bg-outline-variant/50 my-2" />
                    <p className="text-xs text-error">La Chiusura Z azzera la cassa e archivia la sessione.</p>
                    <button onClick={closeSessionZ} className="bg-error text-white font-bold px-4 py-4 rounded-xl shadow-md hover:brightness-110 flex flex-col justify-center items-center gap-1">
                      <span className="material-symbols-outlined">point_of_sale</span>
                      <span>Azzera e Chiudi (Z)</span>
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-center h-48 text-neutral">
                  <p>Nessuna sessione attiva trovata.</p>
                </div>
              )}
            </>
          )}

          {/* ── TAB: STORICO ── */}
          {activeTab === "STORICO" && (
            <div className="bg-surface-container-lowest border border-outline-variant rounded-3xl p-6 shadow-sm flex flex-col gap-6">
              <div className="flex justify-between items-center border-b border-outline-variant/30 pb-4">
                <h3 className="font-headline-lg text-[24px] font-black text-on-background">Storico Ordini</h3>
                <div className="flex items-center gap-4">
                  <input type="text" placeholder="Ricerca..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="bg-surface-container-high border border-outline-variant rounded-lg p-2 text-sm w-[250px]" />
                  <input type="date" value={historyDate} onChange={e => setHistoryDate(e.target.value)} className="bg-surface-container-high border border-outline-variant rounded-lg p-2 font-mono text-sm" />
                  <button onClick={() => fetchHistory()} className="bg-surface-container-high border border-outline-variant px-3 py-2 rounded-lg text-sm font-bold hover:brightness-95"><span className="material-symbols-outlined text-sm">refresh</span></button>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-surface-container-high">
                    <tr>
                      <th className="p-3 font-bold text-neutral">ID / Ora</th>
                      <th className="p-3 font-bold text-neutral w-1/2">Articoli</th>
                      <th className="p-3 font-bold text-neutral">Totale</th>
                      <th className="p-3 font-bold text-neutral">Stato</th>
                      <th className="p-3 font-bold text-neutral text-right">Azioni</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-outline-variant/30">
                    {filteredOrders.map((o: any) => (
                      <tr key={o.id} className={`transition-colors ${o.status === "STORNATO" ? "bg-error/5 opacity-70" : "hover:bg-surface-container-low"}`}>
                        <td className="p-3">
                          <div className="font-mono font-bold">#{o.orderNumber}</div>
                          <div className="text-xs text-neutral">{new Date(o.createdAt).toLocaleTimeString("it-IT")}</div>
                          {o.customerName && <div className="text-[10px] bg-tertiary-container text-on-tertiary-container rounded px-1 mt-1 inline-block font-bold">{o.customerName}</div>}
                        </td>
                        <td className="p-3">
                          <button onClick={() => setExpandedOrder(expandedOrder === o.id ? null : o.id)} className="text-xs text-primary font-bold hover:underline mb-1">
                            {expandedOrder === o.id ? "Nascondi" : "Dettagli / Ristampa"}
                          </button>
                          <div className="flex flex-col gap-1">
                            {o.items.map((i: any, idx: number) => (
                              <div key={idx} className="text-xs flex justify-between items-center group">
                                <div><span className="font-bold">{i.quantity}x</span> {i.product.name} {i.variantName ? `(${i.variantName})` : ""}</div>
                                {expandedOrder === o.id && (
                                  <button onClick={() => ristampaSingolo(o.id, i.id)} className="bg-surface-container-highest px-2 py-[2px] rounded text-[10px] font-bold text-neutral opacity-0 group-hover:opacity-100 transition-opacity">Ristampa</button>
                                )}
                              </div>
                            ))}
                          </div>
                        </td>
                        <td className="p-3 font-black text-primary">€{o.totalAmount.toFixed(2)}</td>
                        <td className="p-3">
                          <span className={`text-[10px] px-2 py-1 rounded-md font-bold ${o.status === "STORNATO" ? "bg-error text-white" : o.status === "PENDING" ? "bg-tertiary-container text-tertiary" : "bg-success/20 text-success"}`}>{o.status}</span>
                        </td>
                        <td className="p-3 text-right">
                          <div className="flex flex-col gap-2 items-end">
                            <button onClick={() => ristampaTotale(o.id)} className="bg-surface-container-high text-on-background px-3 py-1 rounded-lg font-bold text-xs hover:brightness-95 flex items-center gap-1">
                              <span className="material-symbols-outlined text-[14px]">print</span> Ristampa
                            </button>
                            {o.status !== "STORNATO" && (
                              <button onClick={() => stornareOrdine(o.id)} className="bg-error/10 text-error hover:bg-error hover:text-white px-3 py-1 rounded-lg font-bold text-xs transition-colors">Storna</button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                    {filteredOrders.length === 0 && (
                      <tr><td colSpan={5} className="p-8 text-center text-neutral font-bold">Nessun ordine trovato per questa data.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── TAB: CATALOGO ── */}
          {activeTab === "CATALOGO" && (
            <>
              <div className="flex justify-between items-center pt-6">
                <h3 className="font-headline-lg text-[28px] font-black text-on-background">Gestione Catalogo</h3>
                <div className="flex gap-3">
                  <button onClick={() => setShowCategoriesModal(true)} className="bg-surface-container-high text-on-background border border-outline-variant px-6 py-3 rounded-xl font-bold flex items-center gap-2 shadow-sm hover:brightness-95">
                    <span className="material-symbols-outlined">category</span> Categorie
                  </button>
                  <button onClick={() => setShowAddModal(true)} className="bg-primary text-on-primary px-6 py-3 rounded-xl font-bold flex items-center gap-2 shadow-md hover:brightness-110">
                    <span className="material-symbols-outlined">add</span> Nuovo Prodotto
                  </button>
                </div>
              </div>
              <div className="bg-surface-container-lowest rounded-3xl shadow-sm border border-outline-variant overflow-hidden">
                <table className="w-full text-left">
                  <thead className="bg-surface-container-high">
                    <tr>
                      <th className="p-4 font-label-lg text-neutral">Prodotto</th>
                      <th className="p-4 font-label-lg text-neutral">Categoria</th>
                      <th className="p-4 font-label-lg text-neutral">Prezzo</th>
                      <th className="p-4 font-label-lg text-neutral">Stock</th>
                      <th className="p-4 font-label-lg text-neutral">Varianti</th>
                      <th className="p-4 font-label-lg text-neutral text-right">Azioni</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-outline-variant/30">
                    {products.map(p => (
                      <tr key={p.id} className={`hover:bg-surface-container-low transition-colors ${!p.available ? "opacity-50" : ""}`}>
                        <td className="p-4 font-body-lg font-bold text-on-background">
                          {p.name}
                          {(p as any).isCombo && <span className="ml-2 text-[10px] bg-tertiary-container text-tertiary px-1.5 py-0.5 rounded font-bold">COMBO</span>}
                          {!p.available && <span className="ml-2 text-[10px] bg-error/20 text-error px-1.5 py-0.5 rounded font-bold">NON DISP.</span>}
                        </td>
                        <td className="p-4 text-sm text-neutral">{(p as any).category?.name || "-"}</td>
                        <td className="p-4 font-body-lg text-primary font-bold">€{p.price.toFixed(2)}</td>
                        <td className="p-4">
                          <span className={`px-3 py-1 rounded-full font-bold text-sm ${(p.stock ?? 0) > 10 ? "bg-success/20 text-success" : (p.stock ?? 0) > 0 ? "bg-primary-container text-primary" : "bg-error/20 text-error"}`}>
                            {p.stock} pz
                          </span>
                        </td>
                        <td className="p-4 text-neutral font-medium text-sm">{p.variants?.length ? p.variants.map((v: any) => v.name).join(", ") : "-"}</td>
                        <td className="p-4 text-right flex gap-2 justify-end">
                          <button onClick={() => setEditingProduct(p)} className="bg-tertiary-container text-tertiary hover:bg-tertiary hover:text-white px-4 py-2 rounded-lg font-bold flex items-center gap-2 transition-colors">
                            <span className="material-symbols-outlined text-sm">edit</span> Modifica
                          </button>
                          <button onClick={() => handleDeleteProduct(p.id)} className="bg-error/10 text-error hover:bg-error hover:text-white px-3 py-2 rounded-lg font-bold flex items-center justify-center transition-colors">
                            <span className="material-symbols-outlined text-sm">delete</span>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* ── TAB: IMPOSTAZIONI ── */}
          {activeTab === "IMPOSTAZIONI" && (
            <div className="flex flex-col lg:flex-row gap-6">
              <div className="flex-1 bg-surface-container-lowest p-6 rounded-3xl shadow-sm border border-outline-variant flex flex-col gap-6">
                <div className="flex justify-between items-center border-b border-outline-variant/30 pb-4">
                  <div>
                    <h3 className="font-headline-lg text-[24px] font-black text-on-background">Personalizzazione Scontrini & Comande</h3>
                    <p className="text-xs text-neutral">Configura logo, grafiche, testi e opzioni di stampa per la stampante termica 80mm</p>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => applyPreset("ECO")} className="text-[12px] font-bold bg-surface-container-highest px-3 py-1 rounded-md hover:brightness-95">🌱 Eco</button>
                    <button onClick={() => applyPreset("RESTO")} className="text-[12px] font-bold bg-surface-container-highest px-3 py-1 rounded-md hover:brightness-95">🍽️ Sagra / Ristorante</button>
                    <button onClick={() => applyPreset("BAR")} className="text-[12px] font-bold bg-surface-container-highest px-3 py-1 rounded-md hover:brightness-95">🍺 Solo Bar</button>
                  </div>
                </div>

                {/* ── Sezione Immagini PNG ── */}
                <div className="bg-surface-container-high p-5 rounded-2xl border border-primary/20">
                  <h4 className="font-bold text-[16px] text-primary mb-2 flex items-center gap-2">
                    <span className="material-symbols-outlined text-[20px]">image</span> Logo e Grafiche Personalizzate (Formato PNG)
                  </h4>
                  <p className="text-xs text-neutral mb-4">
                    Carica le immagini in formato PNG (consigliate in bianco e nero o monocromatiche ad alto contrasto per la stampa termica).
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Logo Testata */}
                    <div className="bg-surface-container-lowest p-4 rounded-xl border border-outline-variant flex flex-col items-center text-center">
                      <span className="text-xs font-bold text-neutral uppercase tracking-wider mb-2">Logo Testata Scontrino (In Alto)</span>
                      {settings.headerLogoBase64 ? (
                        <div className="flex flex-col items-center gap-2 w-full">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={settings.headerLogoBase64} alt="Logo Testata" className="max-h-20 max-w-full object-contain p-2 bg-white rounded-lg border border-outline-variant" />
                          <div className="flex gap-2 mt-1">
                            <label className="text-xs bg-surface-container-highest px-3 py-1.5 rounded-lg font-bold cursor-pointer hover:bg-outline-variant transition-colors">
                              Sostituisci
                              <input type="file" accept="image/png,image/*" onChange={e => handleLogoUpload(e, 'headerLogoBase64')} className="hidden" />
                            </label>
                            <button onClick={() => removeLogo('headerLogoBase64')} className="text-xs bg-error/10 text-error hover:bg-error hover:text-white px-3 py-1.5 rounded-lg font-bold transition-colors">
                              Rimuovi
                            </button>
                          </div>
                        </div>
                      ) : (
                        <label className="w-full flex flex-col items-center justify-center p-5 border-2 border-dashed border-outline-variant hover:border-primary rounded-xl cursor-pointer transition-colors bg-background/50">
                          <span className="material-symbols-outlined text-3xl text-neutral mb-1">upload_file</span>
                          <span className="text-xs font-bold text-primary">Carica Logo Testata (PNG)</span>
                          <span className="text-[10px] text-neutral mt-0.5">Larghezza ideale: 384-512px</span>
                          <input type="file" accept="image/png,image/*" onChange={e => handleLogoUpload(e, 'headerLogoBase64')} className="hidden" />
                        </label>
                      )}
                    </div>

                    {/* Grafica Piè di Pagina */}
                    <div className="bg-surface-container-lowest p-4 rounded-xl border border-outline-variant flex flex-col items-center text-center">
                      <span className="text-xs font-bold text-neutral uppercase tracking-wider mb-2">Grafica Piè di Pagina (In Basso)</span>
                      {settings.footerLogoBase64 ? (
                        <div className="flex flex-col items-center gap-2 w-full">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={settings.footerLogoBase64} alt="Grafica Footer" className="max-h-20 max-w-full object-contain p-2 bg-white rounded-lg border border-outline-variant" />
                          <div className="flex gap-2 mt-1">
                            <label className="text-xs bg-surface-container-highest px-3 py-1.5 rounded-lg font-bold cursor-pointer hover:bg-outline-variant transition-colors">
                              Sostituisci
                              <input type="file" accept="image/png,image/*" onChange={e => handleLogoUpload(e, 'footerLogoBase64')} className="hidden" />
                            </label>
                            <button onClick={() => removeLogo('footerLogoBase64')} className="text-xs bg-error/10 text-error hover:bg-error hover:text-white px-3 py-1.5 rounded-lg font-bold transition-colors">
                              Rimuovi
                            </button>
                          </div>
                        </div>
                      ) : (
                        <label className="w-full flex flex-col items-center justify-center p-5 border-2 border-dashed border-outline-variant hover:border-primary rounded-xl cursor-pointer transition-colors bg-background/50">
                          <span className="material-symbols-outlined text-3xl text-neutral mb-1">wallpaper</span>
                          <span className="text-xs font-bold text-primary">Carica Grafica Piè di Pagina (PNG)</span>
                          <span className="text-[10px] text-neutral mt-0.5">Es. silhouette, skyline o sponsor</span>
                          <input type="file" accept="image/png,image/*" onChange={e => handleLogoUpload(e, 'footerLogoBase64')} className="hidden" />
                        </label>
                      )}
                    </div>
                  </div>
                </div>

                {/* ── Sezione A: Testata Scontrino ── */}
                <div className="bg-surface-container-high p-4 rounded-xl">
                  <h4 className="font-bold text-[16px] text-primary mb-3">A) Testata e Indirizzo</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
                    <div>
                      <label className="text-xs text-neutral block mb-1">Nome / Titolo Evento (se non usi logo PNG)</label>
                      <input type="text" placeholder="es. CAVAGLIO SOTTO LE STELLE" value={settings.headerName} onChange={e => setSettings(s => ({ ...s, headerName: e.target.value }))} className="w-full bg-surface-container-lowest border border-outline-variant rounded p-2 text-sm font-bold" />
                    </div>
                    <div>
                      <label className="text-xs text-neutral block mb-1">Sottotitolo / Indirizzo / Località (su 2 righe)</label>
                      <textarea rows={2} placeholder="AREA FESTE · VIA ASILO&#10;CAVAGLIO D'AGOGNA (NO)" value={settings.headerSubtitle} onChange={e => setSettings(s => ({ ...s, headerSubtitle: e.target.value }))} className="w-full bg-surface-container-lowest border border-outline-variant rounded p-2 text-sm leading-tight" />
                    </div>
                    <div>
                      <label className="text-xs text-neutral block mb-1">P.IVA / Codice Fiscale (opzionale)</label>
                      <input type="text" placeholder="P.IVA..." value={settings.headerVat} onChange={e => setSettings(s => ({ ...s, headerVat: e.target.value }))} className="w-full bg-surface-container-lowest border border-outline-variant rounded p-2 text-sm" />
                    </div>
                    <div>
                      <label className="text-xs text-neutral block mb-1">Telefono / Recapito (opzionale)</label>
                      <input type="text" placeholder="Tel..." value={settings.headerPhone} onChange={e => setSettings(s => ({ ...s, headerPhone: e.target.value }))} className="w-full bg-surface-container-lowest border border-outline-variant rounded p-2 text-sm" />
                    </div>
                  </div>
                </div>

                {/* ── Sezione B: Corpo Scontrino ── */}
                <div className="bg-surface-container-high p-4 rounded-xl">
                  <h4 className="font-bold text-[16px] text-primary mb-3">B) Corpo Scontrino e Opzioni</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="text-xs text-neutral block mb-1">Dimensione Carattere (Font)</label>
                      <select value={settings.bodyFont || 'b'} onChange={e => setSettings(s => ({ ...s, bodyFont: e.target.value }))} className="w-full bg-surface-container-lowest border border-outline-variant rounded p-2 text-sm font-bold">
                        <option value="b">Compatto / Piccolo (Font B - Salva Carta Consigliato)</option>
                        <option value="a">Standard (Font A - 32 Colonne)</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-xs text-neutral block mb-1">Formato Data</label>
                      <select value={settings.dateFormat} onChange={e => setSettings(s => ({ ...s, dateFormat: e.target.value }))} className="w-full bg-surface-container-lowest border border-outline-variant rounded p-2 text-sm">
                        <option value="FULL">Data e Ora complete (GG/MM/AAAA HH:MM)</option>
                        <option value="SHORT">Solo Ora (HH:MM)</option>
                      </select>
                    </div>
                    <label className="flex items-center gap-2 text-sm cursor-pointer md:col-span-2">
                      <input type="checkbox" checked={settings.showChangeAndDiscount} onChange={e => setSettings(s => ({ ...s, showChangeAndDiscount: e.target.checked }))} className="accent-primary" /> Mostra colonna PREZZO e subtotali
                    </label>
                  </div>
                </div>

                {/* ── Sezione C: Talloncini Comanda ── */}
                <div className="bg-surface-container-high p-4 rounded-xl">
                  <h4 className="font-bold text-[16px] text-primary mb-3">C) Talloncini Comanda per Articolo (Salva-Carta)</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
                    <div>
                      <label className="text-xs text-neutral block mb-1">Frase di Augurio Finale (opzionale)</label>
                      <input type="text" placeholder="Es. Buona Sagra! ★ (lascia vuoto per non stampare)" value={settings.comandaGreeting || ''} onChange={e => setSettings(s => ({ ...s, comandaGreeting: e.target.value }))} className="w-full bg-surface-container-lowest border border-outline-variant rounded p-2 text-sm font-bold" />
                    </div>
                    <div>
                      <label className="text-xs text-neutral block mb-1">Dimensione Nome Articolo</label>
                      <select value={settings.prepItemSize} onChange={e => setSettings(s => ({ ...s, prepItemSize: e.target.value }))} className="w-full bg-surface-container-lowest border border-outline-variant rounded p-2 text-sm font-bold">
                        <option value="DOUBLE_HEIGHT">Doppia Altezza (Consigliato)</option>
                        <option value="GIANT">Gigante</option>
                        <option value="NORMAL">Normale</option>
                      </select>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
                    <label className="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" checked={settings.comandaShowHeader} onChange={e => setSettings(s => ({ ...s, comandaShowHeader: e.target.checked }))} className="accent-primary" /> Stampa intestazione in cima al talloncino</label>
                    <label className="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" checked={settings.comandaShowPrice} onChange={e => setSettings(s => ({ ...s, comandaShowPrice: e.target.checked }))} className="accent-primary" /> Stampa il prezzo a lato del nome articolo</label>
                    <label className="flex items-center gap-2 text-sm cursor-pointer md:col-span-2"><input type="checkbox" checked={!!settings.comandaShowGreeting} onChange={e => setSettings(s => ({ ...s, comandaShowGreeting: e.target.checked }))} className="accent-primary" /> Stampa frase di augurio sul talloncino (deseleziona per risparmiare carta)</label>
                  </div>
                </div>

                {/* ── Sezione D: Piè di Pagina Scontrino ── */}
                <div className="bg-surface-container-high p-4 rounded-xl">
                  <h4 className="font-bold text-[16px] text-primary mb-3">D) Ringraziamento e Piè di Pagina Scontrino</h4>
                  <div className="flex flex-col gap-3">
                    <div>
                      <label className="text-xs text-neutral block mb-1">Messaggio di Ringraziamento</label>
                      <textarea rows={2} value={settings.footerText} onChange={e => setSettings(s => ({ ...s, footerText: e.target.value }))} placeholder="GRAZIE&#10;PER AVER SCELTO LA NOSTRA SAGRA!" className="w-full bg-surface-container-lowest border border-outline-variant rounded p-2 text-sm h-16" />
                    </div>
                  </div>
                </div>

                {/* ── Sezione E: Stampa nei Distretti ── */}
                <div className="bg-surface-container-high p-4 rounded-xl border-2 border-primary/20">
                  <h4 className="font-bold text-[16px] text-primary mb-2 flex items-center gap-2">
                    <span className="material-symbols-outlined text-[20px]">storefront</span> E) Stampa nei Distretti / Reparti (Cucina, Bar)
                  </h4>
                  <p className="text-xs text-neutral mb-3">
                    Scegli se inviare le comande alle stampanti dei singoli reparti remoti oppure stampare tutto solo alla cassa.
                  </p>
                  <label className="flex items-start gap-3 text-sm cursor-pointer p-3 bg-surface-container-lowest rounded-xl border border-outline-variant hover:border-primary transition-colors">
                    <input
                      type="checkbox"
                      checked={settings.printToDepartments}
                      onChange={e => setSettings(s => ({ ...s, printToDepartments: e.target.checked }))}
                      className="w-5 h-5 mt-0.5 accent-primary cursor-pointer"
                    />
                    <div>
                      <div className="font-bold text-on-background">
                        Invia copia comanda alle stampanti dei singoli distretti (Cucina, Bar)
                      </div>
                      <div className="text-xs text-neutral mt-1 leading-relaxed">
                        {settings.printToDepartments ? (
                          <span className="text-primary font-medium">
                            ✓ <strong>ABILITATO</strong>: Ogni ordine stampa alla cassa e in più invia un secondo biglietto alle stampanti collegate nei singoli reparti (cucina/bar).
                          </span>
                        ) : (
                          <span className="text-success font-medium">
                            ✓ <strong>DISABILITATO (Consigliato)</strong>: Quando invii la stampa, la cassa emette il biglietto riepilogativo per il cliente e il biglietto per ciascun articolo. Nessun doppio biglietto inviato ai distretti.
                          </span>
                        )}
                      </div>
                    </div>
                  </label>
                </div>

                <div className="pt-2 border-t border-outline-variant/30 flex justify-end gap-3">
                  <button onClick={printTest} className="bg-tertiary text-on-tertiary px-6 py-3 rounded-xl font-bold shadow-sm hover:brightness-110">Stampa di Prova</button>
                  <button onClick={saveSettings} className="bg-primary text-on-primary px-8 py-3 rounded-xl font-bold shadow-md hover:brightness-110">Salva Configurazione</button>
                </div>
              </div>

              {/* ── Anteprima scontrino fedele al print-agent compatto ── */}
              <div className="w-full lg:w-[350px] shrink-0 bg-surface-container-highest p-6 rounded-3xl shadow-inner border border-outline-variant flex flex-col">
                <h4 className="font-bold text-sm text-neutral mb-3 uppercase tracking-widest text-center flex items-center justify-center gap-1">
                  <span className="material-symbols-outlined text-[18px]">receipt</span> Anteprima Live Compatta
                </h4>

                <div className="space-y-4 overflow-y-auto max-h-[850px] pr-1">
                  {/* Scontrino Cliente Compatto */}
                  <div className="bg-white text-black p-4 rounded-xl font-mono text-[10.5px] shadow-md border border-neutral/20 leading-tight">
                    {/* Header Evento */}
                    {settings.headerLogoBase64 && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={settings.headerLogoBase64} alt="Logo" className="max-h-12 mx-auto my-1 object-contain" />
                    )}
                    <div className="text-center font-bold text-[12.5px] tracking-wide my-0.5">{settings.headerName || "SAGRA"}</div>

                    {(settings.headerSubtitle || settings.headerAddress) && (
                      <div className="text-center text-[9.5px] text-neutral/80">
                        {(settings.headerSubtitle || settings.headerAddress).split('\n').map((l, idx) => <div key={idx}>{l}</div>)}
                      </div>
                    )}
                    {settings.headerVat && <div className="text-center text-[9px] text-neutral/80">P.IVA: {settings.headerVat}</div>}
                    {settings.headerPhone && <div className="text-center text-[9px] text-neutral/80">Tel: {settings.headerPhone}</div>}
                    <div className="text-center text-neutral/40 select-none text-[10px] my-1">--------------------------------</div>

                    {/* Intestazione Tabella */}
                    <div className="flex justify-between text-[10px] font-bold text-neutral/70">
                      <span>DESCRIZIONE</span>
                      <span>PREZZO</span>
                    </div>
                    <div className="text-center text-neutral/40 select-none text-[10px] -my-1">--------------------------------</div>

                    {/* Righe Articoli */}
                    <div className="space-y-0.5 text-[10px] my-1">
                      <div className="flex justify-between items-baseline">
                        <span>1x CAFFE ESPRESSO</span>
                        <span>1,20</span>
                      </div>
                      <div className="flex justify-between items-baseline">
                        <span>1x CAPPUCCINO</span>
                        <span>1,80</span>
                      </div>
                      <div className="flex justify-between items-baseline">
                        <span>2x PANINO SALAMINA</span>
                        <span>10,00</span>
                      </div>
                    </div>

                    <div className="text-center text-neutral/40 select-none text-[10px] -my-1">--------------------------------</div>

                    {/* Totale */}
                    <div className="flex justify-between items-baseline font-black text-[12.5px] my-1">
                      <span>TOTALE</span>
                      <span>E 13,00</span>
                    </div>

                    <div className="text-center text-neutral/40 select-none text-[10px] -my-1">--------------------------------</div>

                    {/* Pagamento */}
                    <div className="flex justify-between items-baseline text-[10px] my-1">
                      <span>PAGAMENTO: CONTANTI</span>
                      <span>E 13,00</span>
                    </div>

                    <div className="text-center text-neutral/40 select-none text-[10px] -my-1">--------------------------------</div>

                    {/* Dati Ordine Compatti (Niente N.DOC, Cassa o Asporto) */}
                    <div className="flex justify-between text-[9px] text-neutral/80 my-1 font-bold">
                      <span>ORDINE #0042</span>
                      <span>07/09/2026 15:20</span>
                    </div>

                    {/* Ringraziamento */}
                    {settings.footerText && (
                      <>
                        <div className="text-center text-neutral/40 select-none text-[10px] -my-1">--------------------------------</div>
                        <div className="text-center font-bold text-[10px] my-1">
                          {settings.footerText}
                        </div>
                      </>
                    )}
                  </div>

                  {/* Talloncino Comanda Salva-Carta */}
                  <div className="bg-white text-black p-3 rounded-xl font-mono text-[10.5px] shadow-md border border-neutral/20 leading-tight">
                    <div className="text-[9px] text-neutral text-center uppercase tracking-widest mb-1 font-sans">Talloncino Comanda Salva-Carta</div>

                    {settings.comandaShowHeader && settings.headerName && (
                      <>
                        <div className="text-center font-bold text-[11px]">{settings.headerName}</div>
                        <div className="text-center text-neutral/40 select-none text-[10px] -my-1">--------------------------------</div>
                      </>
                    )}

                    <div className="flex justify-between items-center text-[10px] font-bold text-neutral/80">
                      <span>#0047  15:20</span>
                      <span>TAV. 12</span>
                    </div>

                    <div className="text-center text-neutral/40 select-none text-[10px] -my-1">--------------------------------</div>

                    <div className="flex justify-between items-center my-1 font-bold text-[11.5px]">
                      <span>1x PANINO SALAMINA</span>
                      {settings.comandaShowPrice && <span>E 5,00</span>}
                    </div>
                    <div className="text-[9px] text-neutral/80 pl-2 mb-1">* Ben cotto</div>

                    {settings.comandaShowGreeting && settings.comandaGreeting && (
                      <>
                        <div className="text-center text-neutral/40 select-none text-[10px] -my-1">--------------------------------</div>
                        <div className="text-center font-bold text-[9.5px] my-1">
                          {settings.comandaGreeting}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── TAB: SETUP ── */}
          {activeTab === "SETUP" && (
            <div className="flex flex-col gap-8">
              <div>
                <h3 className="font-headline-lg text-[28px] font-black text-on-background mb-2">Setup Sistema</h3>
                <p className="text-neutral font-body-md mb-6">Gestisci stazioni cassa e stampanti. Le modifiche si applicano immediatamente.</p>
              </div>

              {/* Sezione collegamento casse aggiuntive — mostra TUTTI gli IP disponibili */}
              <div className="bg-primary-container border border-primary/30 mb-6 p-5 rounded-2xl">
                <h3 className="text-primary font-bold text-lg mb-1 flex items-center gap-2">
                  <span className="material-symbols-outlined">wifi</span> Collega Casse Aggiuntive
                </h3>
                <p className="text-sm text-on-background/70 mb-3">
                  Apri uno di questi indirizzi su ogni computer / tablet cassa aggiuntiva.<br/>
                  <strong>Usa hotspot telefono?</strong> Connetti tutti i dispositivi all&apos;hotspot e usa l&apos;IP che inizia con <code className="text-primary">192.168.x.x</code>.
                </p>
                <div className="flex flex-col gap-2">
                  {serverIPs.length > 0 ? serverIPs.map((ip) => (
                    <div key={ip} className="flex gap-2 items-center">
                      <code className="flex-1 bg-surface-container-high p-2 rounded-lg text-sm break-all font-mono border border-outline-variant text-on-background">
                        http://{ip}:3000
                      </code>
                      <button
                        className="bg-primary text-on-primary px-3 py-2 rounded-lg font-bold shadow-md hover:brightness-110 text-sm flex items-center gap-1"
                        onClick={async () => {
                          await navigator.clipboard.writeText(`http://${ip}:3000`);
                          // Feedback visivo senza alert bloccante
                          const btn = document.getElementById(`copy-btn-${ip.replace(/\./g, '-')}`);
                          if (btn) { btn.textContent = '✓ Copiato!'; setTimeout(() => { btn.textContent = '📋 Copia'; }, 2000); }
                        }}
                      >
                        <span id={`copy-btn-${ip.replace(/\./g, '-')}`}>📋 Copia</span>
                      </button>
                    </div>
                  )) : (
                    <div className="flex gap-2 items-center">
                      <code className="flex-1 bg-surface-container-high p-2 rounded-lg text-sm break-all font-mono border border-outline-variant">
                        {typeof window !== 'undefined' ? `http://${window.location.hostname}:3000` : '...'}
                      </code>
                      <button
                        className="bg-primary text-on-primary px-3 py-2 rounded-lg font-bold shadow-md hover:brightness-110 text-sm"
                        onClick={async () => {
                          if (typeof window !== 'undefined') {
                            await navigator.clipboard.writeText(`http://${window.location.hostname}:3000`);
                          }
                        }}
                      >📋 Copia</button>
                    </div>
                  )}
                </div>
                <p className="text-xs text-on-background/50 mt-3">⚠️ Tutte le casse devono essere connesse alla stessa rete (Wi-Fi, LAN o hotspot)</p>
              </div>

              <div className="bg-surface-container-lowest border border-outline-variant rounded-3xl p-6 shadow-sm">
                <h4 className="font-bold text-lg mb-4 flex items-center gap-2"><span className="material-symbols-outlined text-primary">point_of_sale</span> Stazioni Cassa</h4>
                <form onSubmit={handleAddStation} className="flex gap-3 mb-6">
                  <input type="text" placeholder="Nome nuova stazione (es. Cassa 2)..." value={newStationName} onChange={e => setNewStationName(e.target.value)} className="flex-1 bg-surface-container-high border border-outline-variant rounded-lg p-3 font-body-lg" />
                  <button type="submit" disabled={!newStationName.trim()} className="bg-primary text-on-primary px-5 py-2 rounded-lg font-bold shadow-md hover:brightness-110 disabled:opacity-50 flex items-center gap-2">
                    <span className="material-symbols-outlined text-sm">add</span> Aggiungi
                  </button>
                </form>

                <div className="flex flex-col gap-4">
                  {stations.map(s => (
                    <div key={s.id} className="border border-outline-variant rounded-2xl p-4">
                      <div className="flex justify-between items-center mb-3">
                        <div className="flex items-center gap-3">
                          <span className={`w-3 h-3 rounded-full ${s.status === "ONLINE" ? "bg-success" : "bg-error"}`} />
                          <div>
                            <p className="font-bold text-on-background">{s.name}</p>
                            <p className="text-xs text-neutral font-mono">{s.id.slice(0, 8)}...</p>
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <button onClick={() => setShowPrinterModal(s.id)} className="bg-surface-container-high border border-outline-variant text-on-background px-3 py-1.5 rounded-lg font-bold text-sm flex items-center gap-1 hover:brightness-95">
                            <span className="material-symbols-outlined text-sm">print</span> Stampanti
                          </button>
                          <button onClick={() => handleDeleteStation(s.id)} className="text-error hover:bg-error/10 p-2 rounded-lg transition-colors">
                            <span className="material-symbols-outlined text-sm">delete</span>
                          </button>
                        </div>
                      </div>

                      {/* Stampanti della stazione */}
                      {s.printerConfigs?.length > 0 && (
                        <div className="flex flex-col gap-2 mt-2 pt-2 border-t border-outline-variant/30">
                          <p className="text-xs font-bold text-neutral uppercase tracking-wider mb-1">Stampanti configurate</p>
                          {s.printerConfigs.map((pc: any) => (
                            <div key={pc.id} className="flex justify-between items-center bg-surface-container-high rounded-lg px-3 py-2 text-sm">
                              <div className="flex items-center gap-2">
                                <span className="font-bold">{pc.type === "USB" ? "🔌" : "🌐"}</span>
                                <div>
                                  <span className="font-bold text-on-background">{pc.name}</span>
                                  <span className="ml-2 text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded font-bold">{pc.role}</span>
                                </div>
                              </div>
                              <div className="flex items-center gap-3">
                                <span className="text-xs text-neutral font-mono">
                                  {pc.type === "USB" ? `VID:${pc.usbVendorId?.toString(16).toUpperCase()} PID:${pc.usbProductId?.toString(16).toUpperCase()}` : `${pc.networkHost}:${pc.networkPort}`}
                                </span>
                                <button onClick={() => handleDeletePrinter(pc.id)} className="text-error hover:bg-error/10 p-1 rounded">
                                  <span className="material-symbols-outlined text-sm">delete</span>
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                      {(!s.printerConfigs || s.printerConfigs.length === 0) && (
                        <p className="text-xs text-neutral mt-2 italic">Nessuna stampante configurata — clicca &quot;Stampanti&quot; per aggiungerne una.</p>
                      )}
                    </div>
                  ))}
                  {stations.length === 0 && <p className="text-neutral text-center p-4">Nessuna stazione configurata. Aggiungine una.</p>}
                </div>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
