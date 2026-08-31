"use client";

import { useEffect, useRef, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { getApiBase } from '@/lib/api';

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

interface UseSocketOptions {
  eventId?: string | null;
  stationId?: string | null;
}

/**
 * Hook per la connessione Socket.IO.
 * - Gestisce riconnessione automatica
 * - Espone lo stato della connessione (connecting / connected / disconnected / error)
 * - Si unisce alla stanza evento al connect (e al cambio eventId)
 */
export function useSocket({ eventId, stationId }: UseSocketOptions = {}) {
  const socketRef = useRef<Socket | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>('connecting');

  useEffect(() => {
    const socket = io(getApiBase(), {
      reconnection: true,
      reconnectionDelay: 2000,
      reconnectionDelayMax: 10000,
      reconnectionAttempts: Infinity,
      timeout: 10000,
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      setStatus('connected');
      // Unisciti alla stanza dell'evento per ricevere solo gli aggiornamenti pertinenti
      if (eventId) {
        socket.emit('join-event', eventId);
      }
    });

    socket.on('disconnect', (reason) => {
      setStatus('disconnected');
      console.warn('[Socket] Disconnesso:', reason);
    });

    socket.on('connect_error', (err) => {
      setStatus('error');
      console.warn('[Socket] Errore connessione:', err.message);
    });

    socket.on('reconnect', () => {
      setStatus('connected');
      // Rientra nella stanza dopo la riconnessione
      if (eventId) {
        socket.emit('join-event', eventId);
      }
    });

    socket.on('reconnect_attempt', () => {
      setStatus('connecting');
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // creato una sola volta

  // Rientra nella stanza evento quando eventId cambia
  useEffect(() => {
    if (eventId && socketRef.current?.connected) {
      socketRef.current.emit('join-event', eventId);
    }
  }, [eventId]);

  const on = useCallback((event: string, handler: (...args: any[]) => void) => {
    socketRef.current?.on(event, handler);
    return () => { socketRef.current?.off(event, handler); };
  }, []);

  const emit = useCallback((event: string, ...args: any[]) => {
    socketRef.current?.emit(event, ...args);
  }, []);

  return { socket: socketRef, status, on, emit };
}

/**
 * Componente indicatore visivo dello stato di connessione.
 */
export function ConnectionBadge({ status }: { status: ConnectionStatus }) {
  const config: Record<ConnectionStatus, { color: string; label: string }> = {
    connected:    { color: 'bg-success', label: 'Online' },
    connecting:   { color: 'bg-yellow-400 animate-pulse', label: 'Connessione...' },
    disconnected: { color: 'bg-error', label: 'Offline' },
    error:        { color: 'bg-error animate-pulse', label: 'Errore rete' },
  };

  const { color, label } = config[status];

  return (
    <div className="flex items-center gap-1.5" title={`Stato server: ${label}`}>
      <span className={`w-2.5 h-2.5 rounded-full ${color}`} />
      <span className="text-xs font-bold text-neutral hidden sm:inline">{label}</span>
    </div>
  );
}
